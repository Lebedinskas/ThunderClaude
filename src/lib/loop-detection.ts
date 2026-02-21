import type { ToolCallInfo } from "./claude-protocol";

export interface LoopDetection {
  pattern: string;
  count: number;
}

const REPEAT_THRESHOLD = 3;
const ERROR_KEYWORDS = /error|failed|not found|denied|permission|ENOENT/i;

/**
 * Detect repetitive tool call patterns within a single assistant response.
 * Returns a detection result if a loop is found, null otherwise.
 *
 * Patterns detected:
 * 1. Same tool called 3+ times with identical inputs
 * 2. Same tool called 3+ times with all results containing errors
 */
export function detectLoop(toolCalls: ToolCallInfo[]): LoopDetection | null {
  const completed = toolCalls.filter((tc) => !tc.isRunning);
  if (completed.length < REPEAT_THRESHOLD) return null;

  const recent = completed.slice(-REPEAT_THRESHOLD);
  const firstName = recent[0].name;

  // All recent calls must be to the same tool
  if (!recent.every((tc) => tc.name === firstName)) return null;

  // Pattern 1: Same tool + identical inputs
  const firstInput = JSON.stringify(recent[0].input);
  if (recent.every((tc) => JSON.stringify(tc.input) === firstInput)) {
    return {
      pattern: `${firstName} called ${REPEAT_THRESHOLD}x with identical arguments`,
      count: REPEAT_THRESHOLD,
    };
  }

  // Pattern 2: Same tool + all results contain errors
  if (recent.every((tc) => tc.result && ERROR_KEYWORDS.test(tc.result))) {
    return {
      pattern: `${firstName} failing repeatedly`,
      count: REPEAT_THRESHOLD,
    };
  }

  return null;
}
