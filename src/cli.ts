#!/usr/bin/env node
import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { loadConfig, loadTasks } from "./config.js";
import { buildMatrix, runEvals } from "./runner.js";
import { renderMatrix, renderReport } from "./report.js";

const HELP = `Usage: agent-context-evals [options]

Options:
  -c, --config <path>   Config file (default: evals.config.json)
  -t, --task <id>       Only run this task (repeatable)
  -v, --variant <name>  Only run this variant (repeatable)
  -o, --out <path>      Results JSONL (default: results/results-<timestamp>.jsonl)
      --dry-run         Print the run matrix without running the agent
  -h, --help            Show this help`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string", short: "c", default: "evals.config.json" },
      task: { type: "string", short: "t", multiple: true },
      variant: { type: "string", short: "v", multiple: true },
      out: { type: "string", short: "o" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const config = loadConfig(values.config!);
  if (values.variant?.length) {
    config.variants = config.variants.filter((v) => values.variant!.includes(v.name));
    if (!config.variants.length) throw new Error("No variants match --variant");
  }
  let tasks = loadTasks(config.tasksDir);
  if (values.task?.length) tasks = tasks.filter((t) => values.task!.includes(t.id));
  if (!tasks.length) throw new Error("No tasks to run");

  const matrix = buildMatrix(config, tasks);
  if (values["dry-run"]) {
    console.log(renderMatrix(config, matrix));
    return;
  }
  const outFile = resolve(values.out ?? join("results", `results-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`));
  const results = await runEvals(config, tasks, {
    outFile,
    onResult: (r, i, total) =>
      console.error(
        `[${i + 1}/${total}] ${r.taskId} / ${r.variant} #${r.rep}: ${r.pass ? "PASS" : "FAIL"}` +
          ` (new TS errors: ${r.newTsErrors}, files: ${r.filesChanged}, ${(r.durationMs / 1000).toFixed(1)}s)` +
          (r.error ? ` error: ${r.error}` : ""),
      ),
  });
  console.log(renderReport(results, config.variants.map((v) => v.name)));
  console.error(`\nResults written to ${outFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
