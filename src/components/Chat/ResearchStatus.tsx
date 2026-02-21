import { useState } from "react";
import type {
  ResearchState,
  ResearchPhase,
  ResearchWorkerResult,
  ResearchQuestion,
} from "../../lib/researcher";
import { MODEL_LABELS } from "../../lib/models";
import { Spinner } from "../shared/Spinner";

interface ResearchStatusProps {
  state: ResearchState;
}

export function ResearchStatus({ state }: ResearchStatusProps) {
  const {
    phase,
    plan,
    depth,
    workerResults,
    activeWorkers,
    workerStreaming,
    followUpQuestions,
    followUpResults,
    activeFollowUps,
    followUpStreaming,
    sources,
  } = state;
  const [processOpen, setProcessOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <div className="my-3 rounded-xl border border-teal-800/30 bg-teal-950/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-teal-800/20">
        <ResearchIcon />
        <span className="text-[12px] font-semibold text-teal-300">
          Deep Research
        </span>
        <DepthBadge depth={depth} />
        <PhaseBadge phase={phase} />

        {(phase === "planning" || phase === "reviewing" || phase === "researching" || phase === "gap-check" || phase === "follow-up" || phase === "synthesizing") && state.onCancel && (
          <button
            onClick={state.onCancel}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium
              text-red-400 hover:text-red-300 hover:bg-red-500/10 active:scale-[0.97] transition-all"
            title="Stop research"
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
            <Spinner className="text-teal-400" />
            <span className="text-[12px] text-teal-300/80">
              Generating research plan...
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
            <div className="rounded-lg bg-zinc-900/60 border border-teal-800/20 px-3 py-2 max-h-24 overflow-hidden">
              <pre className="text-[10px] text-zinc-500 whitespace-pre-wrap break-words leading-relaxed font-mono">
                {state.planningText.split("\n").slice(-6).join("\n").slice(-500)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Plan review gate (deep mode) */}
      {phase === "reviewing" && plan && (
        <div className="px-4 py-3 space-y-3">
          {plan.reasoning && (
            <p className="text-[11px] text-zinc-500 italic">
              {plan.reasoning}
            </p>
          )}

          <div className="space-y-1.5">
            {plan.questions.map((q) => (
              <div
                key={q.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/50"
              >
                <span className="text-[10px] font-mono text-zinc-600 shrink-0">{q.id}</span>
                <span className="text-[11px] text-zinc-400 flex-1 truncate">{q.question}</span>
                {q.model && (
                  <span className="text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded shrink-0">
                    {MODEL_LABELS[q.model] || q.model}
                  </span>
                )}
                {q.priority === "critical" && (
                  <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-red-500/10 text-red-400/60 shrink-0">
                    Crit
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={state.onApprove}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
                bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 hover:text-teal-300
                border border-teal-600/30 active:scale-[0.97] transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Start Research
            </button>
            <button
              onClick={state.onReject}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
                text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800 active:scale-[0.97] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Research workers grid */}
      {plan && plan.questions.length > 0 && phase !== "planning" && phase !== "reviewing" && (
        <div className="px-4 py-3 space-y-2">
          {plan.reasoning && (phase === "researching" || phase === "gap-check") && (
            <p className="text-[11px] text-zinc-500 italic mb-2">
              {plan.reasoning}
            </p>
          )}

          {/* Progress bar */}
          <WorkerProgressBar
            questions={plan.questions}
            results={workerResults}
            label="Research"
          />

          {/* Worker rows */}
          <div className="grid gap-1.5">
            {plan.questions.map((q) => (
              <ResearchWorkerRow
                key={q.id}
                question={q}
                isActive={activeWorkers.has(q.id)}
                result={workerResults.get(q.id) ?? null}
                streamingText={workerStreaming.get(q.id) ?? null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Gap check phase */}
      {phase === "gap-check" && (
        <div className="px-4 py-3 border-t border-teal-800/20 flex items-center gap-2">
          <Spinner className="text-teal-400" />
          <span className="text-[12px] text-teal-300/80">
            Evaluating research completeness...
          </span>
        </div>
      )}

      {/* Follow-up workers */}
      {followUpQuestions.length > 0 && (phase === "follow-up" || phase === "synthesizing" || phase === "done") && (
        <div className="px-4 py-3 border-t border-teal-800/20 space-y-2">
          <WorkerProgressBar
            questions={followUpQuestions}
            results={followUpResults}
            label="Follow-up"
          />
          <div className="grid gap-1.5">
            {followUpQuestions.map((q) => (
              <ResearchWorkerRow
                key={q.id}
                question={q}
                isActive={activeFollowUps.has(q.id)}
                result={followUpResults.get(q.id) ?? null}
                streamingText={followUpStreaming.get(q.id) ?? null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Synthesis phase */}
      {phase === "synthesizing" && (
        <div className="px-4 py-3 border-t border-teal-800/20 flex items-center gap-2">
          <Spinner className="text-teal-400" />
          <span className="text-[12px] text-teal-300/80">
            Compiling research report...
          </span>
        </div>
      )}

      {/* Done — sources section */}
      {phase === "done" && sources.length > 0 && (
        <div className="border-t border-teal-800/20">
          <button
            onClick={() => setSourcesOpen(!sourcesOpen)}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-teal-950/30 transition-colors"
          >
            <svg
              className={`w-3 h-3 text-zinc-600 transition-transform ${sourcesOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <svg className="w-3 h-3 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.313a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.25 8.81" />
            </svg>
            <span className="text-[11px] text-zinc-500">
              Sources
            </span>
            <span className="text-[10px] text-zinc-700 ml-auto">
              {sources.length} found
            </span>
          </button>
          {sourcesOpen && (
            <div className="px-4 pb-3 space-y-0.5 max-h-40 overflow-y-auto">
              {sources.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[11px] text-teal-500/80 hover:text-teal-400 truncate transition-colors"
                  title={url}
                >
                  [{i + 1}] {url}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Done — collapsible research process */}
      {phase === "done" && plan && (
        <div className="border-t border-teal-800/20">
          <button
            onClick={() => setProcessOpen(!processOpen)}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-teal-950/30 transition-colors"
          >
            <svg
              className={`w-3 h-3 text-zinc-600 transition-transform ${processOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[11px] text-zinc-500">
              Research process
            </span>
            <span className="text-[10px] text-zinc-700 ml-auto">
              {plan.questions.length + followUpQuestions.length} questions · {workerResults.size + followUpResults.size} results
            </span>
          </button>
          {processOpen && (
            <div className="px-4 pb-3 space-y-2.5">
              {plan.reasoning && (
                <p className="text-[11px] text-zinc-500 italic">
                  Strategy: {plan.reasoning}
                </p>
              )}
              <div className="space-y-2">
                {plan.questions.map((q) => (
                  <ProcessCard
                    key={q.id}
                    question={q}
                    result={workerResults.get(q.id) ?? null}
                  />
                ))}
                {followUpQuestions.length > 0 && (
                  <>
                    <div className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider pt-1">
                      Follow-up Research
                    </div>
                    {followUpQuestions.map((q) => (
                      <ProcessCard
                        key={q.id}
                        question={q}
                        result={followUpResults.get(q.id) ?? null}
                      />
                    ))}
                  </>
                )}
              </div>

              {/* Summary footer */}
              <div className="flex items-center gap-3 pt-2 text-[10px] text-zinc-500 border-t border-zinc-800/50">
                <span className="font-medium">Total</span>
                <span>{((Date.now() - state.startTime) / 1000).toFixed(1)}s</span>
                {state.totalCost > 0 && <span>${state.totalCost.toFixed(4)}</span>}
                {sources.length > 0 && <span>{sources.length} sources</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function WorkerProgressBar({
  questions,
  results,
  label,
}: {
  questions: ResearchQuestion[];
  results: Map<string, ResearchWorkerResult>;
  label: string;
}) {
  const completed = questions.filter((q) => results.has(q.id)).length;
  const total = questions.length;
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const allDone = completed === total;

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[10px] text-zinc-600 tabular-nums">
          {completed}/{total}
        </span>
      </div>
      <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            allDone ? "bg-teal-500" : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </>
  );
}

function ResearchWorkerRow({
  question,
  isActive,
  result,
  streamingText,
}: {
  question: ResearchQuestion;
  isActive: boolean;
  result: ResearchWorkerResult | null;
  streamingText: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = (result?.status === "success" || result?.status === "partial") && result.content;
  const hasError = result?.status === "error" && result?.error;
  const isPartial = result?.status === "partial";
  const isExpandable = hasContent || hasError;
  const hasStreaming = isActive && streamingText && streamingText.length > 0;

  const streamPreview = hasStreaming
    ? streamingText.split("\n").slice(-4).join("\n").slice(-300)
    : null;

  return (
    <div className={`rounded-lg bg-zinc-900/60 border overflow-hidden ${
      hasError ? "border-red-900/40" : isPartial ? "border-amber-800/30" : hasStreaming ? "border-teal-800/30" : "border-zinc-800/50"
    }`}>
      <button
        onClick={() => isExpandable && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${
          isExpandable ? "hover:bg-zinc-800/40 cursor-pointer" : "cursor-default"
        } transition-colors`}
      >
        {isActive ? (
          <Spinner className="text-teal-500" />
        ) : result?.status === "success" ? (
          <svg className="w-3 h-3 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : result?.status === "partial" ? (
          <svg className="w-3 h-3 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : result?.status === "error" || result?.status === "timeout" ? (
          <svg className="w-3 h-3 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="w-3 h-3 rounded-full bg-zinc-700 shrink-0" title="Queued" />
        )}

        <span className={`text-[11px] truncate flex-1 ${
          hasError ? "text-red-400/80" : isPartial ? "text-amber-400/80" : "text-zinc-400"
        }`}>
          {hasError && !expanded
            ? result!.error!.split("\n")[0].slice(0, 80)
            : isPartial && !expanded
            ? `${question.question} (partial)`
            : question.question}
        </span>

        {question.model && (
          <span className="text-[9px] text-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 rounded shrink-0">
            {MODEL_LABELS[question.model]?.split(" ").pop() || question.model}
          </span>
        )}

        {question.priority === "critical" && (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-red-500/10 text-red-400/60 shrink-0">
            Crit
          </span>
        )}

        {hasStreaming && (
          <span className="text-[10px] text-teal-600 tabular-nums shrink-0">
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

      {streamPreview && (
        <div className="px-3 pb-2 border-t border-teal-800/20">
          <pre className="text-[10px] text-zinc-500 whitespace-pre-wrap break-words leading-relaxed max-h-20 overflow-hidden mt-1.5 font-mono">
            {streamPreview}
          </pre>
        </div>
      )}

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

function ProcessCard({
  question,
  result,
}: {
  question: ResearchQuestion;
  result: ResearchWorkerResult | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = (result?.status === "success" || result?.status === "partial") && result.content;
  const hasError = result?.status === "error" && result?.error;
  const isPartial = result?.status === "partial";

  return (
    <div className={`rounded-lg border overflow-hidden ${
      hasError ? "border-red-900/40 bg-red-950/10" : isPartial ? "border-amber-800/30 bg-amber-950/10" : "border-zinc-800 bg-zinc-900/40"
    }`}>
      <button
        onClick={() => (hasOutput || hasError) && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
          hasOutput || hasError ? "hover:bg-zinc-800/30 cursor-pointer" : "cursor-default"
        } transition-colors`}
      >
        {result?.status === "success" ? (
          <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : result?.status === "partial" ? (
          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : result?.status === "error" || result?.status === "timeout" ? (
          <svg className="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="w-3.5 h-3.5 rounded-full bg-zinc-700 shrink-0" />
        )}

        <span className="text-[11px] text-zinc-400 truncate flex-1">
          {question.question}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {question.model && (
            <span className="text-[9px] text-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 rounded">
              {MODEL_LABELS[question.model]?.split(" ").pop() || question.model}
            </span>
          )}
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
        </div>

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

function DepthBadge({ depth }: { depth: "quick" | "deep" }) {
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
      depth === "deep"
        ? "text-teal-500 bg-teal-500/10"
        : "text-cyan-400 bg-cyan-500/10"
    }`}>
      {depth}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: ResearchPhase }) {
  const config: Record<ResearchPhase, { label: string; colors: string }> = {
    planning: { label: "Planning", colors: "text-amber-400 bg-amber-500/10" },
    reviewing: { label: "Review", colors: "text-purple-400 bg-purple-500/10" },
    researching: { label: "Researching", colors: "text-teal-400 bg-teal-500/10" },
    "gap-check": { label: "Checking", colors: "text-cyan-400 bg-cyan-500/10" },
    "follow-up": { label: "Follow-up", colors: "text-blue-400 bg-blue-500/10" },
    synthesizing: { label: "Synthesizing", colors: "text-teal-400 bg-teal-500/10" },
    done: { label: "Complete", colors: "text-green-400 bg-green-500/10" },
    error: { label: "Error", colors: "text-red-400 bg-red-500/10" },
  };
  const { label, colors } = config[phase];

  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors}`}>
      {label}
    </span>
  );
}

function ResearchIcon() {
  return (
    <div className="w-5 h-5 rounded bg-teal-600/30 flex items-center justify-center">
      <svg
        className="w-3 h-3 text-teal-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
        />
      </svg>
    </div>
  );
}

