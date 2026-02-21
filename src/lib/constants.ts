// ── Centralized constants ────────────────────────────────────────────────────
// Single source of truth for magic strings used across multiple files.
// Prevents typo bugs and makes refactoring grep-friendly.

/** localStorage keys for user preferences and persisted state */
export const STORAGE_KEYS = {
  MODEL: "thunderclaude-model",
  ORCHESTRATION: "thunderclaude-orchestration",
  RESEARCH_DEPTH: "thunderclaude-research-depth",
  SIDEBAR: "thunderclaude-sidebar",
  MCP_SERVERS: "thunderclaude-mcp-servers",
  FILETREE_ROOT: "thunderclaude-filetree-root",
  SESSIONS: "thunderclaude-sessions",
  SKILLS: "thunderclaude-skills",
  TABS: "thunderclaude-tabs",
  PERMISSION_MODE: "thunderclaude-permission-mode",
  CUSTOM_INSTRUCTIONS: "thunderclaude-custom-instructions",
} as const;

/** Tauri event names emitted by the Rust backend */
export const TAURI_EVENTS = {
  MESSAGE: "claude-message",
  DONE: "claude-done",
  ERROR: "claude-error",
} as const;

/** Tauri invoke command names (must match #[tauri::command] in Rust) */
export const TAURI_COMMANDS = {
  SEND_QUERY: "send_query",
  CANCEL_QUERY: "cancel_query",
  CHECK_CLAUDE: "check_claude",
  LOAD_MEMORY: "load_memory_context",
  READ_MEMORY: "read_memory_file",
  WRITE_MEMORY: "write_memory_file",
  DELETE_MEMORY: "delete_memory_file",
  APPEND_MEMORY: "append_memory",
  LIST_MEMORY_DIR: "list_memory_dir",
  LIST_SESSIONS: "list_sessions",
  SAVE_SESSION: "save_session_file",
  LOAD_SESSION: "load_session_file",
  DELETE_SESSION: "delete_session_file",
  UPDATE_SESSION_TITLE: "update_session_title",
  TOGGLE_SESSION_PIN: "toggle_session_pin",
  MIGRATE_SESSIONS: "migrate_sessions_from_localstorage",
  APPEND_ANALYTICS: "append_analytics",
  LOAD_ANALYTICS: "load_analytics",
  SAVE_TEMP_IMAGE: "save_temp_image",
  SCAN_VAULT: "scan_vault",
  READ_VAULT_FILES: "read_vault_files",
  INIT_EMBEDDINGS: "init_embedding_model",
  EMBED_CHUNKS: "embed_chunks",
  SEARCH_VECTORS: "search_vectors",
  GET_EMBEDDING_STATUS: "get_embedding_status",
  SET_ACTIVE_PROJECT: "set_active_project",
  SAVE_PROJECTS: "save_projects",
  VALIDATE_DIRECTORY: "validate_directory",
} as const;
