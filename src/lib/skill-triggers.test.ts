import { describe, it, expect } from "vitest";
import { suggestSkill } from "./skill-triggers";
import type { Skill } from "./skills";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "test-1",
    name: "Test Skill",
    description: "A test skill",
    content: "Be a test assistant",
    enabled: false,
    builtIn: true,
    createdAt: 0,
    ...overrides,
  };
}

// The 4 built-in skills that have triggers
const allSkills: Skill[] = [
  makeSkill({ id: "skill-code-reviewer", name: "Code Reviewer" }),
  makeSkill({ id: "skill-concise", name: "Concise" }),
  makeSkill({ id: "skill-teacher", name: "Teacher" }),
  makeSkill({ id: "skill-architect", name: "Architect" }),
];

describe("suggestSkill", () => {
  it("returns null for short input", () => {
    expect(suggestSkill("review my code", allSkills, new Set())).toBeNull();
    expect(suggestSkill("hi", allSkills, new Set())).toBeNull();
    expect(suggestSkill("", allSkills, new Set())).toBeNull();
  });

  it("returns null when no skills provided", () => {
    expect(suggestSkill("please review my code for bugs and issues", [], new Set())).toBeNull();
  });

  it("suggests code reviewer for review/bug/audit keywords", () => {
    const result = suggestSkill("can you review this code for security issues", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-code-reviewer");
  });

  it("suggests code reviewer for 'check my code' pattern", () => {
    const result = suggestSkill("check my code for any potential bugs", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-code-reviewer");
  });

  it("suggests code reviewer for refactor keyword", () => {
    const result = suggestSkill("let's refactor this component to be cleaner", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-code-reviewer");
  });

  it("suggests teacher for explain/teach keywords", () => {
    const result = suggestSkill("can you explain how closures work in JavaScript", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-teacher");
  });

  it("suggests teacher for 'how does X work' pattern", () => {
    const result = suggestSkill("how does React work under the hood exactly", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-teacher");
  });

  it("suggests teacher for step-by-step pattern", () => {
    const result = suggestSkill("walk me through step-by-step how to deploy", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-teacher");
  });

  it("suggests concise for brief/tldr keywords", () => {
    const result = suggestSkill("give me a brief summary of the changes tldr", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-concise");
  });

  it("suggests concise for 'keep it short' pattern", () => {
    const result = suggestSkill("just the code please keep it short and simple", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-concise");
  });

  it("suggests architect for system design keywords", () => {
    const result = suggestSkill("how should i architect this microservice system", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-architect");
  });

  it("suggests architect for design pattern keyword", () => {
    const result = suggestSkill("what design pattern should I use for this data pipeline", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-architect");
  });

  it("suggests architect for trade-offs keyword", () => {
    const result = suggestSkill("what are the trade-offs of using a monolith vs microservices", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-architect");
  });

  // ── Priority ────────────────────────────────────────────────────────────

  it("code reviewer wins over teacher when both match (higher priority)", () => {
    // "review" triggers code-reviewer (priority 3), "explain" triggers teacher (priority 2)
    const result = suggestSkill("can you review and explain the security audit results", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-code-reviewer");
  });

  it("teacher wins over concise when both match (higher priority)", () => {
    // "explain" triggers teacher (priority 2), "brief" triggers concise (priority 1)
    const result = suggestSkill("explain this concept briefly, keep it concise", allSkills, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-teacher");
  });

  // ── Dismissal & enabled state ─────────────────────────────────────────

  it("skips dismissed skills", () => {
    const dismissed = new Set(["skill-code-reviewer"]);
    const result = suggestSkill("can you review this code for any issues", allSkills, dismissed);
    // Code reviewer is dismissed, should not be suggested
    expect(result?.id).not.toBe("skill-code-reviewer");
  });

  it("skips already-enabled skills", () => {
    const skills = allSkills.map((s) =>
      s.id === "skill-code-reviewer" ? { ...s, enabled: true } : s
    );
    const result = suggestSkill("can you review this code for any issues", skills, new Set());
    // Code reviewer is enabled, should not be suggested
    expect(result?.id).not.toBe("skill-code-reviewer");
  });

  it("falls to next-priority when top match is dismissed", () => {
    // "review" + "explain" → code-reviewer dismissed → teacher wins
    const dismissed = new Set(["skill-code-reviewer"]);
    const result = suggestSkill("review and explain these security audit findings", allSkills, dismissed);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("skill-teacher");
  });

  it("returns null when all matching skills are dismissed", () => {
    const dismissed = new Set(["skill-code-reviewer", "skill-teacher", "skill-concise", "skill-architect"]);
    const result = suggestSkill("please review this code and explain the bugs", allSkills, dismissed);
    expect(result).toBeNull();
  });

  // ── No false positives ──────────────────────────────────────────────────

  it("does not trigger on unrelated long messages", () => {
    const result = suggestSkill("I need to deploy my application to production using Docker containers", allSkills, new Set());
    expect(result).toBeNull();
  });
});
