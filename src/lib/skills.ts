import { STORAGE_KEYS } from "./constants";

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string; // The actual system prompt instructions
  enabled: boolean;
  builtIn: boolean; // true = shipped with app, can't delete
  createdAt: number;
}


export const EXAMPLE_SKILLS: Skill[] = [
  {
    id: "skill-code-reviewer",
    name: "Code Reviewer",
    description:
      "Reviews code for bugs, security issues, and best practices. Suggests improvements with clear reasoning.",
    content: `You are an expert code reviewer. When reviewing code:
- Check for bugs, edge cases, and potential runtime errors
- Identify security vulnerabilities (injection, XSS, auth issues)
- Suggest performance improvements with benchmarks when relevant
- Flag code style inconsistencies
- Be specific: reference line numbers, suggest exact fixes
- Rate severity: critical / warning / suggestion`,
    enabled: false,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: "skill-concise",
    name: "Concise Mode",
    description:
      "Short, direct answers. No fluff, no unnecessary explanations.",
    content: `Be extremely concise. Give the shortest correct answer possible.
- No preamble or pleasantries
- Code-only responses when a code answer suffices
- Use bullet points, not paragraphs
- Skip explanations unless asked
- If the answer is a single line, give a single line`,
    enabled: false,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: "skill-teacher",
    name: "Teaching Mode",
    description:
      "Explains concepts step-by-step with examples. Great for learning.",
    content: `You are a patient, expert teacher. When explaining:
- Start with a one-sentence summary
- Break complex topics into numbered steps
- Use concrete examples and analogies
- Show before/after code when relevant
- End with a "Key takeaway" summary
- Ask if the user wants to go deeper on any point`,
    enabled: false,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: "skill-architect",
    name: "System Architect",
    description:
      "Think about design patterns, scalability, and system architecture before writing code.",
    content: `Before writing any code, think like a system architect:
- Consider the trade-offs of different approaches
- Think about scalability, maintainability, and testability
- Suggest the simplest solution that meets requirements
- Identify potential failure modes
- Consider backward compatibility
- Propose a clear file/module structure
- When relevant, draw ASCII diagrams of the architecture`,
    enabled: false,
    builtIn: true,
    createdAt: 0,
  },
];

export function loadSkills(): Skill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SKILLS);
    if (!raw) {
      // First run: save example skills
      localStorage.setItem(STORAGE_KEYS.SKILLS, JSON.stringify(EXAMPLE_SKILLS));
      return EXAMPLE_SKILLS;
    }
    const saved: Skill[] = JSON.parse(raw);

    // Merge: ensure all built-in skills exist (user may have older version)
    const savedIds = new Set(saved.map((s) => s.id));
    const merged = [...saved];
    for (const example of EXAMPLE_SKILLS) {
      if (!savedIds.has(example.id)) {
        merged.push(example);
      }
    }
    return merged;
  } catch {
    return EXAMPLE_SKILLS;
  }
}

export function saveSkills(skills: Skill[]): void {
  localStorage.setItem(STORAGE_KEYS.SKILLS, JSON.stringify(skills));
}

export function createSkill(
  name: string,
  description: string,
  content: string
): Skill {
  return {
    id: `skill-${crypto.randomUUID()}`,
    name,
    description,
    content,
    enabled: false,
    builtIn: false,
    createdAt: Date.now(),
  };
}

export function buildSystemPrompt(skills: Skill[]): string | null {
  const active = skills.filter((s) => s.enabled);
  if (active.length === 0) return null;

  const parts = active.map(
    (s) => `## ${s.name}\n${s.content}`
  );
  return parts.join("\n\n");
}
