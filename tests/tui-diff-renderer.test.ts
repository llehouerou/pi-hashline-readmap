import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderTuiDiff } from "../src/tui-diff-renderer.js";
import { diffPalette } from "../src/tui-diff-palette.js";
import { highlightDiffEntries } from "../src/tui-diff-syntax.js";
import type { DiffData } from "../src/diff-data.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import { vi } from "vitest";
import { initTheme, keyHint } from "@earendil-works/pi-coding-agent";

vi.unmock("@earendil-works/pi-coding-agent");
initTheme("dark", false);
// The initialized Theme instance behind pi's `theme` proxy, as pi passes it to tool renderers.
const hostTheme = (globalThis as any)[Symbol.for("@earendil-works/pi-coding-agent:theme")];
const hostEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const hostTui = await import(pathToFileURL(
  createRequire(hostEntry).resolve("@earendil-works/pi-tui")
).href);
const { KeybindingsManager: HostKeybindingsManager } = await import(
  new URL("./core/keybindings.js", hostEntry).href
);
const previousBindings = hostTui.getKeybindings();
beforeEach(() => hostTui.setKeybindings(new HostKeybindingsManager()));
afterEach(() => hostTui.setKeybindings(previousBindings));

const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
const diffData: DiffData = { version: 1, stats: { added: 2, removed: 1, context: 1 }, entries: [
  { kind: "context", oldLine: 1, newLine: 1, text: "one" },
  { kind: "remove", oldLine: 2, text: "two" },
  { kind: "add", newLine: 2, text: "TWO" },
  { kind: "add", newLine: 3, text: "three" },
], inlineDiffs: [{ removeLineIndex: 1, addLineIndex: 2, removeSpans: [{ kind: "remove", text: "two" }], addSpans: [{ kind: "add", text: "TWO" }] }] };

const identityTheme = { fg: (_kind: string, text: string) => text } as any;

const markerDiffData: DiffData = {
  version: 1,
  entries: [
    { kind: "remove", oldLine: 1, text: "one" },
    { kind: "add", newLine: 1, text: "ONE" },
    { kind: "context", oldLine: 2, newLine: 2, text: "two" },
  ],
  stats: { added: 1, removed: 1, context: 1 },
  blockRanges: [{ kind: "add", startLine: 1, endLine: 2 }],
};

const identicalSameLineDiffData: DiffData = {
  version: 1,
  entries: [
    { kind: "remove", oldLine: 1, text: "same" },
    { kind: "add", newLine: 1, text: "same" },
  ],
  stats: { added: 1, removed: 1, context: 0 },
  blockRanges: [{ kind: "add", startLine: 1, endLine: 1 }],
};

describe("renderTuiDiff", () => {
  it("renders unified, compact, split, and summary modes within width", () => {
    const wide = renderTuiDiff({ diffData, width: 120, theme, expanded: true });
    expect(wide.mode).toBe("split");
    expect(wide.lines.join("\n")).toContain("old");
    expect(wide.lines.join("\n")).toContain("new");
    const normal = renderTuiDiff({ diffData, width: 80, theme, expanded: true });
    expect(normal.mode).toBe("unified");
    expect(normal.lines[0]).toBe("↳ diff +2 -1 • 1 hunk • unified");
    expect(normal.lines.join("\n")).toContain("2 + TWO");
    expect(renderTuiDiff({ diffData, width: 80, theme, expanded: true, path: "/repo/src/sample.ts" }).lines[0])
      .toBe("↳ diff sample.ts +2 -1 • 1 hunk • unified");
    const narrow = renderTuiDiff({ diffData, width: 28, theme, expanded: true });
    expect(narrow.mode).toBe("compact");
    expect(narrow.lines[0]).toBe("↳ diff +2 -1");
    const tiny = renderTuiDiff({ diffData, width: 10, theme, expanded: true });
    expect(tiny.mode).toBe("summary");
    expect(tiny.lines).toEqual(["↳ diff +2"]);
    for (const rendered of [wide, normal, narrow, tiny]) expect(rendered.lines.every((line) => visibleWidth(line) <= rendered.width)).toBe(true);
  });

  it("emits textual gutter markers without relying on color", () => {
    const normal = renderTuiDiff({ diffData: markerDiffData, width: 80, theme: identityTheme, expanded: true });
    expect(normal.lines.slice(1)).toEqual(["1 - one", "1 + ONE", "2   two"]);
  });

  it("same-line add and remove rows with identical text are distinct when color is stripped", () => {
    const normal = renderTuiDiff({ diffData: identicalSameLineDiffData, width: 80, theme: identityTheme, expanded: true });
    const bodyRows = normal.lines.filter((line) => line.includes("same"));
    expect(bodyRows).toEqual(["1 - same", "1 + same"]);
  });

  it("compact and split modes also emit textual gutter markers", () => {
    const compact = renderTuiDiff({ diffData: markerDiffData, width: 28, theme: identityTheme, expanded: true });
    expect(compact.mode).toBe("compact");
    expect(compact.lines.slice(1)).toEqual(["1 - one", "1 + ONE"]);

    const split = renderTuiDiff({ diffData: markerDiffData, width: 120, theme: identityTheme, expanded: true });
    expect(split.mode).toBe("split");
    const splitText = split.lines.join("\n");
    expect(splitText).toMatch(/^1 - one\s+│ $/m);
    expect(splitText).toMatch(/^\s+│ 1 \+ ONE$/m);
    expect(splitText).toMatch(/^2   two\s+│ 2   two$/m);
  });

  it("separates hunks with the line number they start at", () => {
    const twoHunks: DiffData = { version: 1, stats: { added: 1, removed: 1, context: 0 }, entries: [
      { kind: "remove", oldLine: 3, text: "a" },
      { kind: "meta", text: "   ..." },
      { kind: "add", newLine: 40, text: "b" },
    ] };
    const out = renderTuiDiff({ diffData: twoHunks, width: 30, theme: identityTheme, expanded: true });
    expect(out.lines[0]).toBe("↳ diff +1 -1");
    expect(out.lines.slice(1)).toEqual([" 3 - a", `╌╌ line 40 ${"╌".repeat(19)}`, "40 + b"]);
    expect(renderTuiDiff({ diffData: twoHunks, width: 80, theme: identityTheme, expanded: true }).lines[0]).toBe("↳ diff +1 -1 • 2 hunks • unified");
  });

  it("renders a collapsed preview without header, hinting only when rows are hidden", () => {
    const collapsed = renderTuiDiff({ diffData, width: 80, theme, expanded: false });
    expect(collapsed.mode).toBe("unified");
    expect(collapsed.lines).toEqual(["1   one", "2 - two", "2 + TWO", "3 + three"]);
    expect(renderTuiDiff({ diffData, width: 120, theme, expanded: false }).mode).toBe("unified");
    expect(renderTuiDiff({ diffData, width: 8, theme, expanded: false }).lines).toEqual([]);
    expect(renderTuiDiff({ diffData, width: 80, theme, expanded: false, collapsedLines: 0 }).lines).toEqual([]);
  });

  it("caps the collapsed preview at collapsedLines rendered rows with minimal context", () => {
    const entries: DiffData["entries"] = [];
    for (let n = 1; n <= 6; n++) entries.push({ kind: "context", oldLine: n, newLine: n, text: `ctx ${n}` });
    for (let n = 7; n <= 26; n++) entries.push({ kind: "add", newLine: n, text: `added ${n}` });
    entries.push({ kind: "context", oldLine: 7, newLine: 27, text: "after" });
    entries.push({ kind: "meta", text: "   ..." });
    entries.push({ kind: "remove", oldLine: 50, text: "gone" });
    const big: DiffData = { version: 1, stats: { added: 20, removed: 1, context: 7 }, entries };
    for (const width of [30, 60, 80, 140]) {
      const out = renderTuiDiff({ diffData: big, width, theme: identityTheme, expanded: false, collapsedLines: 5 });
      expect(out.lines).toHaveLength(6);
      for (const line of out.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    const out = renderTuiDiff({ diffData: big, width: 80, theme: identityTheme, expanded: false, collapsedLines: 5 });
    // Only the context line adjacent to the change survives.
    expect(out.lines.slice(0, 5)).toEqual([" 6   ctx 6", " 7 + added 7", " 8 + added 8", " 9 + added 9", "10 + added 10"]);
    expect(out.lines[5]).toBe(`… (23 more diff lines • 1 more hunk • ${keyHint("app.tools.expand", "to expand")})`);
    // The hunk separator counts against the budget too.
    const all = renderTuiDiff({ diffData: big, width: 80, theme: identityTheme, expanded: false, collapsedLines: 30 });
    expect(all.lines.slice(-5)).toEqual(["26 + added 26", "27   after", `╌╌ line 50 ${"╌".repeat(69)}`, "50 - gone",
      `… (5 more diff lines • ${keyHint("app.tools.expand", "to expand")})`]);
    // Wrapped rows count against the budget.
    const longEntry: DiffData = { version: 1, stats: { added: 1, removed: 0, context: 0 }, entries: [{ kind: "add", newLine: 1, text: "word ".repeat(80) }] };
    const wrapped = renderTuiDiff({ diffData: longEntry, width: 40, theme: identityTheme, expanded: false, collapsedLines: 3 });
    expect(wrapped.lines).toHaveLength(3);
  });

  it("wraps long diff rows with hanging indent instead of truncating with ellipsis", () => {
    const longText = "the quick brown fox jumps over the lazy dog and keeps going far past the right edge";
    const longDiffData: DiffData = {
      version: 1,
      entries: [
        { kind: "remove", oldLine: 1, text: longText },
        { kind: "add", newLine: 1, text: longText.toUpperCase() },
        { kind: "context", oldLine: 2, newLine: 2, text: "tail" },
      ],
      stats: { added: 1, removed: 1, context: 1 },
    };
    const width = 60;
    const out = renderTuiDiff({ diffData: longDiffData, width, theme: identityTheme, expanded: true });
    expect(out.mode).toBe("unified");
    for (const line of out.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    expect(out.lines.some((line) => line.endsWith("..."))).toBe(false);
    const removeIdx = out.lines.findIndex((line) => line.startsWith("1 - "));
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    const indent = " ".repeat(4);
    expect(out.lines[removeIdx + 1]?.startsWith(indent)).toBe(true);
    const reassembled = [out.lines[removeIdx]!.slice(4)];
    let cursor = removeIdx + 1;
    while (cursor < out.lines.length && out.lines[cursor]!.startsWith(indent)) {
      reassembled.push(out.lines[cursor]!.slice(indent.length));
      cursor++;
    }
    const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(collapse(reassembled.join(" "))).toBe(collapse(longText));
  });

  it("falls back to unified mode for pure-add diffs even when the pane is wide enough for split", () => {
    const pureAdd: DiffData = {
      version: 1,
      entries: [
        { kind: "add", newLine: 1, text: "first added line" },
        { kind: "add", newLine: 2, text: "second added line" },
        { kind: "add", newLine: 3, text: "third added line" },
      ],
      stats: { added: 3, removed: 0, context: 0 },
    };
    const out = renderTuiDiff({ diffData: pureAdd, width: 160, theme: identityTheme, expanded: true });
    expect(out.mode).toBe("unified");
    const text = out.lines.join("\n");
    expect(text).toContain("1 + first added line");
    expect(text).not.toMatch(/^old\s+│ new$/m);
  });

  it("tints rows by kind when the theme exposes no colors", () => {
    const colorTheme = {
      fg: (kind: string, text: string) => `<${kind}>${text}</${kind}>`,
      bold: (text: string) => text,
    } as any;
    const out = renderTuiDiff({ diffData: markerDiffData, width: 140, theme: colorTheme, expanded: true });
    expect(out.mode).toBe("split");
    const text = out.lines.join("\n");
    expect(text).toContain("<error>1 - one</error>");
    expect(text).toContain("<success>1 + ONE</success>");
    expect(text.match(/<toolOutput>2   two<\/toolOutput>/g)).toHaveLength(2);
  });
});

describe("renderTuiDiff with the pi theme", () => {
  const piTheme = hostTheme;
  const strip = (s: string) => plain(s);
  const bgOf = (code: string) => code.replace("\x1b[", "").replace("m", "");

  it("fills changed rows with a theme-derived background over the full width", () => {
    const palette = diffPalette(piTheme, "toolSuccessBg")!;
    expect(palette).toBeDefined();
    const restore = piTheme.getBgAnsi("toolSuccessBg");
    expect(palette.restore).toBe(restore);
    for (const code of [palette.add, palette.remove, palette.addStrong, palette.removeStrong]) {
      expect(code).toMatch(/^\x1b\[48;2;\d+;\d+;\d+m$/);
      expect(code).not.toBe(restore);
    }
    for (const width of [60, 80, 120]) {
      for (const expanded of [true, false]) {
        const out = renderTuiDiff({ diffData, width, theme: piTheme, expanded, path: "sample.ts" });
        for (const line of out.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        const unifiedWidth = out.mode === "split" ? Math.floor((width - 3) / 2) : width;
        const addRow = out.lines.find((line) => strip(line).includes("+ three"))!;
        expect(addRow).toContain(palette.add);
        expect(addRow.endsWith(restore)).toBe(true);
        if (out.mode !== "split") expect(addRow.startsWith(palette.add)).toBe(true);
        if (out.mode !== "split") expect(visibleWidth(addRow)).toBe(unifiedWidth);
        const contextRow = out.lines.find((line) => strip(line).includes("one"))!;
        expect(contextRow).not.toContain(bgOf(palette.add));
      }
    }
  });

  it("puts changed spans on a stronger background and restores the row background after them", () => {
    const out = renderTuiDiff({ diffData, width: 80, theme: piTheme, expanded: true });
    const palette = diffPalette(piTheme, "toolSuccessBg")!;
    const removeRow = out.lines.find((line) => strip(line).includes("- two"))!;
    expect(removeRow.replaceAll("\x1b[39m", "")).toContain(`${palette.removeStrong}two${palette.remove}`);
    const addRow = out.lines.find((line) => strip(line).includes("+ TWO"))!;
    expect(addRow.replaceAll("\x1b[39m", "")).toContain(`${palette.addStrong}TWO${palette.add}`);
  });

  it("derives 256-color backgrounds when the theme runs in 256-color mode", () => {
    const indexed = { ...piTheme, fg: piTheme.fg.bind(piTheme), bold: piTheme.bold.bind(piTheme), getColorMode: () => "256color",
      getFgAnsi: (c: string) => c === "toolDiffAdded" ? "\x1b[38;5;34m" : "\x1b[38;5;160m", getBgAnsi: () => "\x1b[48;5;236m" };
    const palette = diffPalette(indexed as any, "toolPendingBg")!;
    expect(palette.restore).toBe("\x1b[48;5;236m");
    expect(palette.add).toMatch(/^\x1b\[48;5;\d+m$/);
    expect(new Set([palette.restore, palette.add, palette.addStrong]).size).toBe(3);
    expect(new Set([palette.restore, palette.remove, palette.removeStrong]).size).toBe(3);
    expect(diffPalette({ ...indexed, getFgAnsi: () => "\x1b[39m" } as any, "toolPendingBg")).toBeUndefined();
  });

  it("syntax-highlights each hunk side as a block and keeps the visible text intact", () => {
    const code: DiffData = { version: 1, stats: { added: 2, removed: 1, context: 1 }, entries: [
      { kind: "context", oldLine: 1, newLine: 1, text: "/* start of a" },
      { kind: "remove", oldLine: 2, text: "   long comment */ const a = 1;" },
      { kind: "add", newLine: 2, text: "   long comment */ const b = 2;" },
      { kind: "add", newLine: 3, text: "export function f() { return \"x\"; }" },
    ] };
    const syntax = highlightDiffEntries(code, "sample.ts", "dark")!;
    expect(syntax).toBeDefined();
    syntax.forEach((line, i) => expect(strip(line!)).toBe(code.entries[i]!.text));
    // The comment opened on the context line keeps its color on the next line of each side.
    const commentColor = piTheme.getFgAnsi("syntaxComment");
    expect(syntax[1]!.startsWith(commentColor)).toBe(true);
    expect(syntax[2]!.startsWith(commentColor)).toBe(true);
    expect(syntax[3]).toContain(piTheme.getFgAnsi("syntaxKeyword"));
    expect(highlightDiffEntries(code, "sample.unknownext", "dark")).toBeUndefined();
    expect(highlightDiffEntries(code, "sample.ts", "dark")).toBe(syntax);

    const out = renderTuiDiff({ diffData: code, width: 70, theme: piTheme, expanded: true, path: "sample.ts" });
    expect(out.lines.map(strip).slice(1)).toEqual([
      "1   /* start of a",
      "2 -    long comment */ const a = 1;",
      "2 +    long comment */ const b = 2;",
      "3 + export function f() { return \"x\"; }",
    ].map((row, i) => i === 0 ? row : row.padEnd(70)));
    for (const line of out.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(70);
  });

  it("keeps wrapped highlighted rows within width and on their background", () => {
    const long: DiffData = { version: 1, stats: { added: 1, removed: 0, context: 0 }, entries: [
      { kind: "add", newLine: 9, text: `const message = "${"lorem ipsum ".repeat(12)}";\tconst next = 1;` },
    ] };
    const palette = diffPalette(piTheme, "toolSuccessBg")!;
    for (const width of [40, 60]) {
      const out = renderTuiDiff({ diffData: long, width, theme: piTheme, expanded: true, path: "x.ts" });
      const rows = out.lines.slice(1);
      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows) {
        expect(visibleWidth(row)).toBe(width);
        expect(row.startsWith(palette.add)).toBe(true);
      }
      expect(strip(rows[1]!).startsWith("    ")).toBe(true);
    }
  });
});

it("updates collapsed diff hints when the active host shortcut changes", () => {
  const previous = hostTui.getKeybindings();
  const bindings = new HostKeybindingsManager();
  hostTui.setKeybindings(bindings);
  try {
    const defaultHint = keyHint("app.tools.expand", "to expand");
    const first = renderTuiDiff({ diffData, width: 120, theme, expanded: false, collapsedLines: 1 });
    bindings.setUserBindings({ "app.tools.expand": ["ctrl+shift+alt+x", "ctrl+alt+enter"] });
    const customHint = keyHint("app.tools.expand", "to expand");
    const second = renderTuiDiff({ diffData, width: 120, theme, expanded: false, collapsedLines: 1 });
    assert.ok(plain(second.lines[1] ?? "").includes(plain(customHint)),
      "collapsed diff uses a stale expansion shortcut");
    assert.equal(first.lines[1], `… (3 more diff lines • ${defaultHint})`);
    assert.equal(plain(defaultHint), "ctrl+o to expand");
    assert.equal(second.lines[1], `… (3 more diff lines • ${customHint})`);
    assert.notEqual(plain(second.lines[1]), plain(first.lines[1]));
    assert.equal(second.lines.length, 2);
    for (const config of [{}, { "app.tools.expand": ["ctrl+shift+alt+x", "ctrl+alt+enter"] }]) {
      bindings.setUserBindings(config);
      for (const width of [8, 24, 36, 80, 120, 200]) {
        for (const expanded of [false, true]) {
          const out = renderTuiDiff({ diffData, width, theme, expanded, collapsedLines: 1 });
          assert.ok(out.lines.every(line => visibleWidth(line) <= width));
        }
      }
      assert.equal(renderTuiDiff({ diffData, width: 30, theme, expanded: false, collapsedLines: 1 }).lines[1],
        "… (3 more diff lines)");
      const expanded = renderTuiDiff({ diffData, width: 80, theme, expanded: true });
      assert.ok(expanded.lines.join("\n").includes("2 + TWO"));
      assert.ok(!expanded.lines.some(line => plain(line).includes("to expand")));
    }
  } finally {
    hostTui.setKeybindings(previous);
  }
});
