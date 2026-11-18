import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithRetry,
  gatewayOrRateLimitStatuses,
  gatewayStatuses,
  isTransientNetworkError,
  retryDelayMs,
  serverErrorStatuses,
  waitForRetry,
} from "./retry";

test("status policies cover their documented sets", () => {
  assert.deepEqual([429, 500, 502, 503, 504].map((status) => gatewayStatuses(status)), [false, false, true, true, true]);
  assert.deepEqual([429, 500, 502].map((status) => gatewayOrRateLimitStatuses(status)), [true, false, true]);
  assert.deepEqual([429, 500, 599, 400].map((status) => serverErrorStatuses(status)), [false, true, true, false]);
});

test("recognizes connection failures through error causes but not aborts", () => {
  assert.equal(isTransientNetworkError(new TypeError("fetch failed", { cause: new Error("ECONNRESET") })), true);
  assert.equal(isTransientNetworkError(new Error("other", { cause: "socket hang up" })), true);
  assert.equal(isTransientNetworkError(new DOMException("aborted", "AbortError")), false);
  assert.equal(isTransientNetworkError(new Error("HTTP 400")), false);
});

test("backs off exponentially and honors bounded retry-after", () => {
  assert.deepEqual([0, 1, 2, 3].map((attempt) => retryDelayMs(attempt)), [250, 500, 1000, 2000]);
  assert.equal(retryDelayMs(0, "2"), 2000);
  assert.equal(retryDelayMs(0, "999"), 5000);
  assert.equal(retryDelayMs(0, "nonsense"), 250);
});

test("waitForRetry rejects on abort and removes its listener on success", async () => {
  const controller = new AbortController();
  let added = 0;
  let removed = 0;
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => { added += 1; add(...args); }) as AbortSignal["addEventListener"];
  signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => { removed += 1; remove(...args); }) as AbortSignal["removeEventListener"];
  await waitForRetry(1, signal);
  assert.deepEqual([added, removed], [1, 1]);
  const pending = waitForRetry(10_000, signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(waitForRetry(1, signal), { name: "AbortError" });
});

test("retries transient statuses and network errors, then returns the final response", async () => {
  const waits: number[] = [];
  const wait = async (ms: number): Promise<void> => { waits.push(ms); };
  let calls = 0;
  const response = await fetchWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
    if (calls === 2) return new Response("busy", { status: 429, headers: { "retry-after": "1" } });
    return new Response("ok", { status: 200 });
  }, { wait });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [250, 1000]);

  let attempts = 0;
  const exhausted = await fetchWithRetry(async () => { attempts += 1; return new Response("", { status: 503 }); }, { wait, maxRetries: 1 });
  assert.equal(exhausted.status, 503);
  assert.equal(attempts, 2);

  let nonTransient = 0;
  const final = await fetchWithRetry(async () => { nonTransient += 1; return new Response("", { status: 429 }); }, { wait, isTransientStatus: gatewayStatuses });
  assert.equal(final.status, 429);
  assert.equal(nonTransient, 1);

  await assert.rejects(fetchWithRetry(async () => { throw new Error("bad request"); }, { wait }), /bad request/);
});
