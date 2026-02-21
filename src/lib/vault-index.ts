import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "./constants";
import {
  type VaultChunk,
  type VaultFile,
  chunkMarkdown,
  indexChunks,
  clearIndex,
  getIndexedChunkCount,
} from "./memory-search";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IndexStatus {
  totalFiles: number;
  indexedFiles: number;
  totalChunks: number;
  lastIndexed: number | null;
  staleFiles: number;
  embeddingsAvailable: boolean;
}

export interface IndexResult {
  filesProcessed: number;
  chunksCreated: number;
  filesSkipped: number;
  durationMs: number;
}

interface ChunkMeta {
  source: string;
  modifiedAt: number;
  chunkCount: number;
}

// ── Vault Index Manager ──────────────────────────────────────────────────────

/** Tracks which files have been indexed and when. */
const indexedFiles = new Map<string, ChunkMeta>();
let lastIndexedTime: number | null = null;

/**
 * Index the Obsidian vault for hybrid search.
 *
 * Process:
 * 1. Scan vault for all .md files (Rust command)
 * 2. Diff against previously indexed files (by modified timestamp)
 * 3. Read changed/new files in batches (Rust command)
 * 4. Chunk and add to BM25 index
 * 5. Optionally embed for vector search (if embeddings available)
 */
export async function indexVault(
  onProgress?: (indexed: number, total: number, phase: string) => void,
): Promise<IndexResult> {
  const startTime = Date.now();

  // Phase 1: Scan vault
  onProgress?.(0, 0, "Scanning vault...");
  const vaultFiles = await invoke<VaultFile[]>(TAURI_COMMANDS.SCAN_VAULT);

  if (vaultFiles.length === 0) {
    return { filesProcessed: 0, chunksCreated: 0, filesSkipped: 0, durationMs: Date.now() - startTime };
  }

  // Phase 2: Diff against indexed files
  const toProcess: VaultFile[] = [];
  const currentPaths = new Set(vaultFiles.map((f) => f.path));

  for (const file of vaultFiles) {
    const existing = indexedFiles.get(file.path);
    if (!existing || existing.modifiedAt < file.modified) {
      toProcess.push(file);
    }
  }

  // Remove files that no longer exist in the vault
  for (const path of indexedFiles.keys()) {
    if (!currentPaths.has(path)) {
      indexedFiles.delete(path);
    }
  }

  if (toProcess.length === 0) {
    lastIndexedTime = Date.now();
    return {
      filesProcessed: 0,
      chunksCreated: 0,
      filesSkipped: vaultFiles.length,
      durationMs: Date.now() - startTime,
    };
  }

  // Phase 3: Read files in batches
  const BATCH_SIZE = 50;
  let totalChunks = 0;
  let filesProcessed = 0;
  const allChunks: VaultChunk[] = [];

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const paths = batch.map((f) => f.path);

    onProgress?.(filesProcessed, toProcess.length, "Reading files...");

    const contents = await invoke<Array<[string, string]>>(
      TAURI_COMMANDS.READ_VAULT_FILES,
      { paths },
    );

    // Phase 4: Chunk each file
    for (const [path, content] of contents) {
      const file = batch.find((f) => f.path === path);
      if (!file) continue;

      const chunks = chunkMarkdown(content, path, file.modified * 1000); // convert to ms
      allChunks.push(...chunks);
      totalChunks += chunks.length;
      filesProcessed++;

      indexedFiles.set(path, {
        source: path,
        modifiedAt: file.modified,
        chunkCount: chunks.length,
      });
    }
  }

  // Phase 5: Add to BM25 index
  onProgress?.(filesProcessed, toProcess.length, "Building search index...");
  indexChunks(allChunks);

  // Phase 6: Try to embed for vector search (non-blocking)
  let embeddingsAvailable = false;
  try {
    const status = await invoke<{ initialized: boolean }>(TAURI_COMMANDS.GET_EMBEDDING_STATUS);
    embeddingsAvailable = status.initialized;
  } catch {
    // Embedding engine not available yet
  }

  if (embeddingsAvailable && allChunks.length > 0) {
    onProgress?.(filesProcessed, toProcess.length, "Generating embeddings...");
    try {
      const texts = allChunks.map((c) => c.content);
      const EMBED_BATCH = 100;
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        await invoke(TAURI_COMMANDS.EMBED_CHUNKS, { texts: batch });
        onProgress?.(
          Math.min(filesProcessed, toProcess.length),
          toProcess.length,
          `Embedding ${i + batch.length}/${texts.length} chunks...`,
        );
      }
    } catch {
      // Embedding failed — BM25 still works
    }
  }

  lastIndexedTime = Date.now();

  return {
    filesProcessed,
    chunksCreated: totalChunks,
    filesSkipped: vaultFiles.length - toProcess.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Full re-index: clears existing data and rebuilds from scratch.
 */
export async function reindexVault(
  onProgress?: (indexed: number, total: number, phase: string) => void,
): Promise<IndexResult> {
  clearIndex();
  indexedFiles.clear();
  lastIndexedTime = null;
  return indexVault(onProgress);
}

/**
 * Get the current index status.
 */
export async function getIndexStatus(): Promise<IndexStatus> {
  let totalFiles = 0;
  let staleFiles = 0;
  let embeddingsAvailable = false;

  try {
    const vaultFiles = await invoke<VaultFile[]>(TAURI_COMMANDS.SCAN_VAULT);
    totalFiles = vaultFiles.length;

    // Count stale files (modified since last index)
    for (const file of vaultFiles) {
      const existing = indexedFiles.get(file.path);
      if (!existing || existing.modifiedAt < file.modified) {
        staleFiles++;
      }
    }
  } catch {
    // Vault not configured
  }

  try {
    const status = await invoke<{ initialized: boolean }>(TAURI_COMMANDS.GET_EMBEDDING_STATUS);
    embeddingsAvailable = status.initialized;
  } catch {
    // Not available
  }

  return {
    totalFiles,
    indexedFiles: indexedFiles.size,
    totalChunks: getIndexedChunkCount(),
    lastIndexed: lastIndexedTime,
    staleFiles,
    embeddingsAvailable,
  };
}
