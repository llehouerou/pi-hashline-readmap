import { createBashTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { buildCollapsedPreview, clampLinesToWidth, EXPAND_HINT, isRendererExpanded, renderToolLabel, summaryLine } from "./tui-render-utils.js";
import { resolvePreviewLines } from "./hashline-settings.js";
import {
  buildRequiredNullParameterError,
  normalizeToolParameters,
} from "./normalize-tool-params.js";

type BuiltInFactory = (cwd: string, options?: { shellPath?: string }) => any;

const BASH_DESCRIPTION = "Run tests, builds, git, package managers, and external CLIs; do not use for repo file reading/searching/listing/editing (use read, grep, find, ls, edit, or write).";
const BASH_PROMPT_SNIPPET = "Bash only for tests/builds/git/pkg/external CLIs. Don't use cat/head/tail, grep/rg, find/ls/tree, sed/awk/perl/python rewrites, or > heredocs/tee for repo files; use read/grep/find/ls/edit/write.";
const BASH_PROMPT_GUIDELINES = [
  "Use bash for tests, builds, git, package managers, and external CLIs.",
  "Do not use bash cat/head/tail/grep/rg/find/ls/tree/sed/awk for repo files.",
  "Use read/grep/find/ls/edit/write for repo file operations.",
];
const BASH_PARAMETERS = Type.Object({
  command: Type.String({ description: "Test/build/git/pkg/external command; not repo file read/search/list/edit." }),
  timeout: Type.Optional(Type.Number({ description: "Timeout seconds" })),
});

const BASH_CALL_PREVIEW_STEPS = 10;

/**
 * Split a shell command into display steps: one per top-level line, and one
 * per top-level `&&`, `||` or `;` (operator kept at the end of its step).
 * Quotes, backslash escapes, parentheses (subshells, `$(...)`) and heredoc
 * bodies are respected, so `echo "a && b"` or `x=$(a; b)` stay whole, and a
 * newline inside them (multi-line commit message, `\` continuation, `<<EOF`
 * body) stays inside its step. Display only — not a shell parser.
 */
export function splitShellSteps(command: string): string[] {
  const steps: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  let heredocs: string[] = [];
  const push = () => {
    if (current.trim()) steps.push(current.trim());
    current = "";
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote === "'") {
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      current += ch + command[++i];
      continue;
    }
    if (quote === '"') {
      current += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "\n" && heredocs.length > 0) {
      // Swallow each pending heredoc body up to its terminator line.
      let end = i;
      for (const delimiter of heredocs) {
        while (end < command.length) {
          const nl = command.indexOf("\n", end + 1);
          const lineEnd = nl === -1 ? command.length : nl;
          const line = command.slice(end + 1, lineEnd);
          end = lineEnd;
          if (line.trim() === delimiter) break;
        }
      }
      current += command.slice(i, end);
      heredocs = [];
      i = end - 1;
      continue;
    }
    if (ch === "\n" && depth === 0) {
      push();
      continue;
    }
    if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<" && command[i - 1] !== "<") {
      const match = /^<<-?[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/.exec(command.slice(i));
      if (match) {
        heredocs.push(match[1] ?? match[2] ?? match[3]!);
        current += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (depth === 0 && heredocs.length === 0) {
      const two = command.slice(i, i + 2);
      if (two === "&&" || two === "||" || (ch === ";" && two !== ";;")) {
        current += ch === ";" ? ch : two;
        if (ch !== ";") i++;
        push();
        while (command[i + 1] === " " || command[i + 1] === "\t") i++;
        continue;
      }
    }
    current += ch;
  }
  push();
  return steps;
}

export function registerBashRendererTool(pi: Pick<ExtensionAPI, "registerTool">, options: { cwd?: string; shellPath?: string; createBuiltInBashTool?: BuiltInFactory } = {}): any {
  const cache = new Map<string, any>();
  const createBuiltInBashTool = options.createBuiltInBashTool ?? ((cwd: string, opts?: { shellPath?: string }) => createBashTool(cwd, { shellPath: opts?.shellPath }));
  const getBuiltIn = (cwd: string) => {
    let tool = cache.get(cwd);
    if (!tool) {
      tool = createBuiltInBashTool(cwd, { shellPath: options.shellPath });
      cache.set(cwd, tool);
    }
    return tool;
  };
  const tool = {
    name: "bash",
    label: "bash",
    description: BASH_DESCRIPTION,
    promptSnippet: BASH_PROMPT_SNIPPET,
    promptGuidelines: BASH_PROMPT_GUIDELINES,
    parameters: BASH_PARAMETERS,
    async execute(toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: any, ctx: any = {}) {
      const normalized = normalizeToolParameters(BASH_PARAMETERS, params);
      if (normalized.requiredNull) {
        return buildRequiredNullParameterError("bash", normalized.requiredNull);
      }
      const cwd = ctx?.cwd ?? options.cwd ?? process.cwd();
      return getBuiltIn(cwd).execute(
        toolCallId,
        normalized.value,
        signal,
        onUpdate,
      );
    },
    renderCall(args: any, theme: any, context: any = {}) {
      const steps = splitShellSteps(String(args?.command ?? ""));
      const expanded = isRendererExpanded(undefined, context);
      const shown = expanded ? steps : steps.slice(0, BASH_CALL_PREVIEW_STEPS);
      const indent = " ".repeat("bash ".length);
      const lines = shown.flatMap((step, i) => {
        const stepLines = step.split("\n");
        const visible = expanded ? stepLines : [stepLines[0] + (stepLines.length > 1 ? " …" : "")];
        return visible.map((line, j) => (i === 0 && j === 0 ? `${renderToolLabel(theme, "bash")} ` : indent) + theme.fg("muted", line));
      });
      if (lines.length === 0) lines.push(renderToolLabel(theme, "bash"));
      const hidden = steps.length - shown.length;
      if (hidden > 0) lines.push(indent + theme.fg("muted", `… (${hidden} more${EXPAND_HINT})`));
      return new Text(clampLinesToWidth(lines, context.width).join("\n"), 0, 0);
    },
    renderResult(result: any, optionsArg: any, _theme: any, context: any = {}) {
      const expanded = isRendererExpanded(optionsArg, context);
      const width = context.width ?? optionsArg?.width;
      const text = result.content?.find((item: any) => item.type === "text")?.text ?? "";
      if (result.isError || context.isError) {
        const first = text.split("\n")[0] || "command failed";
        const body = expanded && text ? text : first;
        return new Text(clampLinesToWidth([summaryLine(body)], width).join("\n"), 0, 0);
      }
      if (!text.trim()) return new Text(summaryLine("command completed (no output)"), 0, 0);
      const lineCount = text.split("\n").filter(Boolean).length;
      if (expanded) {
        const rendered = `${summaryLine(`${lineCount} ${lineCount === 1 ? "line" : "lines"} returned`)}\n${text}`;
        return new Text(clampLinesToWidth(rendered.split("\n"), width).join("\n"), 0, 0);
      }
      const preview = buildCollapsedPreview(text, resolvePreviewLines(), width);
      const summary = summaryLine(`${lineCount} ${lineCount === 1 ? "line" : "lines"} returned`, { hidden: preview.lines.length === 0 });
      const out = [summary, ...(preview.hint ? [preview.hint] : []), ...preview.lines];
      return new Text(clampLinesToWidth(out, width).join("\n"), 0, 0);
    },
  };
  pi.registerTool(tool as any);
  return tool;
}
