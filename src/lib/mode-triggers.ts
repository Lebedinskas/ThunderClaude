import type { OrchestrationMode } from "./models";

// ── Smart Mode Routing Engine ────────────────────────────────────────────────
// Auto-suggests Commander or Researcher mode based on user input patterns.
// Shows a subtle chip when input strongly signals a different mode would work
// better. User can click to switch or dismiss — never forces a mode change.

interface ModeTrigger {
  mode: OrchestrationMode;
  /** Pre-compiled matchers — multiple hits increase confidence. */
  matchers: RegExp[];
  /** Weight per match (0-1). Sum ≥ threshold triggers suggestion. */
  weight: number;
  /** Label shown in the suggestion chip. */
  label: string;
}

const TRIGGERS: ModeTrigger[] = [
  // ── Researcher triggers ────────────────────────────────────────────────────
  {
    mode: "researcher",
    label: "Deep Research",
    weight: 0.5,
    matchers: [
      /\bresearch\b/i,
      /\bcomprehensive\b/i,
      /\bin[- ]?depth\b/i,
      /\bcompare\b.*\b(vs|versus|and|or|with)\b/i,
      /\bpros\s+and\s+cons\b/i,
      /\bstate\s+of\s+(the\s+)?(art|industry)/i,
      /\bwhat\s+are\s+the\s+(latest|best|top|current)/i,
      /\bsurvey\b.*\b(of|the)\b/i,
      /\blandscape\b/i,
      /\bmarket\s+(analysis|overview|report)/i,
      /\bliterature\s+review/i,
      /\bdeep\s+dive\b/i,
    ],
  },
  {
    mode: "researcher",
    label: "Deep Research",
    weight: 0.35,
    matchers: [
      /\banalyz[ei]/i,
      /\binvestigat/i,
      /\bexplor[ei]/i,
      /\bevaluat/i,
      /\bwhat\s+(is|are)\s+(the\s+)?(difference|distinction)/i,
      /\bhow\s+does?\s+\w+\s+compare/i,
      /\boverview\b/i,
      /\breport\b/i,
      /\btrend/i,
      /\bbreakdown\b/i,
    ],
  },
  // ── Commander triggers ─────────────────────────────────────────────────────
  {
    mode: "commander",
    label: "Commander",
    weight: 0.5,
    matchers: [
      /\bbuild\s+(me\s+)?(a|an|the)\b/i,
      /\bimplement\b/i,
      /\bcreate\s+(a|an|the)\s+\w+\s+(app|project|system|api|service|tool)/i,
      /\brefactor\b.*\b(entire|whole|all|codebase)\b/i,
      /\bmigrat[ei]\b/i,
      /\bset\s*up\b.*\b(project|repo|environment|ci|cd|pipeline)/i,
      /\bmulti[- ]?(step|part|phase)/i,
      /\bstep\s+by\s+step\b.*\b(build|create|implement)/i,
    ],
  },
  {
    mode: "commander",
    label: "Commander",
    weight: 0.35,
    matchers: [
      /\bbuild\b/i,
      /\bcreate\b/i,
      /\bscaffold\b/i,
      /\bgenerat[ei]\b/i,
      /\bfix\s+(all|every|each|these|the)\b/i,
      /\badd\s+\w+\s+(to|for|in)\s+(all|every|each)\b/i,
      /\bwrite\s+tests?\s+(for|across)\b/i,
      /\bupdate\s+(all|every|each)\b/i,
      /\bconvert\b.*\bto\b/i,
      /\bport\b.*\b(to|from)\b/i,
    ],
  },
];

const SUGGESTION_THRESHOLD = 0.7;
const AUTO_THRESHOLD = 0.7;
const MIN_INPUT_LENGTH = 20;

export interface ModeSuggestion {
  mode: OrchestrationMode;
  label: string;
  confidence: number;
}

/**
 * Analyze user input and suggest a better orchestration mode.
 * Returns null if current mode seems fine or input is too short.
 * Only suggests switching AWAY from the current mode.
 */
export function suggestMode(
  message: string,
  currentMode: OrchestrationMode,
): ModeSuggestion | null {
  if (message.length < MIN_INPUT_LENGTH) return null;
  // No suggestions needed when auto mode is active — it resolves per-message
  if (currentMode === "auto") return null;

  // Score each candidate mode
  const scores = new Map<OrchestrationMode, { total: number; label: string }>();

  for (const trigger of TRIGGERS) {
    // Only suggest modes different from current
    if (trigger.mode === currentMode) continue;

    const matchCount = trigger.matchers.filter((m) => m.test(message)).length;
    if (matchCount === 0) continue;

    const current = scores.get(trigger.mode) ?? { total: 0, label: trigger.label };
    current.total += matchCount * trigger.weight;
    scores.set(trigger.mode, current);
  }

  // Find the highest-scoring suggestion above threshold
  let best: ModeSuggestion | null = null;
  for (const [mode, { total, label }] of scores) {
    if (total >= SUGGESTION_THRESHOLD && (!best || total > best.confidence)) {
      best = { mode, label, confidence: total };
    }
  }

  return best;
}

// ── Auto-mode resolution ──────────────────────────────────────────────────────
// Used when orchestrationMode === "auto". Evaluates ALL triggers and picks the
// best concrete mode, defaulting to "direct" when no strong signal is found.

export type ConcreteMode = "direct" | "commander" | "researcher";

/**
 * Detect the optimal concrete mode for a message. Used by auto-mode.
 * Returns "direct" when the message is short or no pattern exceeds threshold.
 */
export function detectMode(message: string): ConcreteMode {
  if (message.length < MIN_INPUT_LENGTH) return "direct";

  const scores = new Map<ConcreteMode, number>();

  for (const trigger of TRIGGERS) {
    const mode = trigger.mode as ConcreteMode;
    const matchCount = trigger.matchers.filter((m) => m.test(message)).length;
    if (matchCount === 0) continue;
    scores.set(mode, (scores.get(mode) ?? 0) + matchCount * trigger.weight);
  }

  let bestMode: ConcreteMode = "direct";
  let bestScore = AUTO_THRESHOLD;

  for (const [mode, score] of scores) {
    if (score > bestScore) {
      bestMode = mode;
      bestScore = score;
    }
  }

  return bestMode;
}
