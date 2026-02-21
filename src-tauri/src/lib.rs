mod claude;
mod search;

use claude::{ProcessRegistry, QueryConfig};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

// ── App settings (in-memory + disk persistence) ─────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectConfig {
    id: String,
    name: String,
    root_path: String,
    #[serde(default)]
    enabled_mcp_names: Vec<String>,
    #[serde(default)]
    enabled_skill_ids: Vec<String>,
    #[serde(default)]
    default_model: Option<String>,
    created_at: String,
    last_used_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Settings {
    close_to_tray: bool,
    #[serde(default)]
    vault_path: Option<String>,
    #[serde(default)]
    projects: Vec<ProjectConfig>,
    #[serde(default)]
    active_project_id: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            vault_path: None,
            projects: Vec::new(),
            active_project_id: None,
        }
    }
}

struct AppState {
    close_to_tray: Mutex<bool>,
    vault_path: Mutex<Option<String>>,
    projects: Mutex<Vec<ProjectConfig>>,
    active_project_id: Mutex<Option<String>>,
    active_project_root: Mutex<Option<String>>,
    processes: ProcessRegistry,
}

fn thunderclaude_dir() -> PathBuf {
    // USERPROFILE on Windows, HOME on Mac/Linux
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".thunderclaude")
}

fn settings_path() -> PathBuf {
    thunderclaude_dir().join("settings.json")
}

fn mcp_config_path() -> PathBuf {
    thunderclaude_dir().join("mcp-config.json")
}

/// Resolve the memory directory: use vault's ThunderClaude/ subfolder when
/// an Obsidian vault is configured, otherwise fall back to ~/.thunderclaude/memory/.
fn resolve_memory_dir(vault_path: &Option<String>) -> PathBuf {
    if let Some(vp) = vault_path {
        PathBuf::from(vp).join("ThunderClaude")
    } else {
        thunderclaude_dir().join("memory")
    }
}

fn load_settings_from_disk() -> Settings {
    let path = settings_path();
    if path.exists() {
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<Settings>(&json) {
                return settings;
            }
        }
    }
    Settings::default()
}

fn save_settings_to_disk(settings: &Settings) -> Result<(), String> {
    let dir = thunderclaude_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), json).map_err(|e| format!("Failed to write settings: {}", e))
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn send_query(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    config: QueryConfig,
) -> Result<String, String> {
    let query_id = uuid::Uuid::new_v4().to_string();
    let qid = query_id.clone();
    let registry = state.processes.clone();

    // Inject active project root as working directory (if not already set)
    let mut config = config;
    if config.cwd.is_none() {
        if let Some(root) = state.active_project_root.lock().unwrap().clone() {
            config.cwd = Some(root);
        }
    }

    tokio::spawn(async move {
        if let Err(e) = claude::run_query(&app, &qid, config, registry).await {
            eprintln!("Query error: {}", e);
            let _ = app.emit(
                "claude-error",
                serde_json::json!({ "queryId": qid, "data": e }),
            );
        }
    });
    Ok(query_id)
}

#[tauri::command]
async fn cancel_query(
    state: tauri::State<'_, AppState>,
    query_id: String,
) -> Result<bool, String> {
    let mut reg = state.processes.lock().await;
    if let Some(mut child) = reg.remove(&query_id) {
        let _ = child.kill().await;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Check if Claude CLI is available. Reuses the same discovery logic as run_query.
#[tauri::command]
async fn check_claude() -> Result<String, String> {
    let binary = claude::check_claude_available();
    if binary == "claude" {
        // "claude" is the PATH fallback — we didn't find a concrete installation
        Err("Claude CLI not found. Install via: npm install -g @anthropic-ai/claude-code".to_string())
    } else {
        Ok(binary)
    }
}

#[tauri::command]
async fn save_mcp_config(config_json: String) -> Result<String, String> {
    let path = mcp_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }
    std::fs::write(&path, &config_json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn load_mcp_config() -> Result<String, String> {
    let path = mcp_config_path();
    if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))
    } else {
        Ok(r#"{"mcpServers":{}}"#.to_string())
    }
}

#[tauri::command]
async fn get_mcp_config_path() -> Result<String, String> {
    let path = mcp_config_path();
    if path.exists() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("No MCP config file".to_string())
    }
}

#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> Result<Settings, String> {
    let close_to_tray = *state.close_to_tray.lock().unwrap();
    let vault_path = state.vault_path.lock().unwrap().clone();
    let projects = state.projects.lock().unwrap().clone();
    let active_project_id = state.active_project_id.lock().unwrap().clone();
    Ok(Settings { close_to_tray, vault_path, projects, active_project_id })
}

#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, AppState>,
    settings: Settings,
) -> Result<(), String> {
    *state.close_to_tray.lock().unwrap() = settings.close_to_tray;
    *state.vault_path.lock().unwrap() = settings.vault_path.clone();
    // Preserve project state (managed separately via save_projects)
    let projects = state.projects.lock().unwrap().clone();
    let active_project_id = state.active_project_id.lock().unwrap().clone();
    save_settings_to_disk(&Settings {
        close_to_tray: settings.close_to_tray,
        vault_path: settings.vault_path,
        projects,
        active_project_id,
    })
}

/// Load the Obsidian vault's CLAUDE.md for system prompt context.
/// Requires a vault_path to be configured in settings.
#[tauri::command]
async fn load_vault_context(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let vault_dir = state.vault_path.lock().unwrap().clone()
        .ok_or_else(|| "No Obsidian vault configured. Set a vault path in Settings.".to_string())?;
    let vault_claude = std::path::Path::new(&vault_dir).join("CLAUDE.md");
    if vault_claude.exists() {
        std::fs::read_to_string(&vault_claude)
            .map_err(|e| format!("Failed to read vault CLAUDE.md: {}", e))
    } else {
        Err(format!("CLAUDE.md not found in {}", vault_dir))
    }
}

// ── Memory system ──────────────────────────────────────────────────────────

/// Load composite memory context: MEMORY.md + today's + yesterday's daily logs.
#[tauri::command]
async fn load_memory_context(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let vault_path = state.vault_path.lock().unwrap().clone();
    let dir = resolve_memory_dir(&vault_path);
    let mut sections: Vec<String> = Vec::new();

    // Persistent memory
    let mem_file = dir.join("MEMORY.md");
    if mem_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&mem_file) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                sections.push(format!("### Persistent Memory\n{}", trimmed));
            }
        }
    }

    // Daily logs (today + yesterday)
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let yesterday = (chrono::Local::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    let daily_dir = dir.join("daily");
    for (label, date) in [("Today", &today), ("Yesterday", &yesterday)] {
        let path = daily_dir.join(format!("{}.md", date));
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    sections.push(format!("### {} ({})\n{}", label, date, trimmed));
                }
            }
        }
    }

    if sections.is_empty() {
        Ok(String::new())
    } else {
        Ok(sections.join("\n\n"))
    }
}

/// Read a specific file from the memory directory.
#[tauri::command]
async fn read_memory_file(state: tauri::State<'_, AppState>, filename: String) -> Result<String, String> {
    let vault_path = state.vault_path.lock().unwrap().clone();
    let path = resolve_memory_dir(&vault_path).join(&filename);
    if path.exists() {
        std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read memory file: {}", e))
    } else {
        Ok(String::new())
    }
}

/// Write (overwrite) a file in the memory directory.
#[tauri::command]
async fn write_memory_file(state: tauri::State<'_, AppState>, filename: String, content: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().unwrap().clone();
    let path = resolve_memory_dir(&vault_path).join(&filename);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create memory dir: {}", e))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write memory file: {}", e))
}

/// Delete a file from the memory directory. Silently succeeds if file doesn't exist.
#[tauri::command]
async fn delete_memory_file(state: tauri::State<'_, AppState>, filename: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().unwrap().clone();
    let path = resolve_memory_dir(&vault_path).join(&filename);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete memory file: {}", e))?;
    }
    Ok(())
}

/// Append content to a file in the memory directory (creates if missing).
#[tauri::command]
async fn append_memory(state: tauri::State<'_, AppState>, filename: String, content: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().unwrap().clone();
    let path = resolve_memory_dir(&vault_path).join(&filename);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create memory dir: {}", e))?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open memory file: {}", e))?;
    writeln!(file, "{}", content)
        .map_err(|e| format!("Failed to append to memory file: {}", e))
}

/// List files in a subdirectory of the memory dir (e.g., "research", "sessions").
/// Returns an empty vec if the directory doesn't exist.
#[derive(serde::Serialize)]
struct MemoryFileInfo {
    name: String,
    size: u64,
    /// Unix timestamp in seconds (most recent first)
    modified: u64,
}

#[tauri::command]
async fn list_memory_dir(
    state: tauri::State<'_, AppState>,
    subdir: String,
) -> Result<Vec<MemoryFileInfo>, String> {
    let vault_path = state.vault_path.lock().unwrap().clone();
    let dir = resolve_memory_dir(&vault_path).join(&subdir);

    if !dir.exists() || !dir.is_dir() {
        return Ok(Vec::new());
    }

    let read_dir = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read memory dir: {}", e))?;

    let mut entries: Vec<MemoryFileInfo> = Vec::new();
    for entry in read_dir.flatten() {
        let metadata = entry.metadata().ok();
        let is_file = metadata.as_ref().map(|m| m.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        entries.push(MemoryFileInfo {
            name,
            size,
            modified,
        });
    }

    // Most recent first
    entries.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(entries)
}

// ── Vault scanning (for hybrid search indexing) ──────────────────────────────

#[derive(serde::Serialize)]
struct VaultFile {
    path: String,
    modified: u64,
    size: u64,
}

/// Recursively scan the Obsidian vault for .md files.
/// Returns relative paths, modification timestamps, and file sizes.
/// Skips: .obsidian/, .git/, .trash/, node_modules/
#[tauri::command]
async fn scan_vault(state: tauri::State<'_, AppState>) -> Result<Vec<VaultFile>, String> {
    let vault_path = state.vault_path.lock().unwrap().clone()
        .ok_or_else(|| "No Obsidian vault configured. Set a vault path in Settings.".to_string())?;

    let root = std::path::Path::new(&vault_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Vault path does not exist: {}", vault_path));
    }

    let ignored: std::collections::HashSet<&str> = [
        ".obsidian", ".git", ".trash", "node_modules", ".DS_Store",
    ].into_iter().collect();

    let mut files: Vec<VaultFile> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            if metadata.is_dir() {
                if !ignored.contains(name.as_str()) {
                    stack.push(entry.path());
                }
                continue;
            }

            // Only index .md files
            if !name.ends_with(".md") {
                continue;
            }

            let rel_path = entry.path()
                .strip_prefix(root)
                .unwrap_or(entry.path().as_path())
                .to_string_lossy()
                .replace('\\', "/"); // normalize to forward slashes

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(VaultFile {
                path: rel_path,
                modified,
                size: metadata.len(),
            });
        }
    }

    // Sort by modification time (most recent first)
    files.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(files)
}

/// Read the content of multiple vault files in a batch.
/// Returns pairs of (relative_path, content). Skips files that fail to read.
#[tauri::command]
async fn read_vault_files(
    state: tauri::State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    let vault_path = state.vault_path.lock().unwrap().clone()
        .ok_or_else(|| "No Obsidian vault configured.".to_string())?;

    let root = std::path::Path::new(&vault_path);
    let mut results: Vec<(String, String)> = Vec::new();

    for rel_path in &paths {
        let full_path = root.join(rel_path);
        if let Ok(content) = std::fs::read_to_string(&full_path) {
            results.push((rel_path.clone(), content));
        }
    }

    Ok(results)
}

// ── Session storage (filesystem-backed) ──────────────────────────────────────

fn sessions_dir() -> PathBuf {
    thunderclaude_dir().join("sessions")
}

fn sessions_index_path() -> PathBuf {
    sessions_dir().join("_index.json")
}

/// Lightweight session metadata for the sidebar (no messages).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIndex {
    id: String,
    #[serde(default)]
    session_id: Option<String>,
    title: String,
    model: String,
    message_count: usize,
    timestamp: f64,
    last_activity: f64,
    #[serde(default)]
    pinned: bool,
}

/// Full session data (with messages) — saved as individual JSON files.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionData {
    id: String,
    #[serde(default)]
    session_id: Option<String>,
    title: String,
    model: String,
    message_count: usize,
    timestamp: f64,
    last_activity: f64,
    #[serde(default)]
    pinned: bool,
    messages: serde_json::Value,
}

/// Load the sessions index (lightweight metadata for sidebar).
#[tauri::command]
async fn list_sessions() -> Result<Vec<SessionIndex>, String> {
    let path = sessions_index_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read sessions index: {}", e))?;
    let sessions: Vec<SessionIndex> = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse sessions index: {}", e))?;
    Ok(sessions)
}

/// Save the sessions index to disk.
fn write_sessions_index(sessions: &[SessionIndex]) -> Result<(), String> {
    let dir = sessions_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create sessions dir: {}", e))?;
    let json = serde_json::to_string(sessions)
        .map_err(|e| format!("Failed to serialize sessions index: {}", e))?;
    std::fs::write(sessions_index_path(), json)
        .map_err(|e| format!("Failed to write sessions index: {}", e))
}

/// Save a full session (messages + metadata). Updates the index atomically.
#[tauri::command]
async fn save_session_file(session: SessionData) -> Result<(), String> {
    let dir = sessions_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create sessions dir: {}", e))?;

    // Write the full session data to its own file
    let file_path = dir.join(format!("{}.json", session.id));
    let data_json = serde_json::to_string(&session)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;
    std::fs::write(&file_path, &data_json)
        .map_err(|e| format!("Failed to write session file: {}", e))?;

    // Update the index
    let mut index = list_sessions_internal()?;
    let entry = SessionIndex {
        id: session.id.clone(),
        session_id: session.session_id,
        title: session.title,
        model: session.model,
        message_count: session.message_count,
        timestamp: session.timestamp,
        last_activity: session.last_activity,
        pinned: session.pinned,
    };

    if let Some(pos) = index.iter().position(|s| s.id == session.id) {
        // Preserve pinned if not explicitly set
        if !session.pinned && index[pos].pinned {
            let mut e = entry;
            e.pinned = true;
            index[pos] = e;
        } else {
            index[pos] = entry;
        }
    } else {
        index.insert(0, entry);
    }

    write_sessions_index(&index)
}

/// Internal helper (no Tauri wrapper) for reading the index.
fn list_sessions_internal() -> Result<Vec<SessionIndex>, String> {
    let path = sessions_index_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read sessions index: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse sessions index: {}", e))
}

/// Load a full session by ID (messages included).
#[tauri::command]
async fn load_session_file(id: String) -> Result<SessionData, String> {
    let path = sessions_dir().join(format!("{}.json", id));
    if !path.exists() {
        return Err(format!("Session not found: {}", id));
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read session: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse session: {}", e))
}

/// Delete a session file and remove from index.
#[tauri::command]
async fn delete_session_file(id: String) -> Result<(), String> {
    // Remove the data file
    let path = sessions_dir().join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete session file: {}", e))?;
    }

    // Update the index
    let mut index = list_sessions_internal()?;
    index.retain(|s| s.id != id);
    write_sessions_index(&index)
}

/// Update session title in the index (and the data file).
#[tauri::command]
async fn update_session_title(id: String, title: String) -> Result<(), String> {
    // Update index
    let mut index = list_sessions_internal()?;
    if let Some(entry) = index.iter_mut().find(|s| s.id == id) {
        entry.title = title.clone();
    }
    write_sessions_index(&index)?;

    // Update the data file too (so loaded sessions show the right title)
    let path = sessions_dir().join(format!("{}.json", id));
    if path.exists() {
        let json = std::fs::read_to_string(&path).unwrap_or_default();
        if let Ok(mut data) = serde_json::from_str::<SessionData>(&json) {
            data.title = title;
            if let Ok(updated) = serde_json::to_string(&data) {
                let _ = std::fs::write(&path, updated);
            }
        }
    }

    Ok(())
}

/// Toggle pinned state. Returns the new pinned value.
#[tauri::command]
async fn toggle_session_pin(id: String) -> Result<bool, String> {
    let mut index = list_sessions_internal()?;
    let entry = index.iter_mut().find(|s| s.id == id)
        .ok_or_else(|| format!("Session not found: {}", id))?;
    entry.pinned = !entry.pinned;
    let new_pinned = entry.pinned;
    write_sessions_index(&index)?;

    // Update the data file too
    let path = sessions_dir().join(format!("{}.json", id));
    if path.exists() {
        let json = std::fs::read_to_string(&path).unwrap_or_default();
        if let Ok(mut data) = serde_json::from_str::<SessionData>(&json) {
            data.pinned = new_pinned;
            if let Ok(updated) = serde_json::to_string(&data) {
                let _ = std::fs::write(&path, updated);
            }
        }
    }

    Ok(new_pinned)
}

/// Migrate sessions from localStorage JSON (called once from frontend).
/// Receives the full array of sessions and writes them all to disk.
#[tauri::command]
async fn migrate_sessions_from_localstorage(sessions: Vec<SessionData>) -> Result<usize, String> {
    let dir = sessions_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create sessions dir: {}", e))?;

    let mut index: Vec<SessionIndex> = Vec::new();
    let count = sessions.len();

    for session in &sessions {
        // Write data file
        let file_path = dir.join(format!("{}.json", session.id));
        if let Ok(json) = serde_json::to_string(session) {
            let _ = std::fs::write(&file_path, json);
        }

        // Add to index
        index.push(SessionIndex {
            id: session.id.clone(),
            session_id: session.session_id.clone(),
            title: session.title.clone(),
            model: session.model.clone(),
            message_count: session.message_count,
            timestamp: session.timestamp,
            last_activity: session.last_activity,
            pinned: session.pinned,
        });
    }

    write_sessions_index(&index)?;
    Ok(count)
}

#[tauri::command]
async fn get_working_directory(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    if let Some(root) = state.active_project_root.lock().unwrap().clone() {
        return Ok(root);
    }
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get working directory: {}", e))
}

// ── Project context commands ─────────────────────────────────────────────────

#[tauri::command]
async fn set_active_project(
    state: tauri::State<'_, AppState>,
    id: Option<String>,
    root_path: Option<String>,
) -> Result<(), String> {
    *state.active_project_id.lock().unwrap() = id;
    *state.active_project_root.lock().unwrap() = root_path;
    Ok(())
}

#[tauri::command]
async fn save_projects(
    state: tauri::State<'_, AppState>,
    projects: Vec<ProjectConfig>,
    active_project_id: Option<String>,
) -> Result<(), String> {
    *state.projects.lock().unwrap() = projects.clone();
    *state.active_project_id.lock().unwrap() = active_project_id.clone();
    let close_to_tray = *state.close_to_tray.lock().unwrap();
    let vault_path = state.vault_path.lock().unwrap().clone();
    save_settings_to_disk(&Settings {
        close_to_tray,
        vault_path,
        projects,
        active_project_id,
    })
}

#[tauri::command]
async fn validate_directory(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !p.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    std::fs::canonicalize(p)
        .map(|abs| abs.to_string_lossy().replace('\\', "/"))
        .map_err(|e| format!("Failed to resolve path: {}", e))
}

// ── File system commands (for file tree + @ mentions) ────────────────────────

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    extension: String,
}

#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    // Normalize bare drive letters: "C:" → "C:\" (otherwise resolves to CWD on that drive)
    let path = if path.len() == 2 && path.ends_with(':') {
        format!("{}\\", path)
    } else {
        path
    };
    let dir = std::path::Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Not a valid directory: {}", path));
    }

    let read_dir = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in read_dir.flatten() {
        let metadata = entry.metadata().ok();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let extension = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();

        entries.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
            size,
            extension,
        });
    }

    // Directories first, then alphabetically (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Recursive file search for @ mention autocomplete.
/// Walks from `root`, skips ignored dirs, returns files matching `query` (case-insensitive substring).
/// Limited to 20 results for speed.
#[tauri::command]
async fn search_files(root: String, query: String) -> Result<Vec<DirEntry>, String> {
    let root_path = std::path::Path::new(&root);
    if !root_path.exists() || !root_path.is_dir() {
        return Err(format!("Not a valid directory: {}", root));
    }

    let query_lower = query.to_lowercase();
    let ignored: std::collections::HashSet<&str> = [
        "node_modules", ".git", ".next", "dist", "build", "__pycache__",
        ".cache", "target", ".turbo", ".vercel", ".svelte-kit", "coverage",
    ].into_iter().collect();

    let mut results: Vec<DirEntry> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root_path.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if results.len() >= 20 { break; }

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if results.len() >= 20 { break; }

            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata().ok();
            let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);

            if is_dir {
                if !ignored.contains(name.as_str()) {
                    stack.push(entry.path());
                }
                // Also match folder names
                if name.to_lowercase().contains(&query_lower) {
                    results.push(DirEntry {
                        name: name.clone(),
                        path: entry.path().to_string_lossy().to_string(),
                        is_dir: true,
                        size: 0,
                        extension: String::new(),
                    });
                }
            } else if name.to_lowercase().contains(&query_lower) {
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                let extension = entry.path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_string())
                    .unwrap_or_default();
                results.push(DirEntry {
                    name,
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir: false,
                    size,
                    extension,
                });
            }
        }
    }

    // Sort: exact prefix matches first, then by name
    results.sort_by(|a, b| {
        let a_starts = a.name.to_lowercase().starts_with(&query_lower);
        let b_starts = b.name.to_lowercase().starts_with(&query_lower);
        b_starts.cmp(&a_starts)
            .then(a.is_dir.cmp(&b.is_dir).reverse())
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(results)
}

#[tauri::command]
async fn create_file(path: String, content: Option<String>) -> Result<(), String> {
    let file = std::path::Path::new(&path);
    if file.exists() {
        return Err(format!("Already exists: {}", path));
    }
    if let Some(parent) = file.parent() {
        if !parent.exists() {
            return Err(format!("Parent directory does not exist: {}", parent.display()));
        }
    }
    std::fs::write(&path, content.unwrap_or_default())
        .map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
async fn create_directory(path: String) -> Result<(), String> {
    let dir = std::path::Path::new(&path);
    if dir.exists() {
        return Err(format!("Already exists: {}", path));
    }
    if let Some(parent) = dir.parent() {
        if !parent.exists() {
            return Err(format!("Parent directory does not exist: {}", parent.display()));
        }
    }
    std::fs::create_dir(&path).map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    let file = std::path::Path::new(&path);
    if !file.exists() {
        return Err(format!("File not found: {}", path));
    }
    if file.is_dir() {
        return Err("Cannot read directory as file".to_string());
    }
    let metadata =
        std::fs::metadata(file).map_err(|e| format!("Failed to read metadata: {}", e))?;
    if metadata.len() > 1024 * 1024 {
        return Err(format!(
            "File too large: {} bytes (max 1MB)",
            metadata.len()
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

// ── Cost analytics persistence ──────────────────────────────────────────────

fn analytics_path() -> PathBuf {
    thunderclaude_dir().join("analytics.json")
}

/// Append a cost entry to the analytics log. Each entry is a JSON object on one line.
#[tauri::command]
async fn append_analytics(entry_json: String) -> Result<(), String> {
    let path = analytics_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open analytics: {}", e))?;
    writeln!(file, "{}", entry_json.trim())
        .map_err(|e| format!("Failed to write analytics: {}", e))?;
    Ok(())
}

/// Read all analytics entries (newline-delimited JSON).
#[tauri::command]
async fn load_analytics() -> Result<String, String> {
    let path = analytics_path();
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read analytics: {}", e))
}

// ── Temp image storage (for vision/image input) ─────────────────────────────

/// Save base64-encoded image data to a temp file. Returns the absolute path.
/// Used by the frontend to pass images to CLI processes via file path references.
#[tauri::command]
async fn save_temp_image(name: String, base64_data: String) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("base64 decode failed: {}", e))?;

    let dir = std::env::temp_dir().join("thunderclaude-images");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create temp image dir: {}", e))?;

    let filename = format!("{}_{}", uuid::Uuid::new_v4(), name);
    let path = dir.join(&filename);
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write temp image: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

// ── Main entry point ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_settings = load_settings_from_disk();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState {
            close_to_tray: Mutex::new(initial_settings.close_to_tray),
            vault_path: Mutex::new(initial_settings.vault_path.clone()),
            active_project_root: Mutex::new(
                initial_settings.active_project_id.as_ref().and_then(|id| {
                    initial_settings.projects.iter()
                        .find(|p| &p.id == id)
                        .map(|p| p.root_path.clone())
                })
            ),
            projects: Mutex::new(initial_settings.projects),
            active_project_id: Mutex::new(initial_settings.active_project_id),
            processes: std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        })
        .manage(search::SearchState::new())
        .setup(|app| {
            // Build tray context menu
            let show = MenuItem::with_id(app, "show", "Show ThunderClaude", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit ThunderClaude", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // Build tray icon
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("ThunderClaude")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                if *state.close_to_tray.lock().unwrap() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            send_query,
            cancel_query,
            check_claude,
            save_mcp_config,
            load_mcp_config,
            get_mcp_config_path,
            get_settings,
            save_settings,
            load_vault_context,
            load_memory_context,
            read_memory_file,
            write_memory_file,
            delete_memory_file,
            append_memory,
            list_memory_dir,
            list_sessions,
            save_session_file,
            load_session_file,
            delete_session_file,
            update_session_title,
            toggle_session_pin,
            migrate_sessions_from_localstorage,
            get_working_directory,
            set_active_project,
            save_projects,
            validate_directory,
            list_directory,
            search_files,
            read_file_content,
            create_file,
            create_directory,
            append_analytics,
            load_analytics,
            save_temp_image,
            scan_vault,
            read_vault_files,
            search::init_embedding_model,
            search::embed_chunks,
            search::search_vectors,
            search::get_embedding_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
