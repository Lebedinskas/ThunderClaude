import type { MentionResult } from "../../hooks/useMention";
import { MENTION_EXT_COLORS } from "../../hooks/useMention";

interface MentionPopupProps {
  results: MentionResult[];
  activeIndex: number;
  query: string;
  projectRoot: string | null;
  onSelect: (result: MentionResult) => void;
  onHover: (index: number) => void;
}

export function MentionPopup({
  results,
  activeIndex,
  query,
  projectRoot,
  onSelect,
  onHover,
}: MentionPopupProps) {
  if (results.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-0 z-50">
      <div className="mx-3 mb-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 max-h-[240px] overflow-y-auto">
        <div className="px-2 py-1.5 border-b border-zinc-700/50">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            {query ? `Files matching "${query}"` : "Project files"}
          </span>
        </div>
        {results.map((result, i) => {
          const ext = result.extension?.toLowerCase() || "";
          const color = MENTION_EXT_COLORS[ext] || "text-zinc-500";
          const relPath = projectRoot
            ? result.path.replace(/\\/g, "/").replace(
                projectRoot.replace(/\\/g, "/") + "/", ""
              )
            : result.name;
          const isActive = i === activeIndex;

          return (
            <button
              key={result.path}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(result);
              }}
              onMouseEnter={() => onHover(i)}
            >
              {result.is_dir ? (
                <svg className="w-3.5 h-3.5 text-amber-500/70 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                </svg>
              ) : (
                <svg className={`w-3.5 h-3.5 ${color} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium truncate">{result.name}</span>
                {relPath !== result.name && (
                  <span className="text-[10px] text-zinc-600 truncate">{relPath}</span>
                )}
              </div>
              {!result.is_dir && result.size > 0 && (
                <span className="text-[10px] text-zinc-700 ml-auto shrink-0">
                  {result.size < 1024 ? `${result.size}B` :
                   result.size < 1024 * 1024 ? `${(result.size / 1024).toFixed(0)}K` :
                   `${(result.size / (1024 * 1024)).toFixed(1)}M`}
                </span>
              )}
            </button>
          );
        })}
        <div className="px-2.5 py-1 border-t border-zinc-700/50">
          <span className="text-[9px] text-zinc-600">
            ↑↓ navigate · Enter select · Esc dismiss
          </span>
        </div>
      </div>
    </div>
  );
}
