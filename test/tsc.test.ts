import { test } from "node:test";
import assert from "node:assert/strict";
import { newErrors, parseTscOutput } from "../src/tsc.js";

const OUT = `src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.
src\\b.tsx(10,1): error TS2304: Cannot find name 'foo'.
src/c.ts(1,1): error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'.
  Property 'z' is missing in type 'X'.
Found 3 errors in 3 files.`;

test("parseTscOutput parses error lines and continuations", () => {
  const errs = parseTscOutput(OUT);
  assert.equal(errs.length, 3);
  assert.deepEqual(errs[0], {
    file: "src/a.ts", line: 3, col: 5, code: "TS2322",
    message: "Type 'string' is not assignable to type 'number'.",
  });
  assert.equal(errs[1].file, "src/b.tsx");
  assert.match(errs[2].message, /Property 'z' is missing/);
  assert.deepEqual(parseTscOutput(""), []);
});

test("newErrors ignores position shifts and counts duplicates", () => {
  const base = parseTscOutput("src/a.ts(3,5): error TS2322: bad.\nsrc/a.ts(9,1): error TS2322: bad.");
  const cur = parseTscOutput(
    "src/a.ts(4,5): error TS2322: bad.\nsrc/a.ts(10,1): error TS2322: bad.\nsrc/a.ts(20,1): error TS2322: bad.\nsrc/n.ts(1,1): error TS2304: Cannot find name 'x'.",
  );
  const fresh = newErrors(base, cur);
  assert.equal(fresh.length, 2);
  assert.deepEqual(fresh.map((e) => e.line), [20, 1]);
  assert.equal(newErrors(cur, base).length, 0);
});
