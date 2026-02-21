import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { SessionIndexEntry } from "../../lib/sessions";
import {
  type SearchResult,
  searchSessions,
  preloadSessions,
  clearSearchCache,
} from "../../lib/session-search";

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  sessionIndex: SessionIndexEntry[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}

function HighlightedSnippet({
  snippet,
  offset,
  length,
}: {
  snippet: string;
  offset: number;
  length: number;
}) {
  const before = snippet.slice(0, offset);
  const match = snippet.slice(offset, offset + length);
  const after = snippet.slice(offset + length);
  return (
    <span className="text-[11px] text-zinc-500 leading-relaxed">
      {before}
      <mark className="bg-amber-500/30 text-amber-200 rounded-sm px-0.5">
        {match}
      </mark>
      {after}
    </span>
  );
}

function formatRelativeDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function SearchOverlay({
  isOpen,
  onClose,
  sessionIndex,
  currentSessionId,
  onSelectSession,
}: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [preloading, setPreloading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState({ loaded: 0, total: 0 });
  const [ready, setReady] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resultRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Preload sessions when overlay opens
  useEffect(() => {
    if (!isOpen) return;

    setQuery("");
    setResults([]);
    setSelectedIdx(0);
    setReady(false);

    if (sessionIndex.length === 0) {
      setReady(true);
      return;
    }

    setPreloading(true);
    preloadSessions(sessionIndex, (loaded, total) => {
      setPreloadProgress({ loaded, total });
    }).then(() => {
      setPreloading(false);
      setReady(true);
    });

    // Focus input after mount
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen, sessionIndex]);

  // Clear cache on unmount
  useEffect(() => {
    return () => clearSearchCache();
  }, []);

  // Search when query changes
  useEffect(() => {
    if (!ready) {
      setResults([]);
      return;
    }
    const r = searchSessions(query, sessionIndex);
    setResults(r);
    setSelectedIdx(0);
  }, [query, ready, sessionIndex]);

  // Handle selection
  const handleSelect = useCallback(
    (id: string) => {
      onSelectSession(id);
      onClose();
    },
    [onSelectSession, onClose],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIdx((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIdx((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIdx]) {
            handleSelect(results[selectedIdx].id);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIdx, handleSelect, onClose],
  );

  // Scroll selected result into view
  useEffect(() => {
    resultRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  // Memoize result count text
  const statusText = useMemo(() => {
    if (preloading) {
      const pct = preloadProgress.total > 0
        ? Math.round((preloadProgress.loaded / preloadProgress.total) * 100)
        : 0;
      return `Loading sessions... ${pct}%`;
    }
    if (!query || query.length < 2) return "Type to search across all conversations";
    if (results.length === 0) return "No matches found";
    const totalMatches = results.reduce((sum, r) => sum + r.matches.length + (r.titleMatch ? 1 : 0), 0);
    return `${results.length} session${results.length !== 1 ? "s" : ""} · ${totalMatches} match${totalMatches !== 1 ? "es" : ""}`;
  }, [preloading, preloadProgress, query, results]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl w-[560px] max-h-[60vh] flex flex-col">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
          <svg
            className="w-4 h-4 text-zinc-500 shrink-0"
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
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search all conversations..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
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
          )}
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-[10px] font-mono text-zinc-500">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {results.length > 0 ? (
            <div className="py-1">
              {results.map((result, i) => {
                const isSelected = i === selectedIdx;
                const isCurrent = result.id === currentSessionId;
                return (
                  <div
                    key={result.id}
                    ref={(el) => { resultRefs.current[i] = el; }}
                    role="button"
                    tabIndex={-1}
                    onClick={() => handleSelect(result.id)}
                    onMouseEnter={() => setSelectedIdx(i)}
                    className={`px-4 py-2.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-zinc-800/70"
                        : "hover:bg-zinc-800/40"
                    }`}
                  >
                    {/* Title row */}
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`text-[13px] truncate flex-1 ${
                          isCurrent
                            ? "text-amber-400 font-medium"
                            : "text-zinc-200"
                        }`}
                      >
                        {result.title}
                        {result.titleMatch && (
                          <span className="ml-1.5 text-[9px] text-amber-500/70 uppercase font-semibold">
                            title
                          </span>
                        )}
                      </p>
                      <span className="text-[10px] text-zinc-600 shrink-0">
                        {formatRelativeDate(result.lastActivity)}
                      </span>
                    </div>

                    {/* Content matches */}
                    {result.matches.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {result.matches.map((match, mi) => (
                          <div key={mi} className="flex items-start gap-1.5">
                            <span
                              className={`text-[9px] mt-0.5 uppercase font-medium shrink-0 ${
                                match.role === "user"
                                  ? "text-blue-500/60"
                                  : "text-emerald-500/60"
                              }`}
                            >
                              {match.role === "user" ? "you" : "ai"}
                            </span>
                            <HighlightedSnippet
                              snippet={match.snippet}
                              offset={match.offset}
                              length={match.length}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Meta */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-zinc-700">
                        {result.messageCount} messages
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            query.length >= 2 &&
            ready && (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] text-zinc-600">
                  No matches for &ldquo;{query}&rdquo;
                </p>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-800/50">
          <span className="text-[10px] text-zinc-600">{statusText}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-700">
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-[9px] font-mono">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span className="text-[10px] text-zinc-700">
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-[9px] font-mono">
                ↵
              </kbd>{" "}
              open
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
