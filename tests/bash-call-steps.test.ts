import { describe, expect, it } from "vitest";
import { registerBashRendererTool, splitShellSteps } from "../src/bash-renderer.js";

const theme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };
const textOf = (component: any): string => component?.text ?? "";

describe("splitShellSteps", () => {
  it("splits top-level &&, || and ; plus newlines, keeping the operator", () => {
    expect(splitShellSteps("cd x && make || echo fail; ls\ngit status")).toEqual([
      "cd x &&",
      "make ||",
      "echo fail;",
      "ls",
      "git status",
    ]);
  });

  it("keeps quoted, escaped and parenthesized operators whole", () => {
    expect(splitShellSteps(`echo "a && b" 'c; d' e\\;f && x=$(a && b) && (cd y; make) 2>&1 | tee log`)).toEqual([
      `echo "a && b" 'c; d' e\\;f &&`,
      "x=$(a && b) &&",
      "(cd y; make) 2>&1 | tee log",
    ]);
  });

  it("drops blank lines and returns nothing for an empty command", () => {
    expect(splitShellSteps("a\n\n  \nb")).toEqual(["a", "b"]);
    expect(splitShellSteps("")).toEqual([]);
  });
});

describe("bash renderCall", () => {
  let tool: any;
  registerBashRendererTool({ registerTool(def: any) { tool = def; } } as any);
  const command = Array.from({ length: 12 }, (_, i) => `step${i + 1}`).join(" && ");

  it("shows one step per line, capped at 10 when collapsed", () => {
    const lines = textOf(tool.renderCall({ command }, theme, { expanded: false })).split("\n");
    expect(lines[0]).toBe("bash step1 &&");
    expect(lines[1]).toBe("     step2 &&");
    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe("     … (2 more • Ctrl+O to expand)");
  });

  it("shows every step when expanded", () => {
    const lines = textOf(tool.renderCall({ command }, theme, { expanded: true })).split("\n");
    expect(lines).toHaveLength(12);
    expect(lines[11]).toBe("     step12");
  });
});
