import { visibleWidth } from "@earendil-works/pi-tui";
import type { DiffData, DiffEntry, DiffSpan } from "./diff-data.js";
import { clampLineToWidth, clampLinesToWidth, getExpandHint, normalizeWidth, wrapWithHangingIndent, type RendererTheme } from "./tui-render-utils.js";

export type TuiDiffMode = "split" | "unified" | "compact" | "summary";
export type RenderTuiDiffInput = { diffData: DiffData; width: number; theme: RendererTheme; expanded: boolean; collapsedLines?: number };
export type RenderTuiDiffOutput = { mode: TuiDiffMode; width: number; lines: string[] };
export const DEFAULT_COLLAPSED_LINES = 12;

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
function compactHeader(data: DiffData): string { return `↳ diff +${data.stats.added} -${data.stats.removed}`; }
function header(data: DiffData, mode: TuiDiffMode, width: number): string {
  if (mode === "summary" && width <= 10) return `↳ diff +${data.stats.added}`;
  const full = `${compactHeader(data)} • ${hunkCount(data)} hunk • 1 file • ${mode === "split" ? "split" : "unified"}`;
  return visibleWidth(full) <= width ? full : clampLineToWidth(compactHeader(data), width);
}
function lineNo(entry: DiffEntry): string { return String(entry.kind === "add" ? entry.newLine : entry.kind === "remove" ? entry.oldLine : entry.kind === "context" ? entry.newLine : ""); }
function gutterMarker(entry: DiffEntry): string { return entry.kind === "add" ? "+" : entry.kind === "remove" ? "-" : " "; }
function textOf(entry: DiffEntry): string { return "text" in entry ? entry.text : ""; }
function padRightVisual(line: string, width: number): string { const visible = visibleWidth(line); return visible >= width ? line : line + " ".repeat(width - visible); }
function tint(theme: RendererTheme, entry: DiffEntry, text: string): string { return entry.kind === "add" ? theme.fg("success", text) : entry.kind === "remove" ? theme.fg("error", text) : theme.fg("toolOutput", text); }
function spans(theme: RendererTheme, spans: DiffSpan[] | undefined, fallback: string): string { return spans?.map((s) => s.kind === "add" ? theme.fg("success", s.text) : s.kind === "remove" ? theme.fg("error", s.text) : s.text).join("") ?? fallback; }
function inlineText(input: RenderTuiDiffInput, index: number, entry: DiffEntry): string {
  const pair = input.diffData.inlineDiffs?.find((d) => entry.kind === "remove" ? d.removeLineIndex === index : entry.kind === "add" ? d.addLineIndex === index : false);
  if (!pair) return textOf(entry);
  return entry.kind === "remove" ? spans(input.theme, pair.removeSpans, textOf(entry)) : entry.kind === "add" ? spans(input.theme, pair.addSpans, textOf(entry)) : textOf(entry);
}
function entryRows(input: RenderTuiDiffInput, i: number, e: DiffEntry, mode: "unified" | "compact", width: number): string[] {
  if (e.kind === "meta" || (mode === "compact" && e.kind === "context")) return [];
  const prefix = mode === "compact" ? `▌${gutterMarker(e)} ${lineNo(e)} ` : `▌${gutterMarker(e)} ${lineNo(e)} │ `;
  return wrapWithHangingIndent(prefix, inlineText(input, i, e), width, { tint: (text) => tint(input.theme, e, text) });
}
function unifiedRows(input: RenderTuiDiffInput, width: number, mode: "unified" | "compact" = "unified"): string[] {
  return input.diffData.entries.flatMap((e, i) => entryRows(input, i, e, mode, width));
}
function splitRows(input: RenderTuiDiffInput, width: number): string[] {
  const pane = Math.max(10, Math.floor((width - 3) / 2));
  const rows = [`${padRightVisual("old", pane)} │ new`];
  const blankPane = " ".repeat(pane);
  for (const [i, e] of input.diffData.entries.entries()) {
    if (e.kind === "remove") {
      const left = wrapWithHangingIndent(`▌- ${e.oldLine} │ `, inlineText(input, i, e), pane, { tint: (text) => tint(input.theme, e, text) });
      for (const line of left) rows.push(`${padRightVisual(line, pane)} │ ${blankPane}`);
    } else if (e.kind === "add") {
      const right = wrapWithHangingIndent(`▌+ ${e.newLine} │ `, inlineText(input, i, e), pane, { tint: (text) => tint(input.theme, e, text) });
      for (const line of right) rows.push(`${blankPane} │ ${line}`);
    } else if (e.kind === "context") {
      const left = wrapWithHangingIndent(`▌  ${e.oldLine} │ `, e.text, pane, { tint: (text) => tint(input.theme, e, text) });
      const right = wrapWithHangingIndent(`▌  ${e.newLine} │ `, e.text, pane, { tint: (text) => tint(input.theme, e, text) });
      const maxLen = Math.max(left.length, right.length);
      for (let k = 0; k < maxLen; k++) {
        const l = left[k] ?? blankPane;
        const r = right[k] ?? blankPane;
        rows.push(`${padRightVisual(l, pane)} │ ${r}`);
      }
    }
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
function collapsedPreview(input: RenderTuiDiffInput, mode: "unified" | "compact", width: number, maxRows: number): { rows: string[]; hiddenLines: number; hiddenHunks: number } {
  const entries = input.diffData.entries;
  const hunks = hunkIndexes(input.diffData);
  const rows: string[] = [];
  const shownHunks = new Set<number>();
  let shown = 0;
  for (const [i, e] of entries.entries()) {
    if (!isChange(e) && !(e.kind === "context" && (isChange(entries[i - 1]) || isChange(entries[i + 1])))) continue;
    const next = entryRows(input, i, e, mode, width);
    if (next.length === 0) continue;
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
export function renderTuiDiff(input: RenderTuiDiffInput): RenderTuiDiffOutput {
  const width = normalizeWidth(input.width);
  const expandedMode = chooseMode(width, input.diffData);
  // Collapsed previews stay single-column: split halves the few rows they get.
  const mode = !input.expanded && expandedMode === "split" ? "unified" : expandedMode;
  // Collapsed: preview rows only; the caller's summary line already carries the stats and expand hint.
  if (!input.expanded) {
    const maxRows = input.collapsedLines ?? DEFAULT_COLLAPSED_LINES;
    if (mode === "summary" || mode === "split" || maxRows <= 0) return { mode, width, lines: [] };
    const preview = collapsedPreview(input, mode, width, maxRows);
    const hint = preview.hiddenLines > 0 ? [hiddenHint(preview.hiddenLines, preview.hiddenHunks, width)] : [];
    return { mode, width, lines: clampLinesToWidth([...preview.rows, ...hint], width) };
  }
  const lines = [header(input.diffData, mode, width)];
  if (mode === "summary") return { mode, width, lines: clampLinesToWidth(lines, width) };
  const rows = mode === "split" ? splitRows(input, width) : unifiedRows(input, width, mode);
  return { mode, width, lines: [...lines, ...rows] };
}
