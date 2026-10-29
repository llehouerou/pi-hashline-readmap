// git diff, show and log pass through untouched: reviews need the whole output, and the
// bash context guard already offloads oversized output to a file.
const GIT_COMMANDS = ["git status"];

export function isGitCommand(command: string | undefined | null): boolean {
	if (typeof command !== "string" || command.length === 0) {
		return false;
	}

	const cmdLower = command.toLowerCase();
	return GIT_COMMANDS.some((gc) => cmdLower.startsWith(gc));
}

interface StatusStats {
	staged: number;
	modified: number;
	untracked: number;
	conflicts: number;
	stagedFiles: string[];
	modifiedFiles: string[];
	untrackedFiles: string[];
}

const SHORT_STATUS_CODES = new Set([" ", "M", "A", "D", "R", "C", "U", "T", "?", "!"]);

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

export function compactStatus(output: string): string {
	const lines = output.split("\n");

	if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === "")) {
		return "Clean working tree";
	}

	const contentLines = lines.filter((line) => line !== "");
	if (contentLines.length === 0 || !contentLines.every(isRecognizedShortStatusLine)) {
		return output;
	}

	const stats: StatusStats = {
		staged: 0,
		modified: 0,
		untracked: 0,
		conflicts: 0,
		stagedFiles: [],
		modifiedFiles: [],
		untrackedFiles: [],
	};

	let branchName = "";

	for (const line of lines) {
		// Extract branch name from first line
		if (line.startsWith("##")) {
			const match = line.match(/## (.+)/);
			if (match) {
				branchName = match[1].split("...")[0];
			}
			continue;
		}

		if (line.length < 3) {
			continue;
		}

		const status = line.slice(0, 2);
		const filename = line.slice(3);

		// Parse two-character status
		const indexStatus = status[0];
		const worktreeStatus = status[1];

		if (["M", "A", "D", "R", "C"].includes(indexStatus)) {
			stats.staged++;
			stats.stagedFiles.push(filename);
		}

		if (indexStatus === "U") {
			stats.conflicts++;
		}

		if (["M", "D"].includes(worktreeStatus)) {
			stats.modified++;
			stats.modifiedFiles.push(filename);
		}

		if (status === "??") {
			stats.untracked++;
			stats.untrackedFiles.push(filename);
		}
	}

	// Build summary
	let result = `📌 ${branchName}\n`;

	if (stats.staged > 0) {
		result += `✅ Staged: ${stats.staged} files\n`;
		const shown = stats.stagedFiles.slice(0, 5);
		for (const file of shown) {
			result += `  ${file}\n`;
		}
		if (stats.staged > 5) {
			result += `  ... +${stats.staged - 5} more\n`;
		}
	}

	if (stats.modified > 0) {
		result += `📝 Modified: ${stats.modified} files\n`;
		const shown = stats.modifiedFiles.slice(0, 5);
		for (const file of shown) {
			result += `  ${file}\n`;
		}
		if (stats.modified > 5) {
			result += `  ... +${stats.modified - 5} more\n`;
		}
	}

	if (stats.untracked > 0) {
		result += `❓ Untracked: ${stats.untracked} files\n`;
		const shown = stats.untrackedFiles.slice(0, 3);
		for (const file of shown) {
			result += `  ${file}\n`;
		}
		if (stats.untracked > 3) {
			result += `  ... +${stats.untracked - 3} more\n`;
		}
	}

	if (stats.conflicts > 0) {
		result += `⚠️  Conflicts: ${stats.conflicts} files\n`;
	}

	return result.trim();
}

export function compactGitOutput(
	output: string,
	command: string | undefined | null
): string | null {
	if (typeof command !== "string" || !isGitCommand(command)) {
		return null;
	}

	const cmdLower = command.toLowerCase();

	if (cmdLower.startsWith("git status")) {
		const compacted = compactStatus(output);
		return compacted === output ? null : compacted;
	}

	return null;
}
