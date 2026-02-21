import { useState, useEffect, useCallback, useRef } from "react";
import {
  readMemoryFile,
  writeMemoryFile,
  localDate,
} from "../../lib/memory";
import {
  type ScoredChunk,
  searchVault,
  getIndexedChunkCount,
} from "../../lib/memory-search";
import {
  type IndexStatus,
  indexVault,
  reindexVault,
  getIndexStatus,
} from "../../lib/vault-index";

interface MemoryPanelProps {
  onClose: () => void;
  onMemoryChange: () => void;
}

export function MemoryPanel({ onClose, onMemoryChange }: MemoryPanelProps) {
  const [tab, setTab] = useState<"persistent" | "daily" | "search">("persistent");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [dailyToday, setDailyToday] = useState("");
  const [dailyYesterday, setDailyYesterday] = useState("");
  const [saving, setSaving] = useState(false);

  // Search tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ScoredChunk[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDirty = content !== savedContent;

  // Load memory files on mount
  useEffect(() => {
    readMemoryFile("MEMORY.md")
      .then((text) => {
        setContent(text);
        setSavedContent(text);
      })
      .catch(() => {});

    const today = localDate();
    const yesterday = localDate(-1);
    readMemoryFile(`daily/${today}.md`).then(setDailyToday).catch(() => {});
    readMemoryFile(`daily/${yesterday}.md`)
      .then(setDailyYesterday)
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await writeMemoryFile("MEMORY.md", content);
      setSavedContent(content);
      onMemoryChange();
    } catch {
      // User sees "Save" button stays enabled — they can retry
    } finally {
      setSaving(false);
    }
  }, [content, onMemoryChange]);

  // Ctrl+S to save within panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && isDirty) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDirty, handleSave]);

  // Load index status when switching to search tab
  useEffect(() => {
    if (tab === "search") {
      getIndexStatus().then(setIndexStatus).catch(() => {});
    }
  }, [tab]);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!searchQuery.trim() || getIndexedChunkCount() === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchVault(searchQuery, { topK: 12 });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  const handleIndex = useCallback(async (full: boolean) => {
    setIndexing(true);
    setIndexProgress("Starting...");
    try {
      const fn = full ? reindexVault : indexVault;
      const result = await fn((_indexed, _total, phase) => {
        setIndexProgress(phase);
      });
      setIndexProgress(
        `Done: ${result.chunksCreated} chunks from ${result.filesProcessed} files (${Math.round(result.durationMs / 1000)}s)`,
      );
      getIndexStatus().then(setIndexStatus).catch(() => {});
    } catch (err) {
      setIndexProgress(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setIndexing(false);
    }
  }, []);

  const today = localDate();
  const yesterday = localDate(-1);

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">Memory</h2>
          {isDirty && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-600/20 text-amber-400">
              unsaved
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors"
          title="Close"
        >
          <svg
            className="w-4 h-4 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Description */}
      <div className="px-4 py-2 border-b border-zinc-800/50">
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Persistent memory loaded into every conversation. Also editable in
          Obsidian at <span className="text-zinc-500">ThunderClaude/</span>.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800/50">
        <button
          onClick={() => setTab("persistent")}
          className={`flex-1 px-4 py-2 text-[12px] font-medium transition-colors ${
            tab === "persistent"
              ? "text-orange-400 border-b-2 border-orange-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Persistent
        </button>
        <button
          onClick={() => setTab("daily")}
          className={`flex-1 px-4 py-2 text-[12px] font-medium transition-colors ${
            tab === "daily"
              ? "text-orange-400 border-b-2 border-orange-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Daily Log
        </button>
        <button
          onClick={() => setTab("search")}
          className={`flex-1 px-4 py-2 text-[12px] font-medium transition-colors ${
            tab === "search"
              ? "text-orange-400 border-b-2 border-orange-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Search
        </button>
      </div>

      {/* Content area */}
      {tab === "persistent" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              "# My Memory\n\nAdd facts, preferences, and context that should persist across all sessions..."
            }
            className="flex-1 w-full px-4 py-3 bg-transparent text-[12px] text-zinc-300 placeholder-zinc-700 focus:outline-none resize-none font-mono leading-relaxed"
            spellCheck={false}
          />
          <div className="px-4 py-2 border-t border-zinc-800/50 flex items-center justify-between">
            <span className="text-[10px] text-zinc-600">
              {isDirty ? "Ctrl+S to save" : "Saved"}
            </span>
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`px-3 py-1 text-[11px] rounded-md transition-all ${
                isDirty && !saving
                  ? "bg-orange-600 hover:bg-orange-500 text-white"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              }`}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : tab === "daily" ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Today's log */}
          <div>
            <h3 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Today &mdash; {today}
            </h3>
            {dailyToday ? (
              <div className="text-[12px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
                {dailyToday}
              </div>
            ) : (
              <p className="text-[12px] text-zinc-700 italic">
                No entries yet
              </p>
            )}
          </div>

          {/* Yesterday's log */}
          <div>
            <h3 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Yesterday &mdash; {yesterday}
            </h3>
            {dailyYesterday ? (
              <div className="text-[12px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
                {dailyYesterday}
              </div>
            ) : (
              <p className="text-[12px] text-zinc-700 italic">No entries</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Index status bar */}
          <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-500 truncate">
              {indexStatus
                ? `${indexStatus.totalChunks.toLocaleString()} chunks / ${indexStatus.indexedFiles} files${
                    indexStatus.embeddingsAvailable ? " + vectors" : ""
                  }`
                : "Not indexed"}
              {indexStatus?.staleFiles
                ? ` (${indexStatus.staleFiles} stale)`
                : ""}
            </span>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => handleIndex(false)}
                disabled={indexing}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                  indexing
                    ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                }`}
                title="Incremental index (only new/changed files)"
              >
                {indexing ? "Indexing..." : "Index"}
              </button>
              <button
                onClick={() => handleIndex(true)}
                disabled={indexing}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                  indexing
                    ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                }`}
                title="Full re-index from scratch"
              >
                Re-index
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {indexProgress && (
            <div className="px-4 py-1.5 border-b border-zinc-800/50">
              <p className="text-[10px] text-orange-400/80 truncate">{indexProgress}</p>
            </div>
          )}

          {/* Search input */}
          <div className="px-4 py-2 border-b border-zinc-800/50">
            <div className="relative">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your vault..."
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-800/60 rounded-md text-[12px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
                autoFocus
              />
              {searching && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-orange-500/40 border-t-orange-400 rounded-full animate-spin" />
              )}
            </div>
          </div>

          {/* Search results */}
          <div className="flex-1 overflow-y-auto">
            {searchResults.length > 0 ? (
              <div className="divide-y divide-zinc-800/40">
                {searchResults.map((result) => (
                  <div
                    key={result.id}
                    className="px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-orange-400/70 font-medium truncate">
                        {result.source}
                      </span>
                      <span className="text-[9px] text-zinc-700 shrink-0">
                        {Math.round(result.score * 100)}%
                      </span>
                    </div>
                    {result.heading && (
                      <p className="text-[11px] text-zinc-400 font-medium mb-0.5">
                        {result.heading}
                      </p>
                    )}
                    <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-3">
                      {result.content.slice(0, 200)}
                      {result.content.length > 200 ? "..." : ""}
                    </p>
                    {result.tags.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {result.tags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-600"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : searchQuery.trim() && !searching ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] text-zinc-600">No results found</p>
                {getIndexedChunkCount() === 0 && (
                  <p className="text-[11px] text-zinc-700 mt-1">
                    Index your vault first using the button above
                  </p>
                )}
              </div>
            ) : !searchQuery.trim() ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] text-zinc-600">
                  {getIndexedChunkCount() > 0
                    ? "Type to search across your vault"
                    : "Index your vault to enable search"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
