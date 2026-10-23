import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildPrompt, variantContext, type EvalConfig, type Task } from "./config.js";
import { git, run, sh } from "./exec.js";
import { newErrors, parseTscOutput, type TsError } from "./tsc.js";

export interface RunSpec {
  task: Task;
  variant: string;
  rep: number;
}

export interface RunResult {
  taskId: string;
  variant: string;
  rep: number;
  baseRef: string;
  baseCommit: string;
  /** Typecheck has no new errors and (if configured) the test command passed. */
  pass: boolean;
  typecheckPass: boolean;
  newTsErrors: number;
  newTsErrorSamples: string[];
  testPass: boolean | null;
  agentExitCode: number | null;
  agentTimedOut: boolean;
  durationMs: number;
  agentDurationMs: number;
  filesChanged: number;
  diffStat: string;
  error?: string;
}

export function buildMatrix(config: EvalConfig, tasks: Task[]): RunSpec[] {
  const specs: RunSpec[] = [];
  for (const task of tasks)
    for (const v of config.variants)
      for (let rep = 1; rep <= config.repetitions; rep++) specs.push({ task, variant: v.name, rep });
  return specs;
}

export function substitute(template: string[], vars: Record<string, string>): string[] {
  return template.map((arg) => arg.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
}

class Worktrees {
  constructor(private repo: string, private workDir: string) {}

  async create(commit: string, label: string): Promise<string> {
    mkdirSync(this.workDir, { recursive: true });
    const dir = mkdtempSync(join(this.workDir, `${label.replace(/[^\w.-]/g, "_")}-`));
    await git(["worktree", "add", "--detach", dir, commit], this.repo);
    return dir;
  }

  async remove(dir: string): Promise<void> {
    await git(["worktree", "remove", "--force", dir], this.repo).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
    await git(["worktree", "prune"], this.repo).catch(() => undefined);
  }
}

async function prepare(config: EvalConfig, dir: string): Promise<void> {
  const nm = join(config.repo, "node_modules");
  if (config.linkNodeModules && existsSync(nm) && !existsSync(join(dir, "node_modules")))
    symlinkSync(nm, join(dir, "node_modules"), "dir");
  if (config.setup) {
    const r = await sh(config.setup, { cwd: dir, timeoutMs: config.timeoutSec * 1000 });
    if (r.code !== 0) throw new Error(`setup failed (${r.code}): ${(r.stderr || r.stdout).slice(-500)}`);
  }
}

async function typecheck(config: EvalConfig, dir: string): Promise<TsError[]> {
  const r = await sh(config.verify.typecheck, { cwd: dir, timeoutMs: config.timeoutSec * 1000 });
  return parseTscOutput(r.stdout + "\n" + r.stderr);
}

export interface RunOptions {
  onResult?: (r: RunResult, index: number, total: number) => void;
  /** Append each result as a JSON line to this file. */
  outFile?: string;
}

export async function runEvals(config: EvalConfig, tasks: Task[], opts: RunOptions = {}): Promise<RunResult[]> {
  const baseCommit = (await git(["rev-parse", "--verify", `${config.baseRef}^{commit}`], config.repo)).trim();
  const wt = new Worktrees(config.repo, config.workDir);
  const contexts = new Map(config.variants.map((v) => [v.name, variantContext(v)]));

  // The baseline error set is computed once per base commit; only new errors count against the agent.
  const baseDir = await wt.create(baseCommit, "baseline");
  let baseline: TsError[];
  try {
    await prepare(config, baseDir);
    baseline = await typecheck(config, baseDir);
  } finally {
    await wt.remove(baseDir);
  }

  if (opts.outFile) mkdirSync(dirname(opts.outFile), { recursive: true });
  const matrix = buildMatrix(config, tasks);
  const results: RunResult[] = [];
  for (const [i, spec] of matrix.entries()) {
    const result = await runOne(config, wt, spec, baseCommit, baseline, contexts.get(spec.variant) ?? "");
    results.push(result);
    if (opts.outFile) appendFileSync(opts.outFile, JSON.stringify(result) + "\n");
    opts.onResult?.(result, i, matrix.length);
  }
  return results;
}

async function runOne(
  config: EvalConfig,
  wt: Worktrees,
  spec: RunSpec,
  baseCommit: string,
  baseline: TsError[],
  context: string,
): Promise<RunResult> {
  const start = Date.now();
  const result: RunResult = {
    taskId: spec.task.id,
    variant: spec.variant,
    rep: spec.rep,
    baseRef: config.baseRef,
    baseCommit,
    pass: false,
    typecheckPass: false,
    newTsErrors: 0,
    newTsErrorSamples: [],
    testPass: null,
    agentExitCode: null,
    agentTimedOut: false,
    durationMs: 0,
    agentDurationMs: 0,
    filesChanged: 0,
    diffStat: "",
  };
  let dir: string | undefined;
  try {
    dir = await wt.create(baseCommit, `${spec.task.id}-${spec.variant}-${spec.rep}`);
    await prepare(config, dir);
    const prompt = buildPrompt(context, spec.task.prompt);
    const argv = substitute(config.agentCommand, { prompt, cwd: dir });
    const agent = await run(argv, { cwd: dir, timeoutMs: config.timeoutSec * 1000 });
    result.agentExitCode = agent.code;
    result.agentTimedOut = agent.timedOut;
    result.agentDurationMs = agent.durationMs;

    // Include untracked files in the diff without staging anything the agent may rely on.
    await git(["add", "-A", "--intent-to-add", "."], dir);
    await git(["reset", "-q", "--", "node_modules"], dir).catch(() => undefined);
    const names = (await git(["diff", "--name-only", baseCommit, "--", ".", ":!node_modules"], dir)).trim();
    result.filesChanged = names ? names.split("\n").length : 0;
    result.diffStat = (await git(["diff", "--stat", baseCommit, "--", ".", ":!node_modules"], dir)).trim();

    const fresh = newErrors(baseline, await typecheck(config, dir));
    result.newTsErrors = fresh.length;
    result.newTsErrorSamples = fresh.slice(0, 5).map((e) => `${e.file}(${e.line},${e.col}): ${e.code} ${e.message}`);
    result.typecheckPass = fresh.length === 0;

    const testCmd = spec.task.test ?? config.verify.test;
    if (testCmd) {
      const t = await sh(testCmd, { cwd: dir, timeoutMs: config.timeoutSec * 1000 });
      result.testPass = t.code === 0;
    }
    // A run where the agent changed nothing is not a success, even though it type-checks.
    result.pass = result.typecheckPass && result.testPass !== false && result.filesChanged > 0 && !agent.timedOut;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.pass = false;
  } finally {
    if (dir) await wt.remove(dir);
    result.durationMs = Date.now() - start;
  }
  return result;
}
