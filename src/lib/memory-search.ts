import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "./constants";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VaultChunk {
  id: string;
  source: string;
  heading: string | null;
  content: string;
  position: number;
  tags: string[];
  links: string[];
  modifiedAt: number;
  contentHash: string;
}

export interface ScoredChunk extends VaultChunk {
  score: number;
  bm25Score: number;
  vectorScore: number;
}

export interface VaultFile {
  path: string;
  modified: number;
  size: number;
}

// ── Stop words (common English — excluded from BM25 indexing) ────────────────

const STOP_WORDS = new Set([
  "a", "am", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "this", "that", "these", "those", "i", "you", "he", "she", "we",
  "they", "me", "him", "her", "us", "them", "my", "your", "his",
  "its", "our", "their", "what", "which", "who", "whom", "how",
  "when", "where", "why", "not", "no", "nor", "if", "then", "else",
  "so", "up", "out", "about", "into", "over", "after", "before",
  "between", "under", "again", "further", "just", "also", "very",
  "too", "only", "own", "same", "than", "each", "every", "all",
  "both", "few", "more", "most", "other", "some", "such", "any",
]);

// ── Tokenizer ────────────────────────────────────────────────────────────────

/** Lowercase, split on non-word chars, remove stop words and short tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/** Fast hash for chunk IDs and content hashing — djb2 algorithm. */
function quickHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// ── Obsidian-Aware Markdown Chunker ──────────────────────────────────────────

interface FrontmatterMeta {
  tags: string[];
  title: string | null;
  date: string | null;
}

/** Strip YAML frontmatter and extract metadata. */
function parseFrontmatter(content: string): { body: string; meta: FrontmatterMeta } {
  const meta: FrontmatterMeta = { tags: [], title: null, date: null };

  if (!content.startsWith("---")) {
    return { body: content, meta };
  }

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return { body: content, meta };

  const yaml = content.slice(4, endIdx);
  const body = content.slice(endIdx + 4).trimStart();

  // Extract tags (YAML array or inline)
  const tagsMatch = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
  if (tagsMatch) {
    meta.tags = tagsMatch[1].split(",").map((t) => t.trim().replace(/["']/g, "")).filter(Boolean);
  } else {
    const tagLines = yaml.match(/^tags:\s*\n((?:\s*-\s*.+\n?)*)/m);
    if (tagLines) {
      meta.tags = tagLines[1].match(/^\s*-\s*(.+)/gm)?.map((l) => l.replace(/^\s*-\s*/, "").trim()) || [];
    }
  }

  // Extract title
  const titleMatch = yaml.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
  if (titleMatch) meta.title = titleMatch[1].trim();

  // Extract date
  const dateMatch = yaml.match(/^date:\s*(.+)$/m);
  if (dateMatch) meta.date = dateMatch[1].trim();

  return { body, meta };
}

/** Extract [[wiki-links]] from text. */
function extractLinks(text: string): string[] {
  const matches = text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
  return [...matches].map((m) => m[1].trim());
}

/** Extract #tags from text (not inside code blocks). */
function extractInlineTags(text: string): string[] {
  const matches = text.matchAll(/(?:^|\s)#([a-zA-Z][\w-/]*)/g);
  return [...matches].map((m) => m[1].toLowerCase());
}

/** Check if a line is inside a fenced code block. */
function findCodeBlockRanges(lines: string[]): Set<number> {
  const inCode = new Set<number>();
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("```")) {
      inside = !inside;
      inCode.add(i);
    } else if (inside) {
      inCode.add(i);
    }
  }
  return inCode;
}

const MIN_CHUNK_SIZE = 40;
const MAX_CHUNK_SIZE = 800;

/**
 * Chunk a markdown file into semantically coherent pieces.
 *
 * Strategy:
 * 1. Split on headings (## level or above)
 * 2. Within sections, split on paragraph boundaries (\n\n)
 * 3. Merge small consecutive chunks
 * 4. Split oversized paragraphs on sentence boundaries
 * 5. Keep code blocks intact
 */
export function chunkMarkdown(
  content: string,
  source: string,
  modifiedAt: number,
): VaultChunk[] {
  const { body, meta } = parseFrontmatter(content);
  if (body.trim().length < MIN_CHUNK_SIZE) return [];

  const lines = body.split("\n");
  const codeRanges = findCodeBlockRanges(lines);

  // Phase 1: Split into heading-based sections
  const sections: Array<{ heading: string | null; lines: string[] }> = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = !codeRanges.has(i) && line.match(/^(#{1,3})\s+(.+)/);

    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, lines: currentLines });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  // Phase 2: Split sections into paragraphs, then into chunks
  const rawChunks: Array<{ text: string; heading: string | null }> = [];

  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (text.length === 0) continue;

    if (text.length <= MAX_CHUNK_SIZE) {
      rawChunks.push({ text, heading: section.heading });
      continue;
    }

    // Split on paragraph boundaries
    const paragraphs = text.split(/\n\n+/);
    let buffer = "";

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (buffer.length + trimmed.length + 2 <= MAX_CHUNK_SIZE) {
        buffer = buffer ? buffer + "\n\n" + trimmed : trimmed;
      } else {
        if (buffer) rawChunks.push({ text: buffer, heading: section.heading });

        if (trimmed.length > MAX_CHUNK_SIZE) {
          // Split oversized paragraph on sentence boundaries
          const sentences = splitSentences(trimmed);
          let sentBuf = "";
          for (const sent of sentences) {
            if (sentBuf.length + sent.length + 1 <= MAX_CHUNK_SIZE) {
              sentBuf = sentBuf ? sentBuf + " " + sent : sent;
            } else {
              if (sentBuf) rawChunks.push({ text: sentBuf, heading: section.heading });
              sentBuf = sent;
            }
          }
          if (sentBuf) buffer = sentBuf;
          else buffer = "";
        } else {
          buffer = trimmed;
        }
      }
    }
    if (buffer) rawChunks.push({ text: buffer, heading: section.heading });
  }

  // Phase 3: Merge small chunks with previous
  const merged: typeof rawChunks = [];
  for (const chunk of rawChunks) {
    if (
      chunk.text.length < MIN_CHUNK_SIZE * 3 &&
      merged.length > 0 &&
      merged[merged.length - 1].heading === chunk.heading &&
      merged[merged.length - 1].text.length + chunk.text.length + 2 <= MAX_CHUNK_SIZE
    ) {
      merged[merged.length - 1].text += "\n\n" + chunk.text;
    } else if (chunk.text.length >= MIN_CHUNK_SIZE) {
      merged.push(chunk);
    } else if (merged.length > 0) {
      // Too small on its own — append to previous
      merged[merged.length - 1].text += "\n\n" + chunk.text;
    }
    // else: discard if truly tiny and first chunk
  }

  // Phase 4: Build VaultChunk objects
  const chunks: VaultChunk[] = [];
  const allTags = new Set([...meta.tags, ...extractInlineTags(body)]);

  for (let i = 0; i < merged.length; i++) {
    const { text, heading } = merged[i];
    const links = extractLinks(text);
    const inlineTags = extractInlineTags(text);
    const combinedTags = [...new Set([...allTags, ...inlineTags])];

    chunks.push({
      id: quickHash(source + ":" + i),
      source,
      heading,
      content: text,
      position: i,
      tags: combinedTags,
      links,
      modifiedAt,
      contentHash: quickHash(text),
    });
  }

  return chunks;
}

/** Split text on sentence boundaries. */
function splitSentences(text: string): string[] {
  // Split on `. `, `? `, `! ` but not on abbreviations like "e.g." or "Mr."
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return parts.filter((p) => p.trim().length > 0);
}

// ── BM25 Index ───────────────────────────────────────────────────────────────

interface DocEntry {
  tf: Map<string, number>;
  length: number;
}

export class BM25Index {
  private docs = new Map<string, DocEntry>();
  private df = new Map<string, number>();
  private totalLength = 0;

  constructor(
    private k1 = 1.2,
    private b = 0.75,
  ) {}

  get size(): number {
    return this.docs.size;
  }

  private get avgDl(): number {
    return this.docs.size > 0 ? this.totalLength / this.docs.size : 0;
  }

  /** Add a document to the index. */
  addDocument(id: string, text: string): void {
    // Remove old version if exists
    if (this.docs.has(id)) this.removeDocument(id);

    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Update document frequency
    for (const term of tf.keys()) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }

    this.docs.set(id, { tf, length: tokens.length });
    this.totalLength += tokens.length;
  }

  /** Remove a document from the index. */
  removeDocument(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;

    for (const term of doc.tf.keys()) {
      const current = this.df.get(term) || 0;
      if (current <= 1) this.df.delete(term);
      else this.df.set(term, current - 1);
    }

    this.totalLength -= doc.length;
    this.docs.delete(id);
  }

  /** Clear the entire index. */
  clear(): void {
    this.docs.clear();
    this.df.clear();
    this.totalLength = 0;
  }

  /** Search the index. Returns scored results sorted by relevance. */
  search(query: string, topK = 20): Array<{ id: string; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.size === 0) return [];

    const N = this.docs.size;
    const avgdl = this.avgDl;
    const results: Array<{ id: string; score: number }> = [];

    for (const [id, doc] of this.docs) {
      let score = 0;
      for (const term of queryTokens) {
        const tf = doc.tf.get(term) || 0;
        if (tf === 0) continue;

        const dfVal = this.df.get(term) || 0;
        // IDF: ln((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1);
        // BM25 term score
        const tfNorm = (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * doc.length / avgdl));
        score += idf * tfNorm;
      }

      if (score > 0) results.push({ id, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}

// ── Temporal Decay ───────────────────────────────────────────────────────────

/**
 * Exponential temporal decay with floor.
 * - Recent files (today) → 1.0
 * - ~35 day half-life
 * - Floor at 0.3 (old files never fully ignored)
 */
export function temporalDecay(
  modifiedAt: number,
  lambda = 0.02,
  floor = 0.3,
): number {
  const daysOld = Math.max(0, (Date.now() - modifiedAt) / 86_400_000);
  return floor + (1 - floor) * Math.exp(-lambda * daysOld);
}

// ── Hybrid Scoring ───────────────────────────────────────────────────────────

/**
 * Combine BM25 + vector scores with temporal decay.
 * alpha = 0.4 → slightly favor semantic over lexical.
 */
export function hybridScore(
  bm25Score: number,
  vectorScore: number,
  modifiedAt: number,
  alpha = 0.4,
): number {
  const hybrid = alpha * bm25Score + (1 - alpha) * vectorScore;
  return hybrid * temporalDecay(modifiedAt);
}

/** Normalize scores to 0-1 range using min-max normalization. */
export function normalizeScores(
  results: Array<{ id: string; score: number }>,
): Map<string, number> {
  if (results.length === 0) return new Map();
  const max = results[0].score; // already sorted desc
  const min = results[results.length - 1].score;
  const range = max - min || 1;

  const normalized = new Map<string, number>();
  for (const r of results) {
    normalized.set(r.id, (r.score - min) / range);
  }
  return normalized;
}

// ── MMR Reranking ────────────────────────────────────────────────────────────

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Maximal Marginal Relevance — select diverse, relevant results.
 * lambda = 0.7 → favor relevance over diversity.
 */
export function mmrRerank<T extends { score: number; vector?: number[] }>(
  candidates: T[],
  queryVector: number[] | null,
  k: number,
  lambda = 0.7,
): T[] {
  if (candidates.length <= k || !queryVector) return candidates.slice(0, k);

  const selected: T[] = [];
  const remaining = [...candidates];

  // First pick: highest score
  selected.push(remaining.shift()!);

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const relevance = cand.score;

      // Max similarity to already-selected items
      let maxSim = 0;
      if (cand.vector) {
        for (const sel of selected) {
          if (sel.vector) {
            const sim = cosineSimilarity(cand.vector, sel.vector);
            if (sim > maxSim) maxSim = sim;
          }
        }
      }

      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

// ── Search Orchestrator ──────────────────────────────────────────────────────

/** Singleton BM25 index — populated during vault indexing. */
let bm25Index: BM25Index | null = null;

/** Chunk lookup by ID — populated during vault indexing. */
const chunkMap = new Map<string, VaultChunk>();

/** Get or create the BM25 index. */
export function getBM25Index(): BM25Index {
  if (!bm25Index) bm25Index = new BM25Index();
  return bm25Index;
}

/** Register chunks in the BM25 index and lookup map. */
export function indexChunks(chunks: VaultChunk[]): void {
  const idx = getBM25Index();
  for (const chunk of chunks) {
    idx.addDocument(chunk.id, chunk.content);
    chunkMap.set(chunk.id, chunk);
  }
}

/** Clear all indexed data. */
export function clearIndex(): void {
  bm25Index?.clear();
  bm25Index = null;
  chunkMap.clear();
}

/** Get a chunk by ID. */
export function getChunk(id: string): VaultChunk | undefined {
  return chunkMap.get(id);
}

/** Get total indexed chunk count. */
export function getIndexedChunkCount(): number {
  return chunkMap.size;
}

interface SearchOptions {
  topK?: number;
  bm25Only?: boolean;
  alpha?: number;
}

/**
 * Search the vault using hybrid BM25 + vector search.
 * Falls back to BM25-only if embeddings aren't initialized.
 */
export async function searchVault(
  query: string,
  options: SearchOptions = {},
): Promise<ScoredChunk[]> {
  const { topK = 8, bm25Only = false, alpha = 0.4 } = options;
  const idx = getBM25Index();

  if (idx.size === 0) return [];

  // BM25 search
  const bm25Results = idx.search(query, 50);
  const bm25Norm = normalizeScores(bm25Results);

  // Vector search (skip if bm25Only or not available)
  let vectorNorm = new Map<string, number>();
  let queryVector: number[] | null = null;

  if (!bm25Only) {
    try {
      const vectorResults = await invoke<Array<{ id: string; score: number; vector?: number[] }>>(
        TAURI_COMMANDS.SEARCH_VECTORS,
        { query, topK: 50 },
      );
      vectorNorm = normalizeScores(vectorResults);
      // Get query vector for MMR
      if (vectorResults.length > 0 && vectorResults[0].vector) {
        queryVector = vectorResults[0].vector;
      }
    } catch {
      // Embeddings not initialized — fall back to BM25 only
    }
  }

  // Merge candidates
  const allIds = new Set([...bm25Norm.keys(), ...vectorNorm.keys()]);
  const scored: (ScoredChunk & { vector?: number[] })[] = [];

  for (const id of allIds) {
    const chunk = chunkMap.get(id);
    if (!chunk) continue;

    const bm25 = bm25Norm.get(id) || 0;
    const vec = vectorNorm.get(id) || 0;
    const score = hybridScore(bm25, vec, chunk.modifiedAt, alpha);

    scored.push({
      ...chunk,
      score,
      bm25Score: bm25,
      vectorScore: vec,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // MMR reranking
  const reranked = mmrRerank(scored, queryVector, topK);

  // Strip vectors from output
  return reranked.map(({ vector: _v, ...rest }) => rest);
}

// ── Context Formatting ───────────────────────────────────────────────────────

/**
 * Format search results into a system prompt section.
 * Groups by source file and includes headings.
 */
export function formatContextResults(results: ScoredChunk[]): string {
  if (results.length === 0) return "";

  // Group by source file
  const bySource = new Map<string, ScoredChunk[]>();
  for (const r of results) {
    const existing = bySource.get(r.source) || [];
    existing.push(r);
    bySource.set(r.source, existing);
  }

  const sections: string[] = [];
  for (const [source, chunks] of bySource) {
    const lines: string[] = [`**${source}**`];
    for (const chunk of chunks) {
      if (chunk.heading) lines.push(`_${chunk.heading}_`);
      lines.push(chunk.content.trim());
    }
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}
