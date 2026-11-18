/** Incremental Server-Sent Events framing, independent of any payload dialect. */

export interface SseMessage {
  /** The last `event:` name in the block, when present. */
  readonly event?: string;
  /** `data:` lines joined with newlines and trimmed. */
  readonly data: string;
}

/** Buffers fragmented text and yields one message per blank-line-delimited block. */
export class SseFramer {
  private buffer = "";

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let boundary = /\r?\n\r?\n/.exec(this.buffer);
    while (boundary) {
      const message = parseSseBlock(this.buffer.slice(0, boundary.index));
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      if (message) messages.push(message);
      boundary = /\r?\n\r?\n/.exec(this.buffer);
    }
    return messages;
  }

  /** Parses a final unterminated block, if any. */
  finish(): SseMessage[] {
    const message = parseSseBlock(this.buffer);
    this.buffer = "";
    return message ? [message] : [];
  }
}

/** Parses one SSE block; comment-only and empty blocks yield undefined. */
export function parseSseBlock(block: string): SseMessage | undefined {
  const lines = block.split(/\r?\n/);
  const event = lines
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice(6).trim())
    .pop();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return undefined;
  return event ? { event, data } : { data };
}
