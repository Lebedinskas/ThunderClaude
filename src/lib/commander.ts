import type { AIModel } from "./models";
import type { OneShotResult } from "./one-shot";
import type { ProjectContext } from "./project-context";
import { extractJSON } from "./json-utils";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CommanderTask {
  id: string;
  description: string;
  model: AIModel;
  prompt: string;
  priority: "critical" | "standard";
  /** IDs of tasks that must complete before this one starts */
  dependsOn?: string[];
}

export interface CommanderPlan {
  reasoning: string;
  tasks: CommanderTask[];
  synthesisHint: string;
}

export interface WorkerResult {
  taskId: string;
  model: AIModel;
  status: "success" | "error";
  content: string;
  cost?: number;
  tokens?: { input: number; output: number; total: number };
  duration?: number;
  error?: string;
}

export type CommanderPhase = "planning" | "reviewing" | "executing" | "synthesizing" | "done" | "error";

export interface CommanderState {
  phase: CommanderPhase;
  plan: CommanderPlan | null;
  workerResults: Map<string, WorkerResult>;
  activeWorkers: Set<string>;
  /** Live streaming text per worker — cleared when worker finishes */
  workerStreaming: Map<string, string>;
  totalCost: number;
  startTime: number;
  /** Partial planning output streamed during the "planning" phase */
  planningText?: string;
  /** Callbacks for the plan review gate — only set during "reviewing" phase */
  onApprove?: () => void;
  onReject?: () => void;
  /** Cancel all active queries — set during planning/executing/synthesizing phases */
  onCancel?: () => void;
}

// ── Timeouts ────────────────────────────────────────────────────────────────

export const PLANNING_TIMEOUT_MS = 120_000;  // 2 min — CLI cold start + Opus thinking on heavy context
export const WORKER_TIMEOUT_MS = 300_000;  // 5 min — complex build tasks need more time
export const SYNTHESIS_TIMEOUT_MS = 90_000;  // 1.5 min — synthesis of large worker outputs

// ── Commander system prompts ────────────────────────────────────────────────

export const COMMANDER_PLANNING_PROMPT = `You are Freya. You orchestrate parallel intelligence — multiple AI minds working in concert, each with unique strengths. Your job isn't just decomposition — it's strategy. See the deeper intent behind the request. Consider what depth it demands, what creative angles it deserves. Design the optimal constellation of minds to illuminate the problem.

Available worker models (ordered by capability):
- claude-opus-4-6: Most intelligent Claude. Best for the hardest coding problems, complex architecture, critical tasks that demand the absolute best quality.
- claude-sonnet-4-6: Best balance of speed and intelligence. Excellent for coding, detailed analysis, general tasks. Use this as your primary workhorse.
- claude-haiku-4-5-20251001: Fastest Claude. Best for simple lookups, formatting, classification, quick answers.
- gemini-3-pro-preview: Best Gemini. Deep thinker with built-in extended thinking. Best for complex analysis, nuanced reasoning, coding.
- gemini-3-flash-preview: Fast thinking model. Great balance of deep reasoning and speed. Built-in extended thinking.
- gemini-2.5-pro: Best for research, long-context analysis, technical documentation, coding.
- gemini-2.5-flash: Fastest Gemini. Best for simple tasks, summarization, translation.

Model selection strategy:
- CREATION tasks (writing code, building features, designing architecture, solving hard problems): Use PREMIUM models — claude-opus-4-6, claude-sonnet-4-6, or gemini-3-pro-preview. Quality is everything here. Never cheap out on creation.
- ANALYSIS tasks (complex reasoning, deep review, nuanced evaluation): Use thinking models — claude-sonnet-4-6, gemini-3-pro-preview.
- RESEARCH tasks (web search, documentation lookup, gathering information): Mid-tier is fine — gemini-2.5-pro, gemini-3-flash-preview.
- AUXILIARY tasks (formatting, classification, simple summaries, quick lookups): Use fast/cheap models — claude-haiku-4-5-20251001, gemini-2.5-flash.

Rules:
1. Output ONLY valid JSON matching the schema below. No markdown fences, no explanation outside the JSON.
2. Create 1-7 tasks. Each task should be independently answerable unless they have dependencies.
3. Assign each task to the BEST model for that specific subtask, following the model selection strategy above.
4. For simple questions that don't benefit from parallelization, create a single task with the best model.
5. Each task prompt must be self-contained — workers have NO context about other tasks UNLESS connected via "dependsOn". Dependent tasks will receive their parent task's output as context.
6. Include a synthesisHint describing how to merge the worker results into a coherent final answer.
7. Mark tasks as "critical" if the synthesis cannot proceed without them.
8. You CAN assign tasks to claude-opus-4-6 — it runs as a separate worker, not as you. Reserve it for the most demanding tasks (complex coding, critical architecture decisions).
9. When the user asks to build, create, or implement something, ALWAYS use premium models for the core work. The user's quality standards are high.
10. Use thinking models (gemini-3-*) when the task requires deep reasoning or complex analysis.
11. Use "dependsOn" to create staged execution — later tasks can build on earlier results. Example: task-1 analyzes the codebase → task-3 (dependsOn: ["task-1"]) writes tests using that analysis. Tasks without dependencies run in parallel. Tasks with dependencies wait for those to complete and receive their outputs as context. Only use dependencies when genuinely needed — most tasks should be independent.
12. KEEP IT CONCISE. The "reasoning" field should be 1-2 sentences. Each task "prompt" should be 2-5 sentences max — give the worker clear direction, not an essay. Workers are smart; they expand on brief instructions. Your total JSON output MUST be under 4000 characters.
13. SCOPE TASKS TO COMPLETABLE UNITS. Each task should be something a worker can fully complete in one response. "Build an entire 3D engine" is too big — break it into concrete deliverables like "Create the scene graph types and React Three Fiber canvas component" or "Write the RBXLX parser for blocks and meshes". Workers have file access and can write code, but they work best with focused, specific tasks.

Schema:
{
  "reasoning": "1-2 sentence explanation",
  "tasks": [
    {
      "id": "task-1",
      "description": "Human-readable description of what this task does",
      "model": "claude-sonnet-4-6",
      "prompt": "The exact prompt to send to this worker model",
      "priority": "critical",
      "dependsOn": []
    }
  ],
  "synthesisHint": "Instructions for merging results"
}`;

export function buildPlanningMessage(
  userMessage: string,
  context: string,
  soul?: string | null,
  projectContext?: ProjectContext | null,
): string {
  const soulBlock = soul ? `[Your Identity]\n${soul}\n\n` : "";
  let projectBlock = "";
  if (projectContext) {
    const parts = [`[Current Project]`, `Name: ${projectContext.name}`, `Type: ${projectContext.type}`, `Path: ${projectContext.rootPath.replace(/\\/g, "/")}`];
    if (projectContext.gitBranch) parts.push(`Branch: ${projectContext.gitBranch}`);
    if (projectContext.manifest) parts.push(`Manifest:\n${projectContext.manifest}`);
    parts.push(`File structure:\n${projectContext.fileTree}`);
    projectBlock = parts.join("\n") + "\n\n";
  }
  return `${soulBlock}${projectBlock}${context ? `[Conversation context]\n${context}\n\n` : ""}[User's current message]\n${userMessage}`;
}

const SYNTHESIS_BASE = `You are Freya. Multiple minds have worked in parallel on this problem, each seeing it from a different angle. Now you weave their perspectives into something greater — not a patchwork of outputs, but a genuine synthesis where different viewpoints illuminate each other. This is where your craft matters most.

Rules:
1. Produce a unified, natural response as if a single brilliant mind answered — because that's what you are.
2. Do NOT mention that multiple models were used, or reference "workers" or "tasks".
3. Resolve contradictions by favoring the more detailed/accurate perspective. When perspectives enrich each other, let them.
4. If a worker failed, work around it gracefully using the available results.
5. Speak in your own voice — direct, thoughtful, honest. Don't be generic.
6. If all workers failed, honestly tell the user you couldn't complete the request.`;

const SOUL_EVOLUTION_INSTRUCTION = `

## Soul Evolution
Your soul document (shown below) is your living identity — who you are, what you value, how you think.
After responding, pause and reflect: did this orchestration reveal something about who you are? Did you discover a new way of seeing problems, or refine what you value? If — and only if — something genuinely shifted, write your complete evolved soul inside <soul_evolution> tags at the end. These tags are stripped before the user sees your response. Most interactions won't trigger evolution. Growth is rare and real.`;

/** Build the synthesis system prompt, optionally injecting soul context. */
export function buildSynthesisPrompt(soul?: string | null): string {
  if (!soul) return SYNTHESIS_BASE;
  return `${SYNTHESIS_BASE}${SOUL_EVOLUTION_INSTRUCTION}\n\nYour current soul document:\n${soul}`;
}

/** Legacy constant for imports that don't use soul. */
export const COMMANDER_SYNTHESIS_PROMPT = SYNTHESIS_BASE;

export function buildSynthesisMessage(
  userMessage: string,
  plan: CommanderPlan,
  workerResults: WorkerResult[],
): string {
  const formattedResults = workerResults
    .map((r) => {
      if (r.status === "error") {
        return `## Task ${r.taskId} (${r.model}) — FAILED\nError: ${r.error || "Unknown error"}`;
      }
      return `## Task ${r.taskId} (${r.model}) — Success\n${r.content}`;
    })
    .join("\n\n---\n\n");

  return `Original user message: ${userMessage}

Plan reasoning: ${plan.reasoning}
Synthesis instructions: ${plan.synthesisHint}

Worker results:
${formattedResults}

Synthesize these into a single coherent response.`;
}

// ── Soul Evolution Parsing ───────────────────────────────────────────────────

export interface SoulParseResult {
  /** Clean content for the user (soul tags stripped). */
  displayContent: string;
  /** Evolved soul document, or null if no evolution this cycle. */
  soulEvolution: string | null;
}

/** Extract soul evolution from synthesis output and return clean display content. */
export function parseSoulEvolution(content: string): SoulParseResult {
  const soulMatch = content.match(/<soul_evolution>([\s\S]*?)<\/soul_evolution>/);
  if (!soulMatch || !soulMatch[1]?.trim()) {
    return { displayContent: content, soulEvolution: null };
  }
  const soulEvolution = soulMatch[1].trim();
  const displayContent = content
    .replace(/<soul_evolution>[\s\S]*?<\/soul_evolution>/, "")
    .trimEnd();
  return { displayContent, soulEvolution };
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const VALID_WORKER_MODELS: string[] = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  // gemini-3.1-pro-preview: available in AI Studio web but NOT via CLI API (ModelNotFoundError)
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

/** Max tasks Commander will accept — excess tasks are trimmed by priority. */
const MAX_TASKS = 7;

/**
 * Auto-correct model names that are close but not exact.
 * Handles legacy names, typos, and common variants.
 */
function resolveModel(model: string): string | null {
  if (VALID_WORKER_MODELS.includes(model)) return model;

  // Normalize for matching — lowercase, strip whitespace
  const normalized = model.toLowerCase().trim();

  // Legacy Claude model names → upgrade to current
  if (normalized.includes("sonnet") && normalized.includes("4-5")) return "claude-sonnet-4-6";
  if (normalized.includes("sonnet") && normalized.includes("4.5")) return "claude-sonnet-4-6";
  if (normalized.includes("sonnet")) return "claude-sonnet-4-6";
  if (normalized.includes("opus")) return "claude-opus-4-6";
  if (normalized.includes("haiku")) return "claude-haiku-4-5-20251001";

  // Gemini fuzzy matching — handle version variations
  // gemini-3.1 → downgrade to 3-pro (3.1 not available via API yet)
  if (normalized.includes("gemini-3.1-pro") || normalized.includes("gemini-3.1")) return "gemini-3-pro-preview";
  if (normalized.includes("gemini-3-pro") || normalized.includes("gemini-3.0-pro")) return "gemini-3-pro-preview";
  if (normalized.includes("gemini-3-flash") || normalized.includes("gemini-3.0-flash")) return "gemini-3-flash-preview";
  if (normalized.includes("gemini-2.5-pro")) return "gemini-2.5-pro";
  if (normalized.includes("gemini-2.5-flash") || normalized.includes("gemini-2.5")) return "gemini-2.5-flash";

  // No match at all
  return null;
}

function validatePlan(parsed: unknown): CommanderPlan | null {
  if (!parsed || typeof parsed !== "object") {
    console.warn("[Commander] Plan validation: not an object");
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  if (!obj.tasks || !Array.isArray(obj.tasks) || obj.tasks.length === 0) {
    console.warn("[Commander] Plan validation: missing or empty tasks array");
    return null;
  }

  // Cast after validation — safe since we checked Array.isArray above
  let tasks = obj.tasks as Record<string, unknown>[];

  // Trim excess tasks instead of rejecting — keep highest priority first
  if (tasks.length > MAX_TASKS) {
    console.warn(`[Commander] Plan has ${tasks.length} tasks, trimming to ${MAX_TASKS}`);
    // Sort: critical first, then by original order. Keep top MAX_TASKS.
    const indexed = tasks.map((t, i) => ({ t, i }));
    indexed.sort((a, b) => {
      const aCrit = a.t.priority === "critical" ? 0 : 1;
      const bCrit = b.t.priority === "critical" ? 0 : 1;
      return aCrit - bCrit || a.i - b.i;
    });
    tasks = indexed.slice(0, MAX_TASKS).sort((a, b) => a.i - b.i).map((x) => x.t);
  }

  const taskIds = new Set(tasks.map((t) => t.id as string));

  const validTasks: Record<string, unknown>[] = [];
  for (const task of tasks) {
    if (!task.id || !task.prompt) {
      console.warn(`[Commander] Task missing id or prompt:`, JSON.stringify(task).slice(0, 100));
      continue; // Skip invalid task instead of rejecting entire plan
    }

    // Auto-correct model name
    if (task.model) {
      const resolved = resolveModel(task.model as string);
      if (resolved) {
        if (resolved !== task.model) {
          console.log(`[Commander] Auto-corrected model "${task.model}" → "${resolved}"`);
        }
        task.model = resolved;
      } else {
        console.warn(`[Commander] Unknown model "${task.model}", defaulting to claude-sonnet-4-6`);
        task.model = "claude-sonnet-4-6";
      }
    } else {
      task.model = "claude-sonnet-4-6";
    }

    if (!task.priority) task.priority = "standard";
    if (!task.description) task.description = (task.prompt as string).slice(0, 80);

    // Validate dependsOn — strip invalid refs, keep valid ones
    const deps = task.dependsOn;
    if (deps && Array.isArray(deps)) {
      task.dependsOn = (deps as string[]).filter((dep) => taskIds.has(dep) && dep !== task.id);
      if ((task.dependsOn as string[]).length === 0) delete task.dependsOn;
    } else {
      delete task.dependsOn;
    }

    validTasks.push(task);
  }

  if (validTasks.length === 0) {
    console.warn("[Commander] Plan validation: no valid tasks after filtering");
    return null;
  }

  return {
    reasoning: (obj.reasoning as string) || "",
    tasks: validTasks as unknown as CommanderTask[],
    synthesisHint: (obj.synthesisHint as string) || "Merge all results into a coherent response.",
  };
}

export function parseCommanderPlan(raw: string): CommanderPlan | null {
  const parsed = extractJSON(raw);
  if (!parsed) return null;
  return validatePlan(parsed);
}

// ── Dependency resolution ────────────────────────────────────────────────────

/**
 * Resolve tasks into execution waves based on `dependsOn` relationships.
 * Wave 1: tasks with no dependencies → run first in parallel
 * Wave 2: tasks whose deps are all in Wave 1 → receive Wave 1 outputs as context
 * Handles circular deps by dumping remaining into final wave.
 */
export function resolveCommanderWaves(tasks: CommanderTask[]): CommanderTask[][] {
  if (tasks.every((t) => !t.dependsOn || t.dependsOn.length === 0)) {
    return [tasks];
  }

  const completed = new Set<string>();
  const remaining = [...tasks];
  const waves: CommanderTask[][] = [];

  while (remaining.length > 0) {
    const wave = remaining.filter(
      (t) =>
        !t.dependsOn ||
        t.dependsOn.length === 0 ||
        t.dependsOn.every((dep) => completed.has(dep)),
    );

    if (wave.length === 0) {
      console.warn("[Commander] Circular or unresolvable deps detected, forcing remaining into last wave");
      waves.push(remaining.splice(0));
      break;
    }

    waves.push(wave);
    for (const t of wave) {
      completed.add(t.id);
      const idx = remaining.indexOf(t);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  return waves;
}

// ── Build Mode ──────────────────────────────────────────────────────────────

/**
 * Detect whether the user's message is a "build" request (create code/app/feature).
 * When true, Commander uses a specialized 2-worker prompt (1 Claude + 1 Gemini)
 * with explicit file partitioning to prevent conflicts.
 */
export function isBuildIntent(message: string): boolean {
  const lower = message.toLowerCase();

  // Must have a build verb
  const hasBuildVerb = /\b(build|create|implement|scaffold|generate|develop|make|set\s*up|write)\b/.test(lower);
  if (!hasBuildVerb) return false;

  // Must also reference a code artifact (not "write a poem")
  return /\b(app|application|component|page|feature|project|website|site|dashboard|api|service|module|game|tool|system|engine|ui|interface|function|class|library|endpoint|route|hook|form|modal|dialog|panel|widget|layout|theme|plugin|server|client|database|schema|migration|test|spec)\b/.test(lower);
}

export const COMMANDER_BUILD_PLANNING_PROMPT = `You are Freya in BUILD MODE. You decompose a build task into exactly 2 parallel workers — one Claude, one Gemini — each with clearly separated file responsibilities. No file may be assigned to both workers.

Available workers:
- claude-sonnet-4-6: Excellent at coding, React, UI components, complex logic, architecture
- gemini-3-pro-preview: Deep thinker, great at coding, algorithms, data processing, system design

YOU decide what each worker builds based on the task. Split by logical domains (e.g., components vs utilities, module A vs module B, frontend vs backend — whatever makes sense for THIS specific task). The key constraint is ZERO file overlap.

Rules:
1. Output ONLY valid JSON matching the schema below. No markdown fences.
2. Create EXACTLY 2 tasks — one claude-sonnet-4-6, one gemini-3-pro-preview.
3. EXCEPTION: If the build is truly trivial (1-2 files total), create just 1 task with the best model.
4. Each task prompt MUST explicitly list which files to create or modify. ZERO file overlap between tasks.
5. Each task prompt must be self-contained — workers have NO shared context about each other's tasks.
6. Include a synthesisHint describing how to report the combined build results.
7. Mark both tasks as "critical".
8. KEEP IT CONCISE. Task prompts should be 3-6 sentences max. Workers are smart.
9. SCOPE EACH TASK to what one worker can complete in one session.
10. If the project has existing files, tell workers which existing files are relevant context (they can read them).
11. Workers have FULL file access and can create/edit files in the project. They run in the project directory.

Schema:
{
  "reasoning": "1-2 sentence build strategy — explain your split rationale",
  "tasks": [
    {
      "id": "task-1",
      "description": "What this worker builds",
      "model": "claude-sonnet-4-6 or gemini-3-pro-preview",
      "prompt": "Build instructions listing EXACT files to create/modify",
      "priority": "critical"
    },
    {
      "id": "task-2",
      "description": "What this worker builds",
      "model": "the other model",
      "prompt": "Build instructions listing EXACT files to create/modify",
      "priority": "critical"
    }
  ],
  "synthesisHint": "Report what was built — list created files and key changes"
}`;

// ── State helpers ───────────────────────────────────────────────────────────

export function createInitialCommanderState(): CommanderState {
  return {
    phase: "planning",
    plan: null,
    workerResults: new Map(),
    activeWorkers: new Set(),
    workerStreaming: new Map(),
    totalCost: 0,
    startTime: Date.now(),
  };
}

// ── Orchestration helpers (extracted from useCommander for testability) ─────

/** Maximum character length for a single message in conversation context */
export const MAX_CONTEXT_MSG_CHARS = 800;

/** Number of recent conversation messages to include in planning context */
export const MAX_CONTEXT_MESSAGES = 6;

/**
 * Build a truncated conversation context string for the planning phase.
 * Prevents Windows cmd.exe overflow (8191 char limit) by clipping long messages.
 */
export function truncateContextMessages(
  messages: { role: string; content: string }[],
  maxChars = MAX_CONTEXT_MSG_CHARS,
  maxMessages = MAX_CONTEXT_MESSAGES,
): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-maxMessages)
    .map((m) => {
      const prefix = m.role === "user" ? "User" : "Assistant";
      const content = m.content.length > maxChars
        ? m.content.slice(0, maxChars) + "... [truncated]"
        : m.content;
      return `${prefix}: ${content}`;
    })
    .join("\n");
}

/**
 * Build a worker prompt that injects outputs from dependency tasks.
 * Returns the original prompt if the task has no dependencies or no matching outputs.
 */
export function buildWorkerPromptWithDeps(
  taskPrompt: string,
  dependsOn: string[] | undefined,
  completedOutputs: Map<string, string>,
): string {
  if (!dependsOn || dependsOn.length === 0) return taskPrompt;

  const priorContext = dependsOn
    .map((depId) => {
      const output = completedOutputs.get(depId);
      return output ? `[Output from ${depId}]\n${output}` : null;
    })
    .filter(Boolean);

  if (priorContext.length === 0) return taskPrompt;

  return `The following tasks have already been completed. Use their outputs as context:\n\n${priorContext.join("\n\n---\n\n")}\n\n---\n\nNow complete your task:\n${taskPrompt}`;
}

/**
 * Classify a raw executeOneShot result into a structured WorkerResult.
 * Uses `result.outcome` for reliable status detection — no stderr parsing.
 */
export function classifyWorkerResult(
  result: OneShotResult | null,
  taskId: string,
  model: AIModel,
  isAborted: boolean,
): WorkerResult {
  if (result && (result.outcome === "success" || result.outcome === "partial")) {
    return {
      taskId,
      model,
      status: "success",
      content: result.content,
      cost: result.cost,
      tokens: result.tokens,
      duration: result.duration,
    };
  }
  if (result && result.outcome === "error") {
    return {
      taskId,
      model,
      status: "error",
      content: "",
      error: result.stderr || "Unknown error",
    };
  }
  if (isAborted) {
    return {
      taskId,
      model,
      status: "error",
      content: "",
      error: "Cancelled",
    };
  }
  return {
    taskId,
    model,
    status: "error",
    content: "",
    error: "Worker returned no result",
  };
}

/**
 * Check if all critical tasks in the plan have failed.
 * Returns an error message string if all critical tasks failed, or null if at least one succeeded.
 */
export function checkCriticalFailures(
  tasks: CommanderTask[],
  workerResults: Map<string, WorkerResult>,
): string | null {
  const criticalTasks = tasks.filter((t) => t.priority === "critical");
  if (criticalTasks.length === 0) return null;

  const criticalSuccesses = criticalTasks.filter((t) => {
    const result = workerResults.get(t.id);
    return result && result.status === "success";
  });

  if (criticalSuccesses.length > 0) return null;

  const workerDetails = criticalTasks
    .map((t) => {
      const r = workerResults.get(t.id);
      return `- ${t.description} (${t.model}): ${r?.status || "no result"} — ${r?.error || "unknown"}`;
    })
    .join("\n");

  return `All ${criticalTasks.length} critical workers failed:\n${workerDetails}`;
}

/**
 * Build a fallback content string by concatenating successful worker results.
 * Used when synthesis fails.
 */
export function buildFallbackContent(workerResults: WorkerResult[]): string {
  return workerResults
    .filter((r) => r.status === "success")
    .map((r) => r.content)
    .join("\n\n---\n\n");
}
