import { readMemoryFile, writeMemoryFile, deleteMemoryFile } from "./memory";
import { extractJSON } from "./json-utils";

// ── Goal Tracking ────────────────────────────────────────────────────────────
// Persistent goals that span multiple sessions. Canonical data in goals.json;
// each save also syncs individual Obsidian-compatible .md files with YAML
// frontmatter + a goals/index.md with wiki-links for vault browsing.

export interface Goal {
  id: string;
  name: string;
  description: string;
  status: "active" | "completed" | "archived";
  /** 0–100 progress percentage (user-managed) */
  progress: number;
  createdAt: number;
  completedAt?: number;
  tags: string[];
}

const GOALS_FILE = "goals.json";

/** Load all goals from disk. Returns empty array if file doesn't exist. */
export async function loadGoals(): Promise<Goal[]> {
  try {
    const raw = await readMemoryFile(GOALS_FILE);
    const parsed = extractJSON(raw);
    if (Array.isArray(parsed)) return parsed as Goal[];
    return [];
  } catch {
    return [];
  }
}

/** Save all goals to disk (overwrites) and sync Obsidian markdown files. */
export async function saveGoals(goals: Goal[]): Promise<void> {
  await writeMemoryFile(GOALS_FILE, JSON.stringify(goals, null, 2));
  // Fire-and-forget: sync individual .md files for Obsidian browsing
  syncGoalsToObsidian(goals).catch(() => {});
}

/** Create a new goal and persist. Returns the updated list. */
export async function createGoal(
  goals: Goal[],
  name: string,
  description = "",
  tags: string[] = [],
): Promise<Goal[]> {
  const goal: Goal = {
    id: crypto.randomUUID(),
    name: name.trim(),
    description: description.trim(),
    status: "active",
    progress: 0,
    createdAt: Date.now(),
    tags,
  };
  const updated = [goal, ...goals];
  await saveGoals(updated);
  return updated;
}

/** Update an existing goal and persist. Returns the updated list. */
export async function updateGoal(
  goals: Goal[],
  id: string,
  changes: Partial<Pick<Goal, "name" | "description" | "status" | "progress" | "tags">>,
): Promise<Goal[]> {
  const original = goals.find((g) => g.id === id);
  const updated = goals.map((g) => {
    if (g.id !== id) return g;
    const merged = { ...g, ...changes };
    // Auto-set completedAt when marked complete
    if (changes.status === "completed" && !g.completedAt) {
      merged.completedAt = Date.now();
    }
    // Clear completedAt if reopened
    if (changes.status === "active") {
      merged.completedAt = undefined;
    }
    return merged;
  });
  await saveGoals(updated);
  // If name changed, clean up old Obsidian file (new slug file created by sync)
  if (original && changes.name && changes.name !== original.name) {
    deleteMemoryFile(`goals/${slugify(original.name)}.md`).catch(() => {});
  }
  return updated;
}

/** Delete a goal and persist. Removes the Obsidian .md file too. */
export async function deleteGoal(goals: Goal[], id: string): Promise<Goal[]> {
  const removed = goals.find((g) => g.id === id);
  const updated = goals.filter((g) => g.id !== id);
  await saveGoals(updated);
  // Clean up the orphaned Obsidian markdown file
  if (removed) {
    deleteMemoryFile(`goals/${slugify(removed.name)}.md`).catch(() => {});
  }
  return updated;
}

// ── Obsidian Sync ────────────────────────────────────────────────────────────

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return slug || "untitled";
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Convert a goal to an Obsidian-compatible markdown note with YAML frontmatter. */
function goalToMarkdown(goal: Goal): string {
  const created = formatDate(goal.createdAt);
  const lines = [
    "---",
    `title: "${goal.name.replace(/"/g, '\\"')}"`,
    `status: ${goal.status}`,
    `progress: ${goal.progress}`,
    `created: ${created}`,
  ];
  if (goal.completedAt) lines.push(`completed: ${formatDate(goal.completedAt)}`);
  if (goal.tags.length > 0) lines.push(`tags: [${goal.tags.join(", ")}]`);
  lines.push("type: goal", "source: thunderclaude", "---", "");

  lines.push(`# ${goal.name}`, "");

  if (goal.status === "active" && goal.progress > 0) {
    lines.push(`**Progress**: ${goal.progress}%`, "");
  }
  if (goal.description) {
    lines.push(goal.description, "");
  }
  if (goal.completedAt) {
    const dateStr = new Date(goal.completedAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    lines.push(`*Completed ${dateStr}*`, "");
  }

  return lines.join("\n");
}

/** Build an Obsidian index page with wiki-links to all goals. */
function buildGoalIndex(goals: Goal[]): string {
  const active = goals.filter((g) => g.status === "active");
  const completed = goals.filter(
    (g) => g.status === "completed" || g.status === "archived",
  );

  const lines = [
    "---",
    "type: goal-index",
    "source: thunderclaude",
    "---",
    "",
    "# Goals",
    "",
  ];

  if (active.length > 0) {
    lines.push("## Active", "");
    for (const g of active) {
      const slug = slugify(g.name);
      const pct = g.progress > 0 ? ` (${g.progress}%)` : "";
      const desc = g.description ? ` — ${g.description.slice(0, 80)}` : "";
      lines.push(`- [[${slug}|${g.name}]]${pct}${desc}`);
    }
    lines.push("");
  }

  if (completed.length > 0) {
    lines.push("## Completed", "");
    for (const g of completed) {
      const slug = slugify(g.name);
      lines.push(`- ~~[[${slug}|${g.name}]]~~`);
    }
    lines.push("");
  }

  if (goals.length === 0) {
    lines.push("*No goals yet. Create one in ThunderClaude.*", "");
  }

  return lines.join("\n");
}

/**
 * Sync all goals to individual Obsidian markdown files + index page.
 * Writes to goals/ subdirectory in the memory dir (resolves to vault when configured).
 */
async function syncGoalsToObsidian(goals: Goal[]): Promise<void> {
  const writes = goals.map((goal) => {
    const slug = slugify(goal.name);
    return writeMemoryFile(`goals/${slug}.md`, goalToMarkdown(goal)).catch(() => {});
  });
  writes.push(
    writeMemoryFile("goals/index.md", buildGoalIndex(goals)).catch(() => {}),
  );
  await Promise.all(writes);
}

/**
 * Build a concise goal context string for system prompt injection.
 * Only includes active goals. Returns null if no active goals exist.
 */
export function buildGoalContext(goals: Goal[]): string | null {
  const active = goals.filter((g) => g.status === "active");
  if (active.length === 0) return null;

  const lines = active.map((g) => {
    const pct = g.progress > 0 ? ` (${g.progress}%)` : "";
    const desc = g.description ? ` — ${g.description.slice(0, 150)}` : "";
    return `- ${g.name}${pct}${desc}`;
  });

  return `## Active Goals\nThe user is working on these ongoing goals. Provide help that advances them when relevant.\n\n${lines.join("\n")}`;
}
