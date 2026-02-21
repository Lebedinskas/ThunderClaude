import { useState, useCallback } from "react";
import type { ProjectConfig } from "../../lib/projects";
import {
  createProject,
  validateDirectory,
  saveProjects,
} from "../../lib/projects";

interface ProjectsPanelProps {
  onClose: () => void;
  projects: ProjectConfig[];
  activeProjectId: string | null;
  onSwitchProject: (id: string | null) => void;
  onProjectsChange: (projects: ProjectConfig[]) => void;
  currentMcpNames: string[];
  currentSkillIds: string[];
}

export function ProjectsPanel({
  onClose,
  projects,
  activeProjectId,
  onSwitchProject,
  onProjectsChange,
  currentMcpNames,
  currentSkillIds,
}: ProjectsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");
  const [copyContext, setCopyContext] = useState(true);
  const [pathError, setPathError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleAdd = useCallback(async () => {
    if (!newPath.trim()) return;
    setValidating(true);
    setPathError(null);

    try {
      const canonicalPath = await validateDirectory(newPath.trim());
      const mcpNames = copyContext ? currentMcpNames : [];
      const skillIds = copyContext ? currentSkillIds : [];
      const project = createProject(canonicalPath, newName, mcpNames, skillIds);
      const updated = [...projects, project];
      onProjectsChange(updated);
      saveProjects(updated, activeProjectId).catch(() => {});
      setNewPath("");
      setNewName("");
      setAdding(false);
    } catch {
      setPathError("Directory not found or not accessible");
    } finally {
      setValidating(false);
    }
  }, [newPath, newName, copyContext, currentMcpNames, currentSkillIds, projects, activeProjectId, onProjectsChange]);

  const handleDelete = useCallback(
    (id: string) => {
      if (id === activeProjectId) {
        onSwitchProject(null);
      }
      const updated = projects.filter((p) => p.id !== id);
      onProjectsChange(updated);
      saveProjects(updated, id === activeProjectId ? null : activeProjectId).catch(() => {});
    },
    [projects, activeProjectId, onSwitchProject, onProjectsChange],
  );

  const handleRename = useCallback(
    (id: string) => {
      if (!editName.trim()) {
        setEditingId(null);
        return;
      }
      const updated = projects.map((p) =>
        p.id === id ? { ...p, name: editName.trim() } : p,
      );
      onProjectsChange(updated);
      saveProjects(updated, activeProjectId).catch(() => {});
      setEditingId(null);
    },
    [editName, projects, activeProjectId, onProjectsChange],
  );

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-800/80 shrink-0">
        <span className="text-[13px] font-medium text-zinc-300 tracking-tight">Projects</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-500 hover:text-zinc-300"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 && !adding ? (
          <div className="px-4 py-8 text-center">
            <div className="text-zinc-600 text-[12px] mb-3">
              No projects configured yet.
              <br />
              Add a project to quickly switch working directories, MCP servers, and skills.
            </div>
            <button
              onClick={() => setAdding(true)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-[12px] font-medium text-white transition-colors"
            >
              Add Project
            </button>
          </div>
        ) : (
          <div className="py-1">
            {projects.map((p) => {
              const isActive = p.id === activeProjectId;
              const isEditing = editingId === p.id;

              return (
                <div
                  key={p.id}
                  className={`group px-3 py-2 border-l-2 transition-colors ${
                    isActive
                      ? "border-emerald-500 bg-emerald-950/20"
                      : "border-transparent hover:bg-zinc-800/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => handleRename(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(p.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-[12px] text-zinc-200 outline-none focus:border-emerald-500"
                        />
                      ) : (
                        <div
                          className="text-[12px] font-medium text-zinc-300 truncate cursor-pointer"
                          onDoubleClick={() => {
                            setEditingId(p.id);
                            setEditName(p.name);
                          }}
                          title="Double-click to rename"
                        >
                          {p.name}
                        </div>
                      )}
                      <div className="text-[10px] text-zinc-600 truncate font-mono mt-0.5">
                        {p.rootPath.replace(/\\/g, "/")}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!isActive && (
                        <button
                          onClick={() => onSwitchProject(p.id)}
                          className="p-1 hover:bg-zinc-700 rounded transition-colors text-zinc-500 hover:text-emerald-400"
                          title="Switch to this project"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="p-1 hover:bg-zinc-700 rounded transition-colors text-zinc-500 hover:text-red-400"
                        title="Delete project"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Config summary */}
                  <div className="flex items-center gap-2 mt-1">
                    {p.enabledMcpNames.length > 0 && (
                      <span className="text-[9px] text-zinc-600 bg-zinc-800/60 px-1 py-0.5 rounded">
                        {p.enabledMcpNames.length} MCP
                      </span>
                    )}
                    {p.enabledSkillIds.length > 0 && (
                      <span className="text-[9px] text-zinc-600 bg-zinc-800/60 px-1 py-0.5 rounded">
                        {p.enabledSkillIds.length} skills
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[9px] text-emerald-600 font-medium">active</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add form */}
        {adding && (
          <div className="px-3 py-3 border-t border-zinc-800/60">
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Root Path
                </label>
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => {
                    setNewPath(e.target.value);
                    setPathError(null);
                  }}
                  placeholder="C:\Projects\my-app"
                  className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-200 font-mono outline-none focus:border-emerald-500 placeholder:text-zinc-700"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                    if (e.key === "Escape") setAdding(false);
                  }}
                />
                {pathError && (
                  <div className="text-[10px] text-red-400 mt-1">{pathError}</div>
                )}
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Auto-detected from path"
                  className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-emerald-500 placeholder:text-zinc-700"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                    if (e.key === "Escape") setAdding(false);
                  }}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={copyContext}
                  onChange={(e) => setCopyContext(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/30"
                />
                <span className="text-[11px] text-zinc-400">
                  Copy current MCP & skill settings
                </span>
              </label>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleAdd}
                  disabled={!newPath.trim() || validating}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-[11px] font-medium text-white transition-colors"
                >
                  {validating ? "Validating..." : "Add"}
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setNewPath("");
                    setNewName("");
                    setPathError(null);
                  }}
                  className="px-3 py-1.5 hover:bg-zinc-800 rounded text-[11px] text-zinc-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer — add button when not in add mode and projects exist */}
      {!adding && projects.length > 0 && (
        <div className="px-3 py-2 border-t border-zinc-800/80 shrink-0">
          <button
            onClick={() => setAdding(true)}
            className="w-full py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 rounded transition-colors"
          >
            + Add Project
          </button>
        </div>
      )}
    </div>
  );
}
