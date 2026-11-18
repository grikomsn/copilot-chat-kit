import assert from "node:assert/strict";
import test from "node:test";
import { readTextStream, RequestDeadline } from "./stream";

function streamOf(chunks: string[], hold = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!hold) controller.close();
    },
  });
}

test("reads every chunk including split multi-byte characters", async () => {
  const bytes = new TextEncoder().encode("é😀");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  let text = "";
  assert.equal(await readTextStream(body, (chunk) => { text += chunk; }), true);
  assert.equal(text, "é😀");
});

test("stops early on cancellation and cancels the body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode("x")); },
    cancel() { cancelled = true; },
  });
  let reads = 0;
  const done = await readTextStream(body, () => { reads += 1; }, { isCancelled: () => reads >= 2 });
  assert.equal(done, false);
  assert.equal(cancelled, true);
});

test("idle and total timers abort with descriptive errors", async () => {
  const idle = new RequestDeadline({ totalMs: 10_000, idleMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(idle.signal.aborted, true);
  assert.equal(idle.timedOut, "idle");
  assert.match(idle.timeoutError("Example request")?.message ?? "", /received no data/);
  idle.dispose();

  const total = new RequestDeadline({ totalMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(total.timedOut, "total");
  assert.match(total.timeoutError("Example request")?.message ?? "", /exceeded/);
  total.dispose();
});

test("caller cancellation aborts without a timeout reason and dispose cleans up", () => {
  let listener: (() => unknown) | undefined;
  let disposed = false;
  const deadline = new RequestDeadline({
    totalMs: 10_000,
    idleMs: 10_000,
    cancellation: { isCancellationRequested: false, onCancellationRequested: (callback) => { listener = callback; return { dispose: () => { disposed = true; } }; } },
  });
  listener?.();
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.timedOut, undefined);
  assert.equal(deadline.timeoutError("x"), undefined);
  deadline.dispose();
  assert.equal(disposed, true);
});

test("touch keeps an active stream alive", async () => {
  const deadline = new RequestDeadline({ totalMs: 10_000, idleMs: 30 });
  let text = "";
  const body = streamOf(["a", "b"]);
  await readTextStream(body, (chunk) => { text += chunk; }, { deadline });
  assert.equal(text, "ab");
  assert.equal(deadline.signal.aborted, false);
  deadline.dispose();
});
