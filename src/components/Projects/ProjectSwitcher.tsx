import { useState, useRef, useEffect } from "react";
import type { ProjectConfig } from "../../lib/projects";

interface ProjectSwitcherProps {
  projects: ProjectConfig[];
  activeProjectId: string | null;
  projectName?: string;
  projectType?: string;
  onSwitchProject: (id: string | null) => void;
  onManageProjects: () => void;
}

export function ProjectSwitcher({
  projects,
  activeProjectId,
  projectName,
  projectType,
  onSwitchProject,
  onManageProjects,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // No projects configured — show static text (existing behavior)
  if (projects.length === 0) {
    if (!projectName) return null;
    return (
      <div className="flex items-center gap-1.5 ml-1">
        <span className="text-zinc-700">/</span>
        <span className="text-[12px] text-zinc-500 font-medium">{projectName}</span>
        {projectType && projectType !== "Unknown" && (
          <span className="text-[10px] text-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 rounded-sm font-mono">{projectType}</span>
        )}
      </div>
    );
  }

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const displayName = activeProject?.name || projectName || "No project";

  return (
    <div className="relative ml-1" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 -my-0.5 rounded hover:bg-zinc-800/60 transition-colors group"
        title="Switch project (Ctrl+P)"
      >
        <span className="text-zinc-700">/</span>
        <span className="text-[12px] text-zinc-500 font-medium group-hover:text-zinc-300 transition-colors">
          {displayName}
        </span>
        {projectType && projectType !== "Unknown" && (
          <span className="text-[10px] text-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 rounded-sm font-mono">{projectType}</span>
        )}
        <svg className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="py-1">
            {projects.map((p) => {
              const isActive = p.id === activeProjectId;
              const pathParts = p.rootPath.replace(/\\/g, "/").split("/");
              const shortPath = pathParts.length > 2
                ? `.../${pathParts.slice(-2).join("/")}`
                : p.rootPath.replace(/\\/g, "/");

              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (!isActive) onSwitchProject(p.id);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-emerald-950/30 text-zinc-200"
                      : "hover:bg-zinc-800/60 text-zinc-400"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-zinc-600 truncate font-mono">{shortPath}</div>
                  </div>
                  {isActive && (
                    <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-zinc-800">
            <button
              onClick={() => {
                setOpen(false);
                onManageProjects();
              }}
              className="w-full px-3 py-2 text-left text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
            >
              Manage Projects...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
