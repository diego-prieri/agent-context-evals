import { spawn } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Runs argv without a shell. On timeout the whole process group is killed. */
export function run(argv: string[], opts: ExecOptions): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, opts.timeoutMs)
      : undefined;
    const done = (code: number | null, err?: Error) => {
      if (timer) clearTimeout(timer);
      if (err) stderr += String(err.message);
      resolvePromise({ code, stdout, stderr, timedOut, durationMs: Date.now() - start });
    };
    child.on("error", (err) => done(null, err));
    child.on("close", (code) => done(code));
  });
}

export function sh(command: string, opts: ExecOptions): Promise<ExecResult> {
  return run(["sh", "-c", command], opts);
}

export async function git(args: string[], cwd: string): Promise<string> {
  const r = await run(["git", ...args], { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
