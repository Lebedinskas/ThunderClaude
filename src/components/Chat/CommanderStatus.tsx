import { useState } from "react";
import type { CommanderState, CommanderPhase, WorkerResult } from "../../lib/commander";
import { MODEL_LABELS, isGeminiModel, type AIModel } from "../../lib/models";
import { Spinner } from "../shared/Spinner";

interface CommanderStatusProps {
  state: CommanderState;
}

export function CommanderStatus({ state }: CommanderStatusProps) {
  const { phase, plan, workerResults, activeWorkers, workerStreaming } = state;
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  return (
    <div className="my-3 rounded-xl border border-purple-800/30 bg-purple-950/20 overflow-hidden" style={{ contain: "layout style" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-purple-800/20">
        <CommanderIcon />
        <span className="text-[12px] font-semibold text-purple-300">
          Freya
        </span>
        <PhaseBadge phase={phase} />

        {/* Stop button — visible during active phases (not review, which has its own Cancel) */}
        {(phase === "planning" || phase === "executing" || phase === "synthesizing") && state.onCancel && (
          <button
            onClick={state.onCancel}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium
              text-red-400 hover:text-red-300 hover:bg-red-500/10 active:scale-[0.97] transition-all"
            title="Stop all tasks"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            Stop
          </button>
        )}

        {(phase === "done" || phase === "error") && (
          <span className="ml-auto text-[10px] text-zinc-600">
            {((Date.now() - state.startTime) / 1000).toFixed(1)}s
            {state.totalCost > 0 && ` · $${state.totalCost.toFixed(4)}`}
          </span>
        )}
      </div>

      {/* Planning phase — spinner + live stream */}
      {phase === "planning" && (
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Spinner className="text-purple-400" />
            <span className="text-[12px] text-purple-300/80">
              Analyzing request and creating task plan...
            </span>
            {state.planningText && (
              <span className="ml-auto text-[10px] text-zinc-600 tabular-nums">
                {state.planningText.length > 1000
                  ? `${(state.planningText.length / 1000).toFixed(1)}k`
                  : state.planningText.length} chars
              </span>
            )}
          </div>
          {state.planningText && (
            <div className="rounded-lg bg-zinc-900/60 border border-purple-800/20 px-3 py-2 max-h-24 overflow-hidden">
              <pre className="text-[10px] text-zinc-500 whitespace-pre-wrap break-words leading-relaxed font-mono">
                {state.planningText.split("\n").slice(-6).join("\n").slice(-500)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Plan Review Gate ───────────────────────────────────────────── */}
      {phase === "reviewing" && plan && (
        <div className="px-4 py-3 space-y-3">
          {/* Plan reasoning */}
          {plan.reasoning && (
            <p className="text-[12px] text-zinc-300 leading-relaxed">
              {plan.reasoning}
            </p>
          )}

          {/* Task preview list */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Task Plan ({plan.tasks.length} {plan.tasks.length === 1 ? "worker" : "workers"})
            </div>
            {plan.tasks.map((task, i) => (
              <div
                key={task.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/50"
              >
                <span className="text-[10px] font-mono text-zinc-600 w-4 shrink-0">
                  {i + 1}.
                </span>
                <ModelBadge model={task.model} />
                <span className="text-[11px] text-zinc-400 flex-1 truncate">
                  {task.description}
                </span>
                {task.dependsOn && task.dependsOn.length > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400/70 shrink-0"
                    title={`Depends on: ${task.dependsOn.join(", ")}`}
                  >
                    after {task.dependsOn.join(", ")}
                  </span>
                )}
                {task.priority === "critical" && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                    Critical
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Synthesis hint */}
          {plan.synthesisHint && (
            <p className="text-[11px] text-zinc-600 italic">
              Synthesis: {plan.synthesisHint}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => state.onApprove?.()}
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold
                bg-purple-600 hover:bg-purple-500 text-white
                shadow-md shadow-purple-900/30 active:scale-[0.98] transition-all"
            >
              Proceed
            </button>
            <button
              onClick={() => state.onReject?.()}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium
                text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <span className="text-[10px] text-zinc-700 ml-auto">
              {state.totalCost > 0 && `Planning: $${state.totalCost.toFixed(4)}`}
            </span>
          </div>
        </div>
      )}

      {/* ── Worker Grid (executing / synthesizing / done) ──────────────── */}
      {plan && plan.tasks.length > 0 && phase !== "planning" && phase !== "reviewing" && (
        <div className="px-4 py-3 space-y-2">
          {plan.reasoning && phase === "executing" && (
            <p className="text-[11px] text-zinc-500 italic mb-2">
              {plan.reasoning}
            </p>
          )}
          {(() => {
            const completed = plan.tasks.filter((t) => workerResults.has(t.id)).length;
            const total = plan.tasks.length;
            const pct = total > 0 ? (completed / total) * 100 : 0;
            const allDone = completed === total;
            return (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider">
                    Workers
                  </span>
                  <span className="text-[10px] text-zinc-600 tabular-nums">
                    {completed}/{total}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${
                      allDone ? "bg-green-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            );
          })()}
          <div className="grid gap-1.5">
            {plan.tasks.map((task) => {
              const result = workerResults.get(task.id);
              const isActive = activeWorkers.has(task.id);
              return (
                <WorkerRow
                  key={task.id}
                  model={task.model}
                  description={task.description}
                  priority={task.priority}
                  dependsOn={task.dependsOn}
                  isActive={isActive}
                  result={result ?? null}
                  streamingText={workerStreaming.get(task.id) ?? null}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Synthesis phase indicator */}
      {phase === "synthesizing" && (
        <div className="px-4 py-3 border-t border-purple-800/20 flex items-center gap-2">
          <Spinner className="text-purple-400" />
          <span className="text-[12px] text-purple-300/80">
            Synthesizing results into final response...
          </span>
        </div>
      )}

      {/* ── Walkthrough (done phase) ──────────────────────────────────── */}
      {phase === "done" && plan && (
        <div className="border-t border-purple-800/20">
          <button
            onClick={() => setWalkthroughOpen(!walkthroughOpen)}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-purple-950/30 transition-colors"
          >
            <svg
              className={`w-3 h-3 text-zinc-600 transition-transform ${walkthroughOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[11px] text-zinc-500">
              How this was made
            </span>
            <span className="text-[10px] text-zinc-700 ml-auto">
              {plan.tasks.length} workers · {workerResults.size} results
            </span>
          </button>
          {walkthroughOpen && (
            <div className="px-4 pb-3 space-y-2.5">
              {/* Strategy */}
              {plan.reasoning && (
                <p className="text-[11px] text-zinc-500 italic">
                  Strategy: {plan.reasoning}
                </p>
              )}

              {/* Worker result cards */}
              <div className="space-y-2">
                {plan.tasks.map((task) => {
                  const result = workerResults.get(task.id);
                  return (
                    <WalkthroughCard
                      key={task.id}
                      model={task.model}
                      description={task.description}
                      result={result ?? null}
                    />
                  );
                })}
              </div>

              {/* Summary footer */}
              <div className="flex items-center gap-3 pt-2 text-[10px] text-zinc-500 border-t border-zinc-800/50">
                <span className="font-medium">Total</span>
                <span>{((Date.now() - state.startTime) / 1000).toFixed(1)}s</span>
                {state.totalCost > 0 && <span>${state.totalCost.toFixed(4)}</span>}
                {Array.from(workerResults.values()).some((r) => r.tokens) && (
                  <span>
                    {Array.from(workerResults.values())
                      .reduce((sum, r) => sum + (r.tokens?.total || 0), 0)
                      .toLocaleString()}{" "}
                    tokens
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function WorkerRow({
  model,
  description,
  priority,
  dependsOn,
  isActive,
  result,
  streamingText,
}: {
  model: AIModel;
  description: string;
  priority: "critical" | "standard";
  dependsOn?: string[];
  isActive: boolean;
  result: WorkerResult | null;
  streamingText: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = result?.status === "success" && result.content;
  const hasError = result?.status === "error" && result?.error;
  const isExpandable = hasContent || hasError;
  const hasStreaming = isActive && streamingText && streamingText.length > 0;

  // Show last ~4 lines of streaming text as a compact preview
  const streamPreview = hasStreaming
    ? streamingText.split("\n").slice(-4).join("\n").slice(-300)
    : null;

  return (
    <div className={`rounded-lg bg-zinc-900/60 border overflow-hidden ${
      hasError ? "border-red-900/40" : hasStreaming ? "border-amber-800/30" : "border-zinc-800/50"
    }`}>
      <button
        onClick={() => isExpandable && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${
          isExpandable ? "hover:bg-zinc-800/40 cursor-pointer" : "cursor-default"
        } transition-colors`}
      >
        {/* Status icon */}
        {isActive ? (
          <Spinner className="text-amber-500" />
        ) : result?.status === "success" ? (
          <svg className="w-3 h-3 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : result?.status === "error" || result?.status === "timeout" ? (
          <svg className="w-3 h-3 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : dependsOn && dependsOn.length > 0 ? (
          <span className="w-3 h-3 rounded-full bg-purple-800/60 shrink-0" title={`Waiting for: ${dependsOn.join(", ")}`} />
        ) : (
          <span className="w-3 h-3 rounded-full bg-zinc-700 shrink-0" />
        )}

        <ModelBadge model={model} />

        <span className={`text-[11px] truncate flex-1 ${
          hasError ? "text-red-400/80" : "text-zinc-400"
        }`}>
          {hasError && !expanded
            ? result!.error!.split("\n")[0].slice(0, 80)
            : description}
        </span>

        {dependsOn && dependsOn.length > 0 && !isActive && !result && (
          <span className="text-[9px] text-purple-500/60 shrink-0" title={`Depends on: ${dependsOn.join(", ")}`}>
            waiting
          </span>
        )}

        {priority === "critical" && (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-red-500/10 text-red-400/60 shrink-0">
            Crit
          </span>
        )}

        {/* Streaming byte counter while active */}
        {hasStreaming && (
          <span className="text-[10px] text-amber-600 tabular-nums shrink-0">
            {streamingText.length > 1000
              ? `${(streamingText.length / 1000).toFixed(1)}k`
              : streamingText.length} chars
          </span>
        )}

        {result?.duration != null && (
          <span className="text-[10px] text-zinc-600 shrink-0">
            {(result.duration / 1000).toFixed(1)}s
          </span>
        )}

        {/* Expand chevron — for content or errors */}
        {isExpandable && (
          <svg
            className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Live streaming preview — shows last few lines while worker is active */}
      {streamPreview && (
        <div className="px-3 pb-2 border-t border-amber-800/20">
          <pre className="text-[10px] text-zinc-500 whitespace-pre-wrap break-words leading-relaxed max-h-20 overflow-hidden mt-1.5 font-mono">
            {streamPreview}
          </pre>
        </div>
      )}

      {/* Expanded: success content */}
      {expanded && hasContent && (
        <div className="px-3 pb-2.5 border-t border-zinc-800/50">
          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap break-words leading-relaxed max-h-60 overflow-y-auto mt-2">
            {result!.content}
          </pre>
          {result!.tokens && (
            <div className="mt-1.5 text-[10px] text-zinc-600">
              {result!.tokens.total.toLocaleString()} tokens
              {result!.cost != null && ` · $${result!.cost.toFixed(4)}`}
            </div>
          )}
        </div>
      )}

      {/* Expanded: error details — MCP errors, tool failures, etc. */}
      {expanded && hasError && (
        <div className="px-3 pb-2.5 border-t border-red-900/30">
          <pre className="text-[11px] text-red-400/80 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto mt-2 font-mono">
            {result!.error}
          </pre>
        </div>
      )}
    </div>
  );
}

function WalkthroughCard({
  model,
  description,
  result,
}: {
  model: AIModel;
  description: string;
  result: WorkerResult | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = result?.status === "success" && result.content;
  const hasError = result?.status === "error" && result?.error;

  return (
    <div className={`rounded-lg border overflow-hidden ${
      hasError ? "border-red-900/40 bg-red-950/10" : "border-zinc-800 bg-zinc-900/40"
    }`}>
      {/* Card header */}
      <button
        onClick={() => (hasOutput || hasError) && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
          hasOutput || hasError ? "hover:bg-zinc-800/30 cursor-pointer" : "cursor-default"
        } transition-colors`}
      >
        {/* Status icon */}
        {result?.status === "success" ? (
          <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : result?.status === "error" || result?.status === "timeout" ? (
          <svg className="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="w-3.5 h-3.5 rounded-full bg-zinc-700 shrink-0" />
        )}

        <ModelBadge model={model} />

        <span className="text-[11px] text-zinc-400 truncate flex-1">
          {description}
        </span>

        {/* Stats */}
        <div className="flex items-center gap-2 shrink-0">
          {result?.duration != null && (
            <span className="text-[10px] text-zinc-600 tabular-nums">
              {(result.duration / 1000).toFixed(1)}s
            </span>
          )}
          {result?.cost != null && (
            <span className="text-[10px] text-zinc-600 tabular-nums">
              ${result.cost.toFixed(4)}
            </span>
          )}
          {result?.tokens && (
            <span className="text-[10px] text-zinc-700 tabular-nums">
              {result.tokens.total.toLocaleString()} tok
            </span>
          )}
        </div>

        {/* Expand chevron */}
        {(hasOutput || hasError) && (
          <svg
            className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Expanded content */}
      {expanded && hasOutput && (
        <div className="px-3 pb-3 border-t border-zinc-800/50">
          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap break-words leading-relaxed max-h-64 overflow-y-auto mt-2 font-mono">
            {result!.content}
          </pre>
        </div>
      )}
      {expanded && hasError && (
        <div className="px-3 pb-3 border-t border-red-900/30">
          <pre className="text-[11px] text-red-400/80 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto mt-2 font-mono">
            {result!.error}
          </pre>
        </div>
      )}
    </div>
  );
}

function ModelBadge({ model }: { model: AIModel }) {
  const isGemini = isGeminiModel(model);
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
        isGemini
          ? "bg-blue-500/10 text-blue-400"
          : "bg-orange-500/10 text-orange-400"
      }`}
    >
      {MODEL_LABELS[model]}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: CommanderPhase }) {
  const config: Record<CommanderPhase, { label: string; colors: string }> = {
    planning: {
      label: "Planning",
      colors: "text-amber-400 bg-amber-500/10",
    },
    reviewing: {
      label: "Review Plan",
      colors: "text-cyan-400 bg-cyan-500/10",
    },
    executing: {
      label: "Executing",
      colors: "text-blue-400 bg-blue-500/10",
    },
    synthesizing: {
      label: "Synthesizing",
      colors: "text-purple-400 bg-purple-500/10",
    },
    done: { label: "Complete", colors: "text-green-400 bg-green-500/10" },
    error: { label: "Error", colors: "text-red-400 bg-red-500/10" },
  };
  const { label, colors } = config[phase];

  return (
    <span
      className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors}`}
    >
      {label}
    </span>
  );
}

function CommanderIcon() {
  return (
    <div className="w-5 h-5 rounded bg-purple-600/30 flex items-center justify-center">
      <svg
        className="w-3 h-3 text-purple-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 13.5V3.75m0 9.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 010 3m0-3a1.5 1.5 0 000 3m0 9.75V10.5"
        />
      </svg>
    </div>
  );
}

