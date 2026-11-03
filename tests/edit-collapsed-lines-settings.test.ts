import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  __resetHashlineSettingsPathsForTest,
  __setHashlineSettingsPathsForTest,
  resolveEditCollapsedLines,
  resolveHashlineJsonSettings,
} from "../src/hashline-settings.js";

describe("edit.collapsedLines setting", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    __resetHashlineSettingsPathsForTest();
    await Promise.all(cleanup.map((p) => rm(p, { recursive: true, force: true })));
    cleanup.length = 0;
  });

  async function useProjectValue(value: unknown): Promise<void> {
    const root = join(tmpdir(), `edit-collapsed-lines-${randomBytes(6).toString("hex")}`);
    cleanup.push(root);
    const projectSettingsPath = join(root, "repo/.pi/hashline-readmap/settings.json");
    await mkdir(join(projectSettingsPath, ".."), { recursive: true });
    if (value !== undefined) await writeFile(projectSettingsPath, JSON.stringify({ edit: { collapsedLines: value } }));
    __setHashlineSettingsPathsForTest({ globalSettingsPath: join(root, "home/settings.json"), projectSettingsPath });
  }

  it("defaults to 12", async () => {
    await useProjectValue(undefined);
    expect(resolveEditCollapsedLines({})).toBe(12);
  });

  it("accepts non-negative integers from JSON", async () => {
    await useProjectValue(0);
    expect(resolveHashlineJsonSettings()).toEqual({ settings: { edit: { collapsedLines: 0 } }, warnings: [] });
    expect(resolveEditCollapsedLines({})).toBe(0);
  });

  it("warns and drops invalid JSON values", async () => {
    await useProjectValue(-3);
    const result = resolveHashlineJsonSettings();
    expect(result.settings).toEqual({});
    expect(result.warnings.map((w) => w.path)).toEqual(["edit.collapsedLines"]);
    expect(resolveEditCollapsedLines({})).toBe(12);
  });

  it("lets a valid environment override win over JSON", async () => {
    await useProjectValue(4);
    expect(resolveEditCollapsedLines({ PI_HASHLINE_EDIT_COLLAPSED_LINES: " 20 " })).toBe(20);
    expect(resolveEditCollapsedLines({ PI_HASHLINE_EDIT_COLLAPSED_LINES: "-1" })).toBe(4);
  });
});
