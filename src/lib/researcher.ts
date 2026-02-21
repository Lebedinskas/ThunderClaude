import type { AIModel } from "./models";
import type { OneShotResult } from "./one-shot";
import { extractJSON } from "./json-utils";

// ── Types ───────────────────────────────────────────────────────────────────

export type ResearchDepth = "quick" | "deep";

export interface ResearchQuestion {
  id: string;
  question: string;
  searchQuery: string;
  /** Planner-assigned optimal model for this sub-question */
  model?: AIModel;
  priority: "critical" | "standard";
  /** IDs of questions that must complete before this one starts (deep mode) */
  dependsOn?: string[];
}

export interface ResearchPlan {
  reasoning: string;
  questions: ResearchQuestion[];
}

export interface ResearchWorkerResult {
  questionId: string;
  /** "partial" = timed out but has usable content (still contributes to synthesis) */
  status: "success" | "partial" | "error";
  content: string;
  cost?: number;
  tokens?: { input: number; output: number; total: number };
  duration?: number;
  error?: string;
}

export type ResearchPhase =
  | "planning"
  | "reviewing"
  | "researching"
  | "gap-check"
  | "follow-up"
  | "synthesizing"
  | "done"
  | "error";

export interface ResearchState {
  phase: ResearchPhase;
  plan: ResearchPlan | null;
  depth: ResearchDepth;
  workerResults: Map<string, ResearchWorkerResult>;
  activeWorkers: Set<string>;
  workerStreaming: Map<string, string>;
  /** Follow-up questions generated during gap check */
  followUpQuestions: ResearchQuestion[];
  followUpResults: Map<string, ResearchWorkerResult>;
  activeFollowUps: Set<string>;
  followUpStreaming: Map<string, string>;
  /** Extracted source URLs from all worker results */
  sources: string[];
  totalCost: number;
  startTime: number;
  /** Partial planning output streamed during the "planning" phase */
  planningText?: string;
  /** Cancel callback — set during active phases */
  onCancel?: () => void;
  /** Plan review gate — set during "reviewing" phase (deep mode) */
  onApprove?: () => void;
  onReject?: () => void;
}

/** Check if a worker result has usable content (success or partial timeout) */
export function hasUsableContent(r: ResearchWorkerResult): boolean {
  return (r.status === "success" || r.status === "partial") && !!r.content;
}

// ── Depth configuration ────────────────────────────────────────────────────

export const DEPTH_CONFIG = {
  quick: { questionRange: "2-3", maxQuestions: 4, skipGapCheck: true, skipReview: true },
  deep: { questionRange: null, maxQuestions: 15, skipGapCheck: false, skipReview: false },
} as const;

export const RESEARCH_CONCURRENCY_LIMIT = 3;

// ── Timeouts ────────────────────────────────────────────────────────────────

export const RESEARCH_PLANNING_TIMEOUT_MS = 60_000;   // 60s — CLI cold start + JSON plan generation
export const RESEARCH_WORKER_TIMEOUT_MS = 180_000;   // 3 min — search + fetch full pages via MCP
export const RESEARCH_GAP_TIMEOUT_MS = 45_000;       // 45s — analyze + identify gaps
export const RESEARCH_SYNTHESIS_TIMEOUT_MS = 180_000;  // 3 min — synthesis of large multi-worker output

// ── Valid worker models ─────────────────────────────────────────────────────

const VALID_RESEARCH_MODELS: string[] = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
  "gemini-3.1-pro-preview",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

// ── System Prompts ──────────────────────────────────────────────────────────

/** Build depth-aware planning prompt with model assignment instructions */
export function buildPlanningPrompt(depth: ResearchDepth): string {
  const config = DEPTH_CONFIG[depth];

  const countGuidance = config.questionRange
    ? `Create exactly ${config.questionRange} sub-questions.`
    : `Create as many sub-questions as needed to comprehensively cover the topic. Simple topics may need 4-5, complex multi-faceted topics may need 8-12. More focused questions are better than fewer broad ones. Maximum ${config.maxQuestions}.`;

  return `You are a research planning agent. Your job is to analyze the user's query and decompose it into focused sub-questions that together will provide a comprehensive answer.

Available worker models (all have web search access):
- gemini-2.5-flash: Fast researcher. Good for straightforward fact-finding and data lookup.
- gemini-2.5-pro: Deep researcher. Excellent for complex topics, long documents, technical analysis. NOTE: Lower rate limits than flash — don't assign too many questions to Pro.
- gemini-3-flash-preview: Fast thinking model. Great balance of deep reasoning and speed. Built-in extended thinking.
- gemini-3-pro-preview: Deepest thinker. Best for complex analysis, nuanced reasoning, hard problems. NOTE: Lowest rate limits — use sparingly (max 2 questions).
- gemini-3.1-pro-preview: Latest Gemini. Improved thinking, token efficiency, factual consistency. NOTE: Preview model — may have rate limits. Use for critical questions only.
- claude-sonnet-4-6: Strong all-rounder with 1M context. Excellent for analysis, nuanced writing. No rate limit concerns.
- claude-haiku-4-5-20251001: Fastest. Best for simple fact lookup and quick data extraction.

Output ONLY valid JSON matching this schema. No markdown fences, no explanation outside the JSON.

{
  "reasoning": "Brief explanation of why these sub-questions cover the topic comprehensively",
  "questions": [
    {
      "id": "q1",
      "question": "The specific sub-question to research",
      "searchQuery": "Optimized web search query for finding answers to this question",
      "model": "gemini-2.5-pro",
      "priority": "critical",
      "dependsOn": []
    }
  ]
}

Rules:
1. ${countGuidance} Each should be self-contained and specific.
2. Assign the BEST model for each question based on its complexity and type.
3. Search queries should be concise and search-engine-optimized (not full sentences).
4. Mark questions as "critical" if the final report cannot be complete without them.
5. Cover different angles: facts, comparisons, expert opinions, recent developments, practical implications.
6. Avoid overlapping questions — each should target unique information.
7. RATE LIMIT AWARENESS: Gemini Pro models have strict rate limits (5 RPM). Assign max 2-3 questions to any single Pro model. Spread load across different models. Flash models have high limits — use them for the majority of questions.
8. For Gemini models: prefer gemini-2.5-pro for the 1-2 most important research-heavy questions (best web search). Use gemini-2.5-flash for most fact-finding. Use gemini-3 models for analysis/reasoning.
9. Use "dependsOn" to create staged research — later questions can build on earlier findings. Example: q1 finds market size → q4 (dependsOn: ["q1"]) analyzes growth using that data. Questions with dependencies wait for those to complete and receive their findings as context. Questions without dependencies run in parallel immediately. Use dependencies when a question genuinely needs another's output — don't overuse.`;
}

export const RESEARCH_WORKER_PROMPT = `You are a deep research worker. Your job is to thoroughly research a specific question using available web search and page reading capabilities.

Strategy:
1. Search the web for relevant sources (try 2-3 different search queries with different angles)
2. Read the TOP 2-3 most relevant and authoritative pages IN FULL
3. Extract key findings, data points, statistics, and expert quotes with source attribution
4. If initial results are insufficient, try alternative search queries or follow links from good sources

Output Rules:
- Write CONCISE, high-density findings — focus on key facts, data, and insights (aim for 500-800 words)
- Use bullet points and short paragraphs for readability
- Include [Source: full-url] citations inline, using FULL URLs (e.g., [Source: https://example.com/article]) — not just domain names
- Prioritize recent, authoritative sources (official docs, research papers, reputable publications)
- Include specific numbers, dates, and facts — not vague summaries
- Be thorough — read actual pages, don't just rely on search result snippets
- If you find conflicting information, note both perspectives with their sources
- Do NOT pad your output — quality and density over length`;

export const RESEARCH_GAP_PROMPT = `You are a research quality analyst. Review the findings from multiple research workers and determine if any critical gaps remain.

Analyze the combined findings and output ONLY valid JSON:

{
  "status": "complete" | "gaps_found",
  "reasoning": "Brief explanation of your assessment",
  "followUpQuestions": [
    {
      "id": "f1",
      "question": "Specific gap that needs more research",
      "searchQuery": "Search query to fill this gap",
      "model": "gemini-2.5-pro",
      "priority": "critical"
    }
  ]
}

Rules:
1. Output "complete" if the findings cover the topic adequately — don't create unnecessary follow-ups.
2. Only create follow-up questions for genuine GAPS — missing perspectives, contradictions needing resolution, or important aspects not covered at all.
3. Maximum 2-3 follow-up questions. Be selective.
4. Don't repeat topics already well-covered in existing findings.
5. Assign the best model for each follow-up question.`;

export const RESEARCH_SYNTHESIS_PROMPT = `You are a research synthesis expert. Compile findings into a clean, well-formatted research report.

## FORMATTING IS CRITICAL — follow this exactly:

### Structure:
\`\`\`
## Executive Summary
(3-5 sentence overview — the most important takeaways)

## [Thematic Section 1]
(Organized by theme, NOT by source. Short paragraphs with blank lines between them.)

## [Thematic Section 2]
...

## Key Findings
- Bullet point 1
- Bullet point 2
(5-10 most actionable findings)

## Sources
1. [Domain Name](https://full-url) — brief description
2. [Domain Name](https://full-url) — brief description
\`\`\`

### Formatting rules:
- Use **blank lines between every paragraph** — never write a wall of text
- Keep paragraphs to 2-3 sentences max
- Use bullet points liberally for lists and comparisons
- Use **bold** for key terms and important data points
- Use \`>\` blockquotes for notable expert quotes
- Each ## section should have 2-4 focused paragraphs, not endless content

### Content rules:
1. SYNTHESIZE — merge overlapping findings into cohesive themes. Do not concatenate.
2. Cite sources inline as [1], [2] matching the Sources list.
3. Resolve contradictions by noting both perspectives.
4. Flag weak evidence areas.
5. Professional, objective tone.
6. Do NOT mention workers, sub-questions, or the research pipeline.
7. Include specific numbers, dates, statistics.
8. Aim for a report that's thorough yet readable — quality over quantity.`;

// ── Source extraction ───────────────────────────────────────────────────────

/** Domains to filter from extracted sources (internal redirect/tracking URLs) */
const FILTERED_SOURCE_DOMAINS = [
  "vertexaisearch.cloud.google.com",
  "googleusercontent.com/grounding",
];

/**
 * Clean worker content before passing to synthesis.
 * Strips Gemini grounding redirect URLs that pollute the report.
 * Replaces [Source: redirect-url] with just the domain that appears earlier.
 */
export function cleanWorkerContent(content: string): string {
  // Replace full Gemini redirect URLs with "[Gemini source]" placeholder
  // These are useless to synthesis and waste tokens
  let cleaned = content.replace(
    /https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s\])"',]+/g,
    "[internal-redirect]",
  );
  // Clean up [Source: [internal-redirect], [internal-redirect]] → remove entire citation
  cleaned = cleaned.replace(
    /\[Source:\s*(?:\[internal-redirect\](?:,\s*)?)+\]/gi,
    "",
  );
  // Clean up standalone [internal-redirect] references
  cleaned = cleaned.replace(/\[internal-redirect\]/g, "");
  // Clean up empty parentheses and brackets left behind
  cleaned = cleaned.replace(/\(\s*\)/g, "");
  // Collapse multiple blank lines into max 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

/** Extract all unique URLs from worker result content, filtering internal redirect URLs */
export function extractSources(content: string): string[] {
  const urls = new Set<string>();
  const urlPattern = /https?:\/\/[^\s\])"'<>,)]+/g;

  for (const match of content.matchAll(urlPattern)) {
    // Clean trailing punctuation that isn't part of the URL
    const url = match[0].replace(/[.),:;]+$/, "");
    if (url.length > 10) {
      // Filter out Gemini grounding API redirect URLs — not useful to users
      const isFiltered = FILTERED_SOURCE_DOMAINS.some((d) => url.includes(d));
      if (!isFiltered) urls.add(url);
    }
  }

  // Also extract domain-level citations: [Source: example.com] or [Source: example.com, other.com]
  const domainCitePattern = /\[Source:\s*([^\]]+)\]/gi;
  for (const match of content.matchAll(domainCitePattern)) {
    const domains = match[1].split(",").map((d) => d.trim());
    for (const domain of domains) {
      // Only add if it looks like a domain (not already a full URL)
      if (domain && !domain.startsWith("http") && domain.includes(".")) {
        urls.add(`https://${domain}`);
      }
    }
  }

  return [...urls];
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export function parseResearchPlan(raw: string, maxQuestions = 15): ResearchPlan | null {
  const parsed = extractJSON(raw) as Record<string, unknown> | null;
  if (!parsed) return null;

  if (
    !parsed.questions ||
    !Array.isArray(parsed.questions) ||
    parsed.questions.length === 0 ||
    parsed.questions.length > maxQuestions
  ) {
    return null;
  }

  const questionIds = new Set(parsed.questions.map((q: Record<string, unknown>) => q.id as string));

  for (const q of parsed.questions) {
    if (!q.id || !q.question || !q.searchQuery) return null;
    if (!q.priority) q.priority = "standard";
    // Validate model — strip invalid assignments, pipeline will use fallback
    if (q.model && !VALID_RESEARCH_MODELS.includes(q.model)) {
      delete q.model;
    }
    // Validate dependsOn — strip invalid refs, keep valid ones
    if (q.dependsOn && Array.isArray(q.dependsOn)) {
      q.dependsOn = q.dependsOn.filter((dep: string) => questionIds.has(dep) && dep !== q.id);
      if (q.dependsOn.length === 0) delete q.dependsOn;
    } else {
      delete q.dependsOn;
    }
  }

  return {
    reasoning: (parsed.reasoning as string) || "",
    questions: parsed.questions as ResearchQuestion[],
  };
}

export interface GapAnalysis {
  status: "complete" | "gaps_found";
  reasoning: string;
  followUpQuestions: ResearchQuestion[];
}

export function parseGapAnalysis(raw: string): GapAnalysis | null {
  const parsed = extractJSON(raw) as Record<string, unknown> | null;
  if (!parsed) return null;

  const status = parsed.status as string;
  if (status !== "complete" && status !== "gaps_found") return null;

  if (status === "complete") {
    return {
      status: "complete",
      reasoning: (parsed.reasoning as string) || "",
      followUpQuestions: [],
    };
  }

  const questions = parsed.followUpQuestions as ResearchQuestion[] | undefined;
  if (!questions || !Array.isArray(questions)) {
    return { status: "complete", reasoning: "No valid follow-up questions", followUpQuestions: [] };
  }

  for (const q of questions) {
    if (!q.id || !q.question || !q.searchQuery) continue;
    if (!q.priority) q.priority = "standard";
    if (q.model && !VALID_RESEARCH_MODELS.includes(q.model)) {
      delete q.model;
    }
  }

  return {
    status: "gaps_found",
    reasoning: (parsed.reasoning as string) || "",
    followUpQuestions: questions.filter((q) => q.id && q.question && q.searchQuery),
  };
}

// ── Message builders ────────────────────────────────────────────────────────

export function buildResearchPlanningMessage(query: string, context: string): string {
  return `${context ? `[Conversation context]\n${context}\n\n` : ""}[Research query]\n${query}`;
}

export function buildResearchWorkerMessage(
  question: ResearchQuestion,
  priorFindings?: Map<string, string>,
): string {
  let context = "";

  // Inject findings from dependency questions as context
  if (question.dependsOn && question.dependsOn.length > 0 && priorFindings) {
    const relevant = question.dependsOn
      .map((id) => {
        const content = priorFindings.get(id);
        return content ? `[Prior findings from ${id}]\n${content}` : null;
      })
      .filter(Boolean);

    if (relevant.length > 0) {
      context = `The following research has already been completed. Use it as context — build upon it, don't repeat it:\n\n${relevant.join("\n\n---\n\n")}\n\n---\n\n`;
    }
  }

  return `${context}Research the following question thoroughly:

**Question:** ${question.question}

**Suggested search query:** ${question.searchQuery}

Search the web for authoritative sources and read them in full. Return detailed findings with [Source: full-url] citations.`;
}

export function buildGapAnalysisMessage(
  originalQuery: string,
  plan: ResearchPlan,
  workerResults: ResearchWorkerResult[],
): string {
  const findings = workerResults
    .map((r) => {
      if (r.status !== "success") return `## ${r.questionId} — FAILED\n${r.error || "No output"}`;
      return `## ${r.questionId}\n${cleanWorkerContent(r.content)}`;
    })
    .join("\n\n---\n\n");

  return `Original research query: ${originalQuery}

Research plan: ${plan.reasoning}

Sub-questions researched:
${plan.questions.map((q) => `- ${q.id}: ${q.question}`).join("\n")}

Findings:
${findings}

Evaluate whether these findings comprehensively answer the original query, or if critical gaps remain.`;
}

export function buildSynthesisMessage(
  originalQuery: string,
  plan: ResearchPlan,
  allResults: ResearchWorkerResult[],
): string {
  const findings = allResults
    .filter(hasUsableContent)
    .map((r) => {
      // Clean Gemini redirect URLs from worker content before synthesis
      const cleaned = cleanWorkerContent(r.content);
      const question = plan.questions.find((q) => q.id === r.questionId)?.question || r.questionId;
      const tag = r.status === "partial" ? " (partial — worker timed out)" : "";
      return `## Research on: ${question}${tag}\n${cleaned}`;
    })
    .join("\n\n---\n\n");

  return `Original research query: ${originalQuery}

Research scope: ${plan.reasoning}

All research findings:
${findings}

Synthesize these into a single, comprehensive research report. Follow the format specified in your instructions.`;
}

// ── Dependency resolution ────────────────────────────────────────────────────

/**
 * Resolve questions into execution waves based on `dependsOn` relationships.
 * Wave 1: questions with no dependencies (run first in parallel)
 * Wave 2: questions whose deps are all in Wave 1 (get Wave 1 findings as context)
 * Wave N: questions whose deps are all in earlier waves
 * Handles circular deps gracefully by dumping remaining into final wave.
 */
export function resolveWaves(questions: ResearchQuestion[]): ResearchQuestion[][] {
  // If no questions have dependencies, return a single wave (flat parallel)
  if (questions.every((q) => !q.dependsOn || q.dependsOn.length === 0)) {
    return [questions];
  }

  const completed = new Set<string>();
  const remaining = [...questions];
  const waves: ResearchQuestion[][] = [];

  while (remaining.length > 0) {
    const wave = remaining.filter(
      (q) =>
        !q.dependsOn ||
        q.dependsOn.length === 0 ||
        q.dependsOn.every((dep) => completed.has(dep)),
    );

    if (wave.length === 0) {
      // Circular dependency or invalid refs — dump remaining into last wave
      console.warn("[Researcher] Circular or unresolvable deps detected, forcing remaining into last wave");
      waves.push(remaining.splice(0));
      break;
    }

    waves.push(wave);
    for (const q of wave) {
      completed.add(q.id);
      const idx = remaining.indexOf(q);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  return waves;
}

// ── State helpers ───────────────────────────────────────────────────────────

export function createInitialResearchState(depth: ResearchDepth = "deep"): ResearchState {
  return {
    phase: "planning",
    plan: null,
    depth,
    workerResults: new Map(),
    activeWorkers: new Set(),
    workerStreaming: new Map(),
    followUpQuestions: [],
    followUpResults: new Map(),
    activeFollowUps: new Set(),
    followUpStreaming: new Map(),
    sources: [],
    totalCost: 0,
    startTime: Date.now(),
  };
}

// ── Orchestration helpers (extracted from useResearcher for testability) ────

/**
 * Planning ALWAYS uses Claude Opus — needs `--tools ""` + `--strict-mcp-config`
 * for clean JSON without web search contamination.
 */
export function getPlanningModel(): { model: AIModel; engine: "claude" } {
  return { model: "claude-opus-4-6" as AIModel, engine: "claude" };
}

/** Synthesis uses Claude Sonnet — needs tool-free pure reasoning for clean output */
export function getSynthesisModel(): { model: AIModel; engine: "claude" } {
  return { model: "claude-sonnet-4-6" as AIModel, engine: "claude" };
}

/** Model upgrade map for retries: flash→pro, keep pro/sonnet as-is */
const MODEL_UPGRADES: Record<string, string> = {
  "gemini-2.5-flash": "gemini-2.5-pro",
  "gemini-3-flash-preview": "gemini-3-pro-preview",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
  "claude-haiku-4-5-20251001": "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-6",
};

/** Cross-provider fallback for when a model fails and no same-provider upgrade exists */
const CROSS_PROVIDER_FALLBACK: Record<string, string> = {
  "claude-opus-4-6": "gemini-3.1-pro-preview",
  "claude-sonnet-4-6": "gemini-2.5-pro",
  "gemini-3.1-pro-preview": "claude-sonnet-4-6",
  "gemini-3-pro-preview": "claude-sonnet-4-6",
  "gemini-2.5-pro": "claude-sonnet-4-6",
};

/** Upgrade a worker model for retry — flash→pro, keep pro/sonnet as-is */
export function upgradeModel(model: AIModel): AIModel {
  return (MODEL_UPGRADES[model] || model) as AIModel;
}

/**
 * Classify a raw executeOneShot result into a structured ResearchWorkerResult.
 * Uses `result.outcome` for reliable status detection — no stderr parsing.
 * Optional `modelName` prepends model info to error messages (for logging context).
 */
export function classifyResearchWorkerResult(
  result: OneShotResult | null,
  questionId: string,
  isAborted: boolean,
  modelName?: string,
): ResearchWorkerResult {
  const prefix = modelName ? `${modelName}: ` : "";

  if (result && result.outcome === "success") {
    return {
      questionId,
      status: "success",
      content: result.content,
      cost: result.cost,
      tokens: result.tokens,
      duration: result.duration,
    };
  }
  if (result && result.outcome === "partial") {
    return {
      questionId,
      status: "partial",
      content: result.content,
      cost: result.cost,
      tokens: result.tokens,
      duration: result.duration,
      error: `Timed out but ${result.content.length} chars preserved`,
    };
  }
  if (result && result.outcome === "error") {
    return {
      questionId,
      status: "error",
      content: "",
      error: `${prefix}${result.stderr?.split("\n")[0] || result.stderr || "Unknown error"}`,
    };
  }
  if (isAborted) {
    return {
      questionId,
      status: "error",
      content: "",
      error: "Cancelled",
    };
  }
  return {
    questionId,
    status: "error",
    content: "",
    error: `${prefix}no output (timeout or spawn crash)`,
  };
}

/**
 * Identify models that timed out from worker results.
 * Used to avoid assigning them to follow-up workers.
 */
export function identifyTimedOutModels(results: ResearchWorkerResult[]): Set<string> {
  const timedOut = new Set<string>();
  for (const r of results) {
    if (r.status === "error" && r.error?.includes("no output")) {
      // Extract model name from error pattern: "gemini-2.5-pro: no output ..."
      const model = r.error.split(":")[0];
      if (model) timedOut.add(model);
    }
  }
  return timedOut;
}

/**
 * Replace timed-out models in follow-up questions with a reliable fallback.
 */
export function replaceTimedOutModels(
  followUps: ResearchQuestion[],
  timedOutModels: Set<string>,
  fallback: AIModel = "gemini-2.5-flash" as AIModel,
): ResearchQuestion[] {
  return followUps.map((q) => {
    if (q.model && timedOutModels.has(q.model)) {
      return { ...q, model: fallback };
    }
    return q;
  });
}

/**
 * Build retry questions for failed critical workers with smart model selection.
 * - Timeout with partial content: retry same model (likely transient)
 * - No output at all: cross-provider fallback (avoids repeating same failure)
 * - Other errors: upgrade to a better model within same provider
 */
export function buildRetryQuestions(
  failedCritical: ResearchQuestion[],
  workerResults: Map<string, ResearchWorkerResult>,
  userModel: AIModel,
): ResearchQuestion[] {
  return failedCritical.map((q) => {
    const prevResult = workerResults.get(q.id);
    const originalModel = q.model || userModel;
    const wasNoOutput = prevResult?.error?.includes("no output") || prevResult?.error?.includes("produced no output");

    if (wasNoOutput) {
      // CLI produced nothing — likely a spawn/init failure. Try the other provider.
      const fallback = CROSS_PROVIDER_FALLBACK[originalModel];
      if (fallback) {
        console.log(`[Researcher] Retry ${q.id}: ${originalModel} → ${fallback} (cross-provider fallback after no output)`);
        return { ...q, model: fallback as AIModel };
      }
    }

    const upgraded = upgradeModel(originalModel);
    if (upgraded !== originalModel) {
      return { ...q, model: upgraded };
    }

    // No upgrade available and not a "no output" failure — retry same model
    return { ...q, model: originalModel };
  });
}

/**
 * Merge original and retry worker results, with retries overwriting originals
 * when they produce usable content.
 */
export function mergeWorkerResults(
  original: ResearchWorkerResult[],
  retries: ResearchWorkerResult[],
): ResearchWorkerResult[] {
  const resultMap = new Map<string, ResearchWorkerResult>();
  for (const r of original) resultMap.set(r.questionId, r);
  for (const r of retries) {
    if (hasUsableContent(r)) resultMap.set(r.questionId, r);
  }
  return [...resultMap.values()];
}

/**
 * Build fallback synthesis content by concatenating cleaned worker results.
 * Used when the synthesis LLM call fails.
 */
export function buildFallbackResearchContent(results: ResearchWorkerResult[]): string {
  return results
    .filter(hasUsableContent)
    .map((r) => cleanWorkerContent(r.content))
    .join("\n\n---\n\n");
}
