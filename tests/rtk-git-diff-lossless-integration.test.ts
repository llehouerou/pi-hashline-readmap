import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cleanup: string[] = [];

const plainDiff = [
  "diff --git a/fixture.txt b/fixture.txt",
  "--- a/fixture.txt",
  "+++ b/fixture.txt",
  "@@ -1,3 +1,4 @@",
  " keep",
  "---option was here",
  "+--option now here",
  "-normal",
  "+normal2",
  "+++plusplus",
  "\\ No newline at end of file",
  "diff --git a/new.txt b/new.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/new.txt",
  "@@ -0,0 +1 @@",
  "+++new front matter",
  "\\ No newline at end of file",
].join("\n");
const ansiDiff = plainDiff
  .replace("---option was here", "\x1b[31m---option was here\x1b[0m")
  .replace("+++plusplus", "\x1b[32m+++plusplus\x1b[0m");

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function loadToolResultHandler() {
  const handlers: Record<string, Function> = {};
  const mockPi = {
    registerTool() {},
    on(event: string, handler: Function) {
      handlers[event] = handler;
    },
    events: { emit() {}, on() {} },
  };
  const url = `${pathToFileURL(resolve(root, "index.ts")).href}?issue-231-diff=${Date.now()}`;
  const mod = await import(url);
  mod.default(mockPi as any);
  return handlers.tool_result;
}

function writeFullOutput(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hashline-231-diff-"));
  cleanup.push(dir);
  const path = join(dir, "full-output.txt");
  writeFileSync(path, text, "utf8");
  return path;
}

function bashEvent(id: string, fullOutputPath: string, isError: boolean) {
  return {
    type: "tool_result" as const,
    toolName: "bash",
    toolCallId: id,
    input: { command: "git diff" },
    content: [{ type: "text" as const, text: "pi-visible diff tail" }],
    isError,
    details: { fullOutputPath },
  };
}

describe("git diff passes through RTK untouched", () => {
  it("returns the whole ANSI-stripped diff, headers and all", async () => {
    const handleToolResult = await loadToolResultHandler();
    const fullOutputPath = writeFullOutput(ansiDiff);
    const result = await handleToolResult(bashEvent("diff-success", fullOutputPath, false));

    expect(result.content[0].text).toBe(plainDiff);
    expect(result.details.compressionInfo.technique).toBe("none");
    expect(result.details.rtkCompaction).toMatchObject({
      applied: false,
      techniques: [],
      truncated: false,
    });
  });
  it("keeps isError as an unconditional ANSI-stripped fallback", async () => {
    const handleToolResult = await loadToolResultHandler();
    const result = await handleToolResult(
      bashEvent("diff-failed", writeFullOutput(ansiDiff), true),
    );

    expect(result.content[0].text).toBe(plainDiff);
    expect(result.details.compressionInfo.technique).toBe("none");
    expect(result.details.rtkCompaction).toMatchObject({
      applied: false,
      techniques: [],
      truncated: false,
    });
    expect(result.details.ptcValue.rtkCompaction).toEqual(result.details.rtkCompaction);
  });
});
