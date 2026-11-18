/** Conversion from VS Code chat history to OpenAI-compatible Chat Completions messages. */

import type * as vscode from "vscode";
import { joinTextParts, stringifyWellFormedJson } from "./unicode";

/** Injected VS Code classes keep this module free of a runtime `vscode` import. */
export type MessagePartClasses = Pick<typeof vscode,
  | "LanguageModelTextPart"
  | "LanguageModelToolCallPart"
  | "LanguageModelToolResultPart"
  | "LanguageModelDataPart"
  | "LanguageModelChatMessageRole"
> & { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart };

export interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ChatConversionOptions {
  /** Provider name used in error messages. */
  readonly label: string;
  /** Whether the selected model accepts image input. */
  readonly imageInput: boolean;
  /** `"throw"` (default) rejects user images for text-only models; `"omit"` sends a placeholder. */
  readonly unsupportedImages?: "throw" | "omit";
  /**
   * Forward tool-result images to vision models as a trailing user message
   * once every outstanding call has settled (default true). Text-only models
   * always get a placeholder.
   */
  readonly toolResultImages?: boolean;
  /** Replay assistant thinking as `reasoning_content` (default false). */
  readonly replayReasoning?: boolean;
  /** Inline images larger than this are replaced with a placeholder. */
  readonly maxInlineImageBytes?: number;
}

/** User text that introduces forwarded tool-result images. */
export const TOOL_IMAGES_NOTE = "Images returned by the tools above.";
/** Inserted when history would otherwise start with an assistant turn. */
export const CONTINUE_NOTE = "Continue from the previous assistant response.";

/**
 * Converts VS Code history. Tool results always directly follow the assistant
 * calls they settle, ahead of any user text sent in the same VS Code message;
 * strict Chat Completions backends reject user text between the two.
 */
export function convertChatMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  classes: MessagePartClasses,
  options: ChatConversionOptions,
): ChatMessage[] {
  const converted: ChatMessage[] = [];
  const pendingCalls = new Set<string>();
  const pendingImages: ChatContentPart[] = [];
  const flushImages = (): void => {
    if (!pendingImages.length) return;
    converted.push({ role: "user", content: [{ type: "text", text: TOOL_IMAGES_NOTE }, ...pendingImages.splice(0)] });
  };
  for (const message of messages) {
    const role = message.role === classes.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
    const text: string[] = [];
    const reasoning: string[] = [];
    const images: ChatContentPart[] = [];
    const toolCalls: ChatToolCall[] = [];
    const results: ChatMessage[] = [];
    for (const part of message.content) {
      if (part instanceof classes.LanguageModelTextPart) text.push(part.value);
      else if (classes.LanguageModelThinkingPart && part instanceof classes.LanguageModelThinkingPart) {
        reasoning.push(...(Array.isArray(part.value) ? part.value : [part.value]));
      } else if (part instanceof classes.LanguageModelToolCallPart) {
        pendingCalls.add(part.callId);
        toolCalls.push({ id: part.callId, type: "function", function: { name: part.name, arguments: stringifyWellFormedJson(part.input ?? {}) } });
      } else if (part instanceof classes.LanguageModelToolResultPart) {
        pendingCalls.delete(part.callId);
        const forward = options.imageInput && (options.toolResultImages ?? true);
        const result = toolResultContent(part.content, classes, forward ? options.maxInlineImageBytes : 0);
        results.push({ role: "tool", tool_call_id: part.callId, content: result.text });
        if (forward) pendingImages.push(...result.images);
      } else if (part instanceof classes.LanguageModelDataPart) {
        if (part.mimeType.startsWith("image/")) {
          if (!options.imageInput) {
            if ((options.unsupportedImages ?? "throw") === "throw") {
              throw new Error(`The selected ${options.label} model does not advertise image input support.`);
            }
            text.push(dataPlaceholder(part));
          } else if (options.maxInlineImageBytes !== undefined && part.data.byteLength > options.maxInlineImageBytes) {
            text.push(oversizedPlaceholder(part));
          } else {
            images.push(imagePart(part));
          }
        } else if (isTextMime(part.mimeType)) {
          text.push(new TextDecoder().decode(part.data));
        }
      }
    }
    const plainText = joinTextParts(text);
    const content: string | ChatContentPart[] = images.length
      ? [...(plainText ? [{ type: "text" as const, text: plainText }] : []), ...images]
      : plainText;
    const current: ChatMessage = role === "assistant" && toolCalls.length
      ? { role, content: content || null, tool_calls: toolCalls }
      : { role, content };
    if (options.replayReasoning && role === "assistant" && reasoning.some(Boolean)) {
      current.reasoning_content = joinTextParts(reasoning.filter(Boolean));
    }
    converted.push(...results);
    if (!pendingCalls.size) flushImages();
    converted.push(current);
  }
  flushImages();
  const filtered = converted.filter((message) => Boolean(message.tool_calls?.length || message.tool_call_id || hasContent(message.content)));
  if (filtered[0]?.role === "assistant") filtered.unshift({ role: "user", content: CONTINUE_NOTE });
  return filtered.length ? filtered : [{ role: "user", content: "" }];
}

/** Flattens a message to text for estimates and logs; data payloads are summarized. */
export function messageText(message: vscode.LanguageModelChatRequestMessage, classes: MessagePartClasses): string {
  return joinTextParts(message.content.map((part) => partText(part, classes)));
}

function toolResultContent(
  content: readonly unknown[],
  classes: MessagePartClasses,
  maxImageBytes: number | undefined,
): { text: string; images: ChatContentPart[] } {
  const text: string[] = [];
  const images: ChatContentPart[] = [];
  for (const part of content) {
    if (part instanceof classes.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      if (maxImageBytes === 0) text.push(dataPlaceholder(part));
      else if (maxImageBytes !== undefined && part.data.byteLength > maxImageBytes) text.push(oversizedPlaceholder(part));
      else images.push(imagePart(part));
    } else {
      const value = partText(part, classes);
      if (value) text.push(value);
    }
  }
  return { text: joinTextParts(text), images };
}

function partText(part: unknown, classes: MessagePartClasses): string {
  if (part instanceof classes.LanguageModelTextPart) return part.value;
  if (part instanceof classes.LanguageModelToolCallPart) return stringifyWellFormedJson(part.input ?? {});
  if (part instanceof classes.LanguageModelToolResultPart) return joinTextParts(part.content.map((nested) => partText(nested, classes)));
  if (part instanceof classes.LanguageModelDataPart) return isTextMime(part.mimeType) ? new TextDecoder().decode(part.data) : dataPlaceholder(part);
  return typeof part === "string" ? part : "";
}

function imagePart(part: vscode.LanguageModelDataPart): ChatContentPart {
  return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}` } };
}

function dataPlaceholder(part: vscode.LanguageModelDataPart): string {
  return `[${part.mimeType} data omitted]`;
}

function oversizedPlaceholder(part: vscode.LanguageModelDataPart): string {
  return `[Image omitted: ${String(part.data.byteLength)} bytes exceeds the provider-safe inline limit]`;
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json";
}

function hasContent(content: ChatMessage["content"]): boolean {
  return typeof content === "string" ? content.length > 0 : Boolean(content?.length);
}
