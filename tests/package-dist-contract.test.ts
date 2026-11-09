import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

describe("package.json dist contract", () => {
  it("loads the bundle through the manifest and ships dist/", () => {
    expect(pkg.pi.extensions).toEqual(["./dist/index.js"]);
    expect(pkg.files).toContain("dist/");
    expect(pkg.exports).toEqual({ ".": "./index.ts" });
  });

  it("has a build script, a runtime esbuild, and keeps npm test free of builds", () => {
    expect(pkg.scripts.build).toBe("node scripts/build.mjs");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.pretest).toBeUndefined();
    // Git installs (pi: `npm install --omit=dev`) build dist/ in `prepare`, so esbuild cannot be dev-only.
    expect(pkg.dependencies.esbuild).toBe("0.28.2");
    expect(pkg.devDependencies.esbuild).toBeUndefined();
  });

  it("publishing builds so a registry tarball can never ship without dist/", () => {
    expect(pkg.scripts.prepublishOnly).toBe("node scripts/build.mjs");
  });
});
