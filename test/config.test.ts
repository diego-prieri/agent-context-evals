import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPrompt, DEFAULT_AGENT_COMMAND, loadTasks, parseConfig, parseTask } from "../src/config.js";

test("parseConfig applies defaults and resolves paths", () => {
  const c = parseConfig({ repo: "../app", variants: [{ name: "a" }, { name: "b", contextFile: "ctx.md" }] }, "/x/y");
  assert.equal(c.repo, "/x/app");
  assert.equal(c.baseRef, "HEAD");
  assert.deepEqual(c.agentCommand, DEFAULT_AGENT_COMMAND.split(" "));
  assert.equal(c.variants[1].contextFile, "/x/y/ctx.md");
  assert.equal(c.repetitions, 1);
  assert.equal(c.timeoutSec, 600);
  assert.equal(c.linkNodeModules, true);
  assert.equal(c.tasksDir, "/x/y/tasks");
  assert.match(c.verify.typecheck, /tsc --noEmit/);
});

test("parseConfig accepts an argv array and rejects bad input", () => {
  const c = parseConfig({ repo: "/r", variants: [{ name: "a" }], agentCommand: ["my-agent", "--msg", "{prompt}"] }, "/");
  assert.deepEqual(c.agentCommand, ["my-agent", "--msg", "{prompt}"]);
  assert.throws(() => parseConfig({ variants: [{ name: "a" }] }, "/"), /repo/);
  assert.throws(() => parseConfig({ repo: "/r", variants: [] }, "/"), /variants/);
  assert.throws(() => parseConfig({ repo: "/r", variants: [{ name: "a" }, { name: "a" }] }, "/"), /duplicate/);
  assert.throws(() => parseConfig({ repo: "/r", variants: [{ name: "a" }], agentCommand: "agent" }, "/"), /\{prompt\}/);
  assert.throws(() => parseConfig({ repo: "/r", variants: [{ name: "a" }], repetitions: 0 }, "/"), /repetitions/);
});

test("parseTask reads front matter and prompt", () => {
  const t = parseTask("---\nid: foo\ntest: npm test -- x\n---\nDo the thing.\n", "file");
  assert.deepEqual(t, { id: "foo", prompt: "Do the thing.", test: "npm test -- x" });
  assert.deepEqual(parseTask("Just a prompt", "file"), { id: "file", prompt: "Just a prompt", test: undefined });
  assert.throws(() => parseTask("---\nid: x\n---\n  ", "f"), /empty prompt/);
});

test("loadTasks loads md files sorted and rejects duplicate ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "ace-tasks-"));
  writeFileSync(join(dir, "b.md"), "B");
  writeFileSync(join(dir, "a.md"), "A");
  writeFileSync(join(dir, "notes.txt"), "ignored");
  assert.deepEqual(loadTasks(dir).map((t) => t.id), ["a", "b"]);
  writeFileSync(join(dir, "c.md"), "---\nid: a\n---\nC");
  assert.throws(() => loadTasks(dir), /Duplicate/);
});

test("loadTasks parses the bundled example tasks", () => {
  assert.equal(loadTasks(new URL("../tasks", import.meta.url).pathname).length, 3);
});

test("buildPrompt prepends context only when present", () => {
  assert.equal(buildPrompt("  ", "task"), "task");
  assert.equal(buildPrompt("ctx", "task"), "ctx\n\n---\n\ntask");
});
