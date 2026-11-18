/** Shared error formatting with one policy for upstream failure details. */

/** Returns a useful message for any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Request cancelled or timed out";
    return error.message;
  }
  return String(error);
}

/** Whether a thrown value is a fetch/stream abort. */
export function isAbortError(error: unknown): boolean {
  return (error instanceof Error || error instanceof DOMException) && error.name === "AbortError";
}

/** Preserve the underlying failure while making context rejections actionable. */
export function withContextOverflowHint(error: unknown): unknown {
  if (!(error instanceof Error) || error.message.includes("/compact")) return error;
  if (!/context[_ ](?:length|window)[_ ]exceeded|maximum context length|context (?:window|length).{0,100}(?:exceed|limit)|prompt (?:is )?too long|too many (?:input|prompt) tokens|exceed.{0,60}(?:context window|context length)/i.test(error.message)) return error;
  return new Error(`${error.message} Run /compact in Copilot Chat, reduce attachments or tool output, or start a new chat.`, { cause: error });
}

/** An HTTP failure carrying only its status, a sanitized provider message, and an error code. */
export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly detail?: string) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** The provider refused the credential itself, as opposed to a network or server failure. */
export function isRejectedCredential(error: unknown): boolean {
  return error instanceof ProviderHttpError && (error.status === 401 || error.status === 403);
}

/** Longest provider-authored detail kept in an error message. */
export const MAX_ERROR_DETAIL_CHARS = 300;

export interface HttpErrorOptions {
  /**
   * `"message"` (default) keeps a bounded provider-authored message from a
   * structured JSON body; `"none"` keeps only the status. Unstructured bodies
   * (HTML gateway pages, echoed input) are never surfaced.
   */
  readonly detail?: "message" | "none";
}

/**
 * Builds an error from a non-successful HTTP response. Only structured JSON
 * error fields are read; raw bodies never reach messages or logs.
 */
export async function httpError(prefix: string, response: Response, options: HttpErrorOptions = {}): Promise<ProviderHttpError> {
  const raw = await response.text().catch(() => "");
  const parsed = parseErrorBody(raw);
  const detail = options.detail === "none" ? undefined : parsed.message;
  return new ProviderHttpError(
    `${prefix} (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    response.status,
    parsed.code,
    detail,
  );
}

/** Extracts a bounded message and code from a structured error payload. */
export function parseErrorBody(raw: string): { message?: string; code?: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  const root = record(json);
  if (!root) return {};
  const nested = record(root.error);
  const message = [typeof root.error === "string" ? root.error : undefined, nested?.message, root.detail, root.message, root.title]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const code = [nested?.code, nested?.type, root.code]
    .find((value): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value));
  return {
    ...(message ? { message: boundedDetail(message) } : {}),
    ...(code ? { code } : {}),
  };
}

function boundedDetail(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_ERROR_DETAIL_CHARS ? `${collapsed.slice(0, MAX_ERROR_DETAIL_CHARS - 1)}…` : collapsed;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
