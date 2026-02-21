/**
 * Robust JSON extraction from LLM output — handles markdown fences,
 * preamble text, and other common LLM formatting artifacts.
 */
export function extractJSON(raw: string): unknown | null {
  let cleaned = raw.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Attempt 1: Direct parse
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  // Attempt 2: Extract first JSON object
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch { /* fall through */ }
  }

  // Attempt 3: Truncated JSON recovery — find last complete task object
  if (start !== -1) {
    const truncated = cleaned.slice(start);
    const recovered = recoverTruncatedPlanJSON(truncated);
    if (recovered) return recovered;
  }

  return null;
}

/**
 * Attempt to recover a truncated Commander plan JSON.
 * Finds the last complete task object in the tasks array and closes the structure.
 * Returns null if recovery is not possible.
 */
export function recoverTruncatedPlanJSON(truncated: string): unknown | null {
  // Must have "tasks" array to be a plan
  const tasksIdx = truncated.indexOf('"tasks"');
  if (tasksIdx === -1) return null;

  // Find the opening bracket of the tasks array
  const arrayStart = truncated.indexOf("[", tasksIdx);
  if (arrayStart === -1) return null;

  // Find all complete task objects by tracking braces within the array
  let lastCompleteTaskEnd = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = arrayStart + 1; i < truncated.length; i++) {
    const ch = truncated[i];

    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        lastCompleteTaskEnd = i;
      }
    }
  }

  if (lastCompleteTaskEnd === -1) return null;

  // Extract everything up to the reasoning + tasks array with last complete task
  const reasoningAndTasks = truncated.slice(0, lastCompleteTaskEnd + 1);

  // Close the structure: ] for tasks array, } for root object
  // Also try to salvage synthesisHint if present before truncation
  const repaired = reasoningAndTasks + '], "synthesisHint": "Merge all results into a coherent response." }';

  try {
    const parsed = JSON.parse(repaired);
    console.warn(`[JSON Recovery] Salvaged truncated plan — recovered ${parsed.tasks?.length ?? 0} complete tasks`);
    return parsed;
  } catch {
    return null;
  }
}
