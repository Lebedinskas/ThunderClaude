import { describe, it, expect } from "vitest";
import {
  parseCommanderPlan,
  resolveCommanderWaves,
  buildPlanningMessage,
  buildSynthesisMessage,
  createInitialCommanderState,
  truncateContextMessages,
  buildWorkerPromptWithDeps,
  classifyWorkerResult,
  checkCriticalFailures,
  buildFallbackContent,
  isBuildIntent,
  COMMANDER_BUILD_PLANNING_PROMPT,
  MAX_CONTEXT_MSG_CHARS,
  MAX_CONTEXT_MESSAGES,
  type CommanderPlan,
  type CommanderTask,
  type WorkerResult,
} from "./commander";

// ── parseCommanderPlan ──────────────────────────────────────────────────────

describe("parseCommanderPlan", () => {
  const validPlan = {
    reasoning: "Split into coding and research tasks",
    tasks: [
      {
        id: "task-1",
        description: "Write the function",
        model: "claude-sonnet-4-6",
        prompt: "Write a function that...",
        priority: "critical",
      },
    ],
    synthesisHint: "Merge code with research findings",
  };

  it("parses valid JSON plan", () => {
    const result = parseCommanderPlan(JSON.stringify(validPlan));
    expect(result).not.toBeNull();
    expect(result!.reasoning).toBe("Split into coding and research tasks");
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].model).toBe("claude-sonnet-4-6");
    expect(result!.tasks[0].priority).toBe("critical");
  });

  it("strips markdown code fences", () => {
    const fenced = "```json\n" + JSON.stringify(validPlan) + "\n```";
    const result = parseCommanderPlan(fenced);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });

  it("strips code fences without language tag", () => {
    const fenced = "```\n" + JSON.stringify(validPlan) + "\n```";
    const result = parseCommanderPlan(fenced);
    expect(result).not.toBeNull();
  });

  it("extracts JSON from surrounding text", () => {
    const messy = "Here is my plan:\n\n" + JSON.stringify(validPlan) + "\n\nI hope this works.";
    const result = parseCommanderPlan(messy);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });

  it("returns null for empty string", () => {
    expect(parseCommanderPlan("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseCommanderPlan("not json at all")).toBeNull();
  });

  it("returns null for JSON without tasks array", () => {
    expect(parseCommanderPlan('{"reasoning": "no tasks"}')).toBeNull();
  });

  it("returns null for empty tasks array", () => {
    expect(parseCommanderPlan('{"tasks": []}')).toBeNull();
  });

  it("trims excess tasks to 7 by priority (critical first)", () => {
    const plan = {
      reasoning: "too many",
      tasks: Array.from({ length: 9 }, (_, i) => ({
        id: `task-${i}`,
        model: "claude-sonnet-4-6",
        prompt: `do stuff ${i}`,
        priority: i === 8 ? "critical" : "standard",
      })),
      synthesisHint: "merge",
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(7);
    // Critical task (index 8) should be included despite being last
    expect(result!.tasks.some((t) => t.prompt === "do stuff 8")).toBe(true);
  });

  it("auto-corrects legacy model names", () => {
    const plan = {
      tasks: [{ id: "t1", model: "claude-sonnet-4-5-20250929", prompt: "test", priority: "standard" }],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].model).toBe("claude-sonnet-4-6");
  });

  it("defaults unknown model to claude-sonnet-4-6", () => {
    const plan = {
      tasks: [{ id: "t1", model: "gpt-4o", prompt: "test", priority: "standard" }],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].model).toBe("claude-sonnet-4-6");
  });

  it("skips tasks missing id or prompt without rejecting plan", () => {
    const plan = {
      tasks: [
        { id: "t1", model: "gemini-2.5-flash", prompt: "good task" },
        { id: "t2", model: "gemini-2.5-flash" },  // missing prompt
        { model: "gemini-2.5-flash", prompt: "no id" },  // missing id
      ],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].id).toBe("t1");
  });

  it("accepts all valid worker models", () => {
    const models = [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ];
    for (const model of models) {
      const plan = {
        tasks: [{ id: "t1", model, prompt: "test", priority: "standard" }],
      };
      const result = parseCommanderPlan(JSON.stringify(plan));
      expect(result).not.toBeNull();
      expect(result!.tasks[0].model).toBe(model);
    }
  });

  it("auto-corrects gemini-3.1-pro-preview to gemini-3-pro-preview", () => {
    const plan = {
      tasks: [{ id: "t1", model: "gemini-3.1-pro-preview", prompt: "test", priority: "standard" }],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].model).toBe("gemini-3-pro-preview");
  });

  it("defaults missing priority to 'standard'", () => {
    const plan = {
      tasks: [{ id: "t1", model: "gemini-2.5-flash", prompt: "test" }],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].priority).toBe("standard");
  });

  it("defaults missing description to truncated prompt", () => {
    const plan = {
      tasks: [{ id: "t1", model: "gemini-2.5-flash", prompt: "A very long prompt that should be truncated to 80 characters for the description field when no explicit description is provided by the model" }],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].description.length).toBeLessThanOrEqual(80);
  });

  it("defaults missing reasoning and synthesisHint", () => {
    const plan = {
      tasks: [{ id: "t1", model: "gemini-2.5-flash", prompt: "test" }],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result!.reasoning).toBe("");
    expect(result!.synthesisHint).toBe("Merge all results into a coherent response.");
  });

  it("handles multi-task plans", () => {
    const plan = {
      reasoning: "three tasks",
      tasks: [
        { id: "t1", model: "claude-sonnet-4-6", prompt: "code", priority: "critical" },
        { id: "t2", model: "gemini-2.5-pro", prompt: "research", priority: "standard" },
        { id: "t3", model: "claude-haiku-4-5-20251001", prompt: "format", priority: "standard" },
      ],
      synthesisHint: "merge all",
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result!.tasks).toHaveLength(3);
  });

  it("preserves valid dependsOn references", () => {
    const plan = {
      tasks: [
        { id: "t1", model: "gemini-2.5-flash", prompt: "analyze code", priority: "standard" },
        { id: "t2", model: "gemini-2.5-pro", prompt: "write tests", priority: "standard", dependsOn: ["t1"] },
      ],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[1].dependsOn).toEqual(["t1"]);
  });

  it("strips invalid dependsOn references", () => {
    const plan = {
      tasks: [
        { id: "t1", model: "gemini-2.5-flash", prompt: "do stuff", priority: "standard", dependsOn: ["nonexistent"] },
      ],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].dependsOn).toBeUndefined();
  });

  it("strips self-references in dependsOn", () => {
    const plan = {
      tasks: [
        { id: "t1", model: "gemini-2.5-flash", prompt: "do stuff", priority: "standard", dependsOn: ["t1"] },
      ],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].dependsOn).toBeUndefined();
  });

  it("removes dependsOn when not an array", () => {
    const plan = {
      tasks: [
        { id: "t1", model: "gemini-2.5-flash", prompt: "do stuff", priority: "standard", dependsOn: "t2" },
      ],
    };
    const result = parseCommanderPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.tasks[0].dependsOn).toBeUndefined();
  });

  it("recovers truncated JSON with complete tasks", () => {
    // Simulate Opus response cut off mid-way through 3rd task
    const truncated = `{ "reasoning": "Split into three tasks", "tasks": [
      { "id": "t1", "model": "claude-sonnet-4-6", "prompt": "Analyze the codebase", "priority": "critical" },
      { "id": "t2", "model": "gemini-2.5-pro", "prompt": "Research competitors", "priority": "standard" },
      { "id": "t3", "model": "claude-opus-4-6", "prompt": "Design the architectu`;

    const result = parseCommanderPlan(truncated);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(2);
    expect(result!.tasks[0].id).toBe("t1");
    expect(result!.tasks[1].id).toBe("t2");
  });

  it("recovers truncated JSON with single complete task", () => {
    const truncated = `{ "reasoning": "Complex analysis", "tasks": [
      { "id": "t1", "model": "claude-sonnet-4-6", "prompt": "Do the work", "priority": "critical" },
      { "id": "t2", "model": "gemini-2.5-pro", "prompt": "This prompt is very long and gets cut off beca`;

    const result = parseCommanderPlan(truncated);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].id).toBe("t1");
  });

  it("returns null when truncated before any complete task", () => {
    const truncated = `{ "reasoning": "Analysis", "tasks": [ { "id": "t1", "model": "claude-son`;
    const result = parseCommanderPlan(truncated);
    expect(result).toBeNull();
  });

  it("returns null when truncated before tasks array", () => {
    const truncated = `{ "reasoning": "This is a massive strategic and architectural challenge. The user wants to build`;
    const result = parseCommanderPlan(truncated);
    expect(result).toBeNull();
  });
});

// ── resolveCommanderWaves ─────────────────────────────────────────────────

describe("resolveCommanderWaves", () => {
  const task = (id: string, deps?: string[]): CommanderTask => ({
    id,
    description: `Task ${id}`,
    model: "gemini-2.5-flash" as any,
    prompt: `Do ${id}`,
    priority: "standard",
    ...(deps && deps.length > 0 ? { dependsOn: deps } : {}),
  });

  it("returns single wave when no dependencies", () => {
    const tasks = [task("t1"), task("t2"), task("t3")];
    const waves = resolveCommanderWaves(tasks);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(3);
  });

  it("resolves two waves with simple dependency", () => {
    const tasks = [task("t1"), task("t2", ["t1"])];
    const waves = resolveCommanderWaves(tasks);
    expect(waves).toHaveLength(2);
    expect(waves[0].map((t) => t.id)).toEqual(["t1"]);
    expect(waves[1].map((t) => t.id)).toEqual(["t2"]);
  });

  it("resolves three waves with chain dependency", () => {
    const tasks = [task("t1"), task("t2", ["t1"]), task("t3", ["t2"])];
    const waves = resolveCommanderWaves(tasks);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((t) => t.id)).toEqual(["t1"]);
    expect(waves[1].map((t) => t.id)).toEqual(["t2"]);
    expect(waves[2].map((t) => t.id)).toEqual(["t3"]);
  });

  it("groups independent tasks with shared dependency", () => {
    const tasks = [task("t1"), task("t2", ["t1"]), task("t3", ["t1"])];
    const waves = resolveCommanderWaves(tasks);
    expect(waves).toHaveLength(2);
    expect(waves[0].map((t) => t.id)).toEqual(["t1"]);
    expect(waves[1].map((t) => t.id).sort()).toEqual(["t2", "t3"]);
  });

  it("handles mixed independent and dependent tasks", () => {
    const tasks = [task("t1"), task("t2"), task("t3", ["t1"])];
    const waves = resolveCommanderWaves(tasks);
    expect(waves).toHaveLength(2);
    expect(waves[0].map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(waves[1].map((t) => t.id)).toEqual(["t3"]);
  });

  it("handles circular dependencies gracefully", () => {
    const tasks = [task("t1", ["t2"]), task("t2", ["t1"])];
    const waves = resolveCommanderWaves(tasks);
    // Circular deps get dumped into a final wave
    expect(waves.length).toBeGreaterThanOrEqual(1);
    expect(waves.flat()).toHaveLength(2);
  });

  it("handles multiple dependencies per task", () => {
    const tasks = [task("t1"), task("t2"), task("t3", ["t1", "t2"])];
    const waves = resolveCommanderWaves(tasks);
    expect(waves).toHaveLength(2);
    expect(waves[0].map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(waves[1].map((t) => t.id)).toEqual(["t3"]);
  });
});

// ── buildPlanningMessage ────────────────────────────────────────────────────

describe("buildPlanningMessage", () => {
  it("includes user message", () => {
    const msg = buildPlanningMessage("hello", "");
    expect(msg).toContain("hello");
  });

  it("includes context when provided", () => {
    const msg = buildPlanningMessage("hello", "previous context");
    expect(msg).toContain("[Conversation context]");
    expect(msg).toContain("previous context");
    expect(msg).toContain("[User's current message]");
    expect(msg).toContain("hello");
  });

  it("omits context header when empty", () => {
    const msg = buildPlanningMessage("hello", "");
    expect(msg).not.toContain("[Conversation context]");
  });
});

// ── buildSynthesisMessage ───────────────────────────────────────────────────

describe("buildSynthesisMessage", () => {
  const plan: CommanderPlan = {
    reasoning: "split into two",
    tasks: [
      { id: "t1", description: "code", model: "claude-sonnet-4-6", prompt: "write code", priority: "critical" },
      { id: "t2", description: "research", model: "gemini-2.5-pro", prompt: "research topic", priority: "standard" },
    ],
    synthesisHint: "merge code with research",
  };

  it("formats successful results", () => {
    const results: WorkerResult[] = [
      { taskId: "t1", model: "claude-sonnet-4-6", status: "success", content: "function foo() {}" },
    ];
    const msg = buildSynthesisMessage("write foo", plan, results);
    expect(msg).toContain("Original user message: write foo");
    expect(msg).toContain("Success");
    expect(msg).toContain("function foo() {}");
    expect(msg).toContain("merge code with research");
  });

  it("formats error results", () => {
    const results: WorkerResult[] = [
      { taskId: "t1", model: "claude-sonnet-4-6", status: "error", content: "", error: "API rate limited" },
    ];
    const msg = buildSynthesisMessage("do stuff", plan, results);
    expect(msg).toContain("FAILED");
    expect(msg).toContain("API rate limited");
  });

  it("separates multiple results with dividers", () => {
    const results: WorkerResult[] = [
      { taskId: "t1", model: "claude-sonnet-4-6", status: "success", content: "result 1" },
      { taskId: "t2", model: "gemini-2.5-pro", status: "success", content: "result 2" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("---");
    expect(msg).toContain("result 1");
    expect(msg).toContain("result 2");
  });
});

// ── createInitialCommanderState ─────────────────────────────────────────────

describe("createInitialCommanderState", () => {
  it("creates state in planning phase", () => {
    const state = createInitialCommanderState();
    expect(state.phase).toBe("planning");
    expect(state.plan).toBeNull();
    expect(state.workerResults).toBeInstanceOf(Map);
    expect(state.workerResults.size).toBe(0);
    expect(state.activeWorkers).toBeInstanceOf(Set);
    expect(state.activeWorkers.size).toBe(0);
    expect(state.totalCost).toBe(0);
    expect(state.startTime).toBeLessThanOrEqual(Date.now());
  });
});

// ── truncateContextMessages ──────────────────────────────────────────────────

describe("truncateContextMessages", () => {
  const msgs = (roles: string[], contentLen = 50) =>
    roles.map((role, i) => ({
      role,
      content: `msg-${i}-${"x".repeat(contentLen)}`,
    }));

  it("includes only user and assistant messages", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "system", content: "system msg" },
      { role: "assistant", content: "hi" },
    ];
    const result = truncateContextMessages(messages);
    expect(result).toContain("User: hello");
    expect(result).toContain("Assistant: hi");
    expect(result).not.toContain("system msg");
  });

  it("limits to maxMessages most recent messages", () => {
    const messages = msgs(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    const result = truncateContextMessages(messages, 800, 3);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
  });

  it("truncates long messages with indicator", () => {
    const messages = [{ role: "user", content: "a".repeat(1000) }];
    const result = truncateContextMessages(messages, 100);
    expect(result).toContain("... [truncated]");
    expect(result.length).toBeLessThan(200);
  });

  it("does not truncate messages within limit", () => {
    const messages = [{ role: "user", content: "short message" }];
    const result = truncateContextMessages(messages);
    expect(result).toBe("User: short message");
    expect(result).not.toContain("truncated");
  });

  it("returns empty string for no messages", () => {
    expect(truncateContextMessages([])).toBe("");
  });

  it("uses default maxChars and maxMessages", () => {
    expect(MAX_CONTEXT_MSG_CHARS).toBe(800);
    expect(MAX_CONTEXT_MESSAGES).toBe(6);
  });

  it("filters system messages even when they appear between user/assistant", () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "tool", content: "tool output" },
      { role: "assistant", content: "b" },
    ];
    const result = truncateContextMessages(messages);
    expect(result).toBe("User: a\nAssistant: b");
  });
});

// ── buildWorkerPromptWithDeps ────────────────────────────────────────────────

describe("buildWorkerPromptWithDeps", () => {
  it("returns original prompt when no dependencies", () => {
    const prompt = buildWorkerPromptWithDeps("do stuff", undefined, new Map());
    expect(prompt).toBe("do stuff");
  });

  it("returns original prompt when dependsOn is empty array", () => {
    const prompt = buildWorkerPromptWithDeps("do stuff", [], new Map());
    expect(prompt).toBe("do stuff");
  });

  it("injects dependency outputs into prompt", () => {
    const outputs = new Map([["task-1", "Result from task 1"]]);
    const prompt = buildWorkerPromptWithDeps("write tests", ["task-1"], outputs);
    expect(prompt).toContain("[Output from task-1]");
    expect(prompt).toContain("Result from task 1");
    expect(prompt).toContain("Now complete your task:");
    expect(prompt).toContain("write tests");
  });

  it("injects multiple dependency outputs with dividers", () => {
    const outputs = new Map([
      ["task-1", "Analysis result"],
      ["task-2", "Research result"],
    ]);
    const prompt = buildWorkerPromptWithDeps("synthesize", ["task-1", "task-2"], outputs);
    expect(prompt).toContain("[Output from task-1]");
    expect(prompt).toContain("[Output from task-2]");
    expect(prompt).toContain("---");
  });

  it("skips dependencies with no matching output", () => {
    const outputs = new Map([["task-1", "only this"]]);
    const prompt = buildWorkerPromptWithDeps("do it", ["task-1", "task-99"], outputs);
    expect(prompt).toContain("[Output from task-1]");
    expect(prompt).not.toContain("task-99");
    expect(prompt).toContain("Now complete your task:");
  });

  it("returns original prompt when no dependency outputs match", () => {
    const outputs = new Map<string, string>();
    const prompt = buildWorkerPromptWithDeps("do stuff", ["task-1"], outputs);
    expect(prompt).toBe("do stuff");
  });
});

// ── classifyWorkerResult ────────────────────────────────────────────────────

describe("classifyWorkerResult", () => {
  const model = "gemini-2.5-flash" as any;

  it("classifies success from outcome", () => {
    const result = classifyWorkerResult(
      { content: "output", cost: 0.01, tokens: { input: 10, output: 20, total: 30 }, duration: 1000, outcome: "success" },
      "t1", model, false,
    );
    expect(result.status).toBe("success");
    expect(result.content).toBe("output");
    expect(result.cost).toBe(0.01);
    expect(result.tokens).toEqual({ input: 10, output: 20, total: 30 });
    expect(result.duration).toBe(1000);
    expect(result.taskId).toBe("t1");
    expect(result.model).toBe(model);
  });

  it("classifies partial outcome as success (commander has no partial)", () => {
    const result = classifyWorkerResult(
      { content: "partial output", outcome: "partial", stderr: "Timeout after 180s" },
      "t1", model, false,
    );
    expect(result.status).toBe("success");
    expect(result.content).toBe("partial output");
  });

  it("classifies error from outcome", () => {
    const result = classifyWorkerResult(
      { content: "", stderr: "Rate limited", outcome: "error" },
      "t1", model, false,
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("Rate limited");
    expect(result.content).toBe("");
  });

  it("classifies cancelled when aborted and no result", () => {
    const result = classifyWorkerResult(null, "t1", model, true);
    expect(result.status).toBe("error");
    expect(result.error).toBe("Cancelled");
  });

  it("classifies no-result error for null result", () => {
    const result = classifyWorkerResult(null, "t1", model, false);
    expect(result.status).toBe("error");
    expect(result.error).toBe("Worker returned no result");
  });

  it("success outcome wins over abort signal", () => {
    const result = classifyWorkerResult(
      { content: "still got output", outcome: "success" },
      "t1", model, true,
    );
    expect(result.status).toBe("success");
    expect(result.content).toBe("still got output");
  });

  it("error outcome wins over abort signal", () => {
    const result = classifyWorkerResult(
      { content: "", stderr: "API error", outcome: "error" },
      "t1", model, true,
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("API error");
  });

  it("uses 'Unknown error' when error outcome has no stderr", () => {
    const result = classifyWorkerResult(
      { content: "", outcome: "error" },
      "t1", model, false,
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("Unknown error");
  });
});

// ── checkCriticalFailures ────────────────────────────────────────────────────

describe("checkCriticalFailures", () => {
  const task = (id: string, priority: "critical" | "standard" = "critical"): CommanderTask => ({
    id,
    description: `Task ${id}`,
    model: "gemini-2.5-flash" as any,
    prompt: `Do ${id}`,
    priority,
  });

  it("returns null when no critical tasks exist", () => {
    const tasks = [task("t1", "standard"), task("t2", "standard")];
    const results = new Map<string, WorkerResult>();
    expect(checkCriticalFailures(tasks, results)).toBeNull();
  });

  it("returns null when at least one critical task succeeded", () => {
    const tasks = [task("t1"), task("t2")];
    const results = new Map<string, WorkerResult>([
      ["t1", { taskId: "t1", model: "gemini-2.5-flash" as any, status: "success", content: "ok" }],
      ["t2", { taskId: "t2", model: "gemini-2.5-flash" as any, status: "error", content: "", error: "fail" }],
    ]);
    expect(checkCriticalFailures(tasks, results)).toBeNull();
  });

  it("returns error message when all critical tasks failed", () => {
    const tasks = [task("t1"), task("t2")];
    const results = new Map<string, WorkerResult>([
      ["t1", { taskId: "t1", model: "gemini-2.5-flash" as any, status: "error", content: "", error: "timeout" }],
      ["t2", { taskId: "t2", model: "gemini-2.5-flash" as any, status: "error", content: "", error: "rate limit" }],
    ]);
    const error = checkCriticalFailures(tasks, results);
    expect(error).toContain("All 2 critical workers failed");
    expect(error).toContain("timeout");
    expect(error).toContain("rate limit");
  });

  it("returns error when critical tasks have no results", () => {
    const tasks = [task("t1")];
    const results = new Map<string, WorkerResult>(); // empty — no results at all
    const error = checkCriticalFailures(tasks, results);
    expect(error).toContain("All 1 critical workers failed");
    expect(error).toContain("no result");
  });

  it("ignores standard tasks when checking critical failures", () => {
    const tasks = [task("t1"), task("t2", "standard")];
    const results = new Map<string, WorkerResult>([
      ["t1", { taskId: "t1", model: "gemini-2.5-flash" as any, status: "success", content: "ok" }],
      ["t2", { taskId: "t2", model: "gemini-2.5-flash" as any, status: "error", content: "", error: "fail" }],
    ]);
    expect(checkCriticalFailures(tasks, results)).toBeNull();
  });
});

// ── buildFallbackContent ────────────────────────────────────────────────────

describe("buildFallbackContent", () => {
  it("concatenates successful results with dividers", () => {
    const results: WorkerResult[] = [
      { taskId: "t1", model: "gemini-2.5-flash" as any, status: "success", content: "result 1" },
      { taskId: "t2", model: "gemini-2.5-flash" as any, status: "success", content: "result 2" },
    ];
    const fallback = buildFallbackContent(results);
    expect(fallback).toContain("result 1");
    expect(fallback).toContain("result 2");
    expect(fallback).toContain("---");
  });

  it("filters out error results", () => {
    const results: WorkerResult[] = [
      { taskId: "t1", model: "gemini-2.5-flash" as any, status: "success", content: "good" },
      { taskId: "t2", model: "gemini-2.5-flash" as any, status: "error", content: "", error: "fail" },
      { taskId: "t3", model: "gemini-2.5-flash" as any, status: "error", content: "", error: "timeout" },
    ];
    const fallback = buildFallbackContent(results);
    expect(fallback).toBe("good");
    expect(fallback).not.toContain("fail");
  });

  it("returns empty string when all results failed", () => {
    const results: WorkerResult[] = [
      { taskId: "t1", model: "gemini-2.5-flash" as any, status: "error", content: "", error: "fail" },
    ];
    expect(buildFallbackContent(results)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(buildFallbackContent([])).toBe("");
  });
});

// ── isBuildIntent ──────────────────────────────────────────────────────────

describe("isBuildIntent", () => {
  it("detects build + app", () => {
    expect(isBuildIntent("Build me a todo app")).toBe(true);
  });

  it("detects create + component", () => {
    expect(isBuildIntent("Create a new login component")).toBe(true);
  });

  it("detects implement + feature", () => {
    expect(isBuildIntent("Implement the dark mode feature")).toBe(true);
  });

  it("detects scaffold + project", () => {
    expect(isBuildIntent("Scaffold a new React project")).toBe(true);
  });

  it("detects generate + api", () => {
    expect(isBuildIntent("Generate a REST api for user management")).toBe(true);
  });

  it("detects develop + system", () => {
    expect(isBuildIntent("Develop a notification system")).toBe(true);
  });

  it("detects make + dashboard", () => {
    expect(isBuildIntent("Make a financial dashboard")).toBe(true);
  });

  it("detects write + function", () => {
    expect(isBuildIntent("Write a function that validates emails")).toBe(true);
  });

  it("detects set up + service", () => {
    expect(isBuildIntent("Set up an authentication service")).toBe(true);
  });

  it("rejects non-build verbs", () => {
    expect(isBuildIntent("Explain how React works")).toBe(false);
  });

  it("rejects build verb without code artifact", () => {
    expect(isBuildIntent("Write a poem about the sea")).toBe(false);
  });

  it("rejects pure analysis requests", () => {
    expect(isBuildIntent("Analyze this error message")).toBe(false);
  });

  it("rejects research questions", () => {
    expect(isBuildIntent("What are the best practices for REST APIs?")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isBuildIntent("BUILD ME A GAME")).toBe(true);
  });

  it("detects create + hook", () => {
    expect(isBuildIntent("Create a custom useDebounce hook")).toBe(true);
  });

  it("detects build + widget", () => {
    expect(isBuildIntent("Build a weather widget")).toBe(true);
  });

  it("detects implement + endpoint", () => {
    expect(isBuildIntent("Implement the /users endpoint")).toBe(true);
  });
});

// ── COMMANDER_BUILD_PLANNING_PROMPT ──────────────────────────────────────────

describe("COMMANDER_BUILD_PLANNING_PROMPT", () => {
  it("mentions BUILD MODE", () => {
    expect(COMMANDER_BUILD_PLANNING_PROMPT).toContain("BUILD MODE");
  });

  it("specifies exactly 2 tasks", () => {
    expect(COMMANDER_BUILD_PLANNING_PROMPT).toContain("EXACTLY 2 tasks");
  });

  it("specifies claude-sonnet-4-6 for worker 1", () => {
    expect(COMMANDER_BUILD_PLANNING_PROMPT).toContain("claude-sonnet-4-6");
  });

  it("specifies gemini-3-pro-preview for worker 2", () => {
    expect(COMMANDER_BUILD_PLANNING_PROMPT).toContain("gemini-3-pro-preview");
  });

  it("emphasizes zero file overlap", () => {
    expect(COMMANDER_BUILD_PLANNING_PROMPT).toContain("ZERO file overlap");
  });

  it("includes JSON schema", () => {
    expect(COMMANDER_BUILD_PLANNING_PROMPT).toContain('"tasks"');
    expect(COMMANDER_BUILD_PLANNING_PROMPT).toContain('"synthesisHint"');
  });
});
