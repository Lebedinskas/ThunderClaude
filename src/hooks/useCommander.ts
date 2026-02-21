import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../lib/claude-protocol";
import type { ProjectContext } from "../lib/project-context";
import { TAURI_COMMANDS } from "../lib/constants";
import { getEngine } from "../lib/models";
import { getAvailableModel } from "../lib/failover";
import { executeOneShot } from "../lib/one-shot";
import {
  CommanderState,
  WorkerResult,
  parseCommanderPlan,
  resolveCommanderWaves,
  createInitialCommanderState,
  buildPlanningMessage,
  buildSynthesisMessage,
  buildSynthesisPrompt,
  parseSoulEvolution,
  truncateContextMessages,
  buildWorkerPromptWithDeps,
  classifyWorkerResult,
  checkCriticalFailures,
  buildFallbackContent,
  isBuildIntent,
  COMMANDER_PLANNING_PROMPT,
  COMMANDER_BUILD_PLANNING_PROMPT,
  PLANNING_TIMEOUT_MS,
  WORKER_TIMEOUT_MS,
  SYNTHESIS_TIMEOUT_MS,
} from "../lib/commander";
import { loadSoulDocument, saveSoulDocument } from "../lib/memory";
import { checkSynthesisQuality, buildRevisionContext } from "../lib/quality-gate";

// ── Commander hook ──────────────────────────────────────────────────────────

interface UseCommanderOptions {
  systemPrompt: string | null;
  mcpConfigPath: string | null;
  projectContext: ProjectContext | null;
}

export function useCommander({ systemPrompt, mcpConfigPath, projectContext }: UseCommanderOptions) {
  const systemPromptRef = useRef(systemPrompt);
  systemPromptRef.current = systemPrompt;
  const mcpConfigRef = useRef(mcpConfigPath);
  mcpConfigRef.current = mcpConfigPath;
  const projectContextRef = useRef(projectContext);
  projectContextRef.current = projectContext;

  // Plan approval gate — resolve function stored here while awaiting user decision
  const pendingApprovalRef = useRef<((proceed: boolean) => void) | null>(null);

  // Cancellation: AbortController per run + set of active CLI process IDs
  const abortRef = useRef<AbortController | null>(null);
  const activeQueryIdsRef = useRef(new Set<string>());
  const cancelledRef = useRef(false);

  /** Cancel all active commander queries and abort the pipeline. */
  const cancelCommander = useCallback(() => {
    cancelledRef.current = true;
    // Abort the pipeline (executeOneShot checks this at every stage)
    abortRef.current?.abort();
    // Resolve any pending plan approval with "reject"
    pendingApprovalRef.current?.(false);
    pendingApprovalRef.current = null;
    // Kill all active CLI processes
    for (const qid of activeQueryIdsRef.current) {
      invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId: qid }).catch(() => {});
    }
    activeQueryIdsRef.current.clear();
  }, []);

  /** Broadcast state changes with properly cloned collections */
  const emitState = (
    state: CommanderState,
    onPhaseChange: (s: CommanderState) => void,
  ) => {
    onPhaseChange({
      ...state,
      workerResults: new Map(state.workerResults),
      activeWorkers: new Set(state.activeWorkers),
      workerStreaming: new Map(state.workerStreaming),
    });
  };

  /**
   * Execute the full commander pipeline:
   * Phase 1: Planning → Phase 1.5: Review → Phase 2: Workers → Phase 3: Synthesis
   *
   * Returns the final content + aggregated cost/duration, or null on failure/cancel.
   */
  const executeCommander = useCallback(
    async (
      userMessage: string,
      conversationContext: ChatMessage[],
      onPhaseChange: (state: CommanderState) => void,
      onStreamingUpdate: (text: string, phase: "planning" | "synthesizing") => void,
    ): Promise<{
      finalContent: string;
      totalCost: number;
      totalDuration: number;
      /** Set when commander fails at a specific phase — surfaces to the user. */
      error?: string;
    } | null> => {
      // Fresh abort controller and state for this run
      const abort = new AbortController();
      abortRef.current = abort;
      activeQueryIdsRef.current.clear();
      cancelledRef.current = false;

      const state = createInitialCommanderState();
      state.onCancel = cancelCommander;
      onPhaseChange({ ...state });

      // Throttle streaming updates to prevent excessive re-renders (~12 FPS).
      // Phase transitions always emit immediately (they call emitState directly).
      let lastStreamEmit = 0;
      const STREAM_THROTTLE_MS = 80;
      const throttledEmit = () => {
        const now = Date.now();
        if (now - lastStreamEmit >= STREAM_THROTTLE_MS) {
          lastStreamEmit = now;
          emitState(state, onPhaseChange);
        }
      };

      // ── Phase 0: Load Soul ──────────────────────────────────────────
      const soul = await loadSoulDocument();

      // ── Phase 1: Planning ─────────────────────────────────────────────
      const contextStr = truncateContextMessages(conversationContext);

      const buildMode = isBuildIntent(userMessage);
      const planningSystemPrompt = buildMode ? COMMANDER_BUILD_PLANNING_PROMPT : COMMANDER_PLANNING_PROMPT;

      const planningMessage = buildPlanningMessage(userMessage, contextStr, soul, projectContextRef.current);
      console.log(`[Commander] Planning message length: ${planningMessage.length} chars, context: ${contextStr.length} chars, project: ${projectContextRef.current?.name ?? "none"}, buildMode: ${buildMode}`);

      const runPlanning = () =>
        executeOneShot(
          {
            message: planningMessage,
            model: "claude-opus-4-6",
            engine: "claude",
            systemPrompt: planningSystemPrompt,
            mcpConfig: null,
            timeoutMs: PLANNING_TIMEOUT_MS,
            maxTurns: 1,
            tools: "",              // Disable ALL built-in tools — pure reasoning
            strictMcp: true,        // Ignore user's default MCP servers
            permissionMode: "bypassPermissions",  // Required for headless mode (stdin is null)
            onStreaming: (text) => {
              state.planningText = text;
              throttledEmit();
              onStreamingUpdate(text, "planning");
            },
          },
          abort.signal,
          activeQueryIdsRef.current,
        );

      let planResult = await runPlanning();

      // Retry once on failure (handles CLI cold-start, transient timeouts)
      if (!planResult && !abort.signal.aborted) {
        console.warn("[Commander] Planning attempt 1 failed (null result), retrying...");
        planResult = await runPlanning();
      }

      if (abort.signal.aborted) return null;

      console.log("[Commander] Planning result:", planResult ? {
        contentLen: planResult.content.length,
        hasStderr: !!planResult.stderr,
        stderr: planResult.stderr?.slice(0, 200),
        contentPreview: planResult.content.slice(0, 200),
      } : "NULL (both attempts failed)");

      if (!planResult) {
        state.phase = "error";
        delete state.onCancel;
        emitState(state, onPhaseChange);
        const elapsed = Date.now() - state.startTime;
        return {
          finalContent: "",
          totalCost: state.totalCost,
          totalDuration: elapsed,
          error: `Planning phase failed — Claude CLI (claude-opus-4-6) returned no output after 2 attempts (${Math.round(elapsed / 1000)}s elapsed, timeout: ${PLANNING_TIMEOUT_MS / 1000}s per attempt). This usually means rate limiting or CLI process issues.`,
        };
      }

      if (planResult.stderr && !planResult.content.trim()) {
        state.phase = "error";
        delete state.onCancel;
        emitState(state, onPhaseChange);
        return {
          finalContent: "",
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
          error: `Planning failed (claude-opus-4-6): ${planResult.stderr.split("\n")[0]}`,
        };
      }

      state.totalCost += planResult.cost || 0;

      const plan = parseCommanderPlan(planResult.content);
      if (!plan) {
        console.warn("[Commander] Failed to parse plan:", planResult.content.slice(0, 300));
        state.phase = "error";
        delete state.onCancel;
        emitState(state, onPhaseChange);
        return {
          finalContent: "",
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
          error: `Planning failed — could not parse task plan from Opus response.\n\nRaw output start: ${planResult.content.slice(0, 300)}`,
        };
      }

      state.plan = plan;

      // ── Phase 1.5: Plan Review Gate ───────────────────────────────────
      // Auto-approve single-task plans — the overhead of review + synthesis
      // isn't worth it when Opus already decided one model is enough.
      const isSingleTask = plan.tasks.length === 1;

      if (!isSingleTask) {
        state.phase = "reviewing";
        state.onApprove = () => pendingApprovalRef.current?.(true);
        state.onReject = cancelCommander; // Reject = full stop, no fallback
        state.onCancel = cancelCommander;
        emitState(state, onPhaseChange);

        const proceed = await new Promise<boolean>((resolve) => {
          pendingApprovalRef.current = resolve;
        });
        pendingApprovalRef.current = null;

        // Clean up review callbacks
        delete state.onApprove;
        delete state.onReject;

        if (!proceed || abort.signal.aborted) {
          return null;
        }
      }

      // ── Phase 2: Wave-Based Worker Execution ──────────────────────────
      // Resolve dependency graph into waves: Wave 1 (no deps) → parallel,
      // Wave 2 (deps on Wave 1, gets outputs as context) → parallel, etc.
      state.phase = "executing";
      state.onCancel = cancelCommander;
      emitState(state, onPhaseChange);

      const waves = resolveCommanderWaves(plan.tasks);
      console.log(`[Commander] Resolved ${plan.tasks.length} tasks into ${waves.length} wave(s): ${waves.map((w, i) => `W${i + 1}(${w.length})`).join(" → ")}`);

      const completedOutputs = new Map<string, string>();
      let workerResults: WorkerResult[] = [];

      for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
        if (abort.signal.aborted) return null;

        const wave = waves[waveIdx];
        if (waves.length > 1) {
          console.log(`[Commander] Starting wave ${waveIdx + 1}/${waves.length} (${wave.length} tasks)`);
        }

        const wavePromises = wave.map((task) => {
          state.activeWorkers.add(task.id);
          emitState(state, onPhaseChange);

          // Apply failover — if planner's chosen model is rate-limited, use alternative
          const workerModel = getAvailableModel(task.model);
          if (workerModel !== task.model) {
            console.log(`[Commander] Worker ${task.id}: ${task.model} → ${workerModel} (failover)`);
          }

          // Build prompt — inject prior task outputs for dependent tasks
          const workerPrompt = buildWorkerPromptWithDeps(task.prompt, task.dependsOn, completedOutputs);

          return executeOneShot(
            {
              message: workerPrompt,
              model: workerModel,
              engine: getEngine(workerModel),
              systemPrompt: systemPromptRef.current,
              mcpConfig: mcpConfigRef.current,
              timeoutMs: WORKER_TIMEOUT_MS,
              permissionMode: "bypassPermissions",  // Workers are autonomous — auto-approve tool usage
              cwd: projectContextRef.current?.rootPath,  // Run in project directory for correct file paths
              onStreaming: (text) => {
                state.workerStreaming.set(task.id, text);
                throttledEmit();
              },
            },
            abort.signal,
            activeQueryIdsRef.current,
          ).then((result): WorkerResult => {
            const workerResult = classifyWorkerResult(result, task.id, task.model, abort.signal.aborted);

            state.workerResults.set(task.id, workerResult);
            state.activeWorkers.delete(task.id);
            state.workerStreaming.delete(task.id);
            state.totalCost += workerResult.cost || 0;
            emitState(state, onPhaseChange);

            return workerResult;
          });
        });

        const waveSettled = await Promise.allSettled(wavePromises);

        const waveResults: WorkerResult[] = waveSettled.map((r, i) => {
          if (r.status === "fulfilled") return r.value;
          return {
            taskId: wave[i].id,
            model: wave[i].model,
            status: "error" as const,
            content: "",
            error: String(r.reason),
          };
        });

        workerResults.push(...waveResults);

        // Collect successful outputs for next wave's dependency context
        for (const r of waveResults) {
          if (r.status === "success" && r.content) {
            completedOutputs.set(r.taskId, r.content);
          }
        }
      }

      if (abort.signal.aborted) return null;

      // Check if all critical tasks failed
      const criticalError = checkCriticalFailures(plan.tasks, state.workerResults);
      if (criticalError) {
        state.phase = "error";
        delete state.onCancel;
        emitState(state, onPhaseChange);
        return {
          finalContent: "",
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
          error: criticalError,
        };
      }

      // ── Phase 3: Synthesis ────────────────────────────────────────────
      // Skip synthesis for single-worker plans — the worker's output IS the answer.
      // Saves ~15-20s (Opus CLI spawn + model call) with zero quality loss.
      const successfulResults = workerResults.filter((r) => r.status === "success");
      if (isSingleTask && successfulResults.length === 1) {
        state.phase = "done";
        delete state.onCancel;
        emitState(state, onPhaseChange);
        return {
          finalContent: successfulResults[0].content,
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
        };
      }

      state.phase = "synthesizing";
      state.onCancel = cancelCommander;
      emitState(state, onPhaseChange);

      const synthesisMessage = buildSynthesisMessage(userMessage, plan, workerResults);

      const synthesisResult = await executeOneShot(
        {
          message: synthesisMessage,
          model: "claude-opus-4-6",
          engine: "claude",
          systemPrompt: buildSynthesisPrompt(soul),
          mcpConfig: null,
          timeoutMs: SYNTHESIS_TIMEOUT_MS,
          maxTurns: 1,
          tools: "",              // Disable ALL built-in tools — pure reasoning
          strictMcp: true,        // Ignore user's default MCP servers
          permissionMode: "bypassPermissions",  // Required for headless mode (stdin is null)
          onStreaming: (text) => onStreamingUpdate(text, "synthesizing"),
        },
        abort.signal,
        activeQueryIdsRef.current,
      );

      if (abort.signal.aborted) return null;

      state.totalCost += synthesisResult?.cost || 0;

      console.log("[Commander] Synthesis result:", synthesisResult ? {
        contentLen: synthesisResult.content.length,
        hasContent: !!synthesisResult.content.trim(),
        outcome: synthesisResult.outcome,
        stderr: synthesisResult.stderr?.slice(0, 200),
      } : "NULL");

      if (synthesisResult && synthesisResult.content.trim()) {
        // ── Quality Gate — fast Haiku check on synthesis completeness ──
        let finalContent = synthesisResult.content;
        const qualityCheck = await checkSynthesisQuality(
          userMessage, finalContent, abort.signal, activeQueryIdsRef.current,
        );
        if (qualityCheck) {
          state.totalCost += 0.001; // Haiku check cost estimate
          if (!qualityCheck.pass && qualityCheck.issues) {
            console.log(`[Commander] Quality gate: ${qualityCheck.score}/10 — "${qualityCheck.issues}". Re-synthesizing...`);
            const revisionMsg = buildRevisionContext(synthesisMessage, finalContent, qualityCheck.issues);
            const revised = await executeOneShot(
              {
                message: revisionMsg,
                model: "claude-opus-4-6",
                engine: "claude",
                systemPrompt: buildSynthesisPrompt(soul),
                mcpConfig: null,
                timeoutMs: SYNTHESIS_TIMEOUT_MS,
                maxTurns: 1,
                tools: "",
                strictMcp: true,
                permissionMode: "bypassPermissions",
                onStreaming: (text) => onStreamingUpdate(text, "synthesizing"),
              },
              abort.signal,
              activeQueryIdsRef.current,
            );
            state.totalCost += revised?.cost || 0;
            if (revised?.content) finalContent = revised.content;
          } else {
            console.log(`[Commander] Quality gate: ${qualityCheck.score}/10 — pass`);
          }
        }

        if (abort.signal.aborted) return null;

        // ── Soul Evolution — parse and save if Commander evolved its identity
        const { displayContent, soulEvolution } = parseSoulEvolution(finalContent);
        finalContent = displayContent;

        if (soulEvolution) {
          saveSoulDocument(soulEvolution).then(() => {
            console.log("[Commander] Soul evolved:", soulEvolution.slice(0, 120));
          }).catch((err) => {
            console.warn("[Commander] Soul save failed (non-blocking):", err);
          });
        }

        state.phase = "done";
        delete state.onCancel;
        emitState(state, onPhaseChange);
        return {
          finalContent,
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
        };
      }

      // Synthesis failed or returned empty — fallback to concatenated results
      console.warn("[Commander] Synthesis empty or failed — using fallback concatenation of worker results");
      state.phase = "done";
      delete state.onCancel;
      emitState(state, onPhaseChange);

      return {
        finalContent: buildFallbackContent(workerResults) || "All workers and synthesis failed. Please try again.",
        totalCost: state.totalCost,
        totalDuration: Date.now() - state.startTime,
      };
    },
    [cancelCommander],
  );

  return { executeCommander, cancelCommander, wasCancelled: cancelledRef };
}
