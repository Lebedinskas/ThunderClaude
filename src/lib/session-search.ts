import type { SessionIndexEntry, SessionInfo } from "./sessions";
import { loadSessionById } from "./sessions";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchMatch {
  role: "user" | "assistant" | "system";
  snippet: string;
  /** Character offset of match within the snippet */
  offset: number;
  /** Length of the match text within the snippet */
  length: number;
}

export interface SearchResult {
  id: string;
  title: string;
  model: string;
  lastActivity: number;
  messageCount: number;
  /** Whether the title itself matched (vs only content) */
  titleMatch: boolean;
  /** Content matches — up to 3 per session */
  matches: SearchMatch[];
}

// ── Session content cache ────────────────────────────────────────────────────

const sessionCache = new Map<string, SessionInfo>();

export function clearSearchCache(): void {
  sessionCache.clear();
}

/**
 * Load all sessions into the cache. Called once when search overlay opens.
 * Returns number of sessions loaded.
 */
export async function preloadSessions(
  index: SessionIndexEntry[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<number> {
  const toLoad = index.filter((s) => !sessionCache.has(s.id));
  let loaded = 0;

  // Load in batches of 10 for concurrency
  const BATCH = 10;
  for (let i = 0; i < toLoad.length; i += BATCH) {
    const batch = toLoad.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const session = await loadSessionById(entry.id);
        if (session) sessionCache.set(entry.id, session);
      }),
    );
    loaded += results.filter((r) => r.status === "fulfilled").length;
    onProgress?.(loaded + (index.length - toLoad.length), index.length);
  }

  return sessionCache.size;
}

// ── Search ───────────────────────────────────────────────────────────────────

const SNIPPET_CONTEXT = 60; // chars before/after match
const MAX_MATCHES_PER_SESSION = 3;

/**
 * Search sessions by query. Searches both titles and message content.
 * Requires `preloadSessions` to have been called first for content search.
 */
export function searchSessions(
  query: string,
  index: SessionIndexEntry[],
): SearchResult[] {
  if (query.length < 2) return [];

  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const entry of index) {
    const titleMatch = entry.title.toLowerCase().includes(lowerQuery);
    const session = sessionCache.get(entry.id);
    const matches: SearchMatch[] = [];

    // Search message content
    if (session) {
      for (const msg of session.messages) {
        if (matches.length >= MAX_MATCHES_PER_SESSION) break;
        if (msg.role === "system") continue;

        const lowerContent = msg.content.toLowerCase();
        const idx = lowerContent.indexOf(lowerQuery);
        if (idx === -1) continue;

        // Build snippet with context
        const start = Math.max(0, idx - SNIPPET_CONTEXT);
        const end = Math.min(msg.content.length, idx + query.length + SNIPPET_CONTEXT);
        let snippet = msg.content.slice(start, end);
        const offset = idx - start;

        // Add ellipsis if truncated
        if (start > 0) snippet = "..." + snippet;
        if (end < msg.content.length) snippet = snippet + "...";

        matches.push({
          role: msg.role,
          snippet,
          offset: start > 0 ? offset + 3 : offset, // +3 for "..."
          length: query.length,
        });
      }
    }

    if (titleMatch || matches.length > 0) {
      results.push({
        id: entry.id,
        title: entry.title,
        model: entry.model,
        lastActivity: entry.lastActivity,
        messageCount: entry.messageCount,
        titleMatch,
        matches,
      });
    }
  }

  // Sort: title matches first, then by recency
  results.sort((a, b) => {
    if (a.titleMatch && !b.titleMatch) return -1;
    if (!a.titleMatch && b.titleMatch) return 1;
    return b.lastActivity - a.lastActivity;
  });

  return results;
}
