import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { STORAGE_KEYS } from "../../lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension: string;
}

interface FileTreeProps {
  onClose: () => void;
  /** Called when user sets the current directory as the active project root for Freya. */
  onSetProjectRoot?: (rootPath: string) => void;
}

interface CreatingState {
  type: "file" | "folder";
  parentPath: string;
}

// ── Constants ────────────────────────────────────────────────────────────────


const FILE_ICONS: Record<string, string> = {
  ts: "text-blue-400", tsx: "text-blue-400",
  js: "text-yellow-400", jsx: "text-yellow-400",
  py: "text-green-400",
  rs: "text-orange-400",
  go: "text-cyan-400",
  json: "text-yellow-500",
  md: "text-zinc-400",
  css: "text-purple-400", scss: "text-purple-400",
  html: "text-red-400",
  sql: "text-blue-300",
  yaml: "text-pink-400", yml: "text-pink-400",
  toml: "text-zinc-500",
  sh: "text-green-300", bash: "text-green-300",
};

const IGNORED = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  "__pycache__", ".cache", "target", ".turbo", ".vercel",
  ".svelte-kit", "coverage", ".DS_Store", "Thumbs.db",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function joinPath(parent: string, name: string): string {
  const normalized = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized + "/" + name;
}

async function addFileToChat(entry: DirEntry) {
  try {
    const content = await invoke<string>("read_file_content", { path: entry.path });
    const ext = entry.extension.toLowerCase();
    const lang = ext || "text";
    window.dispatchEvent(
      new CustomEvent("thunderclaude-attach-file", {
        detail: { name: entry.name, content, language: lang },
      }),
    );
  } catch (err) {
    console.warn("[FileTree] Failed to read file:", err);
  }
}

// ── Inline create input ─────────────────────────────────────────────────────

function CreateInput({
  type,
  depth,
  onCommit,
  onCancel,
}: {
  type: "file" | "folder";
  depth: number;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCommit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    // Basic validation: no path separators
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError("Name cannot contain / or \\");
      return;
    }
    onCommit(trimmed);
  };

  const isFolder = type === "folder";
  const indent = 8 + depth * 12 + (isFolder ? 0 : 15);

  return (
    <div style={{ paddingLeft: `${indent}px` }}>
      <div className="flex items-center gap-1.5 px-2 py-[3px]">
        {isFolder ? (
          <>
            <svg className="w-3 h-3 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <svg className="w-3.5 h-3.5 text-amber-500/70 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
            </svg>
          </>
        ) : (
          <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCommit();
            if (e.key === "Escape") onCancel();
          }}
          onBlur={handleCommit}
          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-600 rounded px-1.5 py-0.5 text-[12px] text-zinc-300 font-mono focus:outline-none focus:border-blue-500"
          placeholder={isFolder ? "folder name" : "file name"}
        />
      </div>
      {error && (
        <div className="px-2 text-[10px] text-red-400/80" style={{ paddingLeft: `${indent + 20}px` }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function FolderRow({
  entry,
  depth,
  expanded,
  onToggle,
  onNavigate,
  onCreateIn,
}: {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  onCreateIn: (parentPath: string, type: "file" | "folder") => void;
}) {
  const isIgnored = IGNORED.has(entry.name);

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-[3px] cursor-pointer hover:bg-zinc-800/60 transition-colors group ${
        isIgnored ? "opacity-40" : ""
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={onToggle}
      onDoubleClick={() => onNavigate(entry.path)}
    >
      <svg
        className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <svg className="w-3.5 h-3.5 text-amber-500/70 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        {expanded ? (
          <path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h5l2 2h7a2 2 0 012 2v1H7l-2 6h14.5a1.5 1.5 0 001.41-2L19 8" />
        ) : (
          <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
        )}
      </svg>
      <span className="text-[12px] text-zinc-300 truncate flex-1">{entry.name}</span>

      {/* Create inside folder — visible on hover */}
      {!isIgnored && (
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onCreateIn(entry.path, "file"); }}
            className="p-0.5 hover:bg-zinc-700 rounded transition-colors"
            title="New file"
          >
            <svg className="w-3 h-3 text-zinc-600 hover:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCreateIn(entry.path, "folder"); }}
            className="p-0.5 hover:bg-zinc-700 rounded transition-colors"
            title="New folder"
          >
            <svg className="w-3 h-3 text-zinc-600 hover:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-2-14H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function FileRow({
  entry,
  depth,
}: {
  entry: DirEntry;
  depth: number;
}) {
  const color = FILE_ICONS[entry.extension.toLowerCase()] || "text-zinc-500";

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer hover:bg-zinc-800/60 transition-colors group"
      style={{ paddingLeft: `${8 + depth * 12 + 15}px` }}
      onClick={() => addFileToChat(entry)}
      title={`Click to attach ${entry.name} to chat`}
    >
      <svg className={`w-3.5 h-3.5 ${color} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <span className="text-[12px] text-zinc-400 truncate flex-1">{entry.name}</span>
      <span className="text-[10px] text-zinc-700 shrink-0 hidden group-hover:inline">
        {formatSize(entry.size)}
      </span>
      <svg
        className="w-3 h-3 text-zinc-700 group-hover:text-zinc-400 shrink-0 transition-colors"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </div>
  );
}

function DirectoryContents({
  parentPath,
  depth,
  expandedDirs,
  onToggleDir,
  onNavigate,
  refreshKey,
  creating,
  onCreateIn,
  onCreateCommit,
  onCreateCancel,
}: {
  parentPath: string;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onNavigate: (path: string) => void;
  refreshKey: number;
  creating: CreatingState | null;
  onCreateIn: (parentPath: string, type: "file" | "folder") => void;
  onCreateCommit: (name: string) => void;
  onCreateCancel: () => void;
}) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(null);
    setError(null);
    invoke<DirEntry[]>("list_directory", { path: parentPath })
      .then(setEntries)
      .catch((err) => setError(String(err)));
  }, [parentPath, refreshKey]);

  if (error) {
    return (
      <div className="px-3 py-1 text-[11px] text-red-400/60" style={{ paddingLeft: `${8 + depth * 12}px` }}>
        {error}
      </div>
    );
  }

  if (!entries) {
    return (
      <div className="px-3 py-1" style={{ paddingLeft: `${8 + depth * 12}px` }}>
        <span className="inline-block w-3 h-3 border-[1.5px] border-zinc-700/30 border-t-zinc-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Show inline create input at this level if creating inside this directory
  const showCreateHere = creating && creating.parentPath === parentPath;

  return (
    <>
      {showCreateHere && (
        <CreateInput
          type={creating!.type}
          depth={depth}
          onCommit={onCreateCommit}
          onCancel={onCreateCancel}
        />
      )}
      {entries.map((entry) =>
        entry.is_dir ? (
          <div key={entry.path}>
            <FolderRow
              entry={entry}
              depth={depth}
              expanded={expandedDirs.has(entry.path)}
              onToggle={() => onToggleDir(entry.path)}
              onNavigate={onNavigate}
              onCreateIn={onCreateIn}
            />
            {expandedDirs.has(entry.path) && (
              <DirectoryContents
                parentPath={entry.path}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onNavigate={onNavigate}
                refreshKey={refreshKey}
                creating={creating}
                onCreateIn={onCreateIn}
                onCreateCommit={onCreateCommit}
                onCreateCancel={onCreateCancel}
              />
            )}
          </div>
        ) : (
          <FileRow key={entry.path} entry={entry} depth={depth} />
        ),
      )}
    </>
  );
}

// ── Breadcrumb helpers ───────────────────────────────────────────────────────

/** Parse "C:/TOMO/ThunderClaude" → [{ label: "C:", path: "C:/" }, { label: "TOMO", path: "C:/TOMO" }, ...] */
function buildBreadcrumbs(rootPath: string): { label: string; path: string }[] {
  const normalized = rootPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];

  for (let i = 0; i < parts.length; i++) {
    const isFirst = i === 0;
    const isDriveLetter = isFirst && /^[A-Z]:$/i.test(parts[0]);
    // Build cumulative path
    const pathParts = parts.slice(0, i + 1);
    let fullPath: string;
    if (isDriveLetter || (isFirst && /^[A-Z]:$/i.test(parts[0]))) {
      fullPath = pathParts.join("/");
      // Ensure drive root has trailing slash
      if (/^[A-Z]:$/i.test(fullPath)) fullPath += "/";
    } else if (normalized.startsWith("/")) {
      fullPath = "/" + pathParts.join("/");
    } else {
      fullPath = pathParts.join("/");
    }
    crumbs.push({ label: parts[i], path: fullPath });
  }
  return crumbs;
}

// ── Main component ───────────────────────────────────────────────────────────

export function FileTree({ onClose, onSetProjectRoot }: FileTreeProps) {
  const [rootPath, setRootPath] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.FILETREE_ROOT) || "C:/TOMO",
  );
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(rootPath);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [projectHome, setProjectHome] = useState<string | null>(null);

  // Get the project working directory on mount
  useEffect(() => {
    invoke<string>("get_working_directory")
      .then((dir) => setProjectHome(dir.replace(/\\/g, "/")))
      .catch(() => setProjectHome("C:/TOMO"));
  }, []);

  // Persist root path
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.FILETREE_ROOT, rootPath);
  }, [rootPath]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const navigateTo = useCallback((path: string) => {
    setRootPath(path);
    setExpandedDirs(new Set());
    setPathInput(path);
    setEditingPath(false);
  }, []);

  const commitPathEdit = useCallback(() => {
    const trimmed = pathInput.trim();
    if (trimmed) navigateTo(trimmed);
    setEditingPath(false);
  }, [pathInput, navigateTo]);

  // ── Create file/folder handlers ──────────────────────────────────────────

  const startCreating = useCallback((parentPath: string, type: "file" | "folder") => {
    setCreateError(null);
    setCreating({ type, parentPath });
    setExpandedDirs((prev) => {
      if (prev.has(parentPath)) return prev;
      const next = new Set(prev);
      next.add(parentPath);
      return next;
    });
  }, []);

  const handleCreateCommit = useCallback(async (name: string) => {
    if (!creating) return;
    const fullPath = joinPath(creating.parentPath, name);
    const command = creating.type === "folder" ? "create_directory" : "create_file";
    try {
      await invoke(command, { path: fullPath });
      setCreating(null);
      setCreateError(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(String(err));
    }
  }, [creating]);

  const handleCreateCancel = useCallback(() => {
    setCreating(null);
    setCreateError(null);
  }, []);

  const breadcrumbs = buildBreadcrumbs(rootPath);

  const handleOpenFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, title: "Open Project Folder" });
    if (selected && typeof selected === "string") {
      const normalized = selected.replace(/\\/g, "/");
      navigateTo(normalized);
      onSetProjectRoot?.(normalized);
    }
  }, [navigateTo, onSetProjectRoot]);

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-800/80 shrink-0">
        <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider select-none">
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleOpenFolder}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="Open Folder"
          >
            <svg className="w-3.5 h-3.5 text-zinc-600 hover:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={() => startCreating(rootPath, "file")}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="New File"
          >
            <svg className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={() => startCreating(rootPath, "folder")}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="New Folder"
          >
            <svg className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-2-14H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
            </svg>
          </button>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          {onSetProjectRoot && (
            <button
              onClick={() => onSetProjectRoot(rootPath)}
              className="p-1 hover:bg-zinc-800 rounded transition-colors"
              title="Focus Freya on this folder"
            >
              <svg className="w-3.5 h-3.5 text-zinc-600 hover:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="Close (Ctrl+E)"
          >
            <svg className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Breadcrumb navigation bar ── */}
      {editingPath ? (
        <div className="px-2 py-1.5 border-b border-zinc-800">
          <input
            autoFocus
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPathEdit();
              if (e.key === "Escape") setEditingPath(false);
            }}
            onBlur={commitPathEdit}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-blue-500/50"
            placeholder="Enter directory path..."
          />
        </div>
      ) : (
        <div
          className="flex items-center gap-0 px-2 py-1 border-b border-zinc-800/50 overflow-x-auto cursor-text group/bar"
          onClick={() => { setEditingPath(true); setPathInput(rootPath); }}
        >
          {/* Home button — only shows when away from project root */}
          {projectHome && rootPath.replace(/\\/g, "/") !== projectHome && (
            <button
              onClick={(e) => { e.stopPropagation(); navigateTo(projectHome); }}
              className="p-0.5 mr-1 hover:bg-zinc-800 rounded transition-colors shrink-0"
              title={`Project root (${projectHome})`}
            >
              <svg className="w-3 h-3 text-zinc-600 hover:text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>
          )}

          {/* Clickable breadcrumb segments */}
          <div className="flex items-center min-w-0 overflow-x-auto">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <div key={crumb.path} className="flex items-center shrink-0">
                  {i > 0 && (
                    <svg className="w-3 h-3 text-zinc-700 mx-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (!isLast) navigateTo(crumb.path); }}
                    className={`px-1 py-0.5 rounded text-[11px] font-mono transition-colors ${
                      isLast
                        ? "text-zinc-300 font-medium cursor-default"
                        : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                    }`}
                  >
                    {crumb.label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create error banner */}
      {createError && (
        <div className="px-3 py-1 bg-red-950/30 border-b border-red-900/30">
          <span className="text-[10px] text-red-400">{createError}</span>
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        <DirectoryContents
          parentPath={rootPath}
          depth={0}
          expandedDirs={expandedDirs}
          onToggleDir={toggleDir}
          onNavigate={navigateTo}
          refreshKey={refreshKey}
          creating={creating}
          onCreateIn={startCreating}
          onCreateCommit={handleCreateCommit}
          onCreateCancel={handleCreateCancel}
        />
      </div>

      {/* Footer */}
      <div className="px-3 py-1 border-t border-zinc-800/50">
        <span className="text-[10px] text-zinc-700 font-mono truncate block">
          {rootPath.replace(/\\/g, "/")}
        </span>
      </div>
    </div>
  );
}
