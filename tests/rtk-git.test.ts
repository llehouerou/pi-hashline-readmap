import { describe, it, expect } from "vitest";
import {
  isGitCommand,
  compactStatus,
  compactLog,
  compactGitOutput,
} from "../src/rtk/git.js";
import { gitLog, gitLogGraph, gitLogOneline, sha } from "./helpers/git-log-fixture.js";
import type { Drop } from "../src/rtk/drops.js";
import { filterBashOutput } from "../src/rtk/bash-filter.js";
import { stripAnsi } from "../src/rtk/ansi.js";

describe("isGitCommand", () => {
  it("matches git status", () => {
    expect(isGitCommand("git status")).toBe(true);
  });

  it("matches git log", () => {
    expect(isGitCommand("git log --oneline")).toBe(true);
  });

  it("rejects git diff and git show, which pass through untouched", () => {
    expect(isGitCommand("git diff")).toBe(false);
    expect(isGitCommand("git show HEAD")).toBe(false);
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

describe("compactLog", () => {
  it("returns a log within 20 commits unchanged", () => {
    for (const log of [gitLog(3), gitLog(20)]) expect(compactLog(log)).toBe(log);
  });

  it("keeps 20 whole commits, bodies uncut, and counts the dropped commits", () => {
    const log = gitLog(30);
    const kept = log.slice(0, log.indexOf(`commit ${sha(20)}`));
    expect(compactLog(log)).toBe(`${kept}... and 10 more commits`);
  });

  it("splits --graph output at its prefixed commit headers", () => {
    const log = gitLogGraph(30);
    const kept = log.slice(0, log.indexOf(`* commit ${sha(20)}`));
    expect(compactLog(log)).toBe(`${kept}... and 10 more commits`);
  });

  it("counts a merge and a side-branch commit in --graph output as headers", () => {
    const log = [
      `*   commit ${sha(1)}`,
      "|\\  Merge: aaaaaaa bbbbbbb",
      `| * commit ${sha(2)}`,
      "|/  Author: A <a@example.test>",
      `* commit ${sha(3)}`,
      "  Author: A <a@example.test>",
    ].join("\n");
    expect(compactLog(log, 2)).toBe(`${log.split("\n").slice(0, 4).join("\n")}\n... and 1 more commits`);
  });

  // Header shapes measured from git 2.x: side marks without --graph, node markers and a blank first column with it.
  it.each([
    ["--left-right", ["commit < SHA", "commit > SHA"]],
    ["--boundary", ["commit - SHA"]],
    ["--cherry-mark", ["commit + SHA", "commit = SHA"]],
    ["--graph --left-right", ["< commit SHA", "  > commit SHA"]],
    ["--graph --boundary", ["o commit SHA", "o | commit SHA"]],
    ["--graph with a blank first column", ["  * commit SHA", "|   * commit SHA"]],
    ["--graph octopus merge", ["*---.   commit SHA"]],
    ["--abbrev-commit --abbrev=4", ["commit 5bcd"]],
  ])("counts %s headers", (_, shapes) => {
    const headers = [`commit ${sha(0)}`, ...shapes.map((shape, i) => shape.replace("SHA", sha(i + 1)))];
    const log = headers.map((header) => `${header}\nAuthor: A <a@example.test>`).join("\n");
    expect(compactLog(log, 1)).toBe(`${headers[0]}\nAuthor: A <a@example.test>\n... and ${shapes.length} more commits`);
  });

  it("keeps 20 lines of headerless output and counts the dropped lines", () => {
    const log = gitLogOneline(30);
    const kept = log.split("\n").slice(0, 20).join("\n");
    expect(compactLog(log)).toBe(`${kept}\n... and 10 more lines`);
  });

  it("does not count a trailing newline as a dropped line", () => {
    const log = gitLogOneline(20);
    expect(compactLog(log)).toBe(log);
  });

  it("honors a custom limit", () => {
    expect(compactLog(gitLogOneline(20), 5)).toMatch(/\n\.\.\. and 15 more lines$/);
    expect(compactLog(gitLog(20), 5)).toMatch(/\n\.\.\. and 15 more commits$/);
  });
});

describe("compactGitOutput", () => {
  it("passes git diff and git show output through untouched", () => {
    const lines = ["diff --git a/f.ts b/f.ts", "--- a/f.ts", "+++ b/f.ts", "@@ -1,300 +1,300 @@"];
    for (let i = 0; i < 300; i++) lines.push(`+added line ${i}`);
    const output = lines.join("\n");

    expect(compactGitOutput(output, "git diff")).toBeNull();
    expect(compactGitOutput(output, "git diff --cached -- f.ts")).toBeNull();
    expect(compactGitOutput(output, "git show HEAD")).toBeNull();
  });

  it("dispatches git status to compactStatus", () => {
    const result = compactGitOutput("## main\n?? new.ts", "git status --short");
    expect(result).not.toBeNull();
    expect(result).toContain("main");
  });

  it("dispatches git log to compactLog", () => {
    const result = compactGitOutput("commit 1\ncommit 2", "git log --oneline");
    expect(result).not.toBeNull();
    expect(result).toContain("commit 1");
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
