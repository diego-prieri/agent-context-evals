// Stand-in for a real coding agent. Writes valid TypeScript only when the prompt carries the "good" context.
import { readFileSync, writeFileSync } from "node:fs";

const prompt = process.argv[2] ?? "";
if (prompt.includes("SLEEP")) await new Promise((r) => setTimeout(r, 10_000));
if (prompt.includes("NOOP")) process.exit(0);
if (prompt.includes("CONTEXT:good")) {
  writeFileSync("src/new.ts", "export const total: number = 42;\n");
  // Shift the pre-existing baseline error down a line: it must still not count as new.
  writeFileSync("src/base.ts", "// touched by agent\n" + readFileSync("src/base.ts", "utf8"));
} else {
  writeFileSync("src/new.ts", 'export const total: number = "42";\n');
}
console.log(JSON.stringify({ result: "done" }));
