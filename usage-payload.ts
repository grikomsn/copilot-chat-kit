/** The `"usage"` data part Copilot Chat reads after each response. */

/** MIME type Copilot Chat recognizes for per-request token usage. */
export const USAGE_DATA_MIME = "usage";

/** Provider-neutral token counts for one request. */
export interface TokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cachedTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  /** Request cost in USD, when the provider reports one. */
  readonly costUsd?: number;
}

/** OpenAI-shaped usage payload, with optional cost credits. */
export interface ProviderUsagePayload {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number; readonly cache_write_tokens?: number };
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  readonly copilotCredits?: number;
}

/** Builds the usage payload; undefined when no token count is known. */
export function providerUsagePayload(usage: TokenUsage): ProviderUsagePayload | undefined {
  if (usage.promptTokens === undefined && usage.completionTokens === undefined && usage.totalTokens === undefined) return undefined;
  const promptDetails = {
    ...(usage.cachedTokens === undefined ? {} : { cached_tokens: usage.cachedTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cache_write_tokens: usage.cacheWriteTokens }),
  };
  return {
    ...(usage.promptTokens === undefined ? {} : { prompt_tokens: usage.promptTokens }),
    ...(usage.completionTokens === undefined ? {} : { completion_tokens: usage.completionTokens }),
    ...(usage.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
    ...(Object.keys(promptDetails).length ? { prompt_tokens_details: promptDetails } : {}),
    ...(usage.reasoningTokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }),
    ...(usage.costUsd === undefined ? {} : { copilotCredits: usage.costUsd }),
  };
}

/**
 * Reads OpenAI Chat Completions and Responses usage shapes, including the
 * common gateway aliases. A total is derived only when both sides are known.
 */
export function normalizeTokenUsage(raw: Record<string, unknown>): TokenUsage {
  const promptDetails = record(raw.prompt_tokens_details) ?? record(raw.input_tokens_details);
  const completionDetails = record(raw.completion_tokens_details) ?? record(raw.output_tokens_details);
  const promptTokens = count(raw.prompt_tokens ?? raw.input_tokens);
  const completionTokens = count(raw.completion_tokens ?? raw.output_tokens);
  const totalTokens = count(raw.total_tokens)
    ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
  const cachedTokens = count(promptDetails?.cached_tokens ?? raw.cached_tokens ?? raw.cache_read_input_tokens);
  const cacheWriteTokens = count(promptDetails?.cache_write_tokens ?? raw.cache_creation_input_tokens);
  const reasoningTokens = count(completionDetails?.reasoning_tokens ?? raw.reasoning_tokens);
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
}

/** Encodes a payload for a `LanguageModelDataPart`. */
export function encodeUsagePayload(payload: ProviderUsagePayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
