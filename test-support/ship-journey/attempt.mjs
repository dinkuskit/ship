import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function recordAttempt({ directory, execute }) {
  await mkdir(directory, { recursive: true });
  const receipt = { status: "running", attemptId: randomUUID(), startedAt: new Date().toISOString(), synthetic: true };
  const file = join(directory, "installed-http-receipt.json");
  let sequence = 0, writes = Promise.resolve(), cleanup = async () => {};
  const save = () => {
    const snapshot = JSON.stringify(receipt, null, 2) + "\n";
    const temporary = `${file}.${receipt.attemptId}.${++sequence}.tmp`;
    writes = writes.then(async () => { await writeFile(temporary, snapshot); await rename(temporary, file); });
    return writes;
  };
  await save(); // Replaces any earlier pass before host preparation can fail.
  const onInterrupted = async (signal, cleanupStatus) => {
    receipt.interruptedSignal = signal;
    receipt.cleanup = cleanupStatus;
    receipt.status = cleanupStatus === "failed" ? "failed" : "interrupted";
    await save();
  };
  let failure;
  try { await execute({ receipt, save, onInterrupted, setCleanup: value => { cleanup = value; } }); }
  catch (error) { failure = error; }
  try { await cleanup(); receipt.cleanup = "passed"; }
  catch (error) { receipt.cleanup = "failed"; failure ??= error; }
  receipt.finishedAt = new Date().toISOString();
  receipt.status = receipt.cleanup === "failed" ? "failed" : receipt.interruptedSignal ? "interrupted" : failure ? "failed" : "passed";
  await save();
  if (failure) throw failure;
  return receipt;
}
