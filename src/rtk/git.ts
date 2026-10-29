import { dropMarker, outputLines, type Drop } from "./drops.ts";

// git diff and git show pass through untouched: reviews need the whole diff, and the
// bash context guard already offloads oversized output to a file.
const GIT_COMMANDS = ["git status", "git log"];

export function isGitCommand(command: string | undefined | null): boolean {
	if (typeof command !== "string" || command.length === 0) {
		return false;
	}

	const cmdLower = command.toLowerCase();
	return GIT_COMMANDS.some((gc) => cmdLower.startsWith(gc));
}

const SHORT_STATUS_CODES = new Set([" ", "M", "A", "D", "R", "C", "U", "T", "?", "!"]);
// The unmerged pairs of git-status(1)'s short-format table: a conflict, whatever its index code.
const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function isRecognizedShortStatusLine(line: string): boolean {
	if (line.startsWith("## ")) {
		return line.length > 3;
	}

	if (line.length < 4 || line[2] !== " " || line.includes("\0")) {
		return false;
	}

	const status = line.slice(0, 2);
	return status !== "  " && Array.from(status).every((code) => SHORT_STATUS_CODES.has(code));
}

export function compactStatus(output: string, drops: Drop[] = []): string {
	const lines = output.split("\n");

	if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === "")) {
		return "Clean working tree";
	}

	const contentLines = lines.filter((line) => line !== "");
	if (contentLines.length === 0 || !contentLines.every(isRecognizedShortStatusLine)) {
		return output;
	}

	const staged: string[] = [];
	const modified: string[] = [];
	const untracked: string[] = [];
	const ignored: string[] = [];
	const conflicts: string[] = [];

	let branchName = "";

	for (const line of lines) {
		// The branch line, tracking included (`main...origin/main [ahead 1]`)
		if (line.startsWith("##")) {
			branchName = line.slice(3);
			continue;
		}

		if (line.length < 3) {
			continue;
		}

		const status = line.slice(0, 2);
		const filename = line.slice(3);

		if (UNMERGED_STATUSES.has(status)) conflicts.push(line);
		else if (status === "??") untracked.push(filename);
		else if (status === "!!") ignored.push(filename);
		else {
			// Any other code is a change: in the index on the left, in the worktree (` T`, ` A` intent to add) on the right.
			if (status[0] !== " ") staged.push(filename);
			if (status[1] !== " ") modified.push(filename);
		}
	}

	let result = `📌 ${branchName}\n`;
	const sections: [title: string, files: string[], budget: number][] = [
		["✅ Staged", staged, 5],
		["📝 Modified", modified, 5],
		["❓ Untracked", untracked, 3],
		["🚫 Ignored", ignored, 3],
	];
	for (const [title, files, budget] of sections) {
		if (files.length === 0) continue;
		result += `${title}: ${files.length} files\n`;
		for (const file of files.slice(0, budget)) result += `  ${file}\n`;
		if (files.length > budget) {
			result += `${dropMarker(drops, files.length - budget, "files", `  ... and ${files.length - budget} more files`)}\n`;
		}
	}

	// No budget: every conflict is listed, its code naming each side.
	if (conflicts.length > 0) {
		result += `⚠️ Conflicts: ${conflicts.length} files\n`;
		for (const line of conflicts) {
			result += `  ${line}\n`;
		}
	}

	return result.trim();
}

// `commit [<>=+-] <sha>` at column 0, or `commit <sha>` after a `--graph` prefix ending in the commit's node (`*`, `<`,
// `>`, `o`); git abbreviates a sha to no fewer than 4 digits. A body line puts 4 or more spaces before its text
// (`    commit 1234567`, `|     * commit 1234567`), so the graph before a node may hold no run of 4 spaces.
// shortcut: a graph with two adjacent blank columns before a node reads as a body line, upgrade if such a graph turns up.
const LOG_COMMIT_HEADER = /^(?:(?:[|/\\]| (?! {3}))*[*<>o][-.|/\\ ]*)?commit (?:[<>=+-] )?[0-9a-f]{4,64}\b/;

/** Keeps the first `limit` whole commits, or `limit` lines of output with no commit header (`--oneline`, `--format`). */
export function compactLog(output: string, limit: number = 20, drops: Drop[] = []): string {
	const lines = outputLines(output);
	const headers = lines.flatMap((line, i) => (LOG_COMMIT_HEADER.test(line) ? [i] : []));
	if (headers.length > 0) {
		if (headers.length <= limit) return output;
		const marker = dropMarker(drops, headers.length - limit, "commits", `... and ${headers.length - limit} more commits`);
		return [...lines.slice(0, headers[limit]), marker].join("\n");
	}

	if (lines.length <= limit) return output;
	const marker = dropMarker(drops, lines.length - limit, "lines", `... and ${lines.length - limit} more lines`);
	return [...lines.slice(0, limit), marker].join("\n");
}

export function compactGitOutput(
	output: string,
	command: string | undefined | null,
	drops: Drop[] = [],
): string | null {
	if (typeof command !== "string" || !isGitCommand(command)) {
		return null;
	}

	const cmdLower = command.toLowerCase();

	if (cmdLower.startsWith("git status")) {
		const compacted = compactStatus(output, drops);
		return compacted === output ? null : compacted;
	}

	if (cmdLower.startsWith("git log")) {
		return compactLog(output, undefined, drops);
	}

	return null;
}
