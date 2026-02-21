import { ChatMessage } from "./claude-protocol";

/**
 * Export conversation as a clean markdown file.
 * Triggers a browser download to the user's Downloads folder.
 */
export function exportConversation(
  messages: ChatMessage[],
  title: string,
  model: string,
): void {
  if (messages.length === 0) return;

  const lines: string[] = [];

  // Header
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Model**: ${model}`);
  lines.push(`**Date**: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`);
  lines.push(`**Messages**: ${messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Messages
  for (const msg of messages) {
    if (msg.role === "system") continue;

    const role = msg.role === "user" ? "User" : "Assistant";
    const time = new Date(msg.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    lines.push(`### ${role}`);
    lines.push(`*${time}*`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");

    // Metadata for assistant messages
    if (msg.role === "assistant") {
      const meta: string[] = [];
      if (msg.duration) meta.push(`${(msg.duration / 1000).toFixed(1)}s`);
      if (msg.cost) meta.push(`$${msg.cost.toFixed(4)}`);
      if (msg.tokens) meta.push(`${msg.tokens.total.toLocaleString()} tokens`);
      if (meta.length > 0) {
        lines.push(`> ${meta.join(" · ")}`);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  // Footer
  lines.push("*Exported from ThunderClaude*");

  const markdown = lines.join("\n");
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const filename = `${slug || "conversation"}.md`;

  // Trigger download via Blob
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
