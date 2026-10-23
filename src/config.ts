import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export interface Variant {
  name: string;
  /** Path to a file whose contents are prepended to the prompt (relative to the config file). */
  contextFile?: string;
  /** Inline text prepended to the prompt. Used if `contextFile` is absent. */
  context?: string;
}

export interface EvalConfig {
  /** Absolute path of the repository the agent works on. */
  repo: string;
  baseRef: string;
  variants: Variant[];
  /** Command template. A string is split on whitespace; an array is used as-is. `{prompt}` and `{cwd}` are substituted per argument. */
  agentCommand: string[];
  verify: { typecheck: string; test?: string };
  /** Shell command run in each fresh worktree before the agent (e.g. `npm ci`). */
  setup?: string;
  /** Symlink `<repo>/node_modules` into each worktree. Default true. */
  linkNodeModules: boolean;
  timeoutSec: number;
  repetitions: number;
  /** Directory with task `.md` files (relative to the config file). */
  tasksDir: string;
  /** Directory for temporary worktrees. */
  workDir: string;
}

export interface Task {
  id: string;
  prompt: string;
  test?: string;
}

export const DEFAULT_AGENT_COMMAND =
  "claude -p {prompt} --output-format json --permission-mode acceptEdits --disallowedTools Bash";

function fail(msg: string): never {
  throw new Error(`Invalid config: ${msg}`);
}

export function parseConfig(raw: unknown, baseDir: string): EvalConfig {
  if (!raw || typeof raw !== "object") fail("expected a JSON object");
  const c = raw as Record<string, any>;
  if (typeof c.repo !== "string" || !c.repo) fail("`repo` is required");
  if (!Array.isArray(c.variants) || c.variants.length === 0) fail("`variants` must be a non-empty array");
  const names = new Set<string>();
  const variants: Variant[] = c.variants.map((v: any, i: number) => {
    if (!v || typeof v.name !== "string" || !v.name) fail(`variants[${i}].name is required`);
    if (names.has(v.name)) fail(`duplicate variant name "${v.name}"`);
    names.add(v.name);
    return {
      name: v.name,
      contextFile: typeof v.contextFile === "string" ? abs(baseDir, v.contextFile) : undefined,
      context: typeof v.context === "string" ? v.context : undefined,
    };
  });
  const cmd = c.agentCommand ?? DEFAULT_AGENT_COMMAND;
  const agentCommand = Array.isArray(cmd) ? cmd.map(String) : String(cmd).trim().split(/\s+/);
  if (agentCommand.length === 0 || !agentCommand[0]) fail("`agentCommand` is empty");
  if (!agentCommand.some((a) => a.includes("{prompt}"))) fail("`agentCommand` must contain {prompt}");
  const verify = c.verify ?? {};
  const num = (v: unknown, def: number, key: string) => {
    if (v === undefined) return def;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) fail(`\`${key}\` must be a positive integer`);
    return v;
  };
  return {
    repo: abs(baseDir, c.repo),
    baseRef: typeof c.baseRef === "string" && c.baseRef ? c.baseRef : "HEAD",
    variants,
    agentCommand,
    verify: {
      typecheck: typeof verify.typecheck === "string" ? verify.typecheck : "npx tsc --noEmit --pretty false",
      test: typeof verify.test === "string" ? verify.test : undefined,
    },
    setup: typeof c.setup === "string" ? c.setup : undefined,
    linkNodeModules: c.linkNodeModules !== false,
    timeoutSec: num(c.timeoutSec, 600, "timeoutSec"),
    repetitions: num(c.repetitions, 1, "repetitions"),
    tasksDir: abs(baseDir, typeof c.tasksDir === "string" ? c.tasksDir : "tasks"),
    workDir: abs(baseDir, typeof c.workDir === "string" ? c.workDir : ".evals-work"),
  };
}

function abs(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

export function loadConfig(path: string): EvalConfig {
  const full = resolve(path);
  return parseConfig(JSON.parse(readFileSync(full, "utf8")), dirname(full));
}

/** Parses a task file: optional `---` front matter with `id:` and `test:` lines, then the prompt. */
export function parseTask(text: string, fallbackId: string): Task {
  let body = text;
  const meta: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^\s*([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  const prompt = body.trim();
  if (!prompt) throw new Error(`Task "${meta.id ?? fallbackId}" has an empty prompt`);
  return { id: meta.id || fallbackId, prompt, test: meta.test || undefined };
}

export function loadTasks(dir: string): Task[] {
  if (!existsSync(dir)) throw new Error(`Tasks directory not found: ${dir}`);
  const tasks = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseTask(readFileSync(join(dir, f), "utf8"), basename(f, ".md")));
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`Duplicate task id "${t.id}"`);
    ids.add(t.id);
  }
  return tasks;
}

export function variantContext(v: Variant): string {
  if (v.contextFile) return readFileSync(v.contextFile, "utf8");
  return v.context ?? "";
}

export function buildPrompt(context: string, taskPrompt: string): string {
  const ctx = context.trim();
  return ctx ? `${ctx}\n\n---\n\n${taskPrompt}` : taskPrompt;
}
