import { useState, useEffect, useRef, useMemo } from "react";
import type { ToolCallInfo } from "../../lib/claude-protocol";

// ── Tool call styling ────────────────────────────────────────────────────────

const TOOL_COLORS: Record<string, { dot: string; bg: string; border: string; spinBorder: string; spinTop: string }> = {
  blue:   { dot: "bg-blue-400",   bg: "bg-blue-500/5",   border: "border-blue-500/10",   spinBorder: "border-blue-500/30",   spinTop: "border-t-blue-500" },
  amber:  { dot: "bg-amber-400",  bg: "bg-amber-500/5",  border: "border-amber-500/10",  spinBorder: "border-amber-500/30",  spinTop: "border-t-amber-500" },
  green:  { dot: "bg-green-400",  bg: "bg-green-500/5",  border: "border-green-500/10",   spinBorder: "border-green-500/30",  spinTop: "border-t-green-500" },
  purple: { dot: "bg-purple-400", bg: "bg-purple-500/5", border: "border-purple-500/10", spinBorder: "border-purple-500/30", spinTop: "border-t-purple-500" },
  cyan:   { dot: "bg-cyan-400",   bg: "bg-cyan-500/5",   border: "border-cyan-500/10",   spinBorder: "border-cyan-500/30",   spinTop: "border-t-cyan-500" },
  zinc:   { dot: "bg-zinc-500",   bg: "bg-zinc-500/5",   border: "border-zinc-500/10",   spinBorder: "border-zinc-600",      spinTop: "border-t-zinc-400" },
};

function getToolColor(name: string): string {
  const n = name.toLowerCase();
  if (["read", "glob", "grep"].some(t => n.includes(t))) return "blue";
  if (["edit", "write", "notebookedit"].some(t => n.includes(t))) return "amber";
  if (n.includes("bash")) return "green";
  if (["websearch", "webfetch"].some(t => n.includes(t))) return "purple";
  if (n.includes("task")) return "cyan";
  return "zinc";
}

function getToolSummary(name: string, input?: Record<string, unknown>): string | null {
  if (!input) return null;
  if (input.file_path) return String(input.file_path).split(/[/\\]/).pop() || null;
  const n = name.toLowerCase();
  if (n.includes("bash") && input.command) {
    const cmd = String(input.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + "\u2026" : cmd;
  }
  if (input.pattern) return String(input.pattern);
  if (input.query) return String(input.query);
  if (input.url) {
    const url = String(input.url);
    return url.length > 60 ? url.slice(0, 60) + "\u2026" : url;
  }
  return null;
}

// ── Category labels for compacted tool groups ────────────────────────────────

type ToolCategory = "read" | "edit" | "bash" | "search" | "task" | "other";

function categorize(name: string): ToolCategory {
  const n = name.toLowerCase();
  if (["read", "glob", "grep"].some(t => n.includes(t))) return "read";
  if (["edit", "write", "notebookedit"].some(t => n.includes(t))) return "edit";
  if (n.includes("bash")) return "bash";
  if (["websearch", "webfetch"].some(t => n.includes(t))) return "search";
  if (n.includes("task")) return "task";
  return "other";
}

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  read: "Read",
  edit: "Edit",
  bash: "Bash",
  search: "Search",
  task: "Task",
  other: "Tool",
};

const CATEGORY_COLOR_KEYS: Record<ToolCategory, string> = {
  read: "blue",
  edit: "amber",
  bash: "green",
  search: "purple",
  task: "cyan",
  other: "zinc",
};

export function ToolCallCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const colorKey = getToolColor(tool.name);
  const colors = TOOL_COLORS[colorKey];
  const summary = getToolSummary(tool.name, tool.input);

  return (
    <div className={`my-1 rounded-lg overflow-hidden text-xs border ${colors.border} ${colors.bg}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.02] transition-colors text-left"
      >
        {tool.isRunning ? (
          <span className={`inline-block w-2.5 h-2.5 border-[1.5px] rounded-full animate-spin shrink-0 ${colors.spinBorder} ${colors.spinTop}`} />
        ) : (
          <span className={`w-2 h-2 rounded-full ${colors.dot} shrink-0`} />
        )}
        <span className="font-mono text-zinc-400 font-medium">{tool.name}</span>
        {summary && (
          <>
            <span className="text-zinc-700">&middot;</span>
            <span className="text-zinc-600 truncate font-mono text-[11px]">{summary}</span>
          </>
        )}
        <svg
          className={`w-3 h-3 text-zinc-700 ml-auto shrink-0 transition-transform duration-150 ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <>
          {tool.input && Object.keys(tool.input).length > 0 && (
            <div className="px-3 py-2 border-t border-zinc-800/40">
              <pre className="text-zinc-500 whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tool.result && (
            <div className="px-3 py-2 border-t border-zinc-800/40">
              <pre className="text-zinc-400 whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-[11px] leading-relaxed">
                {tool.result}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Compact tool group (for collapsed completed tools) ───────────────────────

function CompactToolGroup({
  category,
  tools,
  onExpand,
}: {
  category: ToolCategory;
  tools: ToolCallInfo[];
  onExpand: () => void;
}) {
  const colorKey = CATEGORY_COLOR_KEYS[category];
  const colors = TOOL_COLORS[colorKey];
  const label = CATEGORY_LABELS[category];
  const count = tools.length;

  // Show up to 2 summaries for brevity
  const details = tools
    .map((t) => getToolSummary(t.name, t.input))
    .filter(Boolean)
    .slice(0, 2);
  const moreCount = tools.length - details.length;

  return (
    <button
      onClick={onExpand}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors hover:bg-white/[0.03] ${colors.border} ${colors.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0 opacity-70`} />
      <span className="text-zinc-500 font-medium">
        {label}
        {count > 1 && <span className="text-zinc-600 ml-0.5">&times;{count}</span>}
      </span>
      {details.length > 0 && (
        <span className="text-zinc-600 font-mono truncate max-w-[160px]">
          {details.join(", ")}
          {moreCount > 0 && ` +${moreCount}`}
        </span>
      )}
    </button>
  );
}

// ── Tool call list with smart compaction ─────────────────────────────────────

export function ToolCallList({ tools, isStreaming }: { tools: ToolCallInfo[]; isStreaming?: boolean }) {
  const [forceExpanded, setForceExpanded] = useState(false);

  // Reset expansion when new streaming starts
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) setForceExpanded(false);
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const completedTools = tools.filter((t) => !t.isRunning);
  const activeTools = tools.filter((t) => t.isRunning);

  // During streaming: compact completed tools as soon as there's 1+ completed
  // After streaming: compact when 2+ completed (single tool just shows inline)
  const compactThreshold = isStreaming ? 1 : 2;
  const shouldCompact = completedTools.length >= compactThreshold && !forceExpanded;

  if (!shouldCompact) {
    return (
      <>
        {tools.map((tool) => (
          <ToolCallCard key={tool.id} tool={tool} />
        ))}
      </>
    );
  }

  // Group completed tools by category
  const groups = new Map<ToolCategory, ToolCallInfo[]>();
  for (const tool of completedTools) {
    const cat = categorize(tool.name);
    const list = groups.get(cat) || [];
    list.push(tool);
    groups.set(cat, list);
  }

  return (
    <>
      {/* Compact summary of completed tools */}
      <div className="flex items-center gap-1 flex-wrap">
        {Array.from(groups.entries()).map(([cat, catTools]) => (
          <CompactToolGroup
            key={cat}
            category={cat}
            tools={catTools}
            onExpand={() => setForceExpanded(true)}
          />
        ))}
        <span className="text-[10px] text-zinc-700 tabular-nums">{completedTools.length} done</span>
        <button
          onClick={() => setForceExpanded(true)}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 px-1 py-0.5 rounded hover:bg-zinc-800/60 transition-colors"
          title="Show all tool calls"
        >
          show all
        </button>
      </div>

      {/* Only the active (running) tool gets a full card */}
      {activeTools.map((tool) => (
        <ToolCallCard key={tool.id} tool={tool} />
      ))}
    </>
  );
}

// ── Agentic status bar (live progress during streaming) ──────────────────────

function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

export function AgenticStatusBar({ tools, startTime }: { tools: ToolCallInfo[]; startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const hasRunning = tools.some((t) => t.isRunning);

  useEffect(() => {
    if (!hasRunning) {
      // All tools done — freeze the timer, stop re-rendering
      clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 500);
    return () => clearInterval(intervalRef.current);
  }, [startTime, hasRunning]);

  // findLast requires es2023 — use a manual reverse search for broader compat
  let activeTool: ToolCallInfo | undefined;
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].isRunning) { activeTool = tools[i]; break; }
  }
  const toolCount = tools.length;
  const completedCount = tools.filter((t) => !t.isRunning).length;

  // Summarize completed tool categories
  const summary = useMemo(() => {
    const cats = new Map<ToolCategory, number>();
    for (const t of tools) {
      if (t.isRunning) continue;
      const cat = categorize(t.name);
      cats.set(cat, (cats.get(cat) || 0) + 1);
    }
    return Array.from(cats.entries())
      .map(([cat, n]) => `${n} ${CATEGORY_LABELS[cat].toLowerCase()}${n > 1 ? "s" : ""}`)
      .join(", ");
  }, [tools]);

  return (
    <div className="flex items-center gap-2 py-1.5 text-[11px]">
      <span className="inline-block w-3 h-3 border-[1.5px] border-orange-500/30 border-t-orange-500 rounded-full animate-spin shrink-0" />
      <span className="text-zinc-500">
        {activeTool ? (
          <>
            <span className="text-zinc-400 font-mono font-medium">{activeTool.name}</span>
            {(() => {
              const s = getToolSummary(activeTool.name, activeTool.input);
              return s ? <span className="text-zinc-600 font-mono"> {s}</span> : null;
            })()}
          </>
        ) : (
          <span className="text-zinc-400">Processing...</span>
        )}
      </span>
      <span className="text-zinc-700">&middot;</span>
      <span className="text-zinc-600 tabular-nums">
        {completedCount > 0 ? `${completedCount}/${toolCount} tools` : `${toolCount} tool${toolCount === 1 ? "" : "s"}`}
      </span>
      {summary && (
        <>
          <span className="text-zinc-700">&middot;</span>
          <span className="text-zinc-600">{summary}</span>
        </>
      )}
      <span className="text-zinc-700">&middot;</span>
      <span className="text-zinc-600 tabular-nums font-mono">{formatElapsed(elapsed)}</span>
    </div>
  );
}

// ── Enhanced thinking indicator with elapsed timer ───────────────────────────

export function ThinkingIndicator({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTime), 500);
    return () => clearInterval(id);
  }, [startTime]);

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <div className="w-6 h-6 rounded-md bg-orange-600/20 flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-3.5 h-3.5 text-orange-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
          </svg>
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="inline-block w-3.5 h-3.5 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
          <span className="text-xs text-zinc-500">Thinking...</span>
          {elapsed >= 2000 && (
            <span className="text-[10px] text-zinc-600 font-mono tabular-nums">{formatElapsed(elapsed)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
