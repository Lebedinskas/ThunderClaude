import { useState, useEffect, useCallback } from "react";
import { useChatActions } from "../../contexts/ChatContext";
import {
  type ResearchEntry,
  loadResearchIndex,
  loadResearchContent,
} from "../../lib/research-library";

interface ResearchPanelProps {
  onClose: () => void;
}

export function ResearchPanel({ onClose }: ResearchPanelProps) {
  const { loadResearch } = useChatActions();
  const [entries, setEntries] = useState<ResearchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);

  useEffect(() => {
    loadResearchIndex()
      .then((idx) => {
        // Newest first
        setEntries(idx.sort((a, b) => b.date.localeCompare(a.date)));
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const handleLoad = useCallback(
    async (entry: ResearchEntry) => {
      if (loadingFile) return;
      setLoadingFile(entry.filename);
      try {
        const content = await loadResearchContent(entry.filename);
        if (content) {
          loadResearch(entry.title, content);
        }
      } catch {
        // Silently fail — entry stays in list, user can retry
      }
      setLoadingFile(null);
    },
    [loadResearch, loadingFile],
  );

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function formatAge(daysAgo: number): string {
    if (daysAgo === 0) return "Today";
    if (daysAgo === 1) return "Yesterday";
    if (daysAgo < 7) return `${daysAgo}d ago`;
    if (daysAgo < 30) return `${Math.floor(daysAgo / 7)}w ago`;
    return `${Math.floor(daysAgo / 30)}mo ago`;
  }

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">Research</h2>
          {entries.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400">
              {entries.length}
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
          Saved research from Researcher mode. Load past results to skip
          expensive re-queries.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-[12px] text-zinc-600">Loading...</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <svg
              className="w-8 h-8 text-zinc-700 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <p className="text-[12px] text-zinc-600 mb-1">No saved research</p>
            <p className="text-[11px] text-zinc-700">
              Use Researcher mode and click "Save" on results to build your
              library.
            </p>
          </div>
        ) : (
          <div className="py-1">
            {entries.map((entry) => (
              <div
                key={entry.filename}
                className="group px-4 py-2.5 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/30 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-zinc-300 font-medium truncate leading-tight">
                      {entry.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-zinc-600">
                        {entry.date}
                      </span>
                      <span className="text-[10px] text-zinc-700">
                        {formatAge(entry.daysAgo)}
                      </span>
                      <span className="text-[10px] text-zinc-700">
                        {formatSize(entry.size)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleLoad(entry)}
                    disabled={loadingFile === entry.filename}
                    className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-600/10 text-emerald-400/80 hover:bg-emerald-600/20 hover:text-emerald-300 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                  >
                    {loadingFile === entry.filename ? "..." : "Load"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
