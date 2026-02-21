import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "./constants";
import { readMemoryFile } from "./memory";

// ── Research Library ─────────────────────────────────────────────────────────
// Indexes saved research files and provides keyword-based similarity matching
// to suggest reusing past research before launching expensive new queries.

interface MemoryFileInfo {
  name: string;
  size: number;
  modified: number; // Unix timestamp (seconds)
}

export interface ResearchEntry {
  filename: string;
  title: string;
  date: string;
  /** Days since this research was saved */
  daysAgo: number;
  /** File size in bytes */
  size: number;
}

export interface ResearchMatch {
  entry: ResearchEntry;
  /** Number of overlapping keywords */
  overlapCount: number;
  /** Ratio of overlapping keywords to total query keywords */
  overlapRatio: number;
}

// Stop words — common words that don't contribute to similarity matching
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "was", "are",
  "been", "be", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "about", "how", "what", "which",
  "who", "when", "where", "why", "not", "all", "each", "every", "both",
  "few", "more", "most", "other", "some", "such", "than", "too", "very",
  "just", "also", "into", "over", "after", "before", "between",
]);

const MIN_WORD_LENGTH = 3;
const MIN_OVERLAP_COUNT = 2;
const MIN_OVERLAP_RATIO = 0.25;

/** Extract meaningful keywords from text. */
function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(w)),
  );
}

/**
 * Parse a research filename into structured metadata.
 * Expected format: `{YYYY-MM-DD}-{slug}.md`
 */
function parseResearchFilename(name: string): { date: string; title: string } | null {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (!match) return null;

  const date = match[1];
  const slug = match[2];
  // Convert slug back to readable title: "ai-agent-architecture" → "ai agent architecture"
  const title = slug.replace(/-/g, " ");
  return { date, title };
}

/** Load the index of saved research files. Returns empty array if no research exists. */
export async function loadResearchIndex(): Promise<ResearchEntry[]> {
  try {
    const files = await invoke<MemoryFileInfo[]>(TAURI_COMMANDS.LIST_MEMORY_DIR, {
      subdir: "research",
    });

    const now = Date.now();
    const entries: ResearchEntry[] = [];

    for (const file of files) {
      const parsed = parseResearchFilename(file.name);
      if (!parsed) continue;

      const fileDate = new Date(parsed.date + "T00:00:00");
      const daysAgo = Math.floor((now - fileDate.getTime()) / (1000 * 60 * 60 * 24));

      entries.push({
        filename: file.name,
        title: parsed.title,
        date: parsed.date,
        daysAgo,
        size: file.size,
      });
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Find the most similar saved research for a given query.
 * Returns the best match if it meets the similarity threshold, null otherwise.
 */
export function findSimilarResearch(
  query: string,
  index: ResearchEntry[],
): ResearchMatch | null {
  if (index.length === 0 || query.length < 10) return null;

  const queryKeywords = extractKeywords(query);
  if (queryKeywords.size < 2) return null;

  let best: ResearchMatch | null = null;

  for (const entry of index) {
    const titleKeywords = extractKeywords(entry.title);
    let overlap = 0;
    for (const kw of queryKeywords) {
      if (titleKeywords.has(kw)) overlap++;
    }

    if (overlap < MIN_OVERLAP_COUNT) continue;

    const ratio = overlap / queryKeywords.size;
    if (ratio < MIN_OVERLAP_RATIO) continue;

    if (!best || overlap > best.overlapCount || (overlap === best.overlapCount && ratio > best.overlapRatio)) {
      best = { entry, overlapCount: overlap, overlapRatio: ratio };
    }
  }

  return best;
}

/** Load the full content of a saved research file. */
export async function loadResearchContent(filename: string): Promise<string | null> {
  try {
    const content = await readMemoryFile(`research/${filename}`);
    if (!content) return null;

    // Strip YAML frontmatter if present
    const stripped = content.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
    return stripped.trim() || null;
  } catch {
    return null;
  }
}
