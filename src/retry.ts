/** Pre-stream retry policy shared by every provider; which statuses are transient is a provider quirk. */

/** Decides whether an HTTP status (optionally with its sanitized detail) is worth retrying. */
export type TransientStatusPolicy = (status: number, detail?: string) => boolean;

/** 502/503/504: gateway and availability failures. */
export const gatewayStatuses: TransientStatusPolicy = (status) => status === 502 || status === 503 || status === 504;

/** Gateway failures plus 429 rate limits (honoring `retry-after`). */
export const gatewayOrRateLimitStatuses: TransientStatusPolicy = (status) => status === 429 || gatewayStatuses(status);

/** Any 5xx server failure. */
export const serverErrorStatuses: TransientStatusPolicy = (status) => status >= 500 && status <= 599;

/** Connection-level failures that never reached the provider's application layer. */
export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  return /fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|socket hang up/i.test(
    `${error.name}: ${error.message} ${networkCause(error)}`,
  );
}

/** Longest wait honored from a `retry-after` header. */
export const MAX_RETRY_AFTER_MS = 5_000;

/** Exponential backoff (250ms, 500ms, 1s, capped at 2s), or a bounded `retry-after`. */
export function retryDelayMs(attempt: number, retryAfter: string | null = null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, date - Date.now()));
  }
  return Math.min(2_000, 250 * 2 ** Math.max(0, attempt));
}

/** Waits for a retry delay; rejects with an AbortError as soon as the signal aborts and leaks no listener. */
export function waitForRetry(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export interface RetryOptions {
  /** Which HTTP statuses are retried; defaults to {@link gatewayOrRateLimitStatuses}. */
  readonly isTransientStatus?: TransientStatusPolicy;
  /** Retries after the first attempt; defaults to 2. */
  readonly maxRetries?: number;
  readonly signal?: AbortSignal | null;
  readonly log?: (message: string) => void;
  /** Injectable delay for tests. */
  readonly wait?: (milliseconds: number, signal?: AbortSignal | null) => Promise<void>;
}

/**
 * Sends a request and retries only failures that happen before any response
 * stream is consumed: transient statuses (body discarded) and connection
 * errors. The final response is returned as-is for the caller to judge.
 */
export async function fetchWithRetry(send: (attempt: number) => Promise<Response>, options: RetryOptions = {}): Promise<Response> {
  const isTransient = options.isTransientStatus ?? gatewayOrRateLimitStatuses;
  const maxRetries = options.maxRetries ?? 2;
  const wait = options.wait ?? waitForRetry;
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await send(attempt);
    } catch (error) {
      if (attempt >= maxRetries || options.signal?.aborted || !isTransientNetworkError(error)) throw error;
      const delay = retryDelayMs(attempt);
      options.log?.(`[retry] transient network failure; attempt=${attempt + 2} delayMs=${delay}`);
      await wait(delay, options.signal);
      continue;
    }
    if (attempt >= maxRetries || !isTransient(response.status)) return response;
    const delay = retryDelayMs(attempt, response.headers.get("retry-after"));
    options.log?.(`[retry] transient HTTP ${response.status}; attempt=${attempt + 2} delayMs=${delay}`);
    await response.body?.cancel().catch(() => undefined);
    await wait(delay, options.signal);
  }
}

function networkCause(error: Error): string {
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return `${cause.name}: ${cause.message} ${networkCause(cause)}`;
  return typeof cause === "string" ? cause : "";
}
