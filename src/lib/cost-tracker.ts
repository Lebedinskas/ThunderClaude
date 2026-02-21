import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "./constants";
import type { OrchestrationMode } from "./models";

// ── Cost Analytics ───────────────────────────────────────────────────────────
// Tracks per-query cost/token data. Persisted as newline-delimited JSON
// in ~/.thunderclaude/analytics.json via Rust commands.

export interface CostEntry {
  /** ISO date string */
  ts: string;
  /** Cost in USD (0 if unknown, e.g. Gemini) */
  cost: number;
  /** Token counts */
  tokensIn: number;
  tokensOut: number;
  /** Which model was used */
  model: string;
  /** Orchestration mode at time of query */
  mode: OrchestrationMode;
  /** Duration in ms */
  durationMs: number;
}

export interface DailySummary {
  date: string;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
  queryCount: number;
  byMode: Record<OrchestrationMode, { cost: number; count: number }>;
  byModel: Record<string, { cost: number; count: number; tokensIn: number; tokensOut: number }>;
}

export interface AnalyticsSummary {
  /** All entries (capped to last 1000 for performance) */
  entries: CostEntry[];
  /** Today's totals */
  today: DailySummary;
  /** Last 7 days */
  week: DailySummary;
  /** Last 30 days */
  month: DailySummary;
  /** All-time totals */
  allTime: DailySummary;
}

/**
 * Record a completed query's cost and token usage.
 */
export async function trackCost(entry: CostEntry): Promise<void> {
  try {
    await invoke(TAURI_COMMANDS.APPEND_ANALYTICS, {
      entryJson: JSON.stringify(entry),
    });
  } catch (e) {
    console.warn("[CostTracker] Failed to persist:", e);
  }
}

/**
 * Load all analytics entries from disk and compute summaries.
 */
export async function loadAnalytics(): Promise<AnalyticsSummary> {
  let raw = "";
  try {
    raw = await invoke<string>(TAURI_COMMANDS.LOAD_ANALYTICS);
  } catch {
    // File doesn't exist yet
  }

  const entries: CostEntry[] = [];
  if (raw) {
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Keep last 1000 entries for summary
  const recent = entries.slice(-1000);

  const now = new Date();
  const todayStr = toDateStr(now);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  return {
    entries: recent,
    today: summarize(recent.filter((e) => e.ts.startsWith(todayStr))),
    week: summarize(recent.filter((e) => new Date(e.ts) >= weekAgo)),
    month: summarize(recent.filter((e) => new Date(e.ts) >= monthAgo)),
    allTime: summarize(recent),
  };
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function emptyModeStats(): Record<OrchestrationMode, { cost: number; count: number }> {
  return {
    direct: { cost: 0, count: 0 },
    commander: { cost: 0, count: 0 },
    researcher: { cost: 0, count: 0 },
    auto: { cost: 0, count: 0 },
  };
}

function summarize(entries: CostEntry[]): DailySummary {
  const byMode = emptyModeStats();
  const byModel: Record<string, { cost: number; count: number; tokensIn: number; tokensOut: number }> = {};
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const e of entries) {
    totalCost += e.cost;
    totalTokensIn += e.tokensIn;
    totalTokensOut += e.tokensOut;

    if (byMode[e.mode]) {
      byMode[e.mode].cost += e.cost;
      byMode[e.mode].count++;
    }

    if (!byModel[e.model]) {
      byModel[e.model] = { cost: 0, count: 0, tokensIn: 0, tokensOut: 0 };
    }
    byModel[e.model].cost += e.cost;
    byModel[e.model].count++;
    byModel[e.model].tokensIn += e.tokensIn;
    byModel[e.model].tokensOut += e.tokensOut;
  }

  return {
    date: entries[0]?.ts.slice(0, 10) ?? toDateStr(new Date()),
    totalCost,
    totalTokensIn,
    totalTokensOut,
    queryCount: entries.length,
    byMode,
    byModel,
  };
}
