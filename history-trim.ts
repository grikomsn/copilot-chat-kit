/** Token estimation and oldest-turn trimming for opted-in context caps. */

/** Result of trimming a converted request list against a context cap. */
export interface HistoryTrimResult<T> {
  readonly items: readonly T[];
  readonly removedItems: number;
  readonly estimatedTokens: number;
}

/** Fixed estimate for an image part, whose base64 payload is not token-shaped. */
export const IMAGE_TOKEN_ESTIMATE = 1024;
/** Modest estimate for encrypted reasoning payloads, whose content is opaque. */
export const REASONING_TOKEN_ESTIMATE = 128;
/** Matches the extension's chars-per-token counting heuristic. */
export const CHARS_PER_TOKEN = 4;

export function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Drops the smallest prefix of middle units that fits the budget, keeping the
 * first unit (the anchor) and the last unit (the current turn). Units are
 * given as start indexes; callers place boundaries only where no tool call is
 * outstanding, so call/result pairs are never split. Uncapped or
 * already-fitting input is returned unchanged.
 */
export function dropOldestUnits<T>(
  items: readonly T[],
  itemTokens: readonly number[],
  unitStarts: readonly number[],
  budgetTokens: number,
): HistoryTrimResult<T> {
  const units = unitStarts.map((start, index) => {
    const end = (index + 1 < unitStarts.length ? unitStarts[index + 1] : items.length) - 1;
    return { start, end, tokens: itemTokens.slice(start, end + 1).reduce((sum, tokens) => sum + tokens, 0) };
  });
  const total = units.reduce((sum, unit) => sum + unit.tokens, 0);
  if (budgetTokens <= 0 || units.length < 3 || total <= budgetTokens) {
    return { items, removedItems: 0, estimatedTokens: total };
  }
  let droppedTokens = 0;
  let dropUpToUnit = 1;
  for (let unit = 1; unit <= units.length - 2; unit++) {
    droppedTokens += units[unit].tokens;
    dropUpToUnit = unit;
    if (total - droppedTokens <= budgetTokens) break;
  }
  const dropStart = units[1].start;
  const dropEnd = units[dropUpToUnit].end;
  return {
    items: [...items.slice(0, dropStart), ...items.slice(dropEnd + 1)],
    removedItems: dropEnd - dropStart + 1,
    estimatedTokens: total - droppedTokens,
  };
}

/** Unit starts: index 0 plus every user item reached with no outstanding tool call. */
export function unitStartsBy<T>(
  items: readonly T[],
  isUserBoundary: (item: T) => boolean,
  trackCalls: (item: T, pending: { open(id: string): void; settle(id: string): void }) => void,
): number[] {
  const starts = items.length ? [0] : [];
  const pending: string[] = [];
  const tracker = {
    open: (id: string): void => { pending.push(id); },
    settle: (id: string): void => {
      const index = pending.indexOf(id);
      if (index >= 0) pending.splice(index, 1);
    },
  };
  for (let index = 0; index < items.length; index++) {
    if (index > 0 && pending.length === 0 && isUserBoundary(items[index])) starts.push(index);
    trackCalls(items[index], tracker);
  }
  return starts;
}

/** Structural shape of a converted Chat Completions message. */
export interface TrimChatMessage {
  readonly role: string;
  readonly content: string | null | readonly { readonly type: string; readonly text?: string; readonly image_url?: unknown }[];
  readonly tool_calls?: readonly { readonly id: string; readonly type?: string; readonly function: { readonly name: string; readonly arguments: string } }[];
  readonly tool_call_id?: string;
  readonly reasoning_content?: string;
}

/** Estimates the token weight of one converted chat message. */
export function estimateChatMessageTokens(message: TrimChatMessage): number {
  const content = message.content;
  let tokens = typeof content === "string"
    ? textTokens(content)
    : Array.isArray(content)
      ? content.reduce((sum, part) => sum + (part.type === "image_url" ? IMAGE_TOKEN_ESTIMATE : textTokens(part.text ?? "")), 0)
      : 0;
  if (typeof message.reasoning_content === "string") tokens += textTokens(message.reasoning_content);
  for (const call of message.tool_calls ?? []) {
    tokens += Math.max(1, textTokens(`${call.function.name}${call.function.arguments}`));
  }
  return Math.max(1, tokens);
}

/** Drops the oldest chat turns so the estimated payload fits an opted-in cap. */
export function trimChatHistoryToFit<T extends TrimChatMessage>(messages: readonly T[], budgetTokens: number): HistoryTrimResult<T> {
  const starts = unitStartsBy(messages, (message) => message.role === "user", (message, pending) => {
    for (const call of message.tool_calls ?? []) pending.open(call.id);
    if (message.role === "tool" && typeof message.tool_call_id === "string") pending.settle(message.tool_call_id);
  });
  return dropOldestUnits(messages, messages.map(estimateChatMessageTokens), starts, budgetTokens);
}

/** Estimates the token weight of one converted Responses input item. */
export function estimateResponsesItemTokens(item: object): number {
  const record = item as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "reasoning") return REASONING_TOKEN_ESTIMATE;
  if (type === "function_call") return Math.max(1, textTokens(`${stringOf(record.name)}${stringOf(record.arguments)}`));
  if (type === "function_call_output") return Math.max(1, textTokens(stringOf(record.output)));
  if (type === "message") {
    const content = record.content;
    if (typeof content === "string") return Math.max(1, textTokens(content));
    if (Array.isArray(content)) return Math.max(1, content.reduce((sum: number, part: unknown) => sum + contentPartTokens(part), 0));
    return 1;
  }
  return Math.max(1, textTokens(safeJson(record)));
}

/** Drops the oldest Responses turns, keeping function-call and reasoning adjacency intact. */
export function trimResponsesInputToFit<T extends object>(items: readonly T[], budgetTokens: number): HistoryTrimResult<T> {
  const starts = unitStartsBy(items, (item) => {
    const record = item as Record<string, unknown>;
    return record.type === "message" && record.role === "user";
  }, (item, pending) => {
    const record = item as Record<string, unknown>;
    if (typeof record.call_id !== "string") return;
    if (record.type === "function_call") pending.open(record.call_id);
    if (record.type === "function_call_output") pending.settle(record.call_id);
  });
  return dropOldestUnits(items, items.map(estimateResponsesItemTokens), starts, budgetTokens);
}

function contentPartTokens(part: unknown): number {
  if (typeof part !== "object" || part === null) return textTokens(String(part ?? ""));
  const record = part as Record<string, unknown>;
  if (record.type === "input_image" || record.type === "image_url") return IMAGE_TOKEN_ESTIMATE;
  if (typeof record.text === "string") return textTokens(record.text);
  return textTokens(safeJson(record));
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
