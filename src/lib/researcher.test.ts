import { describe, it, expect } from "vitest";
import {
  parseResearchPlan,
  parseGapAnalysis,
  cleanWorkerContent,
  extractSources,
  hasUsableContent,
  resolveWaves,
  buildResearchPlanningMessage,
  buildResearchWorkerMessage,
  buildGapAnalysisMessage,
  buildSynthesisMessage,
  buildPlanningPrompt,
  createInitialResearchState,
  getPlanningModel,
  getSynthesisModel,
  upgradeModel,
  classifyResearchWorkerResult,
  identifyTimedOutModels,
  replaceTimedOutModels,
  buildRetryQuestions,
  mergeWorkerResults,
  buildFallbackResearchContent,
  type ResearchPlan,
  type ResearchQuestion,
  type ResearchWorkerResult,
} from "./researcher";

// ── parseResearchPlan ──────────────────────────────────────────────────────

describe("parseResearchPlan", () => {
  const validPlan = {
    reasoning: "Split into focused sub-questions",
    questions: [
      {
        id: "q1",
        question: "What is the market size?",
        searchQuery: "SaaS market size 2025",
        model: "gemini-2.5-pro",
        priority: "critical",
      },
      {
        id: "q2",
        question: "Who are the competitors?",
        searchQuery: "micro-SaaS competitors landscape",
        model: "gemini-2.5-flash",
        priority: "standard",
      },
    ],
  };

  it("parses valid JSON plan", () => {
    const result = parseResearchPlan(JSON.stringify(validPlan));
    expect(result).not.toBeNull();
    expect(result!.reasoning).toBe("Split into focused sub-questions");
    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0].model).toBe("gemini-2.5-pro");
    expect(result!.questions[0].priority).toBe("critical");
  });

  it("strips markdown code fences", () => {
    const fenced = "```json\n" + JSON.stringify(validPlan) + "\n```";
    const result = parseResearchPlan(fenced);
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
  });

  it("strips code fences without language tag", () => {
    const fenced = "```\n" + JSON.stringify(validPlan) + "\n```";
    const result = parseResearchPlan(fenced);
    expect(result).not.toBeNull();
  });

  it("extracts JSON from surrounding text", () => {
    const messy = "Here is the plan:\n\n" + JSON.stringify(validPlan) + "\n\nThat covers the topic.";
    const result = parseResearchPlan(messy);
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
  });

  it("returns null for empty string", () => {
    expect(parseResearchPlan("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseResearchPlan("not json at all")).toBeNull();
  });

  it("returns null for JSON without questions array", () => {
    expect(parseResearchPlan('{"reasoning": "no questions"}')).toBeNull();
  });

  it("returns null for empty questions array", () => {
    expect(parseResearchPlan('{"questions": []}')).toBeNull();
  });

  it("returns null for questions exceeding maxQuestions", () => {
    const plan = {
      reasoning: "too many",
      questions: Array.from({ length: 16 }, (_, i) => ({
        id: `q${i}`,
        question: `Question ${i}`,
        searchQuery: `query ${i}`,
        model: "gemini-2.5-flash",
        priority: "standard",
      })),
    };
    expect(parseResearchPlan(JSON.stringify(plan))).toBeNull();
  });

  it("respects custom maxQuestions", () => {
    const plan = {
      questions: Array.from({ length: 5 }, (_, i) => ({
        id: `q${i}`,
        question: `Q${i}`,
        searchQuery: `s${i}`,
        priority: "standard",
      })),
    };
    expect(parseResearchPlan(JSON.stringify(plan), 4)).toBeNull();
    expect(parseResearchPlan(JSON.stringify(plan), 5)).not.toBeNull();
  });

  it("returns null for question missing id", () => {
    const plan = {
      questions: [{ question: "test", searchQuery: "test" }],
    };
    expect(parseResearchPlan(JSON.stringify(plan))).toBeNull();
  });

  it("returns null for question missing question field", () => {
    const plan = {
      questions: [{ id: "q1", searchQuery: "test" }],
    };
    expect(parseResearchPlan(JSON.stringify(plan))).toBeNull();
  });

  it("returns null for question missing searchQuery", () => {
    const plan = {
      questions: [{ id: "q1", question: "test" }],
    };
    expect(parseResearchPlan(JSON.stringify(plan))).toBeNull();
  });

  it("defaults missing priority to standard", () => {
    const plan = {
      questions: [{ id: "q1", question: "test", searchQuery: "query" }],
    };
    const result = parseResearchPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.questions[0].priority).toBe("standard");
  });

  it("defaults missing reasoning to empty string", () => {
    const plan = {
      questions: [{ id: "q1", question: "test", searchQuery: "query" }],
    };
    const result = parseResearchPlan(JSON.stringify(plan));
    expect(result!.reasoning).toBe("");
  });

  it("strips invalid model names", () => {
    const plan = {
      questions: [
        { id: "q1", question: "test", searchQuery: "query", model: "gpt-4o" },
      ],
    };
    const result = parseResearchPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.questions[0].model).toBeUndefined();
  });

  it("accepts all valid research models", () => {
    const validModels = [
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ];
    for (const model of validModels) {
      const plan = {
        questions: [
          { id: "q1", question: "test", searchQuery: "query", model },
        ],
      };
      const result = parseResearchPlan(JSON.stringify(plan));
      expect(result).not.toBeNull();
      expect(result!.questions[0].model).toBe(model);
    }
  });

  it("validates dependsOn references — strips invalid refs", () => {
    const plan = {
      questions: [
        { id: "q1", question: "Q1", searchQuery: "s1" },
        { id: "q2", question: "Q2", searchQuery: "s2", dependsOn: ["q1", "q99"] },
      ],
    };
    const result = parseResearchPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.questions[1].dependsOn).toEqual(["q1"]);
  });

  it("strips self-referencing dependsOn", () => {
    const plan = {
      questions: [
        { id: "q1", question: "Q1", searchQuery: "s1", dependsOn: ["q1"] },
      ],
    };
    const result = parseResearchPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.questions[0].dependsOn).toBeUndefined();
  });

  it("removes dependsOn entirely when all refs are invalid", () => {
    const plan = {
      questions: [
        { id: "q1", question: "Q1", searchQuery: "s1", dependsOn: ["q99", "q100"] },
      ],
    };
    const result = parseResearchPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.questions[0].dependsOn).toBeUndefined();
  });

  it("handles dependsOn as non-array gracefully", () => {
    const plan = {
      questions: [
        { id: "q1", question: "Q1", searchQuery: "s1", dependsOn: "q2" },
      ],
    };
    const result = parseResearchPlan(JSON.stringify(plan));
    expect(result).not.toBeNull();
    expect(result!.questions[0].dependsOn).toBeUndefined();
  });
});

// ── parseGapAnalysis ──────────────────────────────────────────────────────

describe("parseGapAnalysis", () => {
  it("parses complete status", () => {
    const json = { status: "complete", reasoning: "All covered" };
    const result = parseGapAnalysis(JSON.stringify(json));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("complete");
    expect(result!.reasoning).toBe("All covered");
    expect(result!.followUpQuestions).toHaveLength(0);
  });

  it("parses gaps_found with follow-up questions", () => {
    const json = {
      status: "gaps_found",
      reasoning: "Missing market data",
      followUpQuestions: [
        { id: "f1", question: "Market trends?", searchQuery: "market trends 2025", model: "gemini-2.5-pro", priority: "critical" },
      ],
    };
    const result = parseGapAnalysis(JSON.stringify(json));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("gaps_found");
    expect(result!.followUpQuestions).toHaveLength(1);
    expect(result!.followUpQuestions[0].id).toBe("f1");
  });

  it("returns null for invalid status", () => {
    expect(parseGapAnalysis('{"status": "partial"}')).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseGapAnalysis("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGapAnalysis("")).toBeNull();
  });

  it("treats gaps_found without followUpQuestions as complete", () => {
    const json = { status: "gaps_found", reasoning: "No valid questions" };
    const result = parseGapAnalysis(JSON.stringify(json));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("complete");
  });

  it("strips invalid model from follow-up questions", () => {
    const json = {
      status: "gaps_found",
      reasoning: "gaps",
      followUpQuestions: [
        { id: "f1", question: "Q?", searchQuery: "q", model: "gpt-4o", priority: "critical" },
      ],
    };
    const result = parseGapAnalysis(JSON.stringify(json));
    expect(result!.followUpQuestions[0].model).toBeUndefined();
  });

  it("defaults missing priority in follow-ups to standard", () => {
    const json = {
      status: "gaps_found",
      reasoning: "gaps",
      followUpQuestions: [
        { id: "f1", question: "Q?", searchQuery: "q" },
      ],
    };
    const result = parseGapAnalysis(JSON.stringify(json));
    expect(result!.followUpQuestions[0].priority).toBe("standard");
  });

  it("filters out follow-up questions missing required fields", () => {
    const json = {
      status: "gaps_found",
      reasoning: "gaps",
      followUpQuestions: [
        { id: "f1", question: "Good Q", searchQuery: "query" },
        { id: "f2", question: "Missing searchQuery" }, // No searchQuery
        { question: "Missing id", searchQuery: "q" }, // No id
      ],
    };
    const result = parseGapAnalysis(JSON.stringify(json));
    expect(result!.followUpQuestions).toHaveLength(1);
    expect(result!.followUpQuestions[0].id).toBe("f1");
  });

  it("handles markdown-fenced JSON", () => {
    const json = { status: "complete", reasoning: "done" };
    const fenced = "```json\n" + JSON.stringify(json) + "\n```";
    const result = parseGapAnalysis(fenced);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("complete");
  });
});

// ── cleanWorkerContent ────────────────────────────────────────────────────

describe("cleanWorkerContent", () => {
  it("strips Gemini grounding redirect URLs", () => {
    const content = "Check this: https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123xyz and more.";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).not.toContain("vertexaisearch.cloud.google.com");
    expect(cleaned).not.toContain("[internal-redirect]");
    expect(cleaned).toContain("Check this:");
    expect(cleaned).toContain("and more.");
  });

  it("removes [Source: redirect-url] citations entirely", () => {
    const content = "Some text [Source: https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123] more text.";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).not.toContain("[Source:");
    expect(cleaned).not.toContain("vertexaisearch");
    expect(cleaned).toContain("Some text");
    expect(cleaned).toContain("more text.");
  });

  it("removes multi-redirect source citations", () => {
    const content = "[Source: https://vertexaisearch.cloud.google.com/grounding-api-redirect/a, https://vertexaisearch.cloud.google.com/grounding-api-redirect/b]";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).not.toContain("[Source:");
    expect(cleaned).not.toContain("vertexaisearch");
  });

  it("preserves legitimate URLs", () => {
    const content = "See [Source: https://example.com/article] for details.";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).toContain("https://example.com/article");
  });

  it("collapses excessive blank lines", () => {
    const content = "Line 1\n\n\n\n\nLine 2";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).toBe("Line 1\n\nLine 2");
  });

  it("removes empty parentheses left behind", () => {
    const content = "Some text () more text";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).toBe("Some text  more text");
  });

  it("trims whitespace", () => {
    const content = "  some content  \n\n  ";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).toBe("some content");
  });

  it("handles content with no redirect URLs unchanged (minus trim)", () => {
    const content = "Normal research content with [Source: https://example.com] citations.";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).toBe(content);
  });

  it("handles empty string", () => {
    expect(cleanWorkerContent("")).toBe("");
  });

  it("handles http (not https) redirect URLs", () => {
    const content = "Check http://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz done.";
    const cleaned = cleanWorkerContent(content);
    expect(cleaned).not.toContain("vertexaisearch");
  });
});

// ── extractSources ────────────────────────────────────────────────────────

describe("extractSources", () => {
  it("extracts full URLs from content", () => {
    const content = "See https://example.com/article and https://other.com/page for details.";
    const sources = extractSources(content);
    expect(sources).toContain("https://example.com/article");
    expect(sources).toContain("https://other.com/page");
  });

  it("deduplicates URLs", () => {
    const content = "https://example.com and https://example.com again.";
    const sources = extractSources(content);
    expect(sources.filter((u) => u === "https://example.com")).toHaveLength(1);
  });

  it("strips trailing punctuation from URLs", () => {
    const content = "See https://example.com/page. Also https://other.com/path, noted.";
    const sources = extractSources(content);
    expect(sources).toContain("https://example.com/page");
    expect(sources).toContain("https://other.com/path");
  });

  it("filters out Gemini grounding redirect URLs", () => {
    const content = "Found at https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123 and https://example.com";
    const sources = extractSources(content);
    expect(sources).not.toContainEqual(expect.stringContaining("vertexaisearch"));
    expect(sources).toContain("https://example.com");
  });

  it("filters out googleusercontent grounding URLs", () => {
    const content = "https://googleusercontent.com/grounding/something and https://example.com";
    const sources = extractSources(content);
    expect(sources).not.toContainEqual(expect.stringContaining("googleusercontent.com/grounding"));
    expect(sources).toContain("https://example.com");
  });

  it("extracts domain-level citations from [Source: domain.com]", () => {
    const content = "Info [Source: example.com] found here.";
    const sources = extractSources(content);
    expect(sources).toContain("https://example.com");
  });

  it("extracts multiple domains from comma-separated source citation", () => {
    const content = "[Source: example.com, other.org]";
    const sources = extractSources(content);
    expect(sources).toContain("https://example.com");
    expect(sources).toContain("https://other.org");
  });

  it("does not create domain URL from full URL in source citation", () => {
    const content = "[Source: https://example.com/path]";
    const sources = extractSources(content);
    // The full URL should be extracted, not a duplicate https://https://...
    expect(sources).toContain("https://example.com/path");
    expect(sources).not.toContain("https://https://example.com/path");
  });

  it("returns empty array for content with no URLs", () => {
    expect(extractSources("Just some text with no links.")).toEqual([]);
  });

  it("ignores very short URLs (<10 chars)", () => {
    // http://a.b is 10 chars — borderline
    const sources = extractSources("http://a.b");
    expect(sources).toHaveLength(0);
  });
});

// ── resolveWaves ──────────────────────────────────────────────────────────

describe("resolveWaves", () => {
  const q = (id: string, deps?: string[]): ResearchQuestion => ({
    id,
    question: `Q ${id}`,
    searchQuery: `search ${id}`,
    priority: "standard",
    ...(deps && deps.length > 0 ? { dependsOn: deps } : {}),
  });

  it("returns single wave when no dependencies", () => {
    const questions = [q("q1"), q("q2"), q("q3")];
    const waves = resolveWaves(questions);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(3);
  });

  it("splits into 2 waves with simple dependency", () => {
    const questions = [q("q1"), q("q2", ["q1"])];
    const waves = resolveWaves(questions);
    expect(waves).toHaveLength(2);
    expect(waves[0].map((q) => q.id)).toEqual(["q1"]);
    expect(waves[1].map((q) => q.id)).toEqual(["q2"]);
  });

  it("resolves complex dependency chain: q1→q2→q3", () => {
    const questions = [q("q1"), q("q2", ["q1"]), q("q3", ["q2"])];
    const waves = resolveWaves(questions);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((q) => q.id)).toEqual(["q1"]);
    expect(waves[1].map((q) => q.id)).toEqual(["q2"]);
    expect(waves[2].map((q) => q.id)).toEqual(["q3"]);
  });

  it("parallelizes independent questions in same wave", () => {
    const questions = [q("q1"), q("q2"), q("q3", ["q1", "q2"])];
    const waves = resolveWaves(questions);
    expect(waves).toHaveLength(2);
    expect(waves[0]).toHaveLength(2); // q1, q2 in parallel
    expect(waves[1].map((q) => q.id)).toEqual(["q3"]);
  });

  it("handles circular dependencies gracefully", () => {
    const questions = [q("q1", ["q2"]), q("q2", ["q1"])];
    const waves = resolveWaves(questions);
    // Should dump both into a wave rather than infinite loop
    expect(waves.length).toBeGreaterThanOrEqual(1);
    const allIds = waves.flat().map((q) => q.id);
    expect(allIds).toContain("q1");
    expect(allIds).toContain("q2");
  });

  it("handles mixed: some with deps, some without", () => {
    const questions = [q("q1"), q("q2"), q("q3", ["q1"]), q("q4")];
    const waves = resolveWaves(questions);
    expect(waves).toHaveLength(2);
    expect(waves[0]).toHaveLength(3); // q1, q2, q4
    expect(waves[1]).toHaveLength(1); // q3
  });

  it("handles single question", () => {
    const waves = resolveWaves([q("q1")]);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(1);
  });

  it("handles empty array", () => {
    const waves = resolveWaves([]);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(0);
  });
});

// ── buildResearchPlanningMessage ──────────────────────────────────────────

describe("buildResearchPlanningMessage", () => {
  it("includes query", () => {
    const msg = buildResearchPlanningMessage("What is AI?", "");
    expect(msg).toContain("[Research query]");
    expect(msg).toContain("What is AI?");
  });

  it("includes context when provided", () => {
    const msg = buildResearchPlanningMessage("query", "some context");
    expect(msg).toContain("[Conversation context]");
    expect(msg).toContain("some context");
  });

  it("omits context header when empty", () => {
    const msg = buildResearchPlanningMessage("query", "");
    expect(msg).not.toContain("[Conversation context]");
  });
});

// ── buildResearchWorkerMessage ────────────────────────────────────────────

describe("buildResearchWorkerMessage", () => {
  const baseQ: ResearchQuestion = {
    id: "q1",
    question: "What is the market size?",
    searchQuery: "SaaS market size 2025",
    priority: "critical",
  };

  it("includes question and search query", () => {
    const msg = buildResearchWorkerMessage(baseQ);
    expect(msg).toContain("What is the market size?");
    expect(msg).toContain("SaaS market size 2025");
  });

  it("does not include prior findings when no dependencies", () => {
    const msg = buildResearchWorkerMessage(baseQ);
    expect(msg).not.toContain("Prior findings");
  });

  it("includes prior findings for dependency questions", () => {
    const depQ: ResearchQuestion = {
      ...baseQ,
      id: "q2",
      dependsOn: ["q1"],
    };
    const priorFindings = new Map([["q1", "Market size is $50B"]]);
    const msg = buildResearchWorkerMessage(depQ, priorFindings);
    expect(msg).toContain("Prior findings from q1");
    expect(msg).toContain("Market size is $50B");
    expect(msg).toContain("build upon it");
  });

  it("skips missing prior findings gracefully", () => {
    const depQ: ResearchQuestion = {
      ...baseQ,
      id: "q2",
      dependsOn: ["q1", "q99"],
    };
    const priorFindings = new Map([["q1", "Some data"]]);
    const msg = buildResearchWorkerMessage(depQ, priorFindings);
    expect(msg).toContain("Prior findings from q1");
    expect(msg).not.toContain("q99");
  });
});

// ── buildGapAnalysisMessage ──────────────────────────────────────────────

describe("buildGapAnalysisMessage", () => {
  const plan: ResearchPlan = {
    reasoning: "Cover both angles",
    questions: [
      { id: "q1", question: "Market size?", searchQuery: "s1", priority: "critical" },
      { id: "q2", question: "Competitors?", searchQuery: "s2", priority: "standard" },
    ],
  };

  it("includes original query", () => {
    const results: ResearchWorkerResult[] = [];
    const msg = buildGapAnalysisMessage("SaaS research", plan, results);
    expect(msg).toContain("Original research query: SaaS research");
  });

  it("lists sub-questions researched", () => {
    const msg = buildGapAnalysisMessage("query", plan, []);
    expect(msg).toContain("q1: Market size?");
    expect(msg).toContain("q2: Competitors?");
  });

  it("includes successful worker content (cleaned)", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "Market is $50B" },
    ];
    const msg = buildGapAnalysisMessage("query", plan, results);
    expect(msg).toContain("Market is $50B");
  });

  it("shows FAILED for error workers", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "Timeout" },
    ];
    const msg = buildGapAnalysisMessage("query", plan, results);
    expect(msg).toContain("FAILED");
    expect(msg).toContain("Timeout");
  });

  it("cleans Gemini redirect URLs from findings", () => {
    const results: ResearchWorkerResult[] = [
      {
        questionId: "q1",
        status: "success",
        content: "Data from https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123 shows growth.",
      },
    ];
    const msg = buildGapAnalysisMessage("query", plan, results);
    expect(msg).not.toContain("vertexaisearch");
  });
});

// ── buildSynthesisMessage ─────────────────────────────────────────────────

describe("buildSynthesisMessage", () => {
  const plan: ResearchPlan = {
    reasoning: "Comprehensive coverage",
    questions: [
      { id: "q1", question: "Market overview?", searchQuery: "s1", priority: "critical" },
      { id: "q2", question: "Competition?", searchQuery: "s2", priority: "standard" },
    ],
  };

  it("includes original query and scope", () => {
    const results: ResearchWorkerResult[] = [];
    const msg = buildSynthesisMessage("SaaS niches", plan, results);
    expect(msg).toContain("Original research query: SaaS niches");
    expect(msg).toContain("Research scope: Comprehensive coverage");
  });

  it("only includes successful results", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "Market data here" },
      { questionId: "q2", status: "error", content: "", error: "Failed" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("Market data here");
    expect(msg).not.toContain("Failed");
  });

  it("maps questionId to question text in headers", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "findings" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("## Research on: Market overview?");
  });

  it("falls back to questionId when question not found in plan", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q99", status: "success", content: "orphan findings" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("## Research on: q99");
  });

  it("cleans Gemini redirect URLs from content", () => {
    const results: ResearchWorkerResult[] = [
      {
        questionId: "q1",
        status: "success",
        content: "Data from https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz shows X.",
      },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).not.toContain("vertexaisearch");
  });

  it("separates multiple results with dividers", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "result 1" },
      { questionId: "q2", status: "success", content: "result 2" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("---");
    expect(msg).toContain("result 1");
    expect(msg).toContain("result 2");
  });

  it("includes partial results in synthesis", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "partial", content: "partial data here", error: "Timed out" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("partial data here");
    expect(msg).toContain("(partial");
  });

  it("excludes error results from synthesis", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "good data" },
      { questionId: "q2", status: "error", content: "", error: "Timeout" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("good data");
    expect(msg).not.toContain("Timeout");
  });

  it("includes both success and partial results together", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "full result" },
      { questionId: "q2", status: "partial", content: "partial result" },
    ];
    const msg = buildSynthesisMessage("query", plan, results);
    expect(msg).toContain("full result");
    expect(msg).toContain("partial result");
  });
});

// ── buildPlanningPrompt ───────────────────────────────────────────────────

describe("buildPlanningPrompt", () => {
  it("includes question count guidance for quick mode", () => {
    const prompt = buildPlanningPrompt("quick");
    expect(prompt).toContain("2-3");
  });

  it("includes max questions for deep mode", () => {
    const prompt = buildPlanningPrompt("deep");
    expect(prompt).toContain("Maximum 15");
  });

  it("includes rate limit warning", () => {
    const prompt = buildPlanningPrompt("deep");
    expect(prompt).toContain("RATE LIMIT AWARENESS");
    expect(prompt).toContain("5 RPM");
  });

  it("lists all available models", () => {
    const prompt = buildPlanningPrompt("deep");
    expect(prompt).toContain("gemini-2.5-flash");
    expect(prompt).toContain("gemini-2.5-pro");
    expect(prompt).toContain("gemini-3-flash-preview");
    expect(prompt).toContain("gemini-3-pro-preview");
    expect(prompt).toContain("claude-sonnet-4-6");
    expect(prompt).toContain("claude-haiku-4-5-20251001");
  });

  it("mentions dependsOn for staged research", () => {
    const prompt = buildPlanningPrompt("deep");
    expect(prompt).toContain("dependsOn");
  });
});

// ── hasUsableContent ──────────────────────────────────────────────────────

describe("hasUsableContent", () => {
  it("returns true for success with content", () => {
    expect(hasUsableContent({ questionId: "q1", status: "success", content: "data" })).toBe(true);
  });

  it("returns true for partial with content", () => {
    expect(hasUsableContent({ questionId: "q1", status: "partial", content: "partial data" })).toBe(true);
  });

  it("returns false for error", () => {
    expect(hasUsableContent({ questionId: "q1", status: "error", content: "", error: "fail" })).toBe(false);
  });

  it("returns false for success with empty content", () => {
    expect(hasUsableContent({ questionId: "q1", status: "success", content: "" })).toBe(false);
  });

  it("returns false for partial with empty content", () => {
    expect(hasUsableContent({ questionId: "q1", status: "partial", content: "" })).toBe(false);
  });
});

// ── createInitialResearchState ────────────────────────────────────────────

describe("createInitialResearchState", () => {
  it("creates state in planning phase with deep depth", () => {
    const state = createInitialResearchState("deep");
    expect(state.phase).toBe("planning");
    expect(state.depth).toBe("deep");
    expect(state.plan).toBeNull();
    expect(state.workerResults).toBeInstanceOf(Map);
    expect(state.workerResults.size).toBe(0);
    expect(state.activeWorkers).toBeInstanceOf(Set);
    expect(state.activeWorkers.size).toBe(0);
    expect(state.workerStreaming).toBeInstanceOf(Map);
    expect(state.sources).toEqual([]);
    expect(state.totalCost).toBe(0);
    expect(state.startTime).toBeLessThanOrEqual(Date.now());
  });

  it("creates state with quick depth", () => {
    const state = createInitialResearchState("quick");
    expect(state.depth).toBe("quick");
  });

  it("defaults to deep depth", () => {
    const state = createInitialResearchState();
    expect(state.depth).toBe("deep");
  });

  it("initializes follow-up collections empty", () => {
    const state = createInitialResearchState();
    expect(state.followUpQuestions).toEqual([]);
    expect(state.followUpResults).toBeInstanceOf(Map);
    expect(state.followUpResults.size).toBe(0);
    expect(state.activeFollowUps).toBeInstanceOf(Set);
    expect(state.activeFollowUps.size).toBe(0);
    expect(state.followUpStreaming).toBeInstanceOf(Map);
    expect(state.followUpStreaming.size).toBe(0);
  });
});

// ── getPlanningModel ────────────────────────────────────────────────────────

describe("getPlanningModel", () => {
  it("returns Opus for planning", () => {
    const { model, engine } = getPlanningModel();
    expect(model).toBe("claude-opus-4-6");
    expect(engine).toBe("claude");
  });
});

// ── getSynthesisModel ───────────────────────────────────────────────────────

describe("getSynthesisModel", () => {
  it("returns Sonnet for synthesis", () => {
    const { model, engine } = getSynthesisModel();
    expect(model).toBe("claude-sonnet-4-6");
    expect(engine).toBe("claude");
  });
});

// ── upgradeModel ────────────────────────────────────────────────────────────

describe("upgradeModel", () => {
  it("upgrades gemini flash to pro", () => {
    expect(upgradeModel("gemini-2.5-flash" as any)).toBe("gemini-2.5-pro");
    expect(upgradeModel("gemini-3-flash-preview" as any)).toBe("gemini-3-pro-preview");
  });

  it("upgrades gemini-3-pro to gemini-3.1-pro", () => {
    expect(upgradeModel("gemini-3-pro-preview" as any)).toBe("gemini-3.1-pro-preview");
  });

  it("upgrades haiku to sonnet", () => {
    expect(upgradeModel("claude-haiku-4-5-20251001" as any)).toBe("claude-sonnet-4-6");
  });

  it("upgrades old sonnet to new sonnet", () => {
    expect(upgradeModel("claude-sonnet-4-5-20250929" as any)).toBe("claude-sonnet-4-6");
  });

  it("returns same model when no upgrade path exists", () => {
    expect(upgradeModel("gemini-2.5-pro" as any)).toBe("gemini-2.5-pro");
    expect(upgradeModel("claude-sonnet-4-6" as any)).toBe("claude-sonnet-4-6");
    expect(upgradeModel("gemini-3.1-pro-preview" as any)).toBe("gemini-3.1-pro-preview");
  });
});

// ── classifyResearchWorkerResult ────────────────────────────────────────────

describe("classifyResearchWorkerResult", () => {
  it("classifies success from outcome", () => {
    const result = classifyResearchWorkerResult(
      { content: "data", cost: 0.05, tokens: { input: 100, output: 200, total: 300 }, duration: 2000, outcome: "success" },
      "q1", false,
    );
    expect(result.status).toBe("success");
    expect(result.content).toBe("data");
    expect(result.questionId).toBe("q1");
    expect(result.cost).toBe(0.05);
    expect(result.duration).toBe(2000);
  });

  it("classifies partial from outcome", () => {
    const result = classifyResearchWorkerResult(
      { content: "partial data", stderr: "Timeout after 180s", outcome: "partial" },
      "q1", false,
    );
    expect(result.status).toBe("partial");
    expect(result.content).toBe("partial data");
    expect(result.error).toContain("Timed out");
    expect(result.error).toContain("12");  // "12 chars preserved"
  });

  it("classifies error from outcome", () => {
    const result = classifyResearchWorkerResult(
      { content: "", stderr: "API Error\nDetails here", outcome: "error" },
      "q1", false,
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("API Error");  // first line only
    expect(result.content).toBe("");
  });

  it("classifies cancelled when aborted", () => {
    const result = classifyResearchWorkerResult(null, "q1", true);
    expect(result.status).toBe("error");
    expect(result.error).toBe("Cancelled");
  });

  it("classifies null result as error", () => {
    const result = classifyResearchWorkerResult(null, "q1", false);
    expect(result.status).toBe("error");
    expect(result.error).toContain("no output");
  });

  it("success outcome wins over abort signal", () => {
    const result = classifyResearchWorkerResult(
      { content: "got data", outcome: "success" },
      "q1", true,
    );
    expect(result.status).toBe("success");
    expect(result.content).toBe("got data");
  });

  it("error outcome wins over abort signal", () => {
    const result = classifyResearchWorkerResult(
      { content: "", stderr: "rate limited", outcome: "error" },
      "q1", true,
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("rate limited");
  });

  it("error outcome with timeout stderr classifies as error", () => {
    const result = classifyResearchWorkerResult(
      { content: "", stderr: "Timeout after 180s", outcome: "error" },
      "q1", false,
    );
    expect(result.status).toBe("error");
    expect(result.error).toBe("Timeout after 180s");
  });

  it("prepends modelName to error messages when provided", () => {
    const result = classifyResearchWorkerResult(
      { content: "", stderr: "rate limited", outcome: "error" },
      "q1", false, "gemini-2.5-pro",
    );
    expect(result.error).toBe("gemini-2.5-pro: rate limited");
  });

  it("prepends modelName to null-result error", () => {
    const result = classifyResearchWorkerResult(null, "q1", false, "gemini-2.5-pro");
    expect(result.error).toBe("gemini-2.5-pro: no output (timeout or spawn crash)");
  });

  it("does not prepend modelName to success or partial", () => {
    const success = classifyResearchWorkerResult(
      { content: "data", outcome: "success" }, "q1", false, "gemini-2.5-pro",
    );
    expect(success.status).toBe("success");
    expect(success.error).toBeUndefined();

    const partial = classifyResearchWorkerResult(
      { content: "partial", outcome: "partial" }, "q1", false, "gemini-2.5-pro",
    );
    expect(partial.status).toBe("partial");
    expect(partial.error).toContain("Timed out");
    expect(partial.error).not.toContain("gemini-2.5-pro");
  });

  it("does not prepend modelName to Cancelled error", () => {
    const result = classifyResearchWorkerResult(null, "q1", true, "gemini-2.5-pro");
    expect(result.error).toBe("Cancelled");
  });
});

// ── identifyTimedOutModels ──────────────────────────────────────────────────

describe("identifyTimedOutModels", () => {
  it("extracts model names from timeout errors", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "gemini-2.5-pro: no output (timeout 180s)" },
      { questionId: "q2", status: "success", content: "ok" },
    ];
    const timedOut = identifyTimedOutModels(results);
    expect(timedOut.has("gemini-2.5-pro")).toBe(true);
    expect(timedOut.size).toBe(1);
  });

  it("returns empty set when no timeouts", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "ok" },
      { questionId: "q2", status: "error", content: "", error: "rate limited" },
    ];
    expect(identifyTimedOutModels(results).size).toBe(0);
  });

  it("identifies multiple timed-out models", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "gemini-2.5-pro: no output (timeout)" },
      { questionId: "q2", status: "error", content: "", error: "gemini-3-pro-preview: no output (spawn crash)" },
    ];
    const timedOut = identifyTimedOutModels(results);
    expect(timedOut.has("gemini-2.5-pro")).toBe(true);
    expect(timedOut.has("gemini-3-pro-preview")).toBe(true);
    expect(timedOut.size).toBe(2);
  });

  it("deduplicates same model across results", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "gemini-2.5-pro: no output" },
      { questionId: "q2", status: "error", content: "", error: "gemini-2.5-pro: no output" },
    ];
    expect(identifyTimedOutModels(results).size).toBe(1);
  });
});

// ── replaceTimedOutModels ───────────────────────────────────────────────────

describe("replaceTimedOutModels", () => {
  const q = (id: string, model?: string): ResearchQuestion => ({
    id,
    question: `Q ${id}`,
    searchQuery: `s ${id}`,
    priority: "standard",
    ...(model ? { model: model as any } : {}),
  });

  it("replaces timed-out model with fallback", () => {
    const timedOut = new Set(["gemini-2.5-pro"]);
    const result = replaceTimedOutModels([q("f1", "gemini-2.5-pro")], timedOut);
    expect(result[0].model).toBe("gemini-2.5-flash");
  });

  it("does not replace non-timed-out models", () => {
    const timedOut = new Set(["gemini-2.5-pro"]);
    const result = replaceTimedOutModels([q("f1", "gemini-2.5-flash")], timedOut);
    expect(result[0].model).toBe("gemini-2.5-flash");
  });

  it("does not replace questions without a model", () => {
    const timedOut = new Set(["gemini-2.5-pro"]);
    const result = replaceTimedOutModels([q("f1")], timedOut);
    expect(result[0].model).toBeUndefined();
  });

  it("uses custom fallback model", () => {
    const timedOut = new Set(["gemini-2.5-pro"]);
    const result = replaceTimedOutModels(
      [q("f1", "gemini-2.5-pro")],
      timedOut,
      "claude-haiku-4-5-20251001" as any,
    );
    expect(result[0].model).toBe("claude-haiku-4-5-20251001");
  });

  it("handles empty timedOut set", () => {
    const result = replaceTimedOutModels([q("f1", "gemini-2.5-pro")], new Set());
    expect(result[0].model).toBe("gemini-2.5-pro");
  });
});

// ── buildRetryQuestions ─────────────────────────────────────────────────────

describe("buildRetryQuestions", () => {
  const q = (id: string, model?: string): ResearchQuestion => ({
    id,
    question: `Q ${id}`,
    searchQuery: `s ${id}`,
    priority: "critical",
    ...(model ? { model: model as any } : {}),
  });

  const userModel = "gemini-2.5-flash" as any;

  it("uses cross-provider fallback for 'no output' failures", () => {
    const workerResults = new Map<string, ResearchWorkerResult>([
      ["q1", { questionId: "q1", status: "error", content: "", error: "no output (timeout 180s)" }],
    ]);
    const retries = buildRetryQuestions([q("q1", "gemini-2.5-pro")], workerResults, userModel);
    expect(retries[0].model).toBe("claude-sonnet-4-6"); // cross-provider fallback
  });

  it("uses cross-provider fallback for Claude 'produced no output' failures", () => {
    const workerResults = new Map<string, ResearchWorkerResult>([
      ["q1", { questionId: "q1", status: "error", content: "", error: "claude-sonnet-4-6: CLI exited cleanly (code 0) but produced no output" }],
    ]);
    const retries = buildRetryQuestions([q("q1", "claude-sonnet-4-6")], workerResults, userModel);
    expect(retries[0].model).toBe("gemini-2.5-pro"); // cross-provider: Claude → Gemini
  });

  it("upgrades model for non-timeout errors", () => {
    const workerResults = new Map<string, ResearchWorkerResult>([
      ["q1", { questionId: "q1", status: "error", content: "", error: "API rate limited" }],
    ]);
    const retries = buildRetryQuestions([q("q1", "gemini-2.5-flash")], workerResults, userModel);
    expect(retries[0].model).toBe("gemini-2.5-pro"); // upgraded flash → pro
  });

  it("uses userModel as fallback when question has no model", () => {
    const workerResults = new Map<string, ResearchWorkerResult>([
      ["q1", { questionId: "q1", status: "error", content: "", error: "API error" }],
    ]);
    const retries = buildRetryQuestions([q("q1")], workerResults, userModel);
    expect(retries[0].model).toBe("gemini-2.5-pro"); // upgraded from userModel (flash → pro)
  });

  it("preserves question metadata in retries", () => {
    const workerResults = new Map<string, ResearchWorkerResult>([
      ["q1", { questionId: "q1", status: "error", content: "", error: "fail" }],
    ]);
    const retries = buildRetryQuestions([q("q1", "gemini-2.5-flash")], workerResults, userModel);
    expect(retries[0].id).toBe("q1");
    expect(retries[0].question).toBe("Q q1");
    expect(retries[0].searchQuery).toBe("s q1");
    expect(retries[0].priority).toBe("critical");
  });
});

// ── mergeWorkerResults ──────────────────────────────────────────────────────

describe("mergeWorkerResults", () => {
  it("original results preserved when no retries", () => {
    const original: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "data" },
    ];
    const result = mergeWorkerResults(original, []);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("data");
  });

  it("retry overwrites original when retry has usable content", () => {
    const original: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "fail" },
    ];
    const retries: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "retry data" },
    ];
    const result = mergeWorkerResults(original, retries);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("retry data");
    expect(result[0].status).toBe("success");
  });

  it("keeps original when retry also failed", () => {
    const original: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "first fail" },
    ];
    const retries: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "second fail" },
    ];
    const result = mergeWorkerResults(original, retries);
    expect(result).toHaveLength(1);
    expect(result[0].error).toBe("first fail"); // original kept
  });

  it("merges results from different questions", () => {
    const original: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "q1 data" },
      { questionId: "q2", status: "error", content: "", error: "fail" },
    ];
    const retries: ResearchWorkerResult[] = [
      { questionId: "q2", status: "success", content: "q2 retry" },
    ];
    const result = mergeWorkerResults(original, retries);
    expect(result).toHaveLength(2);
    const q1 = result.find((r) => r.questionId === "q1");
    const q2 = result.find((r) => r.questionId === "q2");
    expect(q1?.content).toBe("q1 data");
    expect(q2?.content).toBe("q2 retry");
  });

  it("partial retry overwrites original error", () => {
    const original: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "", error: "fail" },
    ];
    const retries: ResearchWorkerResult[] = [
      { questionId: "q1", status: "partial", content: "partial data" },
    ];
    const result = mergeWorkerResults(original, retries);
    expect(result[0].status).toBe("partial");
    expect(result[0].content).toBe("partial data");
  });
});

// ── buildFallbackResearchContent ────────────────────────────────────────────

describe("buildFallbackResearchContent", () => {
  it("concatenates cleaned usable results", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "result 1" },
      { questionId: "q2", status: "success", content: "result 2" },
    ];
    const fallback = buildFallbackResearchContent(results);
    expect(fallback).toContain("result 1");
    expect(fallback).toContain("result 2");
    expect(fallback).toContain("---");
  });

  it("includes partial results", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "partial", content: "partial data" },
    ];
    const fallback = buildFallbackResearchContent(results);
    expect(fallback).toBe("partial data");
  });

  it("filters out error results", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "good" },
      { questionId: "q2", status: "error", content: "", error: "fail" },
    ];
    const fallback = buildFallbackResearchContent(results);
    expect(fallback).toBe("good");
    expect(fallback).not.toContain("fail");
  });

  it("cleans Gemini redirect URLs from content", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "success", content: "data from https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc here" },
    ];
    const fallback = buildFallbackResearchContent(results);
    expect(fallback).not.toContain("vertexaisearch");
  });

  it("returns empty string when all results failed", () => {
    const results: ResearchWorkerResult[] = [
      { questionId: "q1", status: "error", content: "" },
    ];
    expect(buildFallbackResearchContent(results)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(buildFallbackResearchContent([])).toBe("");
  });
});
