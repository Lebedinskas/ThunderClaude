import { useState, useRef, useEffect } from "react";
import {
  MODEL_GROUPS,
  MODEL_LABELS,
  isGeminiModel,
  type AIModel,
} from "../../lib/models";

export function ModelSelector({
  model,
  onChange,
}: {
  model: AIModel;
  onChange: (m: AIModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isGemini = isGeminiModel(model);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-zinc-700/40 transition-colors group"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isGemini ? "bg-blue-400" : "bg-orange-400"
          }`}
        />
        <span className="text-[11px] font-medium text-zinc-500 group-hover:text-zinc-300 transition-colors">
          {MODEL_LABELS[model]}
        </span>
        <svg
          className={`w-2.5 h-2.5 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 py-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[160px] z-50">
          {MODEL_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 select-none">
                {group.label}
              </div>
              {group.models.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                    m === model
                      ? isGeminiModel(m)
                        ? "text-blue-400 bg-blue-500/10"
                        : "text-orange-400 bg-orange-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                  }`}
                >
                  {MODEL_LABELS[m]}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
