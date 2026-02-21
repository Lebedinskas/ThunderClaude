import type { ChatMessage } from "./claude-protocol";

type MessageSetter = React.Dispatch<React.SetStateAction<ChatMessage[]>>;

/**
 * Update the last streaming assistant message, or create one.
 *
 * - `undefined` values in `updates` are ignored → existing values preserved.
 * - Set `createIfMissing = false` to only update (no creation if no streaming message exists).
 *
 * This replaces the 9-instance boilerplate pattern:
 *   setMessages((prev) => {
 *     const last = prev[prev.length - 1];
 *     if (last?.role === "assistant" && last?.isStreaming) { ... splice ... }
 *     return [...prev, { ...new message... }];
 *   });
 */
export function upsertStreaming(
  setMessages: MessageSetter,
  updates: Partial<ChatMessage>,
  createIfMissing = true,
): void {
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    const isStreamingAssistant =
      last?.role === "assistant" && last?.isStreaming;

    if (isStreamingAssistant) {
      // Merge updates into existing — skip undefined values to preserve existing data
      const merged = { ...last };
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          (merged as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return [...prev.slice(0, -1), merged];
    }

    if (!createIfMissing) return prev;

    // Create new streaming assistant message
    return [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
        ...updates,
      },
    ];
  });
}
