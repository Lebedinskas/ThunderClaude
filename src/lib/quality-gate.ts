import { executeOneShot } from "./one-shot";
import { extractJSON } from "./json-utils";

// ── Quality Gate ─────────────────────────────────────────────────────────────
// Fast Haiku check on synthesis output. Catches structural completeness issues:
// - Missing parts of the user's question
// - Dropped worker contributions
// - Shallow/superficial synthesis despite detailed worker data
// - Poor organization
//
// Cost: ~$0.001 per check. Re-synthesis only triggers on score < 7.

const QUALITY_CHECK_PROMPT = `You are a quality reviewer. Score this response to the user's question on three dimensions:

1. COMPLETENESS — Does it address ALL parts of the question? (not just some)
2. DEPTH — Is the answer substantive and informative? (not vague/superficial)
3. ORGANIZATION — Is it clear, structured, and easy to follow?

Output ONLY valid JSON:
{"score": 7, "issues": null}

- score: integer 1-10 (average of the three dimensions)
- issues: null if score >= 7, otherwise a specific 1-2 sentence description of what's missing or weak

Be calibrated: most good responses score 7-8. Reserve 9-10 for exceptional. Below 6 = significant gaps.`;

/** Minimum synthesis length to quality-check — skip trivial/error responses */
const MIN_CHECK_LENGTH = 200;

export interface QualityCheckResult {
  score: number;
  pass: boolean;
  issues: string | null;
}

/**
 * Run a fast Haiku quality check on synthesis output.
 * Returns null on any failure (timeout, parse error) — caller should skip the gate.
 */
export async function checkSynthesisQuality(
  userQuery: string,
  synthesisContent: string,
  signal?: AbortSignal,
  activeQueryIds?: Set<string>,
): Promise<QualityCheckResult | null> {
  if (synthesisContent.length < MIN_CHECK_LENGTH) return null;
  if (signal?.aborted) return null;

  const message = [
    `USER QUESTION: ${userQuery.slice(0, 500)}`,
    "",
    `RESPONSE TO EVALUATE:`,
    synthesisContent.slice(0, 4000),
  ].join("\n");

  const result = await executeOneShot(
    {
      message,
      model: "claude-haiku-4-5-20251001",
      engine: "claude",
      systemPrompt: QUALITY_CHECK_PROMPT,
      mcpConfig: null,
      timeoutMs: 15_000,
      maxTurns: 1,
      tools: "",
      strictMcp: true,
      permissionMode: "bypassPermissions",
      onStreaming: () => {},
    },
    signal,
    activeQueryIds,
  );

  if (!result?.content) return null;

  const parsed = extractJSON(result.content);
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const score = typeof obj.score === "number" ? obj.score : NaN;
  if (isNaN(score) || score < 1 || score > 10) return null;

  const issues = typeof obj.issues === "string" ? obj.issues : null;

  return {
    score: Math.round(score),
    pass: score >= 7,
    issues,
  };
}

/**
 * Build a revision message that includes the original synthesis + quality feedback.
 * Used for re-synthesis when the quality gate fails.
 */
export function buildRevisionContext(
  originalSynthesisMessage: string,
  previousSynthesis: string,
  feedback: string,
): string {
  return `${originalSynthesisMessage}

---

REVISION REQUEST: A quality review found these issues with the previous attempt:
${feedback}

Previous synthesis for reference:
${previousSynthesis.slice(0, 3000)}

Please produce a revised synthesis that specifically addresses the quality feedback. Maintain all correct content from the previous attempt while fixing the identified issues.`;
}
