import { describe, it, expect } from "vitest";
import { generateTitle } from "./sessions";
import type { ChatMessage } from "./claude-protocol";

function msg(role: "user" | "assistant", content: string): ChatMessage {
  return { id: "1", role, content, timestamp: Date.now() };
}

describe("generateTitle", () => {
  it("returns 'New Chat' for empty messages", () => {
    expect(generateTitle([])).toBe("New Chat");
  });

  it("returns 'New Chat' when no user message exists", () => {
    expect(generateTitle([msg("assistant", "Hello!")])).toBe("New Chat");
  });

  it("returns full text for short messages", () => {
    expect(generateTitle([msg("user", "Hi there")])).toBe("Hi there");
  });

  it("returns full text for exactly 40 chars", () => {
    const text = "a".repeat(40);
    expect(generateTitle([msg("user", text)])).toBe(text);
  });

  it("truncates long messages to 37 chars + ellipsis", () => {
    const text = "a".repeat(50);
    const result = generateTitle([msg("user", text)]);
    expect(result).toBe("a".repeat(37) + "...");
    expect(result.length).toBe(40);
  });

  it("uses first user message, not assistant", () => {
    const messages: ChatMessage[] = [
      msg("assistant", "Welcome! How can I help?"),
      msg("user", "Tell me about TypeScript"),
    ];
    expect(generateTitle(messages)).toBe("Tell me about TypeScript");
  });

  it("trims whitespace before measuring", () => {
    expect(generateTitle([msg("user", "  hello  ")])).toBe("hello");
  });
});
