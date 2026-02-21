import { describe, it, expect } from "vitest";
import { buildSystemPrompt, createSkill, type Skill } from "./skills";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "test-1",
    name: "Test Skill",
    description: "A test skill",
    content: "Be a test assistant",
    enabled: false,
    builtIn: false,
    createdAt: 0,
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("returns null when no skills are enabled", () => {
    expect(buildSystemPrompt([])).toBeNull();
    expect(buildSystemPrompt([makeSkill({ enabled: false })])).toBeNull();
  });

  it("returns prompt for single enabled skill", () => {
    const skill = makeSkill({ name: "Coder", content: "Write code.", enabled: true });
    const result = buildSystemPrompt([skill]);
    expect(result).toBe("## Coder\nWrite code.");
  });

  it("joins multiple enabled skills with double newline", () => {
    const skills = [
      makeSkill({ id: "1", name: "A", content: "Skill A", enabled: true }),
      makeSkill({ id: "2", name: "B", content: "Skill B", enabled: false }),
      makeSkill({ id: "3", name: "C", content: "Skill C", enabled: true }),
    ];
    const result = buildSystemPrompt(skills);
    expect(result).toBe("## A\nSkill A\n\n## C\nSkill C");
  });

  it("ignores disabled skills in the output", () => {
    const skills = [
      makeSkill({ id: "1", name: "Active", content: "yes", enabled: true }),
      makeSkill({ id: "2", name: "Inactive", content: "no", enabled: false }),
    ];
    const result = buildSystemPrompt(skills)!;
    expect(result).toContain("Active");
    expect(result).not.toContain("Inactive");
  });
});

describe("createSkill", () => {
  it("creates a skill with correct fields", () => {
    const skill = createSkill("My Skill", "Does things", "Be helpful");
    expect(skill.name).toBe("My Skill");
    expect(skill.description).toBe("Does things");
    expect(skill.content).toBe("Be helpful");
    expect(skill.enabled).toBe(false);
    expect(skill.builtIn).toBe(false);
    expect(skill.id).toMatch(/^skill-/);
    expect(skill.createdAt).toBeGreaterThan(0);
  });

  it("generates unique IDs", () => {
    const a = createSkill("A", "", "");
    const b = createSkill("B", "", "");
    expect(a.id).not.toBe(b.id);
  });
});
