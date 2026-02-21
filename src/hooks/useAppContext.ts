import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type Goal, loadGoals, buildGoalContext } from "../lib/goals";
import { loadMemoryContext, loadSoulDocument } from "../lib/memory";
import {
  Skill,
  loadSkills,
  saveSkills,
  buildSystemPrompt,
} from "../lib/skills";
import {
  MCPServer,
  loadMCPServers,
  saveMCPServers,
  syncMCPConfigToDisk,
} from "../lib/mcp";
import {
  type ProjectContext,
  scanProjectContext,
  buildProjectPrompt,
} from "../lib/project-context";
import { STORAGE_KEYS, TAURI_COMMANDS } from "../lib/constants";
import {
  type ProjectConfig,
  loadProjects,
  saveProjects,
} from "../lib/projects";
import {
  searchVault,
  formatContextResults,
  getIndexedChunkCount,
} from "../lib/memory-search";

/**
 * Manages all app-level context: vault, memory, goals, skills, MCP servers,
 * and the composite system prompt injected into every AI query.
 */
export function useAppContext() {
  const [skills, setSkills] = useState<Skill[]>(() => loadSkills());
  const [mcpServers, setMcpServers] = useState<MCPServer[]>(() => loadMCPServers());
  const [mcpConfigPath, setMcpConfigPath] = useState<string | null>(null);
  const [vaultContext, setVaultContext] = useState<string | null>(null);
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [memoryContext, setMemoryContext] = useState<string | null>(null);
  const [soulContext, setSoulContext] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalContext, setGoalContext] = useState<string | null>(null);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [customInstructions, setCustomInstructionsState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.CUSTOM_INSTRUCTIONS) || ""
  );

  // Load settings + vault context + memory + goals + project context on startup
  useEffect(() => {
    invoke<{ close_to_tray: boolean; vault_path?: string }>("get_settings")
      .then((settings) => {
        if (settings.vault_path) setVaultPath(settings.vault_path);
      })
      .catch(() => {});
    invoke<string>("load_vault_context")
      .then(setVaultContext)
      .catch(() => {});
    loadMemoryContext().then(setMemoryContext);
    loadSoulDocument().then(setSoulContext);
    loadGoals().then((g) => {
      setGoals(g);
      setGoalContext(buildGoalContext(g));
    });
    scanProjectContext().then(setProjectContext);
    loadProjects().then(({ projects: p, activeProjectId: id }) => {
      setProjects(p);
      setActiveProjectId(id);
    }).catch(() => {});
  }, []);

  // Sync MCP config to disk whenever servers change
  useEffect(() => {
    saveMCPServers(mcpServers);
    syncMCPConfigToDisk(mcpServers).then(setMcpConfigPath);
  }, [mcpServers]);

  // ── Reloaders ──────────────────────────────────────────────────────────────

  const reloadVaultContext = useCallback(() => {
    invoke<string>("load_vault_context")
      .then(setVaultContext)
      .catch(() => setVaultContext(null));
  }, []);

  const reloadMemory = useCallback(() => {
    loadMemoryContext().then(setMemoryContext).catch(() => setMemoryContext(null));
  }, []);

  const reloadSoul = useCallback(() => {
    loadSoulDocument().then(setSoulContext).catch(() => setSoulContext(null));
  }, []);

  const reloadGoals = useCallback(() => {
    loadGoals().then((g) => {
      setGoals(g);
      setGoalContext(buildGoalContext(g));
    }).catch(() => {
      setGoals([]);
      setGoalContext(null);
    });
  }, []);

  // ── Skill handlers ─────────────────────────────────────────────────────────

  const handleToggleSkill = useCallback((id: string) => {
    setSkills((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      );
      saveSkills(updated);
      return updated;
    });
  }, []);

  const setCustomInstructions = useCallback((text: string) => {
    setCustomInstructionsState(text);
    if (text.trim()) {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_INSTRUCTIONS, text);
    } else {
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_INSTRUCTIONS);
    }
  }, []);

  const activeSkillCount = skills.filter((s) => s.enabled).length;
  const activeSkills = useMemo(() => skills.filter((s) => s.enabled), [skills]);

  // ── Project switching ─────────────────────────────────────────────────────

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const switchProject = useCallback(
    async (newProjectId: string | null) => {
      // 1. Snapshot outgoing project's current MCP/skill enabled states
      const updatedProjects = projects.map((p) => {
        if (p.id === activeProjectId) {
          return {
            ...p,
            enabledMcpNames: mcpServers.filter((s) => s.enabled).map((s) => s.name),
            enabledSkillIds: skills.filter((s) => s.enabled).map((s) => s.id),
          };
        }
        return p;
      });

      // 2. Find target project
      const target = newProjectId
        ? updatedProjects.find((p) => p.id === newProjectId) ?? null
        : null;

      // 3. Update Rust AppState + persist to disk
      const rootPath = target?.rootPath ?? null;
      invoke(TAURI_COMMANDS.SET_ACTIVE_PROJECT, {
        id: newProjectId,
        rootPath,
      }).catch(() => {});

      // Touch lastUsedAt on the target
      const now = new Date().toISOString();
      const finalProjects = updatedProjects.map((p) =>
        p.id === newProjectId ? { ...p, lastUsedAt: now } : p,
      );

      saveProjects(finalProjects, newProjectId).catch(() => {});

      // 4. Apply incoming MCP enabled states
      if (target) {
        const enabledSet = new Set(target.enabledMcpNames);
        setMcpServers((prev) =>
          prev.map((s) => ({ ...s, enabled: enabledSet.has(s.name) })),
        );
      }

      // 5. Apply incoming skill enabled states
      if (target) {
        const enabledSet = new Set(target.enabledSkillIds);
        const updated = skills.map((s) => ({
          ...s,
          enabled: enabledSet.has(s.id),
        }));
        saveSkills(updated);
        setSkills(updated);
      }

      // 6. Update React state
      setProjects(finalProjects);
      setActiveProjectId(newProjectId);

      // 7. Re-scan project context (picks up new working directory from Rust)
      setProjectContext(null);
      scanProjectContext().then(setProjectContext);

      // 8. Update FileTree root
      if (target) {
        localStorage.setItem(STORAGE_KEYS.FILETREE_ROOT, target.rootPath);
      } else {
        localStorage.removeItem(STORAGE_KEYS.FILETREE_ROOT);
      }
    },
    [projects, activeProjectId, mcpServers, skills],
  );

  /**
   * Lightweight project root setter — points Freya and all CLI workers at a directory.
   * Unlike switchProject(), this doesn't require a saved project config.
   * Use when the user browses to a folder in FileTree and wants to focus there.
   */
  const setProjectRoot = useCallback(
    async (rootPath: string) => {
      // Update Rust AppState (no project ID — just the root)
      invoke(TAURI_COMMANDS.SET_ACTIVE_PROJECT, {
        id: null,
        rootPath,
      }).catch(() => {});

      // Update FileTree root
      localStorage.setItem(STORAGE_KEYS.FILETREE_ROOT, rootPath);

      // Re-scan project context so Freya picks up the new project
      setProjectContext(null);
      scanProjectContext().then(setProjectContext);
    },
    [],
  );

  // ── MCP handlers ───────────────────────────────────────────────────────────

  const handleInstallMCP = useCallback((servers: MCPServer[]) => {
    setMcpServers((prev) => {
      const existingNames = new Set(prev.map((s) => s.name));
      const newServers = servers.filter((s) => !existingNames.has(s.name));
      if (newServers.length === 0) return prev;
      return [...prev, ...newServers];
    });
  }, []);

  const installedMCPNames = useMemo(
    () => mcpServers.map((s) => s.name),
    [mcpServers]
  );

  // ── System prompt composition ──────────────────────────────────────────────

  const systemPrompt = useMemo(() => {
    const parts: string[] = [];
    if (projectContext) {
      parts.push(buildProjectPrompt(projectContext));
    }
    if (customInstructions.trim()) {
      parts.push(`## Custom Instructions\n${customInstructions.trim()}`);
    }
    if (soulContext) {
      parts.push(`## Your Soul\n${soulContext}`);
    }
    if (memoryContext) {
      parts.push(
        `## Persistent Memory\nThe following is your persistent memory from previous sessions. Use this to maintain continuity across conversations.\n\n${memoryContext}`
      );
    }
    if (vaultContext) {
      const displayPath = vaultPath || "~/obsidian-vault";
      parts.push(
        `## Obsidian Knowledge Vault\nYou have access to the Obsidian vault via the "obsidian-vault" MCP tools (read_file, write_file, search_files, list_directory).\nVault path: ${displayPath.replace(/\\/g, "/")}\n\n${vaultContext}`
      );
    }
    if (goalContext) parts.push(goalContext);
    const skillsPrompt = buildSystemPrompt(skills);
    if (skillsPrompt) parts.push(skillsPrompt);
    return parts.length > 0 ? parts.join("\n\n") : null;
  }, [skills, soulContext, vaultContext, vaultPath, memoryContext, goalContext, projectContext, customInstructions]);

  // ── Context introspection ──────────────────────────────────────────────────

  const buildContextSummary = useCallback((): string => {
    const sections: { name: string; chars: number; status: string }[] = [];

    if (projectContext) {
      const prompt = buildProjectPrompt(projectContext);
      sections.push({ name: "Project Context", chars: prompt.length, status: `${projectContext.name} (${projectContext.type})` });
    } else {
      sections.push({ name: "Project Context", chars: 0, status: "not detected" });
    }

    if (customInstructions.trim()) {
      sections.push({ name: "Custom Instructions", chars: customInstructions.trim().length, status: "active" });
    }

    if (soulContext) {
      sections.push({ name: "Soul Document", chars: soulContext.length, status: "loaded" });
    }

    if (memoryContext) {
      sections.push({ name: "Persistent Memory", chars: memoryContext.length, status: "loaded" });
    } else {
      sections.push({ name: "Persistent Memory", chars: 0, status: "none" });
    }

    if (vaultContext) {
      sections.push({ name: "Obsidian Vault", chars: vaultContext.length, status: vaultPath ? vaultPath.replace(/\\/g, "/") : "loaded" });
    }

    if (goalContext) {
      const activeCount = goals.filter((g) => g.status === "active").length;
      sections.push({ name: "Goals", chars: goalContext.length, status: `${activeCount} active` });
    } else {
      sections.push({ name: "Goals", chars: 0, status: "none" });
    }

    const skillsPrompt = buildSystemPrompt(skills);
    const activeCount = skills.filter((s) => s.enabled).length;
    if (skillsPrompt) {
      sections.push({ name: "Skills", chars: skillsPrompt.length, status: `${activeCount} active` });
    } else {
      sections.push({ name: "Skills", chars: 0, status: `${activeCount} active` });
    }

    const enabledMcp = mcpServers.filter((s) => s.enabled).length;
    sections.push({ name: "MCP Servers", chars: 0, status: `${enabledMcp} enabled` });

    const totalChars = sections.reduce((sum, s) => sum + s.chars, 0);
    const estTokens = Math.round(totalChars / 4);

    const lines = sections.map((s) => {
      const size = s.chars > 0 ? ` (~${Math.round(s.chars / 4)} tok)` : "";
      const dot = s.chars > 0 || (s.status !== "none" && s.status !== "not detected") ? "\u2705" : "\u274c";
      return `${dot} **${s.name}**: ${s.status}${size}`;
    });

    return [
      `**System prompt sections** — ~${estTokens.toLocaleString()} tokens total`,
      "",
      ...lines,
    ].join("\n");
  }, [projectContext, customInstructions, soulContext, memoryContext, vaultContext, vaultPath, goalContext, goals, skills, mcpServers]);

  // ── Vault search (hybrid BM25 + vector) ──────────────────────────────────

  /**
   * Search the vault for context relevant to a query.
   * Returns a formatted string for system prompt injection, or null.
   * Call this before sending a message to inject relevant vault context.
   */
  const searchRelevantContext = useCallback(
    async (query: string): Promise<string | null> => {
      if (getIndexedChunkCount() === 0) return null;
      try {
        const results = await searchVault(query, { topK: 8 });
        if (results.length === 0) return null;
        return formatContextResults(results);
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    // System prompt + MCP config for useClaude
    systemPrompt,
    mcpConfigPath,

    // Skills
    skills,
    setSkills,
    activeSkillCount,
    activeSkills,
    handleToggleSkill,

    // MCP
    mcpServers,
    setMcpServers,
    handleInstallMCP,
    installedMCPNames,

    // Context state (for panel indicators)
    goals,
    hasMemory: memoryContext != null,
    hasSoul: soulContext != null,
    projectContext,

    // Custom instructions
    customInstructions,
    setCustomInstructions,

    // Reloaders (for panels and session management)
    reloadVaultContext,
    reloadMemory,
    reloadSoul,
    reloadGoals,

    // Context introspection
    buildContextSummary,

    // Projects
    projects,
    setProjects,
    activeProjectId,
    activeProject,
    switchProject,
    setProjectRoot,

    // Vault search
    searchRelevantContext,
  };
}
