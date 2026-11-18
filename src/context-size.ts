/** Picker context-window tiers and opt-in context caps shared by every provider. */

/** A selectable context window tier shown on a model's picker configuration. */
export interface ContextSizeOption {
  /** Context cap in input tokens; "auto" selects the model's default handling. */
  readonly value: number | "auto";
  /** Short picker label, e.g. "Auto", "128K", or "Maximum". */
  readonly label: string;
  /** Picker description for the tier. */
  readonly description: string;
}

/** Fixed context tiers offered below a model's registered input limit. */
const CONTEXT_SIZE_TIERS: readonly { value: number; label: string }[] = [
  { value: 65_536, label: "64K" },
  { value: 131_072, label: "128K" },
  { value: 200_000, label: "200K" },
];

/** Builds the context window tiers offered for a model's input limit; undefined when no tier fits. */
export function contextSizeOptions(maxInputTokens: number): ContextSizeOption[] | undefined {
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= CONTEXT_SIZE_TIERS[0].value) return undefined;
  const tiers = CONTEXT_SIZE_TIERS.filter((tier) => tier.value < maxInputTokens);
  if (!tiers.length) return undefined;
  return [
    // VS Code treats every numeric contextSize, including zero, as an input budget.
    { value: "auto", label: "Auto", description: "Default context handling for this model." },
    ...tiers.map((tier) => ({
      value: tier.value,
      label: tier.label,
      description: `Keep the conversation under ${tier.label} input tokens.`,
    })),
    {
      value: maxInputTokens,
      label: "Maximum",
      description: "Use the model's full available input limit.",
    },
  ];
}

/** Resolves the effective context cap for a request; Auto and Maximum return undefined. */
export function resolveContextCap(contextSize: number, maxInputTokens: number): number | undefined {
  if (!Number.isFinite(contextSize) || contextSize <= 0) return undefined;
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return undefined;
  const cap = Math.min(Math.floor(contextSize), maxInputTokens);
  return cap < maxInputTokens ? cap : undefined;
}

/** Reads the opted-in context size from picker configuration; 0 keeps the model's default handling. */
export function resolveContextSize(requestConfiguration: Readonly<Record<string, unknown>> | undefined): number {
  const value = requestConfiguration?.contextSize;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
