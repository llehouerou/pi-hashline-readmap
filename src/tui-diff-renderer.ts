import { basename } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { DiffData, DiffEntry, DiffSpan } from "./diff-data.js";
import { diffPalette, type DiffBoxBg, type DiffPalette } from "./tui-diff-palette.js";
import { highlightDiffEntries } from "./tui-diff-syntax.js";
import { clampLineToWidth, clampLinesToWidth, getExpandHint, normalizeWidth, wrapWithHangingIndent, type RendererTheme } from "./tui-render-utils.js";

export type TuiDiffMode = "split" | "unified" | "compact" | "summary";
export type RenderTuiDiffInput = {
  diffData: DiffData;
  width: number;
  theme: RendererTheme;
  expanded: boolean;
  collapsedLines?: number;
  /** File the diff belongs to: names it in the header and picks the syntax highlighting language. */
  path?: string;
  /** Tool box background the rows sit on; defaults to the completed-tool background. */
  boxBg?: DiffBoxBg;
};
export type RenderTuiDiffOutput = { mode: TuiDiffMode; width: number; lines: string[] };
const DEFAULT_COLLAPSED_LINES = 12;

/** Per-render styling: with a palette rows get tinted backgrounds and syntax colors, else plain fg tints. */
type Style = { theme: RendererTheme; palette?: DiffPalette; syntax?: (string | undefined)[]; numWidth: number };

function hasOldSide(data: DiffData): boolean { return data.entries.some((e) => e.kind === "remove" || e.kind === "context"); }
function chooseMode(width: number, data: DiffData): TuiDiffMode {
  if (width < 24) return "summary";
  if (width < 50) return "compact";
  // Split mode wastes half the pane on pure-add diffs (pending creates,
  // write to a new file) so fall back to unified when there is no old side.
  if (width >= 100 && hasOldSide(data)) return "split";
  return "unified";
}
// Hunk index per entry: the diff generator marks each skipped region with a "..." meta line.
function hunkIndexes(data: DiffData): number[] {
  let hunk = 0;
  let seen = false;
  return data.entries.map((e) => {
    if (e.kind === "meta") { if (seen) hunk++; seen = false; return -1; }
    seen = true;
    return hunk;
  });
}
function hunkCount(data: DiffData): number { return Math.max(1, ...hunkIndexes(data).map((h) => h + 1)); }
function header(input: RenderTuiDiffInput, mode: TuiDiffMode, width: number): string {
  const data = input.diffData;
  if (mode === "summary" && width <= 10) return `↳ diff +${data.stats.added}`;
  const stats = `+${data.stats.added} -${data.stats.removed}`;
  const hunks = hunkCount(data);
  const name = input.path ? `${basename(input.path)} ` : "";
  const forms = [
    `↳ diff ${name}${stats} • ${hunks} hunk${hunks === 1 ? "" : "s"} • ${mode === "split" ? "split" : "unified"}`,
    `↳ diff ${name}${stats}`,
    `↳ diff ${stats}`,
  ];
  return forms.find((form) => visibleWidth(form) <= width) ?? clampLineToWidth(forms[2]!, width);
}
function lineNo(entry: DiffEntry): number | undefined { return entry.kind === "remove" ? entry.oldLine : entry.kind === "meta" ? undefined : entry.newLine; }
function gutterMarker(entry: DiffEntry): string { return entry.kind === "add" ? "+" : entry.kind === "remove" ? "-" : " "; }
function padRightVisual(line: string, width: number): string { const visible = visibleWidth(line); return visible >= width ? line : line + " ".repeat(width - visible); }
function rowBg(style: Style, entry: DiffEntry): string | undefined { return entry.kind === "add" ? style.palette?.add : entry.kind === "remove" ? style.palette?.remove : undefined; }

/** Inserts `strong` before each changed span of `styled` (ANSI-coded `plain` text) and `line` after it. */
function emphasize(styled: string, spans: DiffSpan[], strong: string, line: string): string {
  const marks: Array<[number, string]> = [];
  let pos = 0;
  for (const span of spans) {
    if (span.kind !== "equal") marks.push([pos, strong], [pos + span.text.length, line]);
    pos += span.text.length;
  }
  const ansi = /\x1b\[[0-9;]*m/y;
  let out = "";
  let visible = 0;
  let m = 0;
  for (let k = 0; k < styled.length;) {
    ansi.lastIndex = k;
    const code = ansi.exec(styled);
    if (code) { out += code[0]; k += code[0].length; continue; }
    while (m < marks.length && marks[m]![0] === visible) out += marks[m++]![1];
    out += styled[k];
    k++;
    visible++;
  }
  while (m < marks.length) out += marks[m++]![1];
  return out;
}
function content(input: RenderTuiDiffInput, style: Style, index: number, entry: DiffEntry): string {
  const text = style.syntax?.[index] ?? entry.text;
  const bg = rowBg(style, entry);
  const pair = bg && input.diffData.inlineDiffs?.find((d) => entry.kind === "remove" ? d.removeLineIndex === index : d.addLineIndex === index);
  const spans = pair ? (entry.kind === "remove" ? pair.removeSpans : pair.addSpans) : undefined;
  const coherent = spans && spans.map((s) => s.text).join("") === entry.text;
  const strong = entry.kind === "add" ? style.palette?.addStrong : style.palette?.removeStrong;
  // Tabs as the 3 columns visibleWidth counts them for, so padded backgrounds line up.
  return (coherent && strong && bg ? emphasize(text, spans!, strong, bg) : text).replace(/\t/g, "   ");
}
function gutter(style: Style, entry: DiffEntry, lineNumber: number | undefined): string {
  const marker = gutterMarker(entry);
  const num = String(lineNumber ?? "").padStart(style.numWidth);
  if (!style.palette) return `${num} ${marker} `;
  const mark = entry.kind === "add" ? style.theme.fg("toolDiffAdded", marker) : entry.kind === "remove" ? style.theme.fg("toolDiffRemoved", marker) : marker;
  return `${style.theme.fg("dim", num)} ${mark} `;
}
/** Fills the row to `width` on the entry's background, or tints it when the theme has no palette. */
function paint(style: Style, entry: DiffEntry, row: string, width: number): string {
  if (!style.palette) return entry.kind === "add" ? style.theme.fg("success", row) : entry.kind === "remove" ? style.theme.fg("error", row) : style.theme.fg("toolOutput", row);
  const bg = rowBg(style, entry);
  return bg ? `${bg}${row}${bg}${" ".repeat(Math.max(0, width - visibleWidth(row)))}${style.palette.restore}` : row;
}
function cellRows(input: RenderTuiDiffInput, style: Style, index: number, entry: DiffEntry, width: number, lineNumber = lineNo(entry)): string[] {
  return wrapWithHangingIndent(gutter(style, entry, lineNumber), content(input, style, index, entry), width).map((row) => paint(style, entry, row, width));
}
function separator(style: Style, entry: DiffEntry, width: number): string {
  const label = `╌╌ line ${lineNo(entry)} `;
  return style.theme.fg("dim", clampLineToWidth(label + "╌".repeat(Math.max(0, width - visibleWidth(label))), width));
}
function entryRows(input: RenderTuiDiffInput, style: Style, index: number, entry: DiffEntry, mode: "unified" | "compact" | "split", width: number): string[] {
  if (entry.kind === "meta" || (mode === "compact" && entry.kind === "context")) return [];
  if (mode !== "split") return cellRows(input, style, index, entry, width);
  const pane = Math.max(10, Math.floor((width - 3) / 2));
  const blank = " ".repeat(pane);
  const rule = style.palette ? style.theme.fg("dim", " │ ") : " │ ";
  const left = entry.kind === "add" ? [] : cellRows(input, style, index, entry, pane, entry.oldLine);
  const right = entry.kind === "remove" ? [] : cellRows(input, style, index, entry, pane);
  return Array.from({ length: Math.max(left.length, right.length) }, (_, k) => `${padRightVisual(left[k] ?? blank, pane)}${rule}${right[k] ?? ""}`);
}
function bodyRows(input: RenderTuiDiffInput, style: Style, mode: "unified" | "compact" | "split", width: number): string[] {
  const hunks = hunkIndexes(input.diffData);
  const rows = mode === "split" ? [`${padRightVisual("old", Math.max(10, Math.floor((width - 3) / 2)))} │ new`] : [];
  let current = -1;
  for (const [i, e] of input.diffData.entries.entries()) {
    const next = entryRows(input, style, i, e, mode, width);
    if (next.length === 0) continue;
    if (hunks[i] !== current && current >= 0) rows.push(separator(style, e, width));
    current = hunks[i]!;
    rows.push(...next);
  }
  return rows;
}
function hiddenHint(hiddenLines: number, hiddenHunks: number, width: number): string {
  const lines = `${hiddenLines} more diff line${hiddenLines === 1 ? "" : "s"}`;
  const hunks = hiddenHunks > 0 ? ` • ${hiddenHunks} more hunk${hiddenHunks === 1 ? "" : "s"}` : "";
  const forms = [
    `… (${lines}${hunks}${getExpandHint()})`,
    `… (${lines}${hunks})`,
    `… (+${hiddenLines}${hiddenHunks > 0 ? ` • +${hiddenHunks}h` : ""})`,
    "…",
  ];
  return forms.find((form) => visibleWidth(form) <= width) ?? "…";
}
const isChange = (e: DiffEntry | undefined) => e?.kind === "add" || e?.kind === "remove";
// Collapsed preview: changed lines plus one adjacent context line, capped at maxRows rendered rows.
function collapsedPreview(input: RenderTuiDiffInput, style: Style, mode: "unified" | "compact", width: number, maxRows: number): { rows: string[]; hiddenLines: number; hiddenHunks: number } {
  const entries = input.diffData.entries;
  const hunks = hunkIndexes(input.diffData);
  const rows: string[] = [];
  const shownHunks = new Set<number>();
  let shown = 0;
  for (const [i, e] of entries.entries()) {
    if (!isChange(e) && !(e.kind === "context" && (isChange(entries[i - 1]) || isChange(entries[i + 1])))) continue;
    const cells = entryRows(input, style, i, e, mode, width);
    if (cells.length === 0) continue;
    const next = shownHunks.size > 0 && !shownHunks.has(hunks[i]!) ? [separator(style, e, width), ...cells] : cells;
    if (rows.length + next.length > maxRows) {
      // An entry taller than the whole budget still shows its first rows.
      if (rows.length === 0) { rows.push(...next.slice(0, maxRows)); shown++; shownHunks.add(hunks[i]!); }
      break;
    }
    rows.push(...next);
    shown++;
    shownHunks.add(hunks[i]!);
  }
  const total = entries.filter((e) => e.kind !== "meta").length;
  return { rows, hiddenLines: total - shown, hiddenHunks: hunkCount(input.diffData) - shownHunks.size };
}
function makeStyle(input: RenderTuiDiffInput): Style {
  const palette = diffPalette(input.theme, input.boxBg ?? "toolSuccessBg");
  const themeName = String((input.theme as { name?: unknown }).name ?? "");
  const syntax = palette ? highlightDiffEntries(input.diffData, input.path, themeName) : undefined;
  const numWidth = Math.max(1, ...input.diffData.entries.flatMap((e) => ["oldLine" in e ? e.oldLine : 0, "newLine" in e ? e.newLine : 0]).map((n) => String(n).length));
  return { theme: input.theme, palette, syntax, numWidth };
}
export function renderTuiDiff(input: RenderTuiDiffInput): RenderTuiDiffOutput {
  const width = normalizeWidth(input.width);
  const expandedMode = chooseMode(width, input.diffData);
  // Collapsed previews stay single-column: split halves the few rows they get.
  const mode = !input.expanded && expandedMode === "split" ? "unified" : expandedMode;
  // Collapsed: preview rows only; the caller's summary line already carries the stats and expand hint.
  if (!input.expanded) {
    const maxRows = input.collapsedLines ?? DEFAULT_COLLAPSED_LINES;
    if (mode === "summary" || mode === "split" || maxRows <= 0) return { mode, width, lines: [] };
    const preview = collapsedPreview(input, makeStyle(input), mode, width, maxRows);
    const hint = preview.hiddenLines > 0 ? [hiddenHint(preview.hiddenLines, preview.hiddenHunks, width)] : [];
    return { mode, width, lines: clampLinesToWidth([...preview.rows, ...hint], width) };
  }
  const lines = [header(input, mode, width)];
  if (mode === "summary") return { mode, width, lines: clampLinesToWidth(lines, width) };
  return { mode, width, lines: [...lines, ...bodyRows(input, makeStyle(input), mode, width)] };
}
