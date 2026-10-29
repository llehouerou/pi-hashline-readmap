import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { clearMapCache } from "../src/map-cache.js";
import { registerReadTool } from "../src/read.js";

const tempDirs: string[] = [];

function fixture(name: string, lines: string[]): string {
  const dir = mkdtempSync(resolve(tmpdir(), "pi-read-map-first-"));
  tempDirs.push(dir);
  const path = resolve(dir, name);
  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

function tsLines(count: number, width = 0): string[] {
  return Array.from({ length: count }, (_, i) => `export function fn${i}() { return "${"x".repeat(width)}"; }`);
}

async function read(params: Record<string, unknown>) {
  let tool: any;
  registerReadTool({ registerTool(def: any) { tool = def; } } as any);
  const result = await tool.execute("map-first", params, new AbortController().signal, () => {}, { cwd: process.cwd() });
  const text: string = result.content.find((c: any) => c.type === "text")?.text ?? "";
  return { result, text, ptc: result.details.ptcValue };
}

afterEach(() => {
  clearMapCache();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("read map-first for large unranged reads", () => {
  it("leaves a file under both thresholds unchanged", async () => {
    const path = fixture("small.ts", Array.from({ length: 400 }, (_, i) => `const v${i} = 1;`));
    const { text, ptc } = await read({ path });

    expect(ptc.range).toEqual({ startLine: 1, endLine: 400, totalLines: 400 });
    expect(ptc.map.appended).toBe(false);
    expect(text).not.toContain("[Large file:");
  });

  it("serves the first 200 lines, the map, and how to fetch the rest above 400 lines", async () => {
    const path = fixture("big.ts", tsLines(401));
    const { text, ptc } = await read({ path });

    expect(ptc.range).toEqual({ startLine: 1, endLine: 200, totalLines: 401 });
    expect(ptc.lines).toHaveLength(200);
    expect(ptc.continuation).toEqual({ nextOffset: 201 });
    expect(ptc.map).toEqual({ requested: false, appended: true });
    expect(text).toContain(
      `[Large file: showing lines 1-200 of 401. Read more with read({ path: ${JSON.stringify(path)}, offset: 201, limit: 200 }), or one symbol from the map below with read({ path: ${JSON.stringify(path)}, symbol: "name" }).]`,
    );
    expect(text).toContain("File Map:");
    expect(text).not.toContain("201:");
  });

  it("serves anchors identical to a ranged read of the same lines", async () => {
    const path = fixture("big.ts", tsLines(500));
    const mapFirst = await read({ path });
    const ranged = await read({ path, offset: 1, limit: 200 });

    expect(mapFirst.ptc.lines.map((l: any) => l.anchor)).toEqual(ranged.ptc.lines.map((l: any) => l.anchor));
  });

  it("caps the window by characters when a file is large by size", async () => {
    const path = fixture("wide.ts", tsLines(100, 200));
    const { ptc } = await read({ path });

    expect(ptc.range.endLine).toBeLessThan(100);
    expect(ptc.range.endLine).toBeGreaterThan(1);
    expect(ptc.map.appended).toBe(true);
  });

  it("does not apply when the read has an explicit limit or offset", async () => {
    const path = fixture("big.ts", tsLines(600));

    expect((await read({ path, limit: 600 })).ptc.range.endLine).toBe(600);
    expect((await read({ path, offset: 2 })).ptc.range).toEqual({ startLine: 2, endLine: 600, totalLines: 600 });
  });

  it("omits the symbol hint when the file has no structural map", async () => {
    const path = fixture("big.unknownext", Array.from({ length: 500 }, (_, i) => `line ${i}`));
    const { text, ptc } = await read({ path });

    expect(ptc.range.endLine).toBe(200);
    expect(ptc.map.appended).toBe(false);
    expect(text).toContain(`offset: 201, limit: 200 }).]`);
    expect(text).not.toContain("symbol:");
  });
});
