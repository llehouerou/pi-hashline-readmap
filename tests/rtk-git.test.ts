import { describe, it, expect } from "vitest";
import {
  isGitCommand,
  compactStatus,
  compactGitOutput,
} from "../src/rtk/git.js";
import type { Drop } from "../src/rtk/drops.js";
import { filterBashOutput } from "../src/rtk/bash-filter.js";
import { stripAnsi } from "../src/rtk/ansi.js";

describe("isGitCommand", () => {
  it("matches git status", () => {
    expect(isGitCommand("git status")).toBe(true);
  });

  it("rejects git diff, git show and git log, which pass through untouched", () => {
    expect(isGitCommand("git diff")).toBe(false);
    expect(isGitCommand("git show HEAD")).toBe(false);
    expect(isGitCommand("git log --oneline")).toBe(false);
  });
  it("rejects npm install", () => {
    expect(isGitCommand("npm install")).toBe(false);
  });

  it("rejects cargo test", () => {
    expect(isGitCommand("cargo test")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isGitCommand(undefined)).toBe(false);
  });

  it("rejects null", () => {
    expect(isGitCommand(null)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isGitCommand("")).toBe(false);
  });
});

describe("compactStatus", () => {
  it("returns clean for empty output", () => {
    expect(compactStatus("")).toBe("Clean working tree");
  });

  it("shows branch name and staged files", () => {
    const output = [
      "## main...origin/main",
      "M  src/foo.ts",
      "A  src/bar.ts",
    ].join("\n");

    const result = compactStatus(output);
    expect(result).toContain("main");
    expect(result).toContain("Staged");
    expect(result).toContain("2 files");
  });

  it("shows modified files", () => {
    const output = [
      "## feature",
      " M src/changed.ts",
    ].join("\n");

    const result = compactStatus(output);
    expect(result).toContain("Modified");
    expect(result).toBe("📌 feature\n📝 Modified: 1 files\n  src/changed.ts");
  });

  it("shows untracked files", () => {
    const output = [
      "## main",
      "?? newfile.ts",
    ].join("\n");

    const result = compactStatus(output);
    expect(result).toContain("Untracked");
    expect(result).toContain("newfile.ts");
  });

  it("keeps the branch line's tracking and lists a conflict under Conflicts, not Staged", () => {
    const output = ["## main...origin/main [ahead 1]", "DU a.ts", "M  b.ts", ""].join("\n");
    expect(compactStatus(output)).toBe(
      ["📌 main...origin/main [ahead 1]", "✅ Staged: 1 files", "  b.ts", "⚠️ Conflicts: 1 files", "  DU a.ts"].join("\n"),
    );
  });

  // The unmerged pairs of git-status(1)'s short-format table.
  it.each(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])("lists %s only under Conflicts", (code) => {
    expect(compactStatus(`## main\n${code} a.ts`)).toBe(`📌 main\n⚠️ Conflicts: 1 files\n  ${code} a.ts`);
  });

  it("never cuts the conflicts", () => {
    const conflicts = Array.from({ length: 7 }, (_, i) => `UU c${i}.ts`);
    const drops: Drop[] = [];
    const result = compactStatus(["## main", ...conflicts].join("\n"), drops);
    expect(result).toBe(["📌 main", "⚠️ Conflicts: 7 files", ...conflicts.map((line) => `  ${line}`)].join("\n"));
    expect(drops).toEqual([]);
  });

  it("lists type changes and intent-to-add as changes, and ignored files under Ignored, cut at 3", () => {
    const ignored = Array.from({ length: 5 }, (_, i) => `!! build/${i}.o`);
    const drops: Drop[] = [];
    const result = compactStatus(["## main", "T  link", " T tool", " A intent.ts", ...ignored].join("\n"), drops);
    expect(result).toBe(
      [
        ...["📌 main", "✅ Staged: 1 files", "  link", "📝 Modified: 2 files", "  tool", "  intent.ts"],
        ...["🚫 Ignored: 5 files", "  build/0.o", "  build/1.o", "  build/2.o", "  ... and 2 more files"],
      ].join("\n"),
    );
    expect(drops).toEqual([{ count: 2, unit: "files" }]);
  });

  it("preserves unsupported long-form status output across working-tree states", () => {
    const outputs = [
      [
        "On branch main",
        "Changes not staged for commit:",
        "  (use \"git add <file>...\" to update what will be committed)",
        "  (use \"git restore <file>...\" to discard changes in working directory)",
        "",
        "\tmodified:   src/changed.ts",
        "",
        "no changes added to commit (use \"git add\" and/or \"git commit -a\")",
      ].join("\n"),
      [
        "On branch main",
        "nothing to commit, working tree clean",
      ].join("\n"),
      [
        "On branch main",
        "Changes to be committed:",
        "  (use \"git restore --staged <file>...\" to unstage)",
        "",
        "\tnew file:   src/staged.ts",
      ].join("\n"),
      [
        "On branch main",
        "Untracked files:",
        "  (use \"git add <file>...\" to include in what will be committed)",
        "",
        "\tsrc/untracked.ts",
      ].join("\n"),
      [
        "On branch main",
        "You have unmerged paths.",
        "  (fix conflicts and run \"git commit\")",
        "",
        "Unmerged paths:",
        "  (use \"git add <file>...\" to mark resolution)",
        "",
        "\tboth modified:   src/conflicted.ts",
      ].join("\n"),
      [
        "## main",
        " M src/changed.ts",
        "post-processing output",
      ].join("\n"),
    ];

    for (const output of outputs) {
      expect(compactStatus(output)).toBe(output);
    }
  });
});

describe("compactGitOutput", () => {
  it("passes git diff, git show and git log output through untouched", () => {
    const lines = ["diff --git a/f.ts b/f.ts", "--- a/f.ts", "+++ b/f.ts", "@@ -1,300 +1,300 @@"];
    for (let i = 0; i < 300; i++) lines.push(`+added line ${i}`);
    const output = lines.join("\n");
    const log = Array.from({ length: 50 }, (_, i) => `abc${i}def ${"long commit subject ".repeat(6)}${i}`).join("\n");

    expect(compactGitOutput(output, "git diff")).toBeNull();
    expect(compactGitOutput(output, "git diff --cached -- f.ts")).toBeNull();
    expect(compactGitOutput(output, "git show HEAD")).toBeNull();
    expect(compactGitOutput(log, "git log --oneline -50")).toBeNull();
    expect(compactGitOutput(output, "git log -p")).toBeNull();
  });

  it("dispatches git status to compactStatus", () => {
    const result = compactGitOutput("## main\n?? new.ts", "git status --short");
    expect(result).not.toBeNull();
    expect(result).toContain("main");
  });

  it("returns null for non-git commands", () => {
    expect(compactGitOutput("output", "npm test")).toBeNull();
  });

  it("returns null for unrecognized git subcommands", () => {
    expect(compactGitOutput("output", "git push origin main")).toBeNull();
  });
});

// Real git 2.56.0 output: a file of 4 lines `line oldN` edited to `line newN`.
describe("word diffs pass through", () => {
  const header = ["diff --git a/f.txt b/f.txt", "index 41377b5..2217a90 100644", "--- a/f.txt", "+++ b/f.txt", "@@ -1,4 +1,4 @@"];
  const plain = [...header, ...[1, 2, 3, 4].map((n) => `line [-old${n}-]{+new${n}+}`)].join("\n") + "\n";
  const regex = [...header, ...[1, 2, 3, 4].map((n) => `line [-old-]{+new+}${n}`)].join("\n") + "\n";
  const porcelain = [...header, ...[1, 2, 3, 4].flatMap((n) => [" line ", `-old${n}`, `+new${n}`, "~"])].join("\n") + "\n";
  // `--color-words` marks words by colour alone; `filterBashOutput` strips it before any route.
  const colorWords = [...header.map((l) => `\x1b[1m${l}\x1b[m`), ...[1, 2, 3, 4].map((n) => `line \x1b[31mold${n}\x1b[m\x1b[32mnew${n}\x1b[m`)].join("\n") + "\n";

  it.each([
    ["git diff --word-diff=plain", plain],
    ["git diff --word-diff", plain],
    ["git diff '--word-diff=plain'", plain],
    ["git diff --word-diff=porcelain", porcelain],
    ["git diff --word-diff-regex '[a-z]+'", regex],
    ["git diff --word-diff-regex=[a-z]+", regex],
    ["git diff --color-words", colorWords],
    ["git diff --color-words='[a-z]+'", colorWords],
    ["cd sub && git diff HEAD~1 --word-diff=plain -- f.txt", plain],
  ])("%s keeps every line, dropping nothing", (command, output) => {
    const result = filterBashOutput(command, output);
    expect(result.output).toBe(stripAnsi(output));
    expect(result.compacted).toBe(false);
    expect(result.dropped).toEqual([]);
  });
});
