import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  SessionIndexEntry,
  SessionInfo,
  loadSessionIndex,
  loadSessionById,
  deleteSession,
  updateSessionTitle,
  toggleSessionPin,
  migrateSessionsIfNeeded,
} from "../../lib/sessions";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  currentSessionId: string | null;
  onNewChat: () => void;
  onLoadSession: (session: SessionInfo) => void;
  onToggleSettings: () => void;
}

// ── Date grouping helpers ─────────────────────────────────────────────────

interface SessionGroup {
  label: string;
  sessions: SessionIndexEntry[];
}

function groupSessions(sessions: SessionIndexEntry[]): SessionGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 6 * 86_400_000;

  const pinned: SessionIndexEntry[] = [];
  const today: SessionIndexEntry[] = [];
  const yesterday: SessionIndexEntry[] = [];
  const thisWeek: SessionIndexEntry[] = [];
  const older: SessionIndexEntry[] = [];

  for (const s of sessions) {
    if (s.pinned) { pinned.push(s); continue; }
    const t = s.lastActivity;
    if (t >= todayStart) today.push(s);
    else if (t >= yesterdayStart) yesterday.push(s);
    else if (t >= weekStart) thisWeek.push(s);
    else older.push(s);
  }

  const groups: SessionGroup[] = [];
  if (pinned.length > 0) groups.push({ label: "Pinned", sessions: pinned });
  if (today.length > 0) groups.push({ label: "Today", sessions: today });
  if (yesterday.length > 0) groups.push({ label: "Yesterday", sessions: yesterday });
  if (thisWeek.length > 0) groups.push({ label: "This Week", sessions: thisWeek });
  if (older.length > 0) groups.push({ label: "Older", sessions: older });
  return groups;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────

export function Sidebar({
  isOpen,
  onToggle,
  currentSessionId,
  onNewChat,
  onLoadSession,
  onToggleSettings,
}: SidebarProps) {
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Load session index (lightweight, no messages)
  const refreshSessions = useCallback(() => {
    loadSessionIndex().then(setSessions);
  }, []);

  useEffect(() => {
    // One-time migration from localStorage → filesystem
    migrateSessionsIfNeeded().then(refreshSessions);
    const interval = setInterval(refreshSessions, 2000);
    return () => clearInterval(interval);
  }, [refreshSessions]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleClick = useCallback(async (entry: SessionIndexEntry) => {
    if (loadingId) return; // Prevent double-click
    setLoadingId(entry.id);
    try {
      const session = await loadSessionById(entry.id);
      if (session) {
        onLoadSession(session);
      }
    } finally {
      setLoadingId(null);
    }
  }, [loadingId, onLoadSession]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteSession(id);
    refreshSessions();
  }, [refreshSessions]);

  const startRename = useCallback((e: React.MouseEvent, session: SessionIndexEntry) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== sessions.find((s) => s.id === renamingId)?.title) {
      await updateSessionTitle(renamingId, trimmed);
      refreshSessions();
    }
    setRenamingId(null);
  }, [renamingId, renameValue, sessions, refreshSessions]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  const handlePin = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await toggleSessionPin(id);
    refreshSessions();
  }, [refreshSessions]);

  // Filter by search query (case-insensitive title match)
  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, search]);

  const groups = useMemo(() => groupSessions(filtered), [filtered]);

  if (!isOpen) return null;

  return (
    <div className="w-56 h-full flex flex-col bg-zinc-950 border-r border-zinc-800 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-800/80 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider select-none">
            Chats
          </span>
          {sessions.length > 0 && (
            <span className="text-[9px] text-zinc-700 font-mono">{sessions.length}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewChat}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="New Chat"
          >
            <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onToggle}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
            title="Close sidebar"
          >
            <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      {sessions.length > 3 && (
        <div className="px-2.5 py-1.5 border-b border-zinc-800/50">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800/50 focus-within:border-zinc-700/60">
            <svg className="w-3 h-3 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent text-[11px] text-zinc-300 placeholder-zinc-700 focus:outline-none min-w-0"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-zinc-700 hover:text-zinc-400 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Session list — grouped by date */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[11px] text-zinc-700">
              {search ? "No matching conversations" : "No conversations yet"}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pt-3 pb-1 sticky top-0 bg-zinc-950/90 backdrop-blur-sm z-10">
                <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider">
                  {group.label}
                </span>
              </div>
              {group.sessions.map((session) => {
                const isActive = currentSessionId === session.id;
                const isOlder = group.label !== "Today" && group.label !== "Yesterday";
                const isRenaming = renamingId === session.id;
                const isLoading = loadingId === session.id;
                return (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!isRenaming) handleClick(session); }}
                    onKeyDown={(e) => { if (!isRenaming && (e.key === "Enter" || e.key === " ")) handleClick(session); }}
                    className={`w-full text-left px-3 py-2 group transition-colors cursor-pointer border-l-2 ${
                      isActive
                        ? "bg-zinc-800/50 border-l-orange-500/70"
                        : isLoading
                          ? "bg-zinc-800/30 border-l-orange-500/30"
                          : "hover:bg-zinc-800/30 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") commitRename();
                            else if (e.key === "Escape") cancelRename();
                          }}
                          onBlur={commitRename}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 text-[12px] text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 focus:outline-none focus:border-orange-500/50"
                        />
                      ) : (
                        <>
                          {session.pinned && (
                            <button
                              onClick={(e) => handlePin(e, session.id)}
                              className="p-0.5 text-amber-500/70 hover:text-amber-400 transition-colors shrink-0"
                              title="Unpin"
                            >
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                            </button>
                          )}
                          <p
                            onDoubleClick={(e) => startRename(e, session)}
                            className={`text-[12px] truncate flex-1 leading-snug ${
                              isActive ? "text-zinc-200 font-medium" : "text-zinc-400"
                            }`}
                            title="Double-click to rename"
                          >
                            {session.title}
                          </p>
                        </>
                      )}
                      {!isRenaming && (
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                          {!session.pinned && (
                            <button
                              onClick={(e) => handlePin(e, session.id)}
                              className="p-0.5 hover:text-amber-400 text-zinc-700 transition-colors"
                              title="Pin"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={(e) => startRename(e, session)}
                            className="p-0.5 hover:text-zinc-300 text-zinc-700 transition-colors"
                            title="Rename"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, session.id)}
                            className="p-0.5 hover:text-red-400 text-zinc-700 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-600 mt-0.5 block">
                      {isOlder ? formatDate(session.lastActivity) : formatTime(session.lastActivity)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Settings button */}
      <div className="px-3 py-2 border-t border-zinc-800">
        <button
          onClick={onToggleSettings}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-zinc-800/60 transition-colors group"
          title="Settings (Ctrl+,)"
        >
          <svg
            className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-[11px] text-zinc-600 group-hover:text-zinc-400 transition-colors">
            Settings
          </span>
        </button>
      </div>
    </div>
  );
}
