import { executeOneShot } from "./one-shot";

/**
 * Generate a concise AI-powered session title from the first exchange.
 * Uses Haiku for speed and cost (~$0.0001 per title).
 * Returns null on any failure — caller keeps the fallback title.
 */
export async function generateAITitle(
  userMessage: string,
  assistantResponse: string,
): Promise<string | null> {
  const message = [
    "Generate a concise 3-5 word title for this conversation.",
    "Output ONLY the title — no quotes, no punctuation, no prefix.",
    "",
    `User: ${userMessage.slice(0, 400)}`,
    `Assistant: ${assistantResponse.slice(0, 400)}`,
  ].join("\n");

  const result = await executeOneShot({
    message,
    model: "claude-haiku-4-5-20251001",
    engine: "claude",
    systemPrompt: null,
    mcpConfig: null,
    timeoutMs: 15_000,
    maxTurns: 1,
    tools: "",
    strictMcp: true,
    permissionMode: "bypassPermissions",
    onStreaming: () => {},
  });

  if (!result?.content) return null;

  const title = result.content
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Title:\s*/i, "")
    .replace(/\.+$/, "")
    .trim();

  return title.length > 0 && title.length <= 60 ? title : null;
}
