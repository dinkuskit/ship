import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { recordAttempt } from "../../test-support/ship-journey/attempt.mjs";
import { createDisposableRun, cleanupDisposableRun } from "../../test-support/ship-journey/package-install.mjs";

test("receipt replaces earlier pass and covers preparation, teardown and interruption", async () => {
  const directory = await createDisposableRun();
  const read = async () => JSON.parse(await readFile(join(directory, "installed-http-receipt.json"), "utf8"));
  try {
    const first = await recordAttempt({ directory, execute: async () => {} });
    assert.equal(first.status, "passed");
    await assert.rejects(recordAttempt({ directory, execute: async () => { assert.equal((await read()).status, "running"); throw new Error("preparation failed"); } }), /preparation failed/);
    assert.equal((await read()).status, "failed");
    assert.notEqual((await read()).attemptId, first.attemptId);
    await assert.rejects(recordAttempt({ directory, execute: async ({ setCleanup }) => { setCleanup(async () => { throw new Error("teardown failed"); }); } }), /teardown failed/);
    assert.equal((await read()).status, "failed");
    assert.equal((await read()).cleanup, "failed");
    const interrupted = await recordAttempt({ directory, execute: async ({ onInterrupted }) => { await onInterrupted("SIGTERM", "running"); } });
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.cleanup, "passed");
  } finally { await cleanupDisposableRun(directory); }
});
