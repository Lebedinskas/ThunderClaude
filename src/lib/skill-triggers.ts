import type { Skill } from "./skills";

// ── Skill Auto-Suggestion Engine ─────────────────────────────────────────────
// Maps user message patterns to relevant skills. Shows suggestion chips for
// disabled skills that match the current input — user clicks to enable.
// Only built-in skills have triggers; custom skills require manual toggle.

interface CompiledTrigger {
  skillId: string;
  /** Pre-compiled matchers — ANY match triggers the suggestion. */
  matchers: RegExp[];
  /** Higher priority wins when multiple skills match. */
  priority: number;
}

// Pre-compiled at module load — no runtime regex construction per keystroke.
const TRIGGERS: CompiledTrigger[] = [
  {
    skillId: "skill-code-reviewer",
    matchers: [
      /\breview\b/i,
      /\bbugs?\b/i,
      /\bsecurity\b/i,
      /\bvulnerab/i,
      /\baudit\b/i,
      /\brefactor/i,
      /\blint/i,
      /code\s+smell/i,
      /check\s+(my|this|the)\s+code/i,
      /find\s+(bugs?|issues?|problems?)/i,
    ],
    priority: 3,
  },
  {
    skillId: "skill-concise",
    matchers: [
      /\bbrief(ly)?\b/i,
      /\btldr\b/i,
      /\bconcise/i,
      /short\s+answer/i,
      /keep\s+it\s+short/i,
      /in\s+a\s+nutshell/i,
      /quick\s+answer/i,
      /one[- ]?liner/i,
      /\bjust\s+the\s+(code|answer)/i,
    ],
    priority: 1,
  },
  {
    skillId: "skill-teacher",
    matchers: [
      /\bexplain\b/i,
      /\bteach\b/i,
      /\btutorial\b/i,
      /\bbeginner\b/i,
      /\blearn\b/i,
      /how\s+does?\s+\w+\s+work/i,
      /what\s+is\s+(a|an|the)\s+/i,
      /explain\s+(like|to|it)\s+/i,
      /step[- ]by[- ]step/i,
      /walk\s+me\s+through/i,
    ],
    priority: 2,
  },
  {
    skillId: "skill-architect",
    matchers: [
      /\barchitect/i,
      /\bscalab/i,
      /\bmicroservice/i,
      /\bmonolith/i,
      /\binfrastructure\b/i,
      /system\s+design/i,
      /design\s+pattern/i,
      /how\s+should\s+i\s+(structure|architect|design)/i,
      /database\s+design/i,
      /trade[- ]?offs?\b/i,
    ],
    priority: 2,
  },
];

/** Minimum input length before suggestions trigger. */
const MIN_INPUT_LENGTH = 15;

/**
 * Find the highest-priority disabled skill that matches the user's input.
 * Returns null if no match or input is too short.
 */
export function suggestSkill(
  message: string,
  skills: Skill[],
  dismissedIds: Set<string>,
): Skill | null {
  if (message.length < MIN_INPUT_LENGTH) return null;

  let best: { skill: Skill; priority: number } | null = null;

  for (const trigger of TRIGGERS) {
    const skill = skills.find((s) => s.id === trigger.skillId);
    if (!skill || skill.enabled || dismissedIds.has(skill.id)) continue;

    const matches = trigger.matchers.some((m) => m.test(message));
    if (matches && (!best || trigger.priority > best.priority)) {
      best = { skill, priority: trigger.priority };
    }
  }

  return best?.skill ?? null;
}
