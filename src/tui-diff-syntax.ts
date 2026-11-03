import { stripVTControlCharacters } from "node:util";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { DiffData } from "./diff-data.js";

// Beyond this much text the diff renders without syntax colors.
const MAX_HIGHLIGHT_CHARS = 200_000;
const CACHE_SIZE = 32;
const cache = new Map<string, (string | undefined)[]>();

/** Re-opens on each line the colors left active by the previous one (multi-line strings, comments). */
function carryColors(lines: string[]): string[] {
  return wrapTextWithAnsi(lines.join("\n"), Number.MAX_SAFE_INTEGER);
}

/**
 * Syntax-highlighted text per diff entry, indexed like `diffData.entries` (undefined for entries
 * left plain). Each side of each hunk is highlighted as one block so multi-line constructs keep
 * their colors. Lines end with a foreground reset; backgrounds are left to the caller.
 */
export function highlightDiffEntries(data: DiffData, path: string | undefined, themeName: string): (string | undefined)[] | undefined {
  const lang = path ? getLanguageFromPath(path) : undefined;
  if (!lang) return undefined;
  const entries = data.entries;
  if (entries.reduce((n, e) => n + e.text.length, 0) > MAX_HIGHLIGHT_CHARS) return undefined;
  const key = `${themeName}\0${lang}\0${entries.map((e) => `${e.kind[0]}${e.text}`).join("\n")}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const out: (string | undefined)[] = new Array(entries.length).fill(undefined);
  let start = 0;
  for (let end = 0; end <= entries.length; end++) {
    if (end < entries.length && entries[end]!.kind !== "meta") continue;
    for (const side of ["remove", "add"] as const) {
      const indexes: number[] = [];
      for (let i = start; i < end; i++) if (entries[i]!.kind === "context" || entries[i]!.kind === side) indexes.push(i);
      if (indexes.length === 0) continue;
      let lines: string[];
      try {
        lines = carryColors(highlightCode(indexes.map((i) => entries[i]!.text).join("\n"), lang));
      } catch {
        return undefined;
      }
      indexes.forEach((i, j) => {
        const entry = entries[i]!;
        // Context lines come from the new side; a line whose text the highlighter altered stays plain.
        if ((entry.kind === side || side === "add") && lines[j] !== undefined && stripVTControlCharacters(lines[j]!) === entry.text) out[i] = `${lines[j]}\x1b[39m`;
      });
    }
    start = end + 1;
  }
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
