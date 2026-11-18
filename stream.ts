/** Request deadlines and incremental body reading shared by every streaming provider. */

/** The subset of `vscode.CancellationToken` the deadline needs. */
export interface CancellationLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => unknown): { dispose(): unknown };
}

export interface RequestDeadlineOptions {
  /** Whole-request budget in milliseconds. */
  readonly totalMs: number;
  /** Longest silence between received chunks; omitted disables the idle timer. */
  readonly idleMs?: number;
  readonly cancellation?: CancellationLike;
  /** Names the request in timeout errors, e.g. "Codex request"; defaults to "Request". */
  readonly label?: string;
}

/**
 * One abort signal for a request, tripped by caller cancellation, the total
 * budget, or stream inactivity. A timer abort carries its timeout error as the
 * signal's reason; caller cancellation aborts with a plain AbortError. Call {@link touch} on every received chunk and
 * {@link dispose} in a `finally` block.
 */
export class RequestDeadline {
  private readonly controller = new AbortController();
  private readonly totalTimer: ReturnType<typeof setTimeout>;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscription: { dispose(): unknown } | undefined;
  private reason: "total" | "idle" | undefined;

  constructor(private readonly options: RequestDeadlineOptions) {
    this.totalTimer = setTimeout(() => this.trip("total"), Math.max(1, options.totalMs));
    this.subscription = options.cancellation?.onCancellationRequested(() => this.controller.abort());
    if (options.cancellation?.isCancellationRequested) this.controller.abort();
    this.touch();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Which timer fired, if any; undefined for caller cancellation. */
  get timedOut(): "total" | "idle" | undefined {
    return this.reason;
  }

  /** Restarts the idle timer after receiving data. */
  touch(): void {
    if (this.options.idleMs === undefined || this.controller.signal.aborted) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.trip("idle"), Math.max(1, this.options.idleMs));
  }

  /** A descriptive error when a timer fired; undefined otherwise (including caller cancellation). */
  timeoutError(label = this.options.label ?? "Request"): Error | undefined {
    if (this.reason === "idle") return new Error(`${label} timed out: no data received for ${Math.round((this.options.idleMs ?? 0) / 1000)} seconds`);
    if (this.reason === "total") return new Error(`${label} timed out after ${Math.round(this.options.totalMs / 1000)} seconds`);
    return undefined;
  }

  /** Stops the timers and aborts any request still holding the signal. */
  dispose(): void {
    clearTimeout(this.totalTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.subscription?.dispose();
    this.controller.abort();
  }

  private trip(reason: "total" | "idle"): void {
    if (this.controller.signal.aborted) return;
    this.reason = reason;
    // The reason surfaces from fetch and stream reads, so make it descriptive.
    this.controller.abort(this.timeoutError());
  }
}

/**
 * Decodes a response body incrementally, handing each text chunk to `onText`
 * and touching the deadline. Returns false when cancellation stopped reading
 * early. The reader is always cancelled (when unfinished) and released.
 */
export async function readTextStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  options: { readonly deadline?: RequestDeadline; readonly isCancelled?: () => boolean } = {},
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let finished = false;
  try {
    while (true) {
      if (options.isCancelled?.()) return false;
      const result = await reader.read();
      if (options.isCancelled?.()) return false;
      if (result.done) break;
      options.deadline?.touch();
      const text = decoder.decode(result.value, { stream: true });
      if (text) onText(text);
    }
    const tail = decoder.decode();
    if (tail) onText(tail);
    finished = true;
    return true;
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
