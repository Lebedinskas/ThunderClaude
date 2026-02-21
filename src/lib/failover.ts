// ── Model Failover Registry ──────────────────────────────────────────────────
// Pure utility — no React dependency. Tracks rate-limited models, calculates
// exponential backoff, and recommends cross-provider failover alternatives.
//
// Lifecycle:
//   1. executeOneShot → auto-reports success/failure after each CLI call
//   2. useClaude.sendDirect → calls getAvailableModel() before sending
//   3. Commander/Researcher workers → call getAvailableModel() for worker models

import type { AIModel } from "./models";
import { getEngine } from "./models";

// ── Rate Limit Detection ────────────────────────────────────────────────────

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /overloaded/i,
  /too many requests/i,
  /quota.?exceeded/i,
  /RESOURCE_EXHAUSTED/i,
  /capacity/i,
  /exceeded.*limit/i,
  /retry.?after/i,
];

/** Check if a stderr string indicates a rate limit (vs. other errors). */
export function isRateLimitError(stderr: string): boolean {
  return RATE_LIMIT_PATTERNS.some((p) => p.test(stderr));
}

// ── Cooldown Tracking ───────────────────────────────────────────────────────

interface ModelCooldown {
  /** Timestamp (Date.now()) when cooldown expires */
  until: number;
  /** Consecutive rate limit hits (drives backoff escalation) */
  failures: number;
  /** Human-readable reason for the cooldown */
  reason: string;
}

/** In-memory registry — resets on app restart (intentional: rate limits are transient). */
const cooldowns = new Map<string, ModelCooldown>();

/**
 * Exponential backoff schedule: 1m → 5m → 25m → 1h.
 * Each consecutive rate limit on the same model escalates one step.
 */
const BACKOFF_MS = [60_000, 300_000, 1_500_000, 3_600_000];

/** Report a rate limit hit — applies exponential backoff cooldown. */
export function reportRateLimit(model: string, reason?: string): void {
  const existing = cooldowns.get(model);
  const failures = (existing?.failures || 0) + 1;
  const backoffIdx = Math.min(failures - 1, BACKOFF_MS.length - 1);
  const backoffMs = BACKOFF_MS[backoffIdx];

  cooldowns.set(model, {
    until: Date.now() + backoffMs,
    failures,
    reason: reason || "rate limit",
  });

  const mins = Math.round(backoffMs / 60_000);
  console.log(
    `[Failover] ${model} rate-limited (attempt #${failures}). Cooldown: ${mins}m`,
  );
}

/** Report a successful call — resets the cooldown for this model. */
export function reportSuccess(model: string): void {
  if (cooldowns.has(model)) {
    console.log(`[Failover] ${model} recovered — cooldown cleared`);
    cooldowns.delete(model);
  }
}

/** Check if a model is currently available (not in cooldown). */
export function isModelAvailable(model: string): boolean {
  const state = cooldowns.get(model);
  if (!state) return true;
  if (Date.now() >= state.until) {
    cooldowns.delete(model);
    return true;
  }
  return false;
}

// ── Cross-Provider Failover Chains ──────────────────────────────────────────
// Each model maps to ordered alternatives: same-tier cross-provider first,
// then same-provider downgrade. This ensures capability parity.

const FAILOVER_CHAINS: Record<string, AIModel[]> = {
  // Claude → Gemini
  "claude-opus-4-6": ["gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-2.5-pro", "claude-sonnet-4-6"],
  "claude-sonnet-4-6": ["gemini-3-flash-preview", "gemini-2.5-pro", "claude-sonnet-4-5-20250929"],
  "claude-sonnet-4-5-20250929": ["gemini-2.5-flash", "gemini-3-flash-preview"],
  "claude-haiku-4-5-20251001": ["gemini-2.5-flash", "gemini-3-flash-preview"],
  // Gemini → Claude
  "gemini-3.1-pro-preview": ["gemini-3-pro-preview", "claude-opus-4-6", "claude-sonnet-4-6"],
  "gemini-3-pro-preview": ["gemini-3.1-pro-preview", "claude-opus-4-6", "claude-sonnet-4-6", "gemini-2.5-pro"],
  "gemini-3-flash-preview": ["claude-sonnet-4-6", "gemini-2.5-pro", "gemini-2.5-flash"],
  "gemini-2.5-pro": ["claude-sonnet-4-6", "gemini-3.1-pro-preview", "gemini-3-pro-preview", "claude-sonnet-4-5-20250929"],
  "gemini-2.5-flash": ["claude-haiku-4-5-20251001", "gemini-3-flash-preview", "claude-sonnet-4-5-20250929"],
};

/**
 * Get the best available model, respecting cooldowns.
 * Returns the preferred model if available, otherwise walks the failover chain.
 * Falls back to the preferred model if the entire chain is exhausted (user decides).
 */
export function getAvailableModel(preferred: AIModel): AIModel {
  if (isModelAvailable(preferred)) return preferred;

  const chain = FAILOVER_CHAINS[preferred] || [];
  for (const alt of chain) {
    if (isModelAvailable(alt)) return alt;
  }

  // Everything is rate-limited — return the one with the shortest remaining cooldown
  const shortest = findShortestCooldown(preferred, chain);
  return shortest || preferred;
}

/** Find the model (from preferred + chain) with the least time remaining in cooldown. */
function findShortestCooldown(preferred: AIModel, chain: AIModel[]): AIModel | null {
  const candidates = [preferred, ...chain];
  let best: AIModel | null = null;
  let bestRemaining = Infinity;

  for (const model of candidates) {
    const remaining = getCooldownRemaining(model);
    if (remaining < bestRemaining) {
      bestRemaining = remaining;
      best = model;
    }
  }

  return best;
}

// ── Public Getters (for UI indicators) ──────────────────────────────────────

export interface CooldownInfo {
  model: string;
  remainingMs: number;
  failures: number;
  reason: string;
  failoverModel: AIModel | null;
}

/** Get remaining cooldown milliseconds for a model (0 = available). */
export function getCooldownRemaining(model: string): number {
  const state = cooldowns.get(model);
  if (!state) return 0;
  const remaining = state.until - Date.now();
  if (remaining <= 0) {
    cooldowns.delete(model);
    return 0;
  }
  return remaining;
}

/** Get cooldown info for a specific model (null if available). */
export function getCooldownInfo(model: string): CooldownInfo | null {
  if (isModelAvailable(model)) return null;
  const state = cooldowns.get(model)!;
  const chain = FAILOVER_CHAINS[model] || [];
  const failoverModel = chain.find((m) => isModelAvailable(m)) as AIModel | null ?? null;
  return {
    model,
    remainingMs: state.until - Date.now(),
    failures: state.failures,
    reason: state.reason,
    failoverModel,
  };
}

/** Get all currently active cooldowns (for UI dashboard/model selector). */
export function getActiveCooldowns(): CooldownInfo[] {
  const result: CooldownInfo[] = [];
  for (const [model] of cooldowns) {
    const info = getCooldownInfo(model);
    if (info) result.push(info);
  }
  return result;
}

/** Clear all cooldowns (for testing or manual reset). */
export function clearAllCooldowns(): void {
  cooldowns.clear();
}

// ── Helper for callers that need both model + engine ────────────────────────

export function getAvailableModelWithEngine(preferred: AIModel): {
  model: AIModel;
  engine: "claude" | "gemini";
  wasFailover: boolean;
} {
  const model = getAvailableModel(preferred);
  return {
    model,
    engine: getEngine(model),
    wasFailover: model !== preferred,
  };
}
