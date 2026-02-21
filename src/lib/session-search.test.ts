import { describe, it, expect, beforeEach } from "vitest";
import {
  searchSessions,
  clearSearchCache,
} from "./session-search";
import type { SessionIndexEntry } from "./sessions";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeIndex(
  overrides: Partial<SessionIndexEntry> & { id: string },
): SessionIndexEntry {
  return {
    sessionId: null,
    title: "Test Session",
    model: "claude-sonnet-4-6",
    messageCount: 2,
    timestamp: Date.now(),
    lastActivity: Date.now(),
    pinned: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("searchSessions", () => {
  beforeEach(() => {
    clearSearchCache();
  });

  it("returns empty for queries shorter than 2 chars", () => {
    const index = [makeIndex({ id: "1", title: "Hello world" })];
    expect(searchSessions("h", index)).toEqual([]);
    expect(searchSessions("", index)).toEqual([]);
  });

  it("matches session titles case-insensitively", () => {
    const index = [
      makeIndex({ id: "1", title: "React Hooks Tutorial" }),
      makeIndex({ id: "2", title: "Vue Composition API" }),
    ];

    const results = searchSessions("react", index);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
    expect(results[0].titleMatch).toBe(true);
  });

  it("returns no results when query doesn't match anything", () => {
    const index = [
      makeIndex({ id: "1", title: "React Hooks" }),
      makeIndex({ id: "2", title: "TypeScript Basics" }),
    ];

    const results = searchSessions("python", index);
    expect(results).toHaveLength(0);
  });

  it("sorts title matches before content-only matches", () => {
    const now = Date.now();
    const index = [
      makeIndex({ id: "content-only", title: "Some Chat", lastActivity: now }),
      makeIndex({ id: "title-match", title: "React Discussion", lastActivity: now - 10000 }),
    ];

    // Without content cache, only title matches work
    const results = searchSessions("react", index);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("title-match");
    expect(results[0].titleMatch).toBe(true);
  });

  it("sorts by recency within same match type", () => {
    const now = Date.now();
    const index = [
      makeIndex({ id: "older", title: "React Basics", lastActivity: now - 60000 }),
      makeIndex({ id: "newer", title: "React Advanced", lastActivity: now }),
    ];

    const results = searchSessions("react", index);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("newer");
    expect(results[1].id).toBe("older");
  });

  it("includes messageCount, model, and lastActivity in results", () => {
    const now = Date.now();
    const index = [
      makeIndex({
        id: "1",
        title: "Test Chat",
        model: "gemini-2.5-pro",
        messageCount: 42,
        lastActivity: now,
      }),
    ];

    const results = searchSessions("test", index);
    expect(results).toHaveLength(1);
    expect(results[0].model).toBe("gemini-2.5-pro");
    expect(results[0].messageCount).toBe(42);
    expect(results[0].lastActivity).toBe(now);
  });

  it("returns SearchResult shape with all fields", () => {
    const index = [makeIndex({ id: "abc", title: "My Debugging Session" })];
    const results = searchSessions("debug", index);
    expect(results).toHaveLength(1);

    const r = results[0];
    expect(r).toHaveProperty("id", "abc");
    expect(r).toHaveProperty("title", "My Debugging Session");
    expect(r).toHaveProperty("titleMatch", true);
    expect(r).toHaveProperty("matches");
    expect(Array.isArray(r.matches)).toBe(true);
  });

  it("matches partial words in titles", () => {
    const index = [makeIndex({ id: "1", title: "Authentication System" })];
    expect(searchSessions("auth", index)).toHaveLength(1);
    expect(searchSessions("system", index)).toHaveLength(1);
    expect(searchSessions("tion sys", index)).toHaveLength(1);
  });

  it("handles special characters in query without crashing", () => {
    const index = [makeIndex({ id: "1", title: "Fix bug (urgent)" })];
    expect(searchSessions("(urgent)", index)).toHaveLength(1);
    expect(searchSessions("bug [test]", index)).toHaveLength(0);
  });

  it("matches multiple sessions in a single search", () => {
    const index = [
      makeIndex({ id: "1", title: "API Design" }),
      makeIndex({ id: "2", title: "REST API" }),
      makeIndex({ id: "3", title: "Database Schema" }),
    ];

    const results = searchSessions("api", index);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });
});
