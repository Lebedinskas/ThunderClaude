use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write as IoWrite};
use std::path::PathBuf;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct EmbeddingStatus {
    pub initialized: bool,
    pub model_name: String,
    pub dimension: usize,
    pub chunks_indexed: usize,
    pub last_indexed: Option<u64>,
    pub indexing_in_progress: bool,
}

impl Default for EmbeddingStatus {
    fn default() -> Self {
        Self {
            initialized: false,
            model_name: "all-MiniLM-L6-v2".to_string(),
            dimension: 384,
            chunks_indexed: 0,
            last_indexed: None,
            indexing_in_progress: false,
        }
    }
}

#[derive(Serialize)]
pub struct VectorMatch {
    pub id: String,
    pub score: f32,
}

#[derive(Serialize, Deserialize)]
struct ChunkMeta {
    id: String,
    source: String,
    heading: Option<String>,
    content_hash: String,
    modified_at: u64,
}

// ── State ────────────────────────────────────────────────────────────────────

pub struct SearchState {
    embedder: tokio::sync::Mutex<Option<TextEmbedding>>,
    status: std::sync::Mutex<EmbeddingStatus>,
    index: tokio::sync::Mutex<VectorIndex>,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            embedder: tokio::sync::Mutex::new(None),
            status: std::sync::Mutex::new(EmbeddingStatus::default()),
            index: tokio::sync::Mutex::new(VectorIndex::new()),
        }
    }
}

// ── Vector Index (in-memory + disk persistence) ──────────────────────────────

struct VectorIndex {
    /// Chunk IDs in order (aligned with vectors)
    ids: Vec<String>,
    /// Flat vector storage: ids.len() × dimension
    vectors: Vec<f32>,
    /// Metadata per chunk
    meta: Vec<ChunkMeta>,
    dimension: usize,
}

impl VectorIndex {
    fn new() -> Self {
        Self {
            ids: Vec::new(),
            vectors: Vec::new(),
            meta: Vec::new(),
            dimension: 384,
        }
    }

    fn len(&self) -> usize {
        self.ids.len()
    }

    /// Add a batch of vectors with their IDs and metadata.
    fn add_batch(&mut self, ids: &[String], vectors: &[Vec<f32>], meta: Vec<ChunkMeta>) {
        for (i, id) in ids.iter().enumerate() {
            // Remove old version if exists
            if let Some(pos) = self.ids.iter().position(|x| x == id) {
                self.ids.remove(pos);
                let start = pos * self.dimension;
                self.vectors.drain(start..start + self.dimension);
                self.meta.remove(pos);
            }

            self.ids.push(id.clone());
            self.vectors.extend_from_slice(&vectors[i]);
            if i < meta.len() {
                self.meta.push(ChunkMeta {
                    id: id.clone(),
                    ..meta[i].clone()
                });
            }
        }
    }

    /// Cosine similarity search. Returns top-K results sorted by score.
    fn search(&self, query_vector: &[f32], top_k: usize) -> Vec<VectorMatch> {
        if self.ids.is_empty() || query_vector.len() != self.dimension {
            return Vec::new();
        }

        // Precompute query norm
        let q_norm: f32 = query_vector.iter().map(|x| x * x).sum::<f32>().sqrt();
        if q_norm == 0.0 {
            return Vec::new();
        }

        let mut scores: Vec<(usize, f32)> = Vec::with_capacity(self.ids.len());

        for i in 0..self.ids.len() {
            let offset = i * self.dimension;
            let doc_vec = &self.vectors[offset..offset + self.dimension];

            let mut dot = 0.0f32;
            let mut d_norm = 0.0f32;
            for j in 0..self.dimension {
                dot += query_vector[j] * doc_vec[j];
                d_norm += doc_vec[j] * doc_vec[j];
            }
            d_norm = d_norm.sqrt();

            let score = if d_norm > 0.0 {
                dot / (q_norm * d_norm)
            } else {
                0.0
            };

            scores.push((i, score));
        }

        // Partial sort for top-K
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scores.truncate(top_k);

        scores
            .into_iter()
            .filter(|(_, s)| *s > 0.0)
            .map(|(i, s)| VectorMatch {
                id: self.ids[i].clone(),
                score: s,
            })
            .collect()
    }

    /// Save to disk: binary vectors + JSONL metadata.
    fn save(&self, dir: &std::path::Path) -> Result<(), String> {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create vectors dir: {}", e))?;

        // Write binary vectors
        let vec_path = dir.join("vault-vectors.bin");
        let mut file = std::fs::File::create(&vec_path)
            .map_err(|e| format!("Failed to create vectors file: {}", e))?;

        // Header: magic + version + dimension + count
        use byteorder::{LittleEndian, WriteBytesExt};
        file.write_all(b"TCVX").map_err(|e| e.to_string())?;
        file.write_u32::<LittleEndian>(1).map_err(|e| e.to_string())?; // version
        file.write_u32::<LittleEndian>(self.dimension as u32)
            .map_err(|e| e.to_string())?;
        file.write_u32::<LittleEndian>(self.ids.len() as u32)
            .map_err(|e| e.to_string())?;

        // Write packed f32 vectors
        for v in &self.vectors {
            file.write_f32::<LittleEndian>(*v)
                .map_err(|e| e.to_string())?;
        }

        // Write metadata as JSONL
        let meta_path = dir.join("vault-meta.jsonl");
        let mut meta_file = std::fs::File::create(&meta_path)
            .map_err(|e| format!("Failed to create meta file: {}", e))?;

        for m in &self.meta {
            let json = serde_json::to_string(m).map_err(|e| e.to_string())?;
            writeln!(meta_file, "{}", json).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// Load from disk.
    fn load(dir: &std::path::Path) -> Result<Self, String> {
        let vec_path = dir.join("vault-vectors.bin");
        let meta_path = dir.join("vault-meta.jsonl");

        if !vec_path.exists() || !meta_path.exists() {
            return Ok(Self::new());
        }

        // Read binary vectors
        use byteorder::{LittleEndian, ReadBytesExt};
        let mut file = std::fs::File::open(&vec_path)
            .map_err(|e| format!("Failed to open vectors: {}", e))?;

        let mut magic = [0u8; 4];
        std::io::Read::read_exact(&mut file, &mut magic).map_err(|e| e.to_string())?;
        if &magic != b"TCVX" {
            return Err("Invalid vector file magic".to_string());
        }

        let _version = file.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
        let dimension = file.read_u32::<LittleEndian>().map_err(|e| e.to_string())? as usize;
        let count = file.read_u32::<LittleEndian>().map_err(|e| e.to_string())? as usize;

        let mut vectors = vec![0.0f32; count * dimension];
        for v in vectors.iter_mut() {
            *v = file.read_f32::<LittleEndian>().map_err(|e| e.to_string())?;
        }

        // Read metadata
        let meta_file = std::fs::File::open(&meta_path)
            .map_err(|e| format!("Failed to open meta: {}", e))?;
        let reader = std::io::BufReader::new(meta_file);

        let mut ids = Vec::with_capacity(count);
        let mut meta = Vec::with_capacity(count);

        for line in reader.lines() {
            let line = line.map_err(|e| e.to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            let m: ChunkMeta = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            ids.push(m.id.clone());
            meta.push(m);
        }

        Ok(Self {
            ids,
            vectors,
            meta,
            dimension,
        })
    }

    #[allow(dead_code)]
    fn clear(&mut self) {
        self.ids.clear();
        self.vectors.clear();
        self.meta.clear();
    }
}

// Implement Clone for ChunkMeta manually since Deserialize is derived
impl Clone for ChunkMeta {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            source: self.source.clone(),
            heading: self.heading.clone(),
            content_hash: self.content_hash.clone(),
            modified_at: self.modified_at,
        }
    }
}

// ── Storage paths ────────────────────────────────────────────────────────────

fn vectors_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".thunderclaude").join("vectors")
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Initialize the embedding model. Downloads on first use (~22MB), cached after.
#[tauri::command]
pub async fn init_embedding_model(
    state: tauri::State<'_, SearchState>,
) -> Result<EmbeddingStatus, String> {
    let mut embedder_lock = state.embedder.lock().await;

    if embedder_lock.is_some() {
        let status = state.status.lock().unwrap().clone();
        return Ok(status);
    }

    // Initialize fastembed with all-MiniLM-L6-v2
    let mut opts = InitOptions::new(EmbeddingModel::AllMiniLML6V2);
    opts.show_download_progress = false;
    let model = TextEmbedding::try_new(opts)
        .map_err(|e| format!("Failed to init embedding model: {}", e))?;

    *embedder_lock = Some(model);

    // Load existing index from disk
    let mut index_lock = state.index.lock().await;
    match VectorIndex::load(&vectors_dir()) {
        Ok(loaded) => {
            let count = loaded.len();
            *index_lock = loaded;

            let mut status = state.status.lock().unwrap();
            status.initialized = true;
            status.chunks_indexed = count;
            Ok(status.clone())
        }
        Err(e) => {
            eprintln!("Warning: Failed to load vector index: {}", e);
            let mut status = state.status.lock().unwrap();
            status.initialized = true;
            Ok(status.clone())
        }
    }
}

/// Embed text chunks and store in the vector index.
/// Accepts chunk IDs, texts, and metadata for incremental indexing.
#[tauri::command]
pub async fn embed_chunks(
    state: tauri::State<'_, SearchState>,
    ids: Vec<String>,
    texts: Vec<String>,
    sources: Vec<String>,
    content_hashes: Vec<String>,
    modified_ats: Vec<u64>,
) -> Result<usize, String> {
    let embedder_lock = state.embedder.lock().await;
    let embedder = embedder_lock
        .as_ref()
        .ok_or("Embedding model not initialized. Call init_embedding_model first.")?;

    if texts.is_empty() {
        return Ok(0);
    }

    // Generate embeddings
    let embeddings = embedder
        .embed(texts.clone(), None)
        .map_err(|e| format!("Embedding failed: {}", e))?;

    let count = embeddings.len();

    // Build metadata
    let meta: Vec<ChunkMeta> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| ChunkMeta {
            id: id.clone(),
            source: sources.get(i).cloned().unwrap_or_default(),
            heading: None,
            content_hash: content_hashes.get(i).cloned().unwrap_or_default(),
            modified_at: modified_ats.get(i).copied().unwrap_or(0),
        })
        .collect();

    // Add to index
    let mut index_lock = state.index.lock().await;
    index_lock.add_batch(&ids, &embeddings, meta);

    // Update status
    {
        let mut status = state.status.lock().unwrap();
        status.chunks_indexed = index_lock.len();
        status.last_indexed = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        );
    }

    // Persist to disk
    if let Err(e) = index_lock.save(&vectors_dir()) {
        eprintln!("Warning: Failed to save vector index: {}", e);
    }

    Ok(count)
}

/// Search the vector index for chunks similar to the query text.
#[tauri::command]
pub async fn search_vectors(
    state: tauri::State<'_, SearchState>,
    query: String,
    top_k: usize,
) -> Result<Vec<VectorMatch>, String> {
    let embedder_lock = state.embedder.lock().await;
    let embedder = embedder_lock
        .as_ref()
        .ok_or("Embedding model not initialized.")?;

    // Embed the query
    let query_embeddings = embedder
        .embed(vec![query], None)
        .map_err(|e| format!("Query embedding failed: {}", e))?;

    let query_vec = query_embeddings
        .first()
        .ok_or("Failed to generate query embedding")?;

    // Search
    let index_lock = state.index.lock().await;
    Ok(index_lock.search(query_vec, top_k))
}

/// Get the current embedding engine status.
#[tauri::command]
pub async fn get_embedding_status(
    state: tauri::State<'_, SearchState>,
) -> Result<EmbeddingStatus, String> {
    Ok(state.status.lock().unwrap().clone())
}
