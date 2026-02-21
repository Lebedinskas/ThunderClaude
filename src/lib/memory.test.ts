import { describe, it, expect } from "vitest";
import { softTrimMessages } from "./memory";
import type { ChatMessage } from "./claude-protocol";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: "assistant",
    content: "response",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeToolResult(chars: number): string {
  return "x".repeat(chars);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("softTrimMessages", () => {
  it("returns unchanged messages when fewer than keepRecent", () => {
    const msgs = [
      makeMsg({ id: "1", role: "user", content: "hi" }),
      makeMsg({ id: "2", toolCalls: [{ id: "t1", name: "Read", input: {}, result: makeToolResult(500), isRunning: false }] }),
    ];
    const { messages, trimmedCount, charsSaved } = softTrimMessages(msgs, 8);
    expect(trimmedCount).toBe(0);
    expect(charsSaved).toBe(0);
    expect(messages).toBe(msgs); // same reference
  });

  it("trims tool results from older messages", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 12; i++) {
      if (i % 2 === 0) {
        msgs.push(makeMsg({ id: `u${i}`, role: "user", content: `question ${i}` }));
      } else {
        msgs.push(makeMsg({
          id: `a${i}`,
          toolCalls: [{ id: `t${i}`, name: "Read", input: {}, result: makeToolResult(1000), isRunning: false }],
        }));
      }
    }

    const { messages, trimmedCount, charsSaved } = softTrimMessages(msgs, 4);
    expect(trimmedCount).toBeGreaterThan(0);
    expect(charsSaved).toBeGreaterThan(0);

    // Recent messages (last 4) should be untouched
    const recent = messages.slice(-4);
    recent.forEach((m) => {
      if (m.toolCalls) {
        m.toolCalls.forEach((tc) => {
          if (tc.result) expect(tc.result).not.toContain("[trimmed");
        });
      }
    });

    // Older messages should have trimmed results
    const older = messages.slice(0, -4);
    const trimmed = older.filter((m) =>
      m.toolCalls?.some((tc) => tc.result?.includes("[trimmed"))
    );
    expect(trimmed.length).toBeGreaterThan(0);
  });

  it("skips tool results shorter than 100 chars", () => {
    const msgs = [
      makeMsg({ id: "1", role: "user", content: "q" }),
      makeMsg({
        id: "2",
        toolCalls: [{ id: "t1", name: "Read", input: {}, result: "short result", isRunning: false }],
      }),
      // 8 more messages to push index 1 into "old" territory
      ...Array.from({ length: 8 }, (_, i) =>
        makeMsg({ id: `pad${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` })
      ),
    ];

    const { trimmedCount } = softTrimMessages(msgs, 8);
    expect(trimmedCount).toBe(0); // short result not trimmed
  });

  it("does not mutate original messages", () => {
    const originalResult = makeToolResult(500);
    const msgs = [
      makeMsg({ id: "1", role: "user", content: "q" }),
      makeMsg({
        id: "2",
        toolCalls: [{ id: "t1", name: "Read", input: {}, result: originalResult, isRunning: false }],
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeMsg({ id: `pad${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` })
      ),
    ];

    softTrimMessages(msgs, 8);
    // Original message's tool result should be untouched
    expect(msgs[1].toolCalls![0].result).toBe(originalResult);
  });

  it("reports accurate charsSaved", () => {
    const resultSize = 2000;
    const msgs = [
      makeMsg({ id: "1", role: "user", content: "q" }),
      makeMsg({
        id: "2",
        toolCalls: [
          { id: "t1", name: "Read", input: {}, result: makeToolResult(resultSize), isRunning: false },
          { id: "t2", name: "Bash", input: {}, result: makeToolResult(resultSize), isRunning: false },
        ],
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeMsg({ id: `pad${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` })
      ),
    ];

    const { charsSaved, trimmedCount } = softTrimMessages(msgs, 8);
    expect(trimmedCount).toBe(2);
    expect(charsSaved).toBe(resultSize * 2);
  });

  it("handles messages without toolCalls gracefully", () => {
    const msgs = Array.from({ length: 12 }, (_, i) =>
      makeMsg({ id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` })
    );

    const { messages, trimmedCount } = softTrimMessages(msgs, 4);
    expect(trimmedCount).toBe(0);
    expect(messages).toEqual(msgs);
  });

  it("default keepRecent is 8", () => {
    const msgs: ChatMessage[] = [];
    // 10 messages total — 2 old, 8 recent
    for (let i = 0; i < 10; i++) {
      msgs.push(makeMsg({
        id: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
        toolCalls: i === 1 ? [{ id: "t1", name: "Read", input: {}, result: makeToolResult(500), isRunning: false }] : undefined,
      }));
    }

    // With default keepRecent=8, index 1 (the one with tool results) is in the old zone
    const { trimmedCount } = softTrimMessages(msgs);
    expect(trimmedCount).toBe(1);
  });
});
