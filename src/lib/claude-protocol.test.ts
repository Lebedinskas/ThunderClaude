import { describe, it, expect } from "vitest";
import { parseClaudeMessage, parseGeminiMessage } from "./claude-protocol";

describe("parseClaudeMessage", () => {
  it("parses system init message", () => {
    const msg = parseClaudeMessage('{"type":"system","subtype":"init","session_id":"abc-123"}');
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("system");
    expect((msg as { session_id: string }).session_id).toBe("abc-123");
  });

  it("parses assistant message with text content", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello!" }],
      },
    });
    const msg = parseClaudeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("assistant");
  });

  it("parses result message with cost", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Done",
      total_cost_usd: 0.0042,
      duration_ms: 1500,
      num_turns: 3,
    });
    const msg = parseClaudeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("result");
    const result = msg as { total_cost_usd: number; duration_ms: number };
    expect(result.total_cost_usd).toBeCloseTo(0.0042);
    expect(result.duration_ms).toBe(1500);
  });

  it("parses stream event with text delta", () => {
    const raw = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "chunk" } },
    });
    const msg = parseClaudeMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("stream_event");
  });

  it("returns null for invalid JSON", () => {
    expect(parseClaudeMessage("not json")).toBeNull();
    expect(parseClaudeMessage("")).toBeNull();
    expect(parseClaudeMessage("{incomplete")).toBeNull();
  });
});

describe("parseGeminiMessage", () => {
  it("parses init message", () => {
    const msg = parseGeminiMessage(
      '{"type":"init","session_id":"gem-1","model":"gemini-2.5-flash","timestamp":"2026-01-01T00:00:00Z"}'
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("init");
    expect((msg as { model: string }).model).toBe("gemini-2.5-flash");
  });

  it("parses text message", () => {
    const raw = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "Hello from Gemini",
      delta: true,
      timestamp: "2026-01-01T00:00:00Z",
    });
    const msg = parseGeminiMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("message");
    expect((msg as { content: string }).content).toBe("Hello from Gemini");
  });

  it("parses tool_use message", () => {
    const raw = JSON.stringify({
      type: "tool_use",
      tool_name: "read_file",
      tool_id: "call-1",
      parameters: { path: "/tmp/test.txt" },
      timestamp: "2026-01-01T00:00:00Z",
    });
    const msg = parseGeminiMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("tool_use");
    expect((msg as { tool_name: string }).tool_name).toBe("read_file");
  });

  it("parses result message with stats", () => {
    const raw = JSON.stringify({
      type: "result",
      status: "success",
      stats: {
        total_tokens: 1500,
        input_tokens: 500,
        output_tokens: 1000,
        duration_ms: 2500,
        tool_calls: 2,
      },
      timestamp: "2026-01-01T00:00:00Z",
    });
    const msg = parseGeminiMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("result");
    const stats = (msg as { stats: { total_tokens: number } }).stats;
    expect(stats.total_tokens).toBe(1500);
  });

  it("returns null for invalid JSON", () => {
    expect(parseGeminiMessage("not json")).toBeNull();
    expect(parseGeminiMessage("")).toBeNull();
  });
});
