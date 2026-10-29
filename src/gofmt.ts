import { spawnSync } from "node:child_process";

export interface GofmtResult {
	/** gofmt's output, only when it differs from the input. */
	formatted?: string;
	/** Why gofmt rejected the source (usually a syntax error). */
	error?: string;
}

/**
 * Formats the content about to be written to a `*.go` file with gofmt, so the
 * anchors returned for it describe the formatted file. Not Go, or gofmt not on
 * PATH: no-op.
 */
export function gofmtGoSource(path: string, content: string): GofmtResult {
	if (!path.endsWith(".go")) return {};
	const run = spawnSync("gofmt", [], { input: content, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
	if (run.error) {
		if ((run.error as NodeJS.ErrnoException).code === "ENOENT") return {};
		return { error: `gofmt: ${run.error.message}` };
	}
	if (run.status !== 0) {
		return { error: (run.stderr || `gofmt exited with status ${run.status}`).trim().replaceAll("<standard input>", path) };
	}
	return run.stdout === content ? {} : { formatted: run.stdout };
}

export function formatGofmtError(error: string): string {
	return `⚠️ gofmt failed; the file was written unformatted:\n${error}`;
}
