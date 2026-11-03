import type { RendererTheme } from "./tui-render-utils.js";

/** Background of the pi tool box the diff sits in: pending before execution, success after. */
export type DiffBoxBg = "toolPendingBg" | "toolSuccessBg";

/**
 * Background SGR codes for diff rows. The diff body sits on `panel`, the theme's neutral pending-tool
 * background, so a colored tool box (the green success box) does not tint it; `restore` puts the tool
 * box background back at the end of each row.
 */
export interface DiffPalette {
  panel: string;
  add: string;
  remove: string;
  addGutter: string;
  removeGutter: string;
  addStrong: string;
  removeStrong: string;
  restore: string;
}

type Rgb = [number, number, number];
type ColorTheme = RendererTheme & { getFgAnsi?(color: string): string; getBgAnsi?(color: string): string; getColorMode?(): string };

// Share of the diff color mixed into the panel: subtler for the gutter, discreet for rows, stronger for changed spans.
const GUTTER_ALPHA = 0.12;
const ROW_ALPHA = 0.2;
const SPAN_ALPHA = 0.42;
const BASIC_16: Rgb[] = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];
const CUBE = [0, 95, 135, 175, 215, 255];
const cache = new Map<string, DiffPalette | null>();

function ansi256ToRgb(n: number): Rgb {
  if (n < 16) return BASIC_16[n]!;
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v]; }
  const i = n - 16;
  return [CUBE[Math.floor(i / 36)]!, CUBE[Math.floor(i / 6) % 6]!, CUBE[i % 6]!];
}
function rgbTo256([r, g, b]: Rgb): number {
  const level = (v: number) => CUBE.reduce((best, c, i) => Math.abs(c - v) < Math.abs(CUBE[best]! - v) ? i : best, 0);
  const cube = 16 + 36 * level(r) + 6 * level(g) + level(b);
  const grayIndex = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const dist = (n: number) => { const [x, y, z] = ansi256ToRgb(n); return (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2; };
  return dist(232 + grayIndex) < dist(cube) ? 232 + grayIndex : cube;
}
/** Reads the color of a truecolor or 256-color fg/bg SGR code; default and 16-color codes yield undefined. */
export function parseAnsiColor(ansi: string): Rgb | undefined {
  const rgb = /\x1b\[[34]8;2;(\d+);(\d+);(\d+)m/.exec(ansi);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const indexed = /\x1b\[[34]8;5;(\d+)m/.exec(ansi);
  return indexed ? ansi256ToRgb(Number(indexed[1])) : undefined;
}
function mix(base: Rgb, color: Rgb, alpha: number): Rgb {
  return base.map((v, i) => Math.round(v + (color[i]! - v) * alpha)) as Rgb;
}

/**
 * Derives the diff backgrounds from the active pi theme: its diff add/remove colors blended into its
 * neutral pending-tool background. Undefined when the theme exposes no parseable colors.
 */
export function diffPalette(theme: RendererTheme, boxBg: DiffBoxBg): DiffPalette | undefined {
  const t = theme as ColorTheme;
  if (typeof t.getFgAnsi !== "function" || typeof t.getBgAnsi !== "function") return undefined;
  let codes: [string, string, string, string];
  try {
    codes = [t.getBgAnsi("toolPendingBg"), t.getFgAnsi("toolDiffAdded"), t.getFgAnsi("toolDiffRemoved"), t.getBgAnsi(boxBg)];
  } catch {
    return undefined;
  }
  const truecolor = t.getColorMode?.() !== "256color";
  const key = `${codes.join("|")}|${truecolor}`;
  if (!cache.has(key)) {
    const [panel, added, removed] = codes.map(parseAnsiColor);
    if (!panel || !added || !removed) cache.set(key, null);
    else {
      const panelIndex = rgbTo256(panel);
      // 256 colors are coarse: raise the share until the tint leaves the colors it must stand out from.
      const tint = (color: Rgb, alpha: number, avoid: number[]) => {
        if (truecolor) return { index: -1, code: `\x1b[48;2;${mix(panel, color, alpha).join(";")}m` };
        let n = rgbTo256(mix(panel, color, alpha));
        for (let a = alpha; avoid.includes(n) && a < 1; a += 0.1) n = rgbTo256(mix(panel, color, Math.min(1, a + 0.1)));
        return { index: n, code: `\x1b[48;5;${n}m` };
      };
      const shades = (color: Rgb) => {
        const row = tint(color, ROW_ALPHA, [panelIndex]);
        return { row: row.code, gutter: tint(color, GUTTER_ALPHA, [panelIndex]).code, strong: tint(color, SPAN_ALPHA, [panelIndex, row.index]).code };
      };
      const add = shades(added);
      const remove = shades(removed);
      cache.set(key, {
        panel: codes[0], add: add.row, remove: remove.row, addGutter: add.gutter, removeGutter: remove.gutter,
        addStrong: add.strong, removeStrong: remove.strong, restore: codes[3],
      });
    }
  }
  return cache.get(key) ?? undefined;
}
