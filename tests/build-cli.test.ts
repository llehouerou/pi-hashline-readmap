import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runBuildCli } from "../scripts/build.mjs";

function logger() {
  const errors: string[] = [];
  return { errors, error: (m: string) => errors.push(m) };
}

describe("runBuildCli", () => {
  it("exits 1 and reports the error when the build fails", async () => {
    const log = logger();
    const code = await runBuildCli({ build: async () => { throw new Error("boom"); }, log });
    expect(code).toBe(1);
    expect(log.errors[0]).toContain("boom");
  });

  it("exits 0 quietly when the build succeeds", async () => {
    const log = logger();
    expect(await runBuildCli({ build: async () => "dist", log })).toBe(0);
    expect(log.errors).toEqual([]);
  });

  it("is wired, strict, as the package prepare script: Pi never falls back to index.ts for an installed package", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.prepare).toBe("node scripts/build.mjs");
  });
});
