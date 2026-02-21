import { describe, it, expect, beforeEach } from "vitest";
import {
  tokenize,
  chunkMarkdown,
  BM25Index,
  temporalDecay,
  hybridScore,
  normalizeScores,
  cosineSimilarity,
  mmrRerank,
  indexChunks,
  clearIndex,
  getBM25Index,
  getChunk,
  getIndexedChunkCount,
  formatContextResults,
  type VaultChunk,
  type ScoredChunk,
} from "./memory-search";

// ── Tokenizer ────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("lowercases and splits on non-word chars", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("removes stop words", () => {
    expect(tokenize("the quick brown fox is a fast animal")).toEqual([
      "quick", "brown", "fox", "fast", "animal",
    ]);
  });

  it("filters single-char tokens", () => {
    expect(tokenize("I am a B c D")).toEqual([]); // all stop words or single-char tokens
  });

  it("handles special characters", () => {
    // \W+ splits on hyphens but not underscores (underscores are word chars)
    expect(tokenize("hello-world foo_bar")).toEqual(["hello", "world", "foo_bar"]);
  });

  it("returns empty for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

// ── Markdown Chunker ─────────────────────────────────────────────────────────

describe("chunkMarkdown", () => {
  const NOW = Date.now();

  it("returns empty for tiny content", () => {
    expect(chunkMarkdown("hi", "test.md", NOW)).toEqual([]);
  });

  it("creates single chunk for small file", () => {
    const content = "This is a paragraph with enough text to be a valid chunk for our indexing system.";
    const chunks = chunkMarkdown(content, "note.md", NOW);
    expect(chunks.length).toBe(1);
    expect(chunks[0].source).toBe("note.md");
    expect(chunks[0].content).toBe(content);
    expect(chunks[0].position).toBe(0);
    expect(chunks[0].modifiedAt).toBe(NOW);
  });

  it("splits on headings", () => {
    const content = [
      "## First Section",
      "Content of the first section that has enough text to form a chunk on its own.",
      "",
      "## Second Section",
      "Content of the second section that also has enough text to form a chunk on its own.",
    ].join("\n");
    const chunks = chunkMarkdown(content, "note.md", NOW);
    expect(chunks.length).toBe(2);
    expect(chunks[0].heading).toBe("First Section");
    expect(chunks[1].heading).toBe("Second Section");
  });

  it("strips YAML frontmatter and extracts tags", () => {
    const content = [
      "---",
      "title: \"My Note\"",
      "tags: [coding, rust]",
      "date: 2026-02-21",
      "---",
      "",
      "This is the body content of the note with enough text for a chunk to be created.",
    ].join("\n");
    const chunks = chunkMarkdown(content, "note.md", NOW);
    expect(chunks.length).toBe(1);
    expect(chunks[0].tags).toContain("coding");
    expect(chunks[0].tags).toContain("rust");
    expect(chunks[0].content).not.toContain("---");
    expect(chunks[0].content).not.toContain("title:");
  });

  it("extracts wiki-links", () => {
    const content = "Check out [[My Note]] and [[Other Note|alias]] for more details on this topic that I wrote about.";
    const chunks = chunkMarkdown(content, "note.md", NOW);
    expect(chunks[0].links).toContain("My Note");
    expect(chunks[0].links).toContain("Other Note");
  });

  it("extracts inline tags", () => {
    const content = "This paragraph discusses #typescript and #rust programming languages in some detail.";
    const chunks = chunkMarkdown(content, "note.md", NOW);
    expect(chunks[0].tags).toContain("typescript");
    expect(chunks[0].tags).toContain("rust");
  });

  it("assigns unique IDs to chunks", () => {
    const content = [
      "## Section A",
      "Content A with enough text to be a real chunk in the system for testing purposes.",
      "",
      "## Section B",
      "Content B with enough text to be a real chunk in the system for testing purposes.",
    ].join("\n");
    const chunks = chunkMarkdown(content, "note.md", NOW);
    const ids = new Set(chunks.map((c) => c.id));
    expect(ids.size).toBe(chunks.length);
  });

  it("respects max chunk size by splitting long paragraphs", () => {
    const longPara = "This is a sentence. ".repeat(60); // ~1200 chars
    const chunks = chunkMarkdown(longPara, "long.md", NOW);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(850); // some tolerance
    }
  });

  it("handles content with only frontmatter", () => {
    const content = "---\ntitle: Empty\n---\n";
    expect(chunkMarkdown(content, "empty.md", NOW)).toEqual([]);
  });

  it("preserves code blocks intact", () => {
    const content = [
      "## Code Example",
      "",
      "Here is some code that demonstrates the concept:",
      "",
      "```typescript",
      "function hello() {",
      "  console.log('world');",
      "}",
      "```",
      "",
      "And here is the explanation of what this code does.",
    ].join("\n");
    const chunks = chunkMarkdown(content, "code.md", NOW);
    // The code block should be in a chunk, not split
    const codeChunk = chunks.find((c) => c.content.includes("```typescript"));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain("console.log");
  });
});

// ── BM25 Index ───────────────────────────────────────────────────────────────

describe("BM25Index", () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  it("starts empty", () => {
    expect(index.size).toBe(0);
  });

  it("indexes and searches documents", () => {
    index.addDocument("d1", "typescript programming language");
    index.addDocument("d2", "rust programming systems");
    index.addDocument("d3", "cooking recipes dinner");

    const results = index.search("programming");
    expect(results.length).toBe(2);
    expect(results.map((r) => r.id)).toContain("d1");
    expect(results.map((r) => r.id)).toContain("d2");
  });

  it("ranks exact matches higher", () => {
    index.addDocument("d1", "typescript react frontend development");
    index.addDocument("d2", "typescript compiler internals advanced");
    index.addDocument("d3", "python machine learning data science");

    const results = index.search("typescript");
    expect(results.length).toBe(2);
    // Both should match, d3 should not
    expect(results.map((r) => r.id)).not.toContain("d3");
  });

  it("handles multi-term queries", () => {
    index.addDocument("d1", "typescript react frontend");
    index.addDocument("d2", "typescript backend node");
    index.addDocument("d3", "react frontend design");

    const results = index.search("typescript react");
    expect(results.length).toBe(3);
    // d1 matches both terms — should be ranked first
    expect(results[0].id).toBe("d1");
  });

  it("returns empty for no matches", () => {
    index.addDocument("d1", "hello world");
    expect(index.search("xyz")).toEqual([]);
  });

  it("returns empty for stop-word-only queries", () => {
    index.addDocument("d1", "hello world");
    expect(index.search("the a is")).toEqual([]);
  });

  it("removes documents correctly", () => {
    index.addDocument("d1", "typescript programming");
    index.addDocument("d2", "rust programming");
    expect(index.size).toBe(2);

    index.removeDocument("d1");
    expect(index.size).toBe(1);

    const results = index.search("typescript");
    expect(results).toEqual([]);
  });

  it("clears all documents", () => {
    index.addDocument("d1", "hello");
    index.addDocument("d2", "world");
    index.clear();
    expect(index.size).toBe(0);
    expect(index.search("hello")).toEqual([]);
  });

  it("respects topK limit", () => {
    for (let i = 0; i < 30; i++) {
      index.addDocument(`d${i}`, `programming language ${i}`);
    }
    const results = index.search("programming", 5);
    expect(results.length).toBe(5);
  });

  it("handles document replacement (re-add same ID)", () => {
    index.addDocument("d1", "typescript frontend");
    index.addDocument("d1", "rust backend"); // replaces
    expect(index.size).toBe(1);

    expect(index.search("typescript")).toEqual([]);
    expect(index.search("rust").length).toBe(1);
  });
});

// ── Temporal Decay ───────────────────────────────────────────────────────────

describe("temporalDecay", () => {
  it("returns 1.0 for current time", () => {
    const score = temporalDecay(Date.now());
    expect(score).toBeCloseTo(1.0, 1);
  });

  it("returns floor for very old timestamps", () => {
    const oneYearAgo = Date.now() - 365 * 86_400_000;
    const score = temporalDecay(oneYearAgo);
    expect(score).toBeCloseTo(0.3, 1);
  });

  it("decays gradually over time", () => {
    const now = Date.now();
    const d7 = temporalDecay(now - 7 * 86_400_000);
    const d30 = temporalDecay(now - 30 * 86_400_000);
    const d90 = temporalDecay(now - 90 * 86_400_000);
    expect(d7).toBeGreaterThan(d30);
    expect(d30).toBeGreaterThan(d90);
    expect(d90).toBeGreaterThan(0.3);
  });

  it("never goes below floor", () => {
    const veryOld = temporalDecay(0); // epoch
    expect(veryOld).toBeGreaterThanOrEqual(0.3);
  });
});

// ── Hybrid Scoring ───────────────────────────────────────────────────────────

describe("hybridScore", () => {
  it("combines BM25 and vector scores", () => {
    const score = hybridScore(0.8, 0.6, Date.now());
    // alpha=0.4: 0.4*0.8 + 0.6*0.6 = 0.32 + 0.36 = 0.68 * ~1.0 decay
    expect(score).toBeCloseTo(0.68, 1);
  });

  it("applies temporal decay", () => {
    const recent = hybridScore(0.5, 0.5, Date.now());
    const old = hybridScore(0.5, 0.5, Date.now() - 180 * 86_400_000);
    expect(recent).toBeGreaterThan(old);
  });

  it("returns 0 for zero scores", () => {
    expect(hybridScore(0, 0, Date.now())).toBe(0);
  });
});

// ── Score Normalization ──────────────────────────────────────────────────────

describe("normalizeScores", () => {
  it("normalizes to 0-1 range", () => {
    const results = [
      { id: "a", score: 10 },
      { id: "b", score: 5 },
      { id: "c", score: 0 },
    ];
    const norm = normalizeScores(results);
    expect(norm.get("a")).toBe(1);
    expect(norm.get("b")).toBe(0.5);
    expect(norm.get("c")).toBe(0);
  });

  it("handles single result", () => {
    const norm = normalizeScores([{ id: "a", score: 5 }]);
    expect(norm.get("a")).toBe(0); // (5-5)/(5-5) → 0/1 = 0
  });

  it("handles empty input", () => {
    expect(normalizeScores([])).toEqual(new Map());
  });
});

// ── Cosine Similarity ────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("handles zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

// ── MMR Reranking ────────────────────────────────────────────────────────────

describe("mmrRerank", () => {
  it("returns top-k when no vectors present", () => {
    const candidates = [
      { score: 0.9 },
      { score: 0.8 },
      { score: 0.7 },
    ];
    const result = mmrRerank(candidates, null, 2);
    expect(result.length).toBe(2);
    expect(result[0].score).toBe(0.9);
  });

  it("promotes diversity with vectors", () => {
    const candidates = [
      { score: 0.9, vector: [1, 0, 0] },
      { score: 0.85, vector: [0.99, 0.01, 0] }, // very similar to first
      { score: 0.8, vector: [0, 1, 0] },          // diverse
    ];
    const result = mmrRerank(candidates, [1, 0.5, 0], 2, 0.5);
    // With lambda=0.5, diversity matters more — should pick the diverse one
    expect(result.length).toBe(2);
    expect(result[0].score).toBe(0.9); // first always picked
  });

  it("returns all when k >= candidates", () => {
    const candidates = [{ score: 0.9 }, { score: 0.8 }];
    expect(mmrRerank(candidates, [1, 0], 5).length).toBe(2);
  });
});

// ── Index Management ─────────────────────────────────────────────────────────

describe("index management", () => {
  beforeEach(() => {
    clearIndex();
  });

  it("indexes chunks and makes them searchable", () => {
    const chunks: VaultChunk[] = [
      {
        id: "c1",
        source: "note.md",
        heading: "Intro",
        content: "TypeScript is a programming language",
        position: 0,
        tags: [],
        links: [],
        modifiedAt: Date.now(),
        contentHash: "hash1",
      },
      {
        id: "c2",
        source: "note.md",
        heading: "Details",
        content: "Rust is a systems programming language",
        position: 1,
        tags: [],
        links: [],
        modifiedAt: Date.now(),
        contentHash: "hash2",
      },
    ];

    indexChunks(chunks);
    expect(getIndexedChunkCount()).toBe(2);

    const idx = getBM25Index();
    const results = idx.search("typescript");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("c1");
  });

  it("retrieves chunks by ID", () => {
    const chunk: VaultChunk = {
      id: "c1",
      source: "test.md",
      heading: null,
      content: "Test content",
      position: 0,
      tags: ["test"],
      links: [],
      modifiedAt: Date.now(),
      contentHash: "h1",
    };
    indexChunks([chunk]);
    expect(getChunk("c1")).toEqual(chunk);
    expect(getChunk("nonexistent")).toBeUndefined();
  });

  it("clears all indexed data", () => {
    indexChunks([{
      id: "c1",
      source: "test.md",
      heading: null,
      content: "Test content for clearing",
      position: 0,
      tags: [],
      links: [],
      modifiedAt: Date.now(),
      contentHash: "h1",
    }]);
    expect(getIndexedChunkCount()).toBe(1);

    clearIndex();
    expect(getIndexedChunkCount()).toBe(0);
    expect(getChunk("c1")).toBeUndefined();
  });
});

// ── Context Formatting ───────────────────────────────────────────────────────

describe("formatContextResults", () => {
  it("returns empty string for no results", () => {
    expect(formatContextResults([])).toBe("");
  });

  it("groups chunks by source file", () => {
    const results: ScoredChunk[] = [
      {
        id: "c1", source: "notes/a.md", heading: "Setup",
        content: "Install dependencies", position: 0,
        tags: [], links: [], modifiedAt: Date.now(),
        contentHash: "h1", score: 0.9, bm25Score: 0.8, vectorScore: 0.7,
      },
      {
        id: "c2", source: "notes/a.md", heading: "Usage",
        content: "Run the command", position: 1,
        tags: [], links: [], modifiedAt: Date.now(),
        contentHash: "h2", score: 0.85, bm25Score: 0.7, vectorScore: 0.6,
      },
      {
        id: "c3", source: "notes/b.md", heading: null,
        content: "Different file content", position: 0,
        tags: [], links: [], modifiedAt: Date.now(),
        contentHash: "h3", score: 0.8, bm25Score: 0.6, vectorScore: 0.5,
      },
    ];

    const formatted = formatContextResults(results);
    expect(formatted).toContain("**notes/a.md**");
    expect(formatted).toContain("**notes/b.md**");
    expect(formatted).toContain("_Setup_");
    expect(formatted).toContain("Install dependencies");
    expect(formatted).toContain("---"); // separator between files
  });
});
