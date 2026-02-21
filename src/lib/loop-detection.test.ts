import { describe, it, expect } from "vitest";
import { detectLoop } from "./loop-detection";
import type { ToolCallInfo } from "./claude-protocol";

function tc(
  name: string,
  input: Record<string, unknown> = {},
  result?: string,
  isRunning = false,
): ToolCallInfo {
  return { id: crypto.randomUUID(), name, input, result, isRunning };
}

describe("detectLoop", () => {
  it("returns null for fewer than 3 completed tool calls", () => {
    expect(detectLoop([])).toBeNull();
    expect(detectLoop([tc("read")])).toBeNull();
    expect(detectLoop([tc("read"), tc("read")])).toBeNull();
  });

  it("returns null when still-running calls bring count below threshold", () => {
    const calls = [
      tc("read", { path: "a.ts" }),
      tc("read", { path: "a.ts" }),
      tc("read", { path: "a.ts" }, undefined, true), // still running
    ];
    expect(detectLoop(calls)).toBeNull();
  });

  // ── Pattern 1: Same tool + identical inputs ──────────────────────────

  it("detects 3 identical tool calls", () => {
    const calls = [
      tc("Bash", { command: "npm test" }),
      tc("Bash", { command: "npm test" }),
      tc("Bash", { command: "npm test" }),
    ];
    const result = detectLoop(calls);
    expect(result).not.toBeNull();
    expect(result!.pattern).toContain("Bash");
    expect(result!.pattern).toContain("identical arguments");
    expect(result!.count).toBe(3);
  });

  it("detects identical calls even with other calls before them", () => {
    const calls = [
      tc("read", { path: "foo.ts" }),
      tc("write", { path: "bar.ts" }),
      tc("Bash", { command: "npm test" }),
      tc("Bash", { command: "npm test" }),
      tc("Bash", { command: "npm test" }),
    ];
    const result = detectLoop(calls);
    expect(result).not.toBeNull();
    expect(result!.pattern).toContain("Bash");
  });

  it("does NOT detect same tool with different inputs", () => {
    const calls = [
      tc("read", { path: "a.ts" }),
      tc("read", { path: "b.ts" }),
      tc("read", { path: "c.ts" }),
    ];
    expect(detectLoop(calls)).toBeNull();
  });

  it("does NOT detect different tools", () => {
    const calls = [
      tc("read", { path: "a.ts" }),
      tc("write", { path: "a.ts" }),
      tc("read", { path: "a.ts" }),
    ];
    expect(detectLoop(calls)).toBeNull();
  });

  // ── Pattern 2: Same tool + error results ─────────────────────────────

  it("detects 3 error results from same tool", () => {
    const calls = [
      tc("Bash", { command: "build" }, "Error: compilation failed"),
      tc("Bash", { command: "build --fix" }, "Error: still broken"),
      tc("Bash", { command: "build --clean" }, "FAILED with exit code 1"),
    ];
    const result = detectLoop(calls);
    expect(result).not.toBeNull();
    expect(result!.pattern).toContain("failing repeatedly");
  });

  it("detects errors with various keywords", () => {
    const keywords = ["not found", "denied", "permission", "ENOENT"];
    for (const kw of keywords) {
      const calls = [
        tc("Bash", { command: "a" }, `file ${kw}`),
        tc("Bash", { command: "b" }, `path ${kw}`),
        tc("Bash", { command: "c" }, `resource ${kw}`),
      ];
      expect(detectLoop(calls)).not.toBeNull();
    }
  });

  it("does NOT detect if results don't contain error keywords", () => {
    const calls = [
      tc("Bash", { command: "a" }, "success"),
      tc("Bash", { command: "b" }, "ok"),
      tc("Bash", { command: "c" }, "done"),
    ];
    expect(detectLoop(calls)).toBeNull();
  });

  it("does NOT detect if one result is successful among errors", () => {
    const calls = [
      tc("Bash", { command: "a" }, "Error: failed"),
      tc("Bash", { command: "b" }, "all good"),
      tc("Bash", { command: "c" }, "Error: failed again"),
    ];
    expect(detectLoop(calls)).toBeNull();
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it("ignores running calls when checking the tail", () => {
    const calls = [
      tc("Bash", { command: "npm test" }),
      tc("Bash", { command: "npm test" }),
      tc("Bash", { command: "npm test" }),
      tc("Bash", { command: "npm test" }, undefined, true), // running
    ];
    // 3 completed identical calls → detected
    const result = detectLoop(calls);
    expect(result).not.toBeNull();
  });

  it("identical calls with empty inputs are detected", () => {
    const calls = [tc("read"), tc("read"), tc("read")];
    const result = detectLoop(calls);
    expect(result).not.toBeNull();
  });

  it("handles calls with no result field for error pattern", () => {
    const calls = [
      tc("Bash", { command: "a" }),
      tc("Bash", { command: "b" }),
      tc("Bash", { command: "c" }),
    ];
    // No results → error pattern shouldn't match
    expect(detectLoop(calls)).toBeNull();
  });
});
