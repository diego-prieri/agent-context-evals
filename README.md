# agent-context-evals

Measure how much the context you give a coding agent changes the quality of its first attempt.

Agents working in a large codebase fail in predictable ways: they invent helpers that don't exist, import from paths that don't resolve, and guess the shape of interfaces. The usual fix is to give them more context, like a `CLAUDE.md`, a generated map of the codebase, or a conventions file. Whether that context helps, and by how much, is usually judged by feel. This harness turns it into a number.

The primary metric is simple: **the share of tasks whose one-shot output type-checks** (only errors that are new compared with the base commit count), and optionally also passes a per-task test command. Invented APIs show up as type errors, so this is a cheap, objective signal for the failure mode that context is supposed to fix.

## How it works

For every task × variant × repetition:

1. Create an isolated `git worktree` of the base ref in a temp directory (and symlink `node_modules`, or run a `setup` command).
2. Build the prompt: the variant's context, a `---` separator, then the task prompt.
3. Run the agent **once**, non-interactively, with the worktree as its working directory.
4. Run the typecheck and count errors that are not in the baseline. The baseline is computed once per base commit. Errors are compared by file, code and message, so an edit that shifts a pre-existing error down a few lines doesn't count against the agent.
5. Run the test command, if the task or the config has one.
6. Record the result (pass/fail, new TS errors, duration, files changed, `git diff --stat`) and remove the worktree.

A run **passes** when there are no new type errors, the test (if any) passed, the agent changed at least one file and did not time out.

## Configuration

`evals.config.json`:

```json
{
  "repo": "../my-next-app",
  "baseRef": "main",
  "tasksDir": "tasks",
  "variants": [
    { "name": "baseline", "context": "" },
    { "name": "repo-manifest", "contextFile": "contexts/MANIFEST.example.md" }
  ],
  "agentCommand": "claude -p {prompt} --output-format json --permission-mode acceptEdits --disallowedTools Bash",
  "verify": { "typecheck": "npx tsc --noEmit --pretty false" },
  "linkNodeModules": true,
  "timeoutSec": 600,
  "repetitions": 3
}
```

| Key | Purpose |
|---|---|
| `repo` | Repository the agent works on. Relative paths resolve against the config file. |
| `baseRef` | Commit, branch or tag every run starts from. Default `HEAD`. |
| `variants` | Each has a `name` and either `contextFile` or inline `context`. The first variant is the reference for comparisons. |
| `agentCommand` | String (split on whitespace) or argv array. `{prompt}` and `{cwd}` are substituted per argument and the command runs without a shell, so the prompt is passed as one argument with no quoting issues. Any CLI agent that takes a prompt and edits files in its cwd works. |
| `verify.typecheck` | Must print `file(line,col): error TSxxxx: message` lines, so keep `--pretty false`. |
| `verify.test` | Optional default test command. A task's own `test` overrides it. |
| `setup` | Optional shell command run in each fresh worktree, e.g. `npm ci`. |
| `linkNodeModules` | Symlink `<repo>/node_modules` into each worktree. Default `true`. |
| `timeoutSec` | Per-command timeout. Default 600. |
| `repetitions` | Runs per task × variant. Default 1. |
| `workDir` | Where worktrees are created. Default `.evals-work`. |

The default command disables `Bash` on purpose. If the agent could run `tsc` itself, it would iterate until it type-checks and you'd be measuring its self-correction loop, not its first attempt.

## Tasks

One Markdown file per task in `tasksDir`. Front matter is optional and the file name is the default id:

```markdown
---
id: typed-api-client
test: npx vitest run src/lib/products.test.ts
---
Create `src/lib/products.ts` exporting `getProducts(): Promise<Product[]>` ...
```

Good tasks are small, realistic and touch existing code, so knowing what already exists matters. See `tasks/` for three examples written for a hypothetical Next.js app.

## Usage

```bash
npm install
npx tsx src/cli.ts --dry-run                 # print the run matrix, run nothing
npx tsx src/cli.ts                           # run everything
npx tsx src/cli.ts -t debounced-search -v baseline -c path/to/evals.config.json
npx tsx src/cli.ts -o results/run1.jsonl
```

After `npm run build`, the same commands work as `agent-context-evals …`.

## Reading the results

Each run is appended as one JSON line to `results/results-<timestamp>.jsonl`, so a crashed session keeps what it already did. At the end a table is printed:

```markdown
| Variant | Pass rate | 95% CI | Type-checks | Mean new TS errors | Mean duration | n |
|---|---|---|---|---|---|---|
| baseline | 44.4% (8/18) | 24.6%–66.3% | 9/18 | 1.72 | 141.0s | 18 |
| repo-manifest | 72.2% (13/18) | 49.1%–87.5% | 13/18 | 0.44 | 128.3s | 18 |

Compared with `baseline` (Newcombe 95% interval for the difference in pass rate):

- **repo-manifest**: +27.8% [-3.2%, 51.9%], inconclusive: interval includes 0
```

(Illustrative numbers.) The per-variant interval is a Wilson score interval. The difference uses Newcombe's hybrid score interval, which behaves well at small n and near 0% or 100%. In the example a 28-point improvement is still inconclusive at n=18. That is the honest reading: run more tasks before concluding anything. Mean new TS errors is a useful secondary signal because it moves even when pass/fail doesn't.

## Limitations

- **One-shot only.** It measures the first attempt, not what the agent reaches after iterating. That is deliberate, but it is not the whole story.
- **Small n.** Agents are nondeterministic and each run is slow and costs money. Expect wide intervals with a few dozen runs. Runs of the same task are not independent, so the intervals are optimistic when you use repetitions rather than distinct tasks.
- **Type-checking is a proxy.** Code can type-check and be wrong. Add test commands for the tasks where correctness matters.
- **Cost.** Every run is a full agent session. On a subscription plan this eats into your usage limits; on an API key it is billed. Start with `--dry-run` and one repetition.
- **Sequential.** Runs are executed one at a time.
- **TypeScript only** for the error diff, though any command that prints `tsc`-style lines works.

## Development

```bash
npm install
npm test          # node:test via tsx, uses a fake agent against a temp git repo
npm run typecheck
npm run build
```

## License

MIT
