import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatMessage } from "./claude-protocol";

// Mock DOM APIs used by exportConversation
let lastBlobContent = "";
const mockRevoke = vi.fn();
const mockClick = vi.fn();
let mockAnchor: { href: string; download: string; click: typeof mockClick };

beforeEach(() => {
  lastBlobContent = "";
  mockClick.mockClear();
  mockRevoke.mockClear();

  // Mock Blob
  vi.stubGlobal("Blob", class MockBlob {
    content: string;
    constructor(parts: string[]) {
      this.content = parts.join("");
      lastBlobContent = this.content;
    }
  });

  // Mock URL
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:mock-url",
    revokeObjectURL: mockRevoke,
  });

  // Mock document
  mockAnchor = { href: "", download: "", click: mockClick };
  vi.stubGlobal("document", {
    createElement: () => mockAnchor,
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Import after mocks are set up
const { exportConversation } = await import("./export");

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: "test",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("exportConversation", () => {
  it("does nothing for empty messages", () => {
    exportConversation([], "Test", "Claude");
    expect(mockClick).not.toHaveBeenCalled();
  });

  it("generates markdown with header", () => {
    const messages = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "assistant", content: "Hi there!" }),
    ];
    exportConversation(messages, "Test Chat", "Claude Sonnet");

    expect(lastBlobContent).toContain("# Test Chat");
    expect(lastBlobContent).toContain("**Model**: Claude Sonnet");
    expect(lastBlobContent).toContain("**Messages**: 2");
  });

  it("includes user and assistant messages", () => {
    const messages = [
      makeMessage({ role: "user", content: "What is 2+2?" }),
      makeMessage({ role: "assistant", content: "4" }),
    ];
    exportConversation(messages, "Math", "Claude");

    expect(lastBlobContent).toContain("### User");
    expect(lastBlobContent).toContain("What is 2+2?");
    expect(lastBlobContent).toContain("### Assistant");
    expect(lastBlobContent).toContain("4");
  });

  it("skips system messages", () => {
    const messages = [
      makeMessage({ role: "system", content: "Secret system prompt" }),
      makeMessage({ role: "user", content: "Hello" }),
    ];
    exportConversation(messages, "Test", "Claude");

    expect(lastBlobContent).not.toContain("Secret system prompt");
    expect(lastBlobContent).toContain("Hello");
  });

  it("includes assistant metadata (cost, duration, tokens)", () => {
    const messages = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({
        role: "assistant",
        content: "Hi!",
        cost: 0.0123,
        duration: 2500,
        tokens: { input: 10, output: 20, total: 30 },
      }),
    ];
    exportConversation(messages, "Test", "Claude");

    expect(lastBlobContent).toContain("2.5s");
    expect(lastBlobContent).toContain("$0.0123");
    expect(lastBlobContent).toContain("30 tokens");
  });

  it("adds footer", () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    exportConversation(messages, "Test", "Claude");
    expect(lastBlobContent).toContain("*Exported from ThunderClaude*");
  });

  it("generates slug-based filename", () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    exportConversation(messages, "My Great Chat!", "Claude");
    expect(mockAnchor.download).toBe("my-great-chat.md");
  });

  it("truncates long titles in filename", () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    const longTitle = "A".repeat(100);
    exportConversation(messages, longTitle, "Claude");
    expect(mockAnchor.download.length).toBeLessThanOrEqual(44); // 40 chars + ".md"
  });

  it("uses fallback filename for empty title", () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    exportConversation(messages, "", "Claude");
    expect(mockAnchor.download).toBe("conversation.md");
  });

  it("triggers download and cleans up", () => {
    const messages = [makeMessage({ role: "user", content: "Hi" })];
    exportConversation(messages, "Test", "Claude");

    expect(mockClick).toHaveBeenCalledOnce();
    expect(mockRevoke).toHaveBeenCalledWith("blob:mock-url");
  });
});
