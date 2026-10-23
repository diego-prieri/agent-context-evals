import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseConfig, type Task } from "../src/config.js";
import { buildMatrix, runEvals, substitute } from "../src/runner.js";
import { renderMatrix, renderReport } from "../src/report.js";

const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const fakeAgent = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ace-repo-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g("init", "-q");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "Test");
  g("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ["src"] }));
  // One pre-existing error that the baseline must absorb.
  writeFileSync(join(dir, "src/base.ts"), 'export const broken: number = "x";\n');
  g("add", "-A");
  g("commit", "-q", "-m", "init");
  return dir;
}

function config(repo: string, extra: Record<string, unknown> = {}) {
  return parseConfig(
    {
      repo,
      variants: [{ name: "baseline" }, { name: "good-context", context: "CONTEXT:good" }],
      agentCommand: [process.execPath, fakeAgent, "{prompt}"],
      verify: { typecheck: `"${process.execPath}" "${tscBin}" --noEmit --pretty false -p .` },
      linkNodeModules: false,
      workDir: join(repo, "..", `${repo.split("/").pop()}-work`),
      timeoutSec: 60,
      ...extra,
    },
    repo,
  );
}

test("substitute replaces known placeholders per argument", () => {
  assert.deepEqual(substitute(["a", "{prompt}", "--cwd={cwd}", "{other}"], { prompt: "p q", cwd: "/w" }), ["a", "p q", "--cwd=/w", "{other}"]);
});

test("buildMatrix and dry-run rendering", () => {
  const c = config("/tmp/none", { repetitions: 2 });
  const tasks: Task[] = [{ id: "t1", prompt: "x" }, { id: "t2", prompt: "y", test: "npm test" }];
  const m = buildMatrix(c, tasks);
  assert.equal(m.length, 8);
  const out = renderMatrix(c, m);
  assert.match(out, /Runs: 8 \(2 tasks × 2 variants × 2 reps\)/);
  assert.match(out, /\| 8 \| t2 \| good-context \| 2 \| npm test \|/);
});

test("runEvals with a fake agent counts only new TS errors and cleans up worktrees", async () => {
  const repo = fixtureRepo();
  const c = config(repo);
  const outFile = join(repo, "..", `${repo.split("/").pop()}-results.jsonl`);
  const tasks: Task[] = [
    { id: "write-file", prompt: "Write src/new.ts", test: `"${process.execPath}" -e "process.exit(require('fs').existsSync('src/new.ts')?0:1)"` },
  ];
  const results = await runEvals(c, tasks, { outFile });
  assert.equal(results.length, 2);
  const [base, good] = results;

  assert.equal(base.variant, "baseline");
  assert.equal(base.pass, false);
  assert.equal(base.typecheckPass, false);
  assert.equal(base.newTsErrors, 1);
  assert.match(base.newTsErrorSamples[0], /src\/new\.ts.*TS2322/);
  assert.equal(base.testPass, true);
  assert.equal(base.filesChanged, 1);

  assert.equal(good.variant, "good-context");
  assert.equal(good.pass, true, JSON.stringify(good));
  assert.equal(good.newTsErrors, 0);
  assert.equal(good.filesChanged, 2);
  assert.match(good.diffStat, /src\/base\.ts/);
  assert.equal(good.agentExitCode, 0);

  const lines = readFileSync(outFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).variant, "good-context");

  const report = renderReport(results, ["baseline", "good-context"]);
  assert.match(report, /\| baseline \| 0\.0% \(0\/1\)/);
  assert.match(report, /\*\*good-context\*\*: \+100\.0%/);
  assert.match(report, /Small sample/);

  assert.deepEqual(readdirSync(c.workDir), []);
  const wt = execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).trim().split("\n");
  assert.equal(wt.length, 1);
  assert.equal(existsSync(join(repo, "src/new.ts")), false);
});

test("runEvals marks no-op and timed-out runs as failures", async () => {
  const repo = fixtureRepo();
  const c = config(repo, { variants: [{ name: "only" }], timeoutSec: 2 });
  const results = await runEvals(c, [
    { id: "noop", prompt: "NOOP" },
    { id: "slow", prompt: "SLEEP" },
  ]);
  assert.equal(results[0].filesChanged, 0);
  assert.equal(results[0].typecheckPass, true);
  assert.equal(results[0].pass, false);
  assert.equal(results[1].agentTimedOut, true);
  assert.equal(results[1].pass, false);
});
