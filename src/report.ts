import type { EvalConfig } from "./config.js";
import type { RunResult, RunSpec } from "./runner.js";
import { diffProportions, mean, wilson } from "./stats.js";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export interface VariantSummary {
  variant: string;
  n: number;
  passes: number;
  passRate: number;
  typecheckPasses: number;
  meanNewErrors: number;
  meanDurationSec: number;
}

export function summarize(results: RunResult[], variants: string[]): VariantSummary[] {
  return variants.map((variant) => {
    const rs = results.filter((r) => r.variant === variant);
    const passes = rs.filter((r) => r.pass).length;
    return {
      variant,
      n: rs.length,
      passes,
      passRate: rs.length ? passes / rs.length : 0,
      typecheckPasses: rs.filter((r) => r.typecheckPass).length,
      meanNewErrors: mean(rs.map((r) => r.newTsErrors)),
      meanDurationSec: mean(rs.map((r) => r.durationMs / 1000)),
    };
  });
}

export function renderReport(results: RunResult[], variants: string[]): string {
  const sums = summarize(results, variants);
  const lines = [
    "| Variant | Pass rate | 95% CI | Type-checks | Mean new TS errors | Mean duration | n |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const s of sums) {
    const ci = wilson(s.passes, s.n);
    lines.push(
      `| ${s.variant} | ${pct(s.passRate)} (${s.passes}/${s.n}) | ${pct(ci.low)}–${pct(ci.high)} | ${s.typecheckPasses}/${s.n} | ${s.meanNewErrors.toFixed(2)} | ${s.meanDurationSec.toFixed(1)}s | ${s.n} |`,
    );
  }
  const [ref, ...others] = sums;
  if (ref && others.length) {
    lines.push("", `Compared with \`${ref.variant}\` (Newcombe 95% interval for the difference in pass rate):`, "");
    for (const o of others) {
      const d = diffProportions(o.passes, o.n, ref.passes, ref.n);
      const sign = d.diff >= 0 ? "+" : "";
      const verdict = d.significant ? "interval excludes 0" : "inconclusive: interval includes 0";
      lines.push(`- **${o.variant}**: ${sign}${pct(d.diff)} [${pct(d.interval.low)}, ${pct(d.interval.high)}], ${verdict}`);
    }
  }
  const n = Math.min(...sums.map((s) => s.n));
  if (n < 30)
    lines.push("", `_Small sample (n=${n} per variant). Treat differences as directional, not as proof._`);
  return lines.join("\n");
}

export function renderMatrix(config: EvalConfig, matrix: RunSpec[]): string {
  const lines = [
    `Repo: ${config.repo}`,
    `Base ref: ${config.baseRef}`,
    `Agent: ${config.agentCommand.join(" ")}`,
    `Typecheck: ${config.verify.typecheck}`,
    `Runs: ${matrix.length} (${new Set(matrix.map((m) => m.task.id)).size} tasks × ${config.variants.length} variants × ${config.repetitions} reps)`,
    "",
    "| # | Task | Variant | Rep | Test |",
    "|---|---|---|---|---|",
  ];
  matrix.forEach((m, i) =>
    lines.push(`| ${i + 1} | ${m.task.id} | ${m.variant} | ${m.rep} | ${m.task.test ?? config.verify.test ?? "-"} |`),
  );
  return lines.join("\n");
}
