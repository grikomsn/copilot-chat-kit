/**
 * Fill-in-the-middle prompt pieces and suggestion cleanup shared by every
 * inline-completion engine. Pure and unit-tested.
 */

/** FIM delimiter tokens recognized by common code models. */
export const FIM_TOKENS = { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" } as const;

/** One user message that emulates FIM where the gateway has no FIM endpoint. */
export function fimUserContent(prefix: string, suffix: string): string {
  return `${FIM_TOKENS.prefix}${prefix}${FIM_TOKENS.suffix}${suffix}${FIM_TOKENS.middle}`;
}

/**
 * Remove special-token artifacts from a suggestion. Models occasionally echo
 * the injected FIM delimiters or tokenizer specials such as
 * `<|file_separator|>`; ghost text must never show them. Only token-shaped
 * `<|word|>` strings are removed, so `<|` operators without a matching `|>`
 * survive untouched.
 */
const SPECIAL_TOKEN_PATTERN = /<\|[A-Za-z0-9_.-]{1,48}\|>/g;

export function stripSpecialTokens(text: string): string {
  return text.replace(SPECIAL_TOKEN_PATTERN, "");
}

/**
 * Strip code-fence artifacts: a closed surrounding fence, a dangling opener
 * left when the token budget truncates the stream, or an orphan closer.
 * Responses that merely contain fences inline are left untouched. Unfenced
 * text keeps its leading newlines (a completion may legitimately start on the
 * next line) unless `trimLeadingNewlines` is set.
 */
export function stripCodeFence(text: string, options: { readonly trimLeadingNewlines?: boolean } = {}): string {
  const working = text.replace(/^\n+/, "").trimEnd();
  const closed = /^```[^\n]*\n([\s\S]*?)\n?[ \t]*```[ \t]*$/.exec(working);
  if (closed) return closed[1] ?? "";
  const danglingOpener = /^```[^\n]*\n([\s\S]*)$/.exec(working);
  if (danglingOpener && !(danglingOpener[1] ?? "").includes("```")) return danglingOpener[1] ?? "";
  const orphanCloser = /^([\s\S]*?)\n[ \t]*```[ \t]*$/.exec(working);
  if (orphanCloser && !(orphanCloser[1] ?? "").includes("```")) return orphanCloser[1] ?? "";
  return options.trimLeadingNewlines ? working : text;
}

/** Special tokens first, then fences; undefined when nothing visible remains. */
export function cleanSuggestion(text: string, options: { readonly trimLeadingNewlines?: boolean } = {}): string | undefined {
  const clean = stripCodeFence(stripSpecialTokens(text), options);
  return clean.trim() ? clean : undefined;
}

/**
 * Picks the reasoning-off effort a model accepts for inline completions.
 * "none" is preferred; models without it use their lightest listed effort, and
 * models with no reasoning control omit the field entirely.
 */
export function completionReasoningEffort(efforts: readonly string[] | undefined, preferred = "none"): string | undefined {
  if (!efforts?.length) return undefined;
  if (efforts.includes(preferred)) return preferred;
  return efforts[0];
}
