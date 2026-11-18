/** Projection of normalized stream output into VS Code language-model response parts. */

import type * as vscode from "vscode";
import type { ChatStreamEvent } from "./chat-completions";
import { encodeUsagePayload, USAGE_DATA_MIME, type ProviderUsagePayload } from "./usage-payload";

/** Injected part constructors keep this module free of a runtime `vscode` import. */
export type ResponsePartConstructors = Pick<typeof vscode,
  "LanguageModelTextPart" | "LanguageModelToolCallPart" | "LanguageModelDataPart"
> & { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart };

/**
 * One writer per response. It owns the reasoning segment (a stable,
 * request-scoped id: the renderer only re-stamps falsy ids), holds usage data
 * parts while a segment is open (Copilot Chat merges reasoning deltas only
 * while the previous part is thinking), and generates request-scoped fallback
 * tool-call ids.
 */
export class ResponseWriter {
  private thinkingOpen = false;
  private toolIndex = 0;
  private pendingUsage: ProviderUsagePayload[] = [];
  readonly segmentId: string;

  constructor(
    private readonly progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    private readonly parts: ResponsePartConstructors,
    private readonly idPrefix: string,
    private readonly requestId: string,
  ) {
    this.segmentId = `${idPrefix}-thinking-${requestId}`;
  }

  get isThinking(): boolean {
    return this.thinkingOpen;
  }

  /** Streams reasoning into the open segment; dropped when the host lacks thinking parts. */
  thinking(value: string | string[]): void {
    const ThinkingPart = this.parts.LanguageModelThinkingPart;
    if (!ThinkingPart || !value.length) return;
    this.progress.report(new ThinkingPart(value, this.segmentId));
    this.thinkingOpen = true;
  }

  /** Closes the open reasoning segment exactly once and flushes held usage. */
  closeThinking(): void {
    if (!this.thinkingOpen) return;
    this.thinkingOpen = false;
    const ThinkingPart = this.parts.LanguageModelThinkingPart;
    if (ThinkingPart) this.progress.report(new ThinkingPart("", this.segmentId, { vscode_reasoning_done: true }));
    for (const usage of this.pendingUsage.splice(0)) this.reportUsage(usage);
  }

  text(value: string): void {
    if (!value) return;
    this.closeThinking();
    this.progress.report(new this.parts.LanguageModelTextPart(value));
  }

  /** Reports a tool call; an empty id gets a request-scoped fallback. */
  toolCall(id: string | undefined, name: string, input: object): void {
    this.closeThinking();
    this.progress.report(new this.parts.LanguageModelToolCallPart(
      id || `${this.idPrefix}-tool-${this.requestId}-${this.toolIndex++}`, name, input,
    ));
  }

  /** Reports usage now, or after the open reasoning segment closes. */
  usage(payload: ProviderUsagePayload | undefined): void {
    if (!payload) return;
    if (this.thinkingOpen) this.pendingUsage.push(payload);
    else this.reportUsage(payload);
  }

  /** Reports any other part (data, images, opaque reasoning). */
  report(part: vscode.LanguageModelResponsePart2, options: { readonly closesThinking?: boolean } = {}): void {
    if (options.closesThinking ?? true) this.closeThinking();
    this.progress.report(part);
  }

  /** Closes the segment at EOF, cancellation, or failure, even without a terminal delta. */
  finish(): void {
    this.closeThinking();
  }

  private reportUsage(payload: ProviderUsagePayload): void {
    this.progress.report(new this.parts.LanguageModelDataPart(encodeUsagePayload(payload), USAGE_DATA_MIME));
  }
}

/**
 * Parses validated tool-call JSON. Objects pass through; other JSON values are
 * wrapped as `{ value }`; malformed JSON throws a provider-labelled error.
 */
export function parseToolArguments(value: string, label: string, toolName = "tool"): object {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || "{}");
  } catch {
    throw new Error(`${label} returned invalid arguments for ${toolName}`);
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : { value: parsed };
}

export interface ChatEventReporterOptions {
  /** Provider name used in error messages. */
  readonly label: string;
  /** Converts raw provider usage to the data-part payload. */
  readonly toUsagePayload: (raw: Record<string, unknown>) => ProviderUsagePayload | undefined;
  /** Observes raw usage, e.g. for status-bar tracking. */
  readonly onUsage?: (raw: Record<string, unknown>) => void;
}

/** Maps {@link ChatStreamEvent}s (from Chat Completions or Responses parsers) onto a writer. */
export class ChatEventReporter {
  constructor(private readonly writer: ResponseWriter, private readonly options: ChatEventReporterOptions) {}

  report(event: ChatStreamEvent): void {
    if (event.reasoning) this.writer.thinking(event.reasoning);
    if (event.text || event.toolCalls?.length || event.finishReason || event.done) this.writer.closeThinking();
    if (event.text) this.writer.text(event.text);
    for (const tool of event.toolCalls ?? []) {
      this.writer.toolCall(tool.id, tool.name, parseToolArguments(tool.arguments, this.options.label, tool.name));
    }
    if (event.usage) {
      this.options.onUsage?.(event.usage);
      this.writer.usage(this.options.toUsagePayload(event.usage));
    }
  }

  finish(): void {
    this.writer.finish();
  }
}
