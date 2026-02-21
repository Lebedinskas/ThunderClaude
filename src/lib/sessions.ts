import { invoke } from "@tauri-apps/api/core";
import { ChatMessage } from "./claude-protocol";
import { STORAGE_KEYS, TAURI_COMMANDS } from "./constants";

/** Lightweight session metadata for the sidebar (no messages). */
export interface SessionIndexEntry {
  id: string;
  sessionId: string | null;
  title: string;
  model: string;
  messageCount: number;
  timestamp: number;
  lastActivity: number;
  pinned: boolean;
}

/** Full session data with messages (stored in individual files). */
export interface SessionInfo {
  id: string;
  sessionId: string | null;
  title: string;
  model: string;
  messageCount: number;
  timestamp: number;
  lastActivity: number;
  messages: ChatMessage[];
  pinned?: boolean;
  /** Active branch choices for conversation branching (parentId → child index). */
  activeBranches?: Record<string, number>;
}

// ── Filesystem-backed session operations ─────────────────────────────────────

/** Load the lightweight session index for the sidebar. */
export async function loadSessionIndex(): Promise<SessionIndexEntry[]> {
  try {
    return await invoke<SessionIndexEntry[]>(TAURI_COMMANDS.LIST_SESSIONS);
  } catch {
    return [];
  }
}

/** Save a full session (messages + metadata) to its own file. */
export async function saveSession(session: SessionInfo): Promise<void> {
  try {
    await invoke(TAURI_COMMANDS.SAVE_SESSION, {
      session: {
        id: session.id,
        sessionId: session.sessionId,
        title: session.title,
        model: session.model,
        messageCount: session.messageCount,
        timestamp: session.timestamp,
        lastActivity: session.lastActivity,
        pinned: session.pinned ?? false,
        messages: session.messages,
      },
    });
  } catch (e) {
    console.error("[sessions] Failed to save:", e);
  }
}

/** Load a full session by ID (with messages). */
export async function loadSessionById(id: string): Promise<SessionInfo | null> {
  try {
    return await invoke<SessionInfo>(TAURI_COMMANDS.LOAD_SESSION, { id });
  } catch {
    return null;
  }
}

/** Delete a session. */
export async function deleteSession(id: string): Promise<void> {
  try {
    await invoke(TAURI_COMMANDS.DELETE_SESSION, { id });
  } catch (e) {
    console.error("[sessions] Failed to delete:", e);
  }
}

/** Update just the title of a session. */
export async function updateSessionTitle(id: string, title: string): Promise<void> {
  try {
    await invoke(TAURI_COMMANDS.UPDATE_SESSION_TITLE, { id, title });
  } catch (e) {
    console.error("[sessions] Failed to update title:", e);
  }
}

/** Toggle pinned state. Returns the new pinned value. */
export async function toggleSessionPin(id: string): Promise<boolean | null> {
  try {
    return await invoke<boolean>(TAURI_COMMANDS.TOGGLE_SESSION_PIN, { id });
  } catch {
    return null;
  }
}

// ── Migration from localStorage (one-time) ──────────────────────────────────

const MIGRATION_KEY = "thunderclaude-sessions-migrated";

/** Migrate localStorage sessions to filesystem (runs once). */
export async function migrateSessionsIfNeeded(): Promise<void> {
  // Skip if already migrated
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS);
  if (!raw) {
    localStorage.setItem(MIGRATION_KEY, "true");
    return;
  }

  try {
    const sessions = JSON.parse(raw) as SessionInfo[];
    if (sessions.length === 0) {
      localStorage.setItem(MIGRATION_KEY, "true");
      return;
    }

    const migrated = sessions.map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      title: s.title,
      model: s.model,
      messageCount: s.messageCount,
      timestamp: s.timestamp,
      lastActivity: s.lastActivity,
      pinned: s.pinned ?? false,
      messages: s.messages,
    }));

    const count = await invoke<number>(TAURI_COMMANDS.MIGRATE_SESSIONS, { sessions: migrated });
    console.log(`[sessions] Migrated ${count} sessions from localStorage to filesystem`);

    // Clean up localStorage
    localStorage.removeItem(STORAGE_KEYS.SESSIONS);
    localStorage.setItem(MIGRATION_KEY, "true");
  } catch (e) {
    console.error("[sessions] Migration failed:", e);
    // Don't set the flag — retry on next launch
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function generateTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New Chat";
  const text = firstUser.content.trim();
  if (text.length <= 40) return text;
  return text.slice(0, 37) + "...";
}
