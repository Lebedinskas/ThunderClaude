import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "./constants";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectConfig {
  id: string;
  name: string;
  rootPath: string;
  enabledMcpNames: string[];
  enabledSkillIds: string[];
  defaultModel?: string;
  createdAt: string;
  lastUsedAt: string;
}

// ── Tauri wrappers ───────────────────────────────────────────────────────────

/** Load projects and active project ID from Rust settings. */
export async function loadProjects(): Promise<{
  projects: ProjectConfig[];
  activeProjectId: string | null;
}> {
  const settings = await invoke<{
    close_to_tray: boolean;
    vault_path?: string;
    projects?: ProjectConfig[];
    active_project_id?: string;
  }>("get_settings");
  return {
    projects: settings.projects ?? [],
    activeProjectId: settings.active_project_id ?? null,
  };
}

/** Persist the full projects list + active ID to disk via Rust. */
export async function saveProjects(
  projects: ProjectConfig[],
  activeProjectId: string | null,
): Promise<void> {
  await invoke(TAURI_COMMANDS.SAVE_PROJECTS, {
    projects,
    activeProjectId,
  });
}

/** Validate that a path is an existing directory. Returns the canonical path. */
export async function validateDirectory(path: string): Promise<string> {
  return invoke<string>(TAURI_COMMANDS.VALIDATE_DIRECTORY, { path });
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Create a new ProjectConfig from a validated root path. */
export function createProject(
  rootPath: string,
  name: string,
  enabledMcpNames: string[],
  enabledSkillIds: string[],
  defaultModel?: string,
): ProjectConfig {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim() || inferProjectName(rootPath),
    rootPath,
    enabledMcpNames,
    enabledSkillIds,
    defaultModel,
    createdAt: now,
    lastUsedAt: now,
  };
}

/** Derive a display name from a root path (directory basename). */
export function inferProjectName(rootPath: string): string {
  return rootPath.split(/[/\\]/).filter(Boolean).pop() || rootPath;
}
