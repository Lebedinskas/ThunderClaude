// ── Artifact Extraction Engine ────────────────────────────────────────────────
// Extracts fenced code blocks from assistant messages into a persistent list.
// Each artifact tracks versions (same filename = new version).

import type { ChatMessage } from "./claude-protocol";

export interface Artifact {
  id: string;
  /** Display title — filename from fence or "Code {n}" */
  title: string;
  /** Programming language */
  language: string;
  /** Code content */
  content: string;
  /** Message ID this was extracted from */
  messageId: string;
  /** Version number (1-based, increments when same title reappears) */
  version: number;
  /** Extraction timestamp */
  timestamp: number;
}

// Match fenced code blocks: ```lang\n...\n``` or ```lang:filename\n...\n```
const FENCE_REGEX = /```(\w[\w.+-]*)(?::([^\n]+))?\n([\s\S]*?)```/g;

/**
 * Extract all code artifacts from a set of messages.
 * Returns artifacts sorted by appearance order, with version tracking.
 */
export function extractArtifacts(messages: ChatMessage[]): Artifact[] {
  const artifacts: Artifact[] = [];
  const titleVersions = new Map<string, number>();
  let counter = 0;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (msg.isStreaming) continue;

    // Reset regex state
    FENCE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = FENCE_REGEX.exec(msg.content)) !== null) {
      const language = match[1];
      const explicitFilename = match[2]?.trim();
      const content = match[3];

      // Skip very short code (likely inline examples, not real artifacts)
      if (content.trim().length < 20) continue;
      // Skip plain text/markdown blocks
      if (language === "text" || language === "markdown" || language === "md") continue;

      counter++;
      const title = explicitFilename || `${langLabel(language)} #${counter}`;

      const prevVersion = titleVersions.get(title) || 0;
      const version = prevVersion + 1;
      titleVersions.set(title, version);

      artifacts.push({
        id: `${msg.id}-${match.index}`,
        title,
        language,
        content: content.trimEnd(),
        messageId: msg.id,
        version,
        timestamp: msg.timestamp,
      });
    }
  }

  return artifacts;
}

function langLabel(lang: string): string {
  const labels: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript", typescript: "TypeScript",
    js: "JavaScript", jsx: "JavaScript", javascript: "JavaScript",
    py: "Python", python: "Python",
    rs: "Rust", rust: "Rust",
    go: "Go", golang: "Go",
    sql: "SQL",
    json: "JSON", jsonc: "JSON",
    yaml: "YAML", yml: "YAML",
    html: "HTML", css: "CSS",
    bash: "Shell", sh: "Shell", zsh: "Shell",
    dockerfile: "Dockerfile",
    toml: "TOML",
  };
  return labels[lang.toLowerCase()] || lang;
}
