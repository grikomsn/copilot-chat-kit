/** VS Code-owned API keys for native provider entries; keys stay in memory only. */

import { createHash } from "node:crypto";

/**
 * Stable, non-reversible credential fingerprint used to scope catalogs and
 * usage per native provider entry. Surrounding whitespace never changes it.
 */
export function credentialReference(apiKey: string): string {
  return createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 16);
}

/**
 * Extracts the API key from a native provider entry configuration.
 * `accept` lets a provider reject keys of the wrong shape.
 */
export function apiKeyFromConfiguration(
  configuration: Readonly<Record<string, unknown>>,
  accept: (apiKey: string) => boolean = () => true,
): string | undefined {
  const value = configuration.apiKey;
  const apiKey = typeof value === "string" ? value.trim() : "";
  return apiKey && accept(apiKey) ? apiKey : undefined;
}

/**
 * In-memory registry of the API keys VS Code supplied during provisioning.
 * Entry groups are the sole user-facing identity and the host namespaces model
 * identifiers per group, so no entry IDs are tracked. Recency uses a counter,
 * so keys registered within the same millisecond still order correctly.
 */
export class Credentials {
  private readonly entries = new Map<string, { apiKey: string; registeredAt: number }>();
  private sequence = 0;

  /** Registers a provisioned key and returns its credential fingerprint. */
  register(apiKey: string): string {
    const credentialRef = credentialReference(apiKey);
    this.sequence += 1;
    this.entries.set(credentialRef, { apiKey: apiKey.trim(), registeredAt: this.sequence });
    return credentialRef;
  }

  has(credentialRef: string): boolean {
    return this.entries.has(credentialRef);
  }

  keyForCredential(credentialRef: string): string | undefined {
    return this.entries.get(credentialRef)?.apiKey;
  }

  /** Most recently provisioned key; used by management commands and inline features. */
  activeApiKey(): string | undefined {
    let active: { apiKey: string; registeredAt: number } | undefined;
    for (const entry of this.entries.values()) {
      if (!active || entry.registeredAt >= active.registeredAt) active = entry;
    }
    return active?.apiKey;
  }

  /** Fingerprint of the most recently provisioned key. */
  activeCredentialRef(): string | undefined {
    const apiKey = this.activeApiKey();
    return apiKey === undefined ? undefined : credentialReference(apiKey);
  }
}
