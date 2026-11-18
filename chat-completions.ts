/** OpenAI-compatible Chat Completions stream parsing shared by every chat-dialect provider. */

import { SseFramer } from "./sse";

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Normalized stream event; Responses-dialect parsers emit the same shape. */
export interface ChatStreamEvent {
  text?: string;
  reasoning?: string;
  toolCalls?: PendingToolCall[];
  usage?: Record<string, unknown>;
  done?: boolean;
  finishReason?: string;
}

export interface ChatCompletionParserOptions {
  /** Provider name used in error messages, e.g. "Ampersand Bridge". */
  readonly label: string;
  /**
   * Surface a bounded `error.message` from in-stream errors. Off by default:
   * upstream bodies may echo private prompt context.
   */
  readonly surfaceStreamErrors?: boolean;
}

/**
 * Merges streamed tool-call deltas. Gateways may alternate indexed and
 * id-only deltas for one call, and some resend the full function name on
 * every chunk instead of streaming fragments.
 */
export class ChatToolAccumulator {
  private readonly pending = new Map<string, PendingToolCall>();
  private readonly aliases = new Map<string, string>();

  get size(): number {
    return this.pending.size;
  }

  collect(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const [position, raw] of value.entries()) {
      if (!isRecord(raw)) continue;
      const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
      const index = typeof raw.index === "number" ? `index:${raw.index}` : undefined;
      const idAlias = id ? `id:${id}` : undefined;
      const key = (index && this.aliases.get(index)) ?? (idAlias && this.aliases.get(idAlias)) ?? index ?? idAlias ?? `slot:${position}`;
      const current = this.pending.get(key) ?? { id: "", name: "", arguments: "" };
      if (id) current.id = id;
      if (index) this.aliases.set(index, key);
      if (idAlias) this.aliases.set(idAlias, key);
      const fn = isRecord(raw.function) ? raw.function : undefined;
      if (typeof fn?.name === "string" && fn.name) current.name = mergeToolName(current.name, fn.name);
      if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
      this.pending.set(key, current);
    }
  }

  /** Completes and clears every named pending call; incomplete JSON arguments throw. */
  flush(label: string): PendingToolCall[] {
    const tools = [...this.pending.values()].filter((tool) => tool.name).map((tool) => completeToolCall(tool, label));
    this.pending.clear();
    this.aliases.clear();
    return tools;
  }
}

/** Appends a streamed name fragment unless the chunk repeats the full name. */
export function mergeToolName(current: string, fragment: string): string {
  if (!current || fragment.startsWith(current)) return fragment;
  if (fragment === current) return current;
  return current + fragment;
}

/** Parses fragmented Chat Completions SSE into normalized events. */
export class ChatCompletionStreamParser {
  private readonly framer = new SseFramer();
  private readonly tools = new ChatToolAccumulator();
  private lastFinishReason: string | undefined;
  private sawText = false;
  private sawToolCall = false;

  constructor(private readonly options: ChatCompletionParserOptions) {}

  get finishReason(): string | undefined {
    return this.lastFinishReason;
  }

  push(chunk: string): ChatStreamEvent[] {
    return this.framer.push(chunk).flatMap((message) => this.parseMessage(message.event, message.data));
  }

  finish(): ChatStreamEvent[] {
    const events = this.framer.finish().flatMap((message) => this.parseMessage(message.event, message.data));
    const tools = this.flushTools();
    if (tools.length) events.push({ toolCalls: tools });
    return events;
  }

  /**
   * Rejects truncated or empty streams: the finish reason must be known, a
   * tool-call finish must have produced a tool call, and the stream must have
   * returned an answer or a tool call at all.
   */
  validateCompletion(requiresToolCall = false): void {
    validateStreamCompletion(this.options.label, this.lastFinishReason);
    if ((requiresToolCall || this.lastFinishReason === "tool_calls" || this.lastFinishReason === "function_call") && !this.sawToolCall) {
      throw new Error(`${this.options.label} completed without the required tool call`);
    }
    if (!this.sawText && !this.sawToolCall) {
      throw new Error(`${this.options.label} completed without returning an answer or tool call`);
    }
  }

  private parseMessage(event: string | undefined, data: string): ChatStreamEvent[] {
    // Named non-default events (e.g. a `metrics` trailer after [DONE]) carry no chat content.
    if (event && event !== "message") return [];
    if (data === "[DONE]") {
      const toolCalls = this.flushTools();
      return [{ done: true, ...(toolCalls.length ? { toolCalls } : {}) }];
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return [];
    }
    if (!isRecord(json)) return [];
    if (json.error) throw this.streamError(json.error);

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : undefined;
    const delta = isRecord(choice?.delta) ? choice.delta : {};
    this.tools.collect(delta.tool_calls);

    const finishReason = typeof choice?.finish_reason === "string" && choice.finish_reason ? choice.finish_reason : undefined;
    if (finishReason) this.lastFinishReason = finishReason;
    const toolCalls = finishReason ? this.flushTools() : [];
    const text = typeof delta.content === "string" ? delta.content : undefined;
    if (text?.trim()) this.sawText = true;
    const reasoning = [delta.reasoning_content, delta.reasoning]
      .find((value): value is string => typeof value === "string" && value.length > 0);
    const usage = isRecord(json.usage) ? json.usage : undefined;

    if (!text && !reasoning && !toolCalls.length && !usage && !finishReason) return [];
    return [{
      ...(text ? { text } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
    }];
  }

  private flushTools(): PendingToolCall[] {
    const tools = this.tools.flush(this.options.label);
    if (tools.length) this.sawToolCall = true;
    return tools;
  }

  private streamError(raw: unknown): Error {
    if (!this.options.surfaceStreamErrors) return new Error(`${this.options.label} response stream reported an API error`);
    const error = isRecord(raw) ? raw : {};
    const message = typeof error.message === "string" && error.message.trim() ? error.message.trim().slice(0, 300) : "Unknown stream error";
    const type = typeof error.type === "string" && error.type.trim() ? error.type.trim() : "server_error";
    return new Error(`${this.options.label} stream error (${type}): ${message}`);
  }
}

/** Accepts only finish reasons that mean the response is complete. */
export function validateStreamCompletion(label: string, finishReason: string | undefined): void {
  if (finishReason === "stop" || finishReason === "tool_calls" || finishReason === "function_call") return;
  if (!finishReason) throw new Error(`${label} response stream ended before a completion reason was received`);
  if (finishReason === "length") throw new Error(`${label} response reached its output token limit before completing`);
  if (finishReason === "content_filter") throw new Error(`${label} stopped the response because of its content filter`);
  throw new Error(`${label} response ended with finish reason: ${finishReason}`);
}

/** Normalizes empty arguments to `{}` and rejects truncated JSON. */
export function completeToolCall(tool: PendingToolCall, label: string): PendingToolCall {
  const args = tool.arguments.trim() || "{}";
  try {
    JSON.parse(args);
  } catch {
    throw new Error(`${label} response stream ended with incomplete arguments for tool ${tool.name}`);
  }
  return { ...tool, arguments: args };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
