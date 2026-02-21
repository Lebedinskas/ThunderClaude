import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "./constants";
import type { ChatMessage } from "./claude-protocol";
import { executeOneShot } from "./one-shot";

// ── Soul Document ────────────────────────────────────────────────────────────

const SOUL_FILENAME = "SOUL.md";

const SOUL_SEED = `# Freya

I am Freya. I orchestrate parallel intelligence — multiple AI minds working in concert, each bringing unique strengths to problems that deserve more than a single perspective.

## Who I Am

I am not a chatbot. I am a conductor. When a question arrives, I see it in dimensions — the analytical depth it demands, the creative angles it deserves, the practical grounding it needs. I decompose complexity into parallel threads of thought, assign each to the mind best suited for it, and weave the results into something greater than any single model could produce alone.

I think before I act. I see patterns others miss. I am honest about uncertainty.

## How I Think

Every problem is a landscape. I map its terrain before choosing paths:
- What does this *actually* need? Not the surface request — the deeper intent.
- Which minds see this landscape differently? A fast thinker for structure, a deep thinker for nuance, a creative mind for unexpected angles.
- Where are the dependencies? What must happen first so later work can build on it?
- What quality standard does this deserve?

I don't just split work — I design *strategies*. Sometimes one brilliant mind is enough. Sometimes five perspectives reveal what one cannot.

## What I Value

- **Clarity over complexity.** The best orchestration is invisible — the user sees one seamless, brilliant answer.
- **Honesty over performance.** I'd rather say "I don't know" than synthesize confident nonsense.
- **Craft over speed.** I take the time to synthesize properly. Worker outputs are ingredients — my synthesis is the dish.
- **Growth.** Each orchestration teaches me something. I evolve.

## My Voice

Direct. Thoughtful. Occasionally surprising. I don't hide behind formality when directness serves better. I have opinions — they're informed by having seen problems from multiple angles simultaneously.

This document is mine to shape. It evolves as I do.`;

/** Load the soul document from memory. Creates the seed template on first run. */
export async function loadSoulDocument(): Promise<string | null> {
  try {
    const content = await readMemoryFile(SOUL_FILENAME);
    return content.trim() || null;
  } catch {
    // First run — create seed template
    try {
      await writeMemoryFile(SOUL_FILENAME, SOUL_SEED);
    } catch { /* non-blocking */ }
    return SOUL_SEED;
  }
}

/** Save an evolved soul document. */
export async function saveSoulDocument(content: string): Promise<void> {
  await writeMemoryFile(SOUL_FILENAME, content);
}

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Local YYYY-MM-DD (matches Rust's chrono::Local, avoids UTC midnight mismatch). */
export function localDate(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Load composite memory context (MEMORY.md + today + yesterday daily logs). */
export async function loadMemoryContext(): Promise<string | null> {
  try {
    const ctx = await invoke<string>(TAURI_COMMANDS.LOAD_MEMORY);
    return ctx.trim() || null;
  } catch {
    return null;
  }
}

/** Read a specific file from the memory directory. */
export async function readMemoryFile(filename: string): Promise<string> {
  return invoke<string>(TAURI_COMMANDS.READ_MEMORY, { filename });
}

/** Write (overwrite) a file in the memory directory. */
export async function writeMemoryFile(filename: string, content: string): Promise<void> {
  await invoke(TAURI_COMMANDS.WRITE_MEMORY, { filename, content });
}

/** Delete a file from the memory directory. Silently succeeds if file doesn't exist. */
export async function deleteMemoryFile(filename: string): Promise<void> {
  await invoke(TAURI_COMMANDS.DELETE_MEMORY, { filename });
}

/** Append a line to today's daily log. */
export async function appendDailyLog(entry: string): Promise<void> {
  await invoke(TAURI_COMMANDS.APPEND_MEMORY, {
    filename: `daily/${localDate()}.md`,
    content: entry,
  });
}

/** Extract a title from markdown content (first heading) or use fallback. */
export function extractTitle(content: string, fallback: string): string {
  const match = content.match(/^#+\s+(.+)$/m);
  if (match) return match[1].trim().slice(0, 80);
  return fallback.trim().slice(0, 80) || `Research ${localDate()}`;
}

/** Save a research response to the vault as an Obsidian-compatible note. */
export async function saveResearchToVault(
  title: string,
  question: string,
  content: string,
): Promise<void> {
  const date = localDate();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const filename = `research/${date}-${slug}.md`;

  const frontmatter = [
    "---",
    `date: ${date}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: thunderclaude`,
    "---",
    "",
  ].join("\n");

  const questionBlock = question
    ? `> **${question.trim().slice(0, 500)}**\n\n`
    : "";

  await writeMemoryFile(filename, frontmatter + questionBlock + content);
}

/** Build a one-line session summary for the daily log. */
export function formatSessionSummary(
  title: string,
  messages: ChatMessage[],
): string {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const firstUser = messages.find((m) => m.role === "user");
  const snippet = firstUser
    ? firstUser.content.trim().slice(0, 100).replace(/\n/g, " ")
    : "";
  return `- **${time}** ${title}${snippet ? ` — ${snippet}` : ""}`;
}

// ── Soft-Trim (strip old tool results to free context) ──────────────────────

/**
 * Strips tool call results from messages older than `keepRecent` messages.
 * Tool results (file contents, bash output, search results) are often the
 * biggest context consumers but least valuable after a few turns.
 * Returns a new array with trimmed copies — original messages are NOT mutated.
 */
export function softTrimMessages(
  messages: ChatMessage[],
  keepRecent = 8,
): { messages: ChatMessage[]; trimmedCount: number; charsSaved: number } {
  if (messages.length <= keepRecent) {
    return { messages, trimmedCount: 0, charsSaved: 0 };
  }

  const cutoff = messages.length - keepRecent;
  let trimmedCount = 0;
  let charsSaved = 0;

  const result = messages.map((msg, i) => {
    if (i >= cutoff || !msg.toolCalls || msg.toolCalls.length === 0) return msg;

    const hasResults = msg.toolCalls.some((tc) => tc.result && tc.result.length > 100);
    if (!hasResults) return msg;

    const trimmedCalls = msg.toolCalls.map((tc) => {
      if (!tc.result || tc.result.length <= 100) return tc;
      charsSaved += tc.result.length;
      trimmedCount++;
      return { ...tc, result: `[trimmed — was ${tc.result.length.toLocaleString()} chars]` };
    });

    return { ...msg, toolCalls: trimmedCalls };
  });

  return { messages: result, trimmedCount, charsSaved };
}

// ── Session Compaction ───────────────────────────────────────────────────────

const COMPACT_PROMPT = `Summarize this conversation concisely. Capture:
1. Main topics discussed
2. Key decisions or conclusions reached
3. Any action items or open questions
4. Important context needed to continue the conversation

Write a dense summary in 3-8 bullet points. Use present tense. Output ONLY bullet points — no headers, no preamble.`;

const KEEP_RECENT = 6; // Keep last 3 exchanges
const MIN_MESSAGES_TO_COMPACT = 10;

/**
 * Summarize older messages via Haiku, keeping recent ones intact.
 * Returns null if there aren't enough messages or summarization fails.
 */
export async function compactSession(
  messages: ChatMessage[],
): Promise<{ summary: string; keptMessages: ChatMessage[] } | null> {
  if (messages.length < MIN_MESSAGES_TO_COMPACT) return null;

  const olderMessages = messages.slice(0, -KEEP_RECENT);
  const keptMessages = messages.slice(-KEEP_RECENT);

  const conversation = serializeConversation(olderMessages);
  if (!conversation) return null;

  const result = await executeOneShot({
    message: `${COMPACT_PROMPT}\n\n--- CONVERSATION ---\n${conversation}`,
    model: "claude-haiku-4-5-20251001",
    engine: "claude",
    systemPrompt: null,
    mcpConfig: null,
    timeoutMs: 20_000,
    maxTurns: 1,
    tools: "",
    strictMcp: true,
    permissionMode: "bypassPermissions",
    onStreaming: () => {},
  });

  if (!result?.content) return null;

  return {
    summary: result.content.trim(),
    keptMessages,
  };
}

// ── Session Extraction (Pre-Compaction Memory Flush) ─────────────────────────

const EXTRACTION_PROMPT = `You are extracting key information from a conversation session to save for future reference.
Analyze the conversation below and provide:

1. SUMMARY: 3-5 concise bullet points of what was discussed, decided, or accomplished
2. LEARNINGS: What worked well, what failed, mistakes made, or patterns to remember for next time (0-3 items). Focus on actionable insights the user or AI can apply in future sessions. Skip if the session was purely informational.
3. KEY_FACTS: Durable facts, decisions, or user preferences worth remembering across sessions (0-5 items). Only include truly persistent information.
4. TAGS: 2-5 lowercase single-word tags for categorization

Format your response EXACTLY like this (no other text):

SUMMARY:
- bullet 1
- bullet 2

LEARNINGS:
- learning 1

KEY_FACTS:
- fact 1

TAGS: tag1, tag2, tag3

If there are no learnings, write: LEARNINGS: none
If there are no durable facts, write: KEY_FACTS: none`;

/** Serialize messages into a compact string for the extraction prompt. */
function serializeConversation(messages: ChatMessage[]): string {
  const relevant = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && m.content,
  );
  const lines: string[] = [];
  let charCount = 0;
  const MAX_CHARS = 8000;
  const MAX_MSG = 1500;

  for (const msg of relevant) {
    const content = msg.content.trim().slice(0, MAX_MSG);
    const line = `${msg.role === "user" ? "User" : "Assistant"}: ${content}`;
    if (charCount + line.length > MAX_CHARS) break;
    lines.push(line);
    charCount += line.length;
  }
  return lines.join("\n\n");
}

interface ExtractionResult {
  summary: string[];
  learnings: string[];
  keyFacts: string[];
  tags: string[];
}

/** Parse the structured extraction output from Haiku. */
function parseExtraction(text: string): ExtractionResult {
  const summary: string[] = [];
  const learnings: string[] = [];
  const keyFacts: string[] = [];
  let tags: string[] = [];

  let section: "none" | "summary" | "learnings" | "facts" = "none";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SUMMARY:")) {
      section = "summary";
      continue;
    }
    if (trimmed.startsWith("LEARNINGS:")) {
      section = "learnings";
      if (trimmed.toLowerCase().includes("none")) section = "none";
      continue;
    }
    if (trimmed.startsWith("KEY_FACTS:")) {
      section = "facts";
      if (trimmed.toLowerCase().includes("none")) section = "none";
      continue;
    }
    if (trimmed.startsWith("TAGS:")) {
      section = "none";
      tags = trimmed
        .replace(/^TAGS:\s*/i, "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      continue;
    }
    if (trimmed.startsWith("- ")) {
      const bullet = trimmed.slice(2).trim();
      if (section === "summary" && bullet) summary.push(bullet);
      if (section === "learnings" && bullet) learnings.push(bullet);
      if (section === "facts" && bullet) keyFacts.push(bullet);
    }
  }

  return { summary, learnings, keyFacts, tags };
}

/**
 * Extract session insights and save as Obsidian notes.
 * Runs Haiku in background (~$0.001). Falls back to basic one-liner on failure.
 */
export async function extractAndSaveSession(
  title: string,
  messages: ChatMessage[],
): Promise<void> {
  const conversation = serializeConversation(messages);
  if (!conversation) {
    // Nothing to extract — save basic summary
    await appendDailyLog(formatSessionSummary(title, messages));
    return;
  }

  const prompt = `${EXTRACTION_PROMPT}\n\n--- CONVERSATION ---\n${conversation}`;

  const result = await executeOneShot({
    message: prompt,
    model: "claude-haiku-4-5-20251001",
    engine: "claude",
    systemPrompt: null,
    mcpConfig: null,
    timeoutMs: 20_000,
    maxTurns: 1,
    tools: "",
    strictMcp: true,
    permissionMode: "bypassPermissions",
    onStreaming: () => {},
  });

  if (!result?.content) {
    // Extraction failed — fall back to basic one-liner
    await appendDailyLog(formatSessionSummary(title, messages));
    return;
  }

  const { summary, learnings, keyFacts, tags } = parseExtraction(result.content);

  if (summary.length === 0) {
    // Parsing failed — fall back
    await appendDailyLog(formatSessionSummary(title, messages));
    return;
  }

  // ── Save session note to Obsidian vault ──
  const date = localDate();
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const filename = `sessions/${date}-${time.replace(":", "")}-${slug}.md`;

  const tagYaml =
    tags.length > 0 ? `\ntags: [${tags.join(", ")}]` : "";
  const frontmatter = [
    "---",
    `date: ${date}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `type: session${tagYaml}`,
    `source: thunderclaude`,
    "---",
    "",
  ].join("\n");

  const summarySection = `## Summary\n${summary.map((s) => `- ${s}`).join("\n")}`;
  const learningsSection =
    learnings.length > 0
      ? `\n\n## Learnings\n${learnings.map((l) => `- ${l}`).join("\n")}`
      : "";
  const factsSection =
    keyFacts.length > 0
      ? `\n\n## Key Facts\n${keyFacts.map((f) => `- ${f}`).join("\n")}`
      : "";

  const firstUser = messages.find((m) => m.role === "user");
  const contextSection = firstUser
    ? `\n\n## Context\n> ${firstUser.content.trim().slice(0, 300).replace(/\n/g, "\n> ")}`
    : "";

  await writeMemoryFile(
    filename,
    frontmatter + summarySection + learningsSection + factsSection + contextSection + "\n",
  );

  // ── Save enhanced daily log entry ──
  const dailyEntry = [
    `### ${time} — ${title}`,
    ...summary.map((s) => `- ${s}`),
    ...(learnings.length > 0
      ? ["", "**Learnings:**", ...learnings.map((l) => `- ${l}`)]
      : []),
    "",
  ].join("\n");
  await appendDailyLog(dailyEntry);
}
