import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { clearMapCache } from "../src/map-cache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

async function callReadTool(params: { path: string; offset?: number; limit?: number }) {
	const { registerReadTool } = await import("../src/read.js");
	let capturedTool: any = null;
	const mockPi = { registerTool(def: any) { capturedTool = def; } };
	registerReadTool(mockPi as any);
	return capturedTool.execute("test", params, new AbortController().signal, () => {}, { cwd: process.cwd() });
}

describe("Task 2: Map integration in read.ts", () => {
	beforeEach(() => clearMapCache());

	it("large file without offset/limit is served map-first", async () => {
		const result = await callReadTool({ path: resolve(fixturesDir, "large.ts") });
		const text = result.content[0].text;
		expect(text).toContain("[Large file: showing lines 1-");
		expect(text).toContain("File Map:");
	});
});