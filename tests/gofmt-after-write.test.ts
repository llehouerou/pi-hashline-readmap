import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import init from "../index.js";
import { computeLineHash, ensureHashInit } from "../src/hashline.js";

// Stand-in for gofmt: indents with a tab instead of four spaces, rejects "SYNTAX_ERROR" like a parse error.
const FAKE_GOFMT = `#!/bin/sh
input=$(cat)
case "$input" in
  *SYNTAX_ERROR*) echo "<standard input>:3:1: expected declaration, found SYNTAX_ERROR" >&2; exit 2 ;;
esac
printf '%s\\n' "$input" | sed 's/^    /\t/'
`;

const UNFORMATTED = "package main\n\nfunc main() {\n    println(1)\n}\n";
const FORMATTED = "package main\n\nfunc main() {\n\tprintln(1)\n}\n";

const originalPath = process.env.PATH;
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function useFakeGofmt(): void {
  const bin = tempDir("fake-gofmt-");
  writeFileSync(join(bin, "gofmt"), FAKE_GOFMT);
  chmodSync(join(bin, "gofmt"), 0o755);
  process.env.PATH = `${bin}:${originalPath}`;
}

function session() {
  const dir = tempDir("gofmt-session-");
  const tools = new Map<string, any>();
  const handlers: Record<string, Function> = {};
  init({
    registerTool(definition: any) { tools.set(definition.name, definition); },
    on(event: string, handler: Function) { handlers[event] = handler; },
    events: { emit() {}, on() {} },
  } as any);
  let next = 0;
  async function call(name: string, params: Record<string, unknown>) {
    const tool = tools.get(name);
    const id = `call-${next++}`;
    handlers.context?.({ type: "context", messages: [] });
    await handlers.tool_call?.({ type: "tool_call", toolName: name, toolCallId: id, input: params }, { cwd: dir });
    const result = await tool.execute(id, params, new AbortController().signal, undefined, { cwd: dir });
    const patched = await handlers.tool_result?.(
      { type: "tool_result", toolName: name, toolCallId: id, input: params, content: result.content, details: result.details, isError: result.isError === true },
      { cwd: dir },
    );
    const final = patched ? { ...result, ...patched } : result;
    const text = final.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    return { text, isError: final.isError === true, details: final.details };
  }
  return {
    call,
    write: (path: string, content: string) => call("write", { path, content }),
    bytes: (path: string) => readFileSync(join(dir, path), "utf8"),
    put: (path: string, content: string) => writeFileSync(join(dir, path), content),
  };
}

beforeAll(async () => {
  await ensureHashInit();
});

beforeEach(() => {
  process.env.PATH = originalPath;
});

afterEach(() => {
  process.env.PATH = originalPath;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("gofmt after write", () => {
  it("writes a .go file formatted and returns anchors of the formatted file", async () => {
    useFakeGofmt();
    const s = session();
    const written = await s.write("main.go", UNFORMATTED);

    expect(written.isError).toBe(false);
    expect(s.bytes("main.go")).toBe(FORMATTED);
    const bodyLine = written.details.ptcValue.lines.find((line: any) => line.line === 4);
    expect(bodyLine.raw).toBe("\tprintln(1)");

    // The returned anchor is accepted as-is: it describes the file on disk.
    const edited = await s.call("edit", { path: "main.go", edits: [{ set_line: { anchor: bodyLine.anchor, new_text: "\tprintln(2)" } }] });
    expect(edited.isError).toBe(false);
    expect(s.bytes("main.go")).toBe(FORMATTED.replace("println(1)", "println(2)"));
  });

  it("keeps the written content and appends gofmt's error when gofmt rejects it", async () => {
    useFakeGofmt();
    const s = session();
    const broken = "package main\n\nSYNTAX_ERROR\n    x\n";
    const written = await s.write("main.go", broken);

    expect(written.isError).toBe(false);
    expect(s.bytes("main.go")).toBe(broken);
    expect(written.text).toContain("gofmt failed; the file was written unformatted:");
    expect(written.text).toMatch(/main\.go:3:1: expected declaration, found SYNTAX_ERROR/);
    expect(written.details.ptcValue.warnings).toContainEqual(expect.objectContaining({ code: "gofmt-failed" }));
  });

  it("leaves non-Go files alone", async () => {
    useFakeGofmt();
    const s = session();
    await s.write("notes.txt", UNFORMATTED);
    expect(s.bytes("notes.txt")).toBe(UNFORMATTED);
  });

  it("skips silently when gofmt is not on PATH", async () => {
    process.env.PATH = tempDir("no-gofmt-");
    const s = session();
    const written = await s.write("main.go", UNFORMATTED);

    expect(s.bytes("main.go")).toBe(UNFORMATTED);
    expect(written.text).not.toContain("gofmt");
  });
});

describe("gofmt after edit", () => {
  it("formats the edited .go file, and its anchors stay valid for the next edit", async () => {
    useFakeGofmt();
    const s = session();
    s.put("main.go", FORMATTED);
    await s.call("read", { path: "main.go" });

    const first = await s.call("edit", { path: "main.go", edits: [{ replace: { old_text: "\tprintln(1)", new_text: "    println(1)\n    println(2)" } }] });
    expect(first.isError).toBe(false);
    expect(s.bytes("main.go")).toBe("package main\n\nfunc main() {\n\tprintln(1)\n\tprintln(2)\n}\n");

    // No re-read: the edit's own result must leave the formatted file fresh.
    const anchor = `5:${computeLineHash(5, "\tprintln(2)")}`;
    const second = await s.call("edit", { path: "main.go", edits: [{ set_line: { anchor, new_text: "\tprintln(3)" } }] });
    expect(second.isError).toBe(false);
    expect(s.bytes("main.go")).toBe("package main\n\nfunc main() {\n\tprintln(1)\n\tprintln(3)\n}\n");
  });

  it("writes the edit unformatted and reports gofmt's error on a syntax error", async () => {
    useFakeGofmt();
    const s = session();
    s.put("main.go", FORMATTED);

    const edited = await s.call("edit", { path: "main.go", edits: [{ replace: { old_text: "func main() {", new_text: "SYNTAX_ERROR {" } }] });
    expect(edited.isError).toBe(false);
    expect(s.bytes("main.go")).toBe(FORMATTED.replace("func main() {", "SYNTAX_ERROR {"));
    expect(edited.text).toContain("gofmt failed; the file was written unformatted:");
  });
});
