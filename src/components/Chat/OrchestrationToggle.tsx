import type { OrchestrationMode } from "../../lib/models";
import type { ResearchDepth } from "../../lib/researcher";

const ORCHESTRATION_MODES: OrchestrationMode[] = ["direct", "commander", "researcher", "auto"];

export function OrchestrationToggle({
  mode,
  onChange,
  depth,
  onDepthChange,
}: {
  mode: OrchestrationMode;
  onChange: (mode: OrchestrationMode) => void;
  depth: ResearchDepth;
  onDepthChange: (depth: ResearchDepth) => void;
}) {
  const nextMode = () => {
    const idx = ORCHESTRATION_MODES.indexOf(mode);
    return ORCHESTRATION_MODES[(idx + 1) % ORCHESTRATION_MODES.length];
  };

  if (mode === "auto") {
    return (
      <button
        onClick={() => onChange(nextMode())}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gradient-to-r from-orange-500/8 to-violet-500/8 hover:from-orange-500/15 hover:to-violet-500/15 transition-colors"
        title="Auto Mode — smart routing per message (click to cycle)"
      >
        <svg className="w-3 h-3 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
        <span className="text-[11px] font-medium bg-gradient-to-r from-orange-400 to-violet-400 bg-clip-text text-transparent">Auto</span>
      </button>
    );
  }

  if (mode === "direct") {
    return (
      <button
        onClick={() => onChange(nextMode())}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-zinc-700/50 transition-colors"
        title="Direct Mode — single model responds (click to cycle)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
        <span className="text-[11px] font-medium text-zinc-600">Direct</span>
      </button>
    );
  }

  if (mode === "commander") {
    return (
      <button
        onClick={() => onChange(nextMode())}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/8 hover:bg-purple-500/15 transition-colors"
        title="Freya Mode — orchestrates multiple models in parallel (click to cycle)"
      >
        <svg className="w-3 h-3 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 13.5V3.75m0 9.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 9.75V10.5" />
        </svg>
        <span className="text-[11px] font-medium text-purple-400">Freya</span>
      </button>
    );
  }

  // Researcher mode — unified pill with integrated depth toggle
  const isDeep = depth === "deep";
  return (
    <div className="flex items-center rounded-md bg-teal-500/8 overflow-hidden">
      <button
        onClick={() => onChange(nextMode())}
        className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 hover:bg-teal-500/15 transition-colors"
        title="Research Mode — multi-step deep research (click to cycle mode)"
      >
        <svg className="w-3 h-3 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <span className="text-[11px] font-medium text-teal-400">Research</span>
      </button>
      <div className="w-px h-3.5 bg-zinc-600/40" />
      <button
        onClick={() => onDepthChange(isDeep ? "quick" : "deep")}
        className={`flex items-center gap-1 pl-1.5 pr-2 py-1 transition-colors ${
          isDeep ? "hover:bg-amber-500/10" : "hover:bg-sky-500/10"
        }`}
        title={isDeep
          ? "Deep: 3-5 questions, gap check, plan review (click for Quick)"
          : "Quick: 2-3 questions, no gap check (click for Deep)"
        }
      >
        <span className={`text-[11px] font-medium capitalize ${
          isDeep ? "text-amber-400" : "text-sky-400"
        }`}>
          {depth}
        </span>
        <svg className={`w-2.5 h-2.5 ${isDeep ? "text-amber-500/30" : "text-sky-500/30"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      </button>
    </div>
  );
}
