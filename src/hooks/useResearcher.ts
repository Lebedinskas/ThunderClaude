import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../lib/claude-protocol";
import { createLimiter } from "../lib/concurrency";
import { TAURI_COMMANDS } from "../lib/constants";
import { getEngine, type AIModel } from "../lib/models";
import { getAvailableModel } from "../lib/failover";
import { executeOneShot } from "../lib/one-shot";
import {
  ResearchState,
  ResearchWorkerResult,
  ResearchQuestion,
  ResearchDepth,
  DEPTH_CONFIG,
  RESEARCH_CONCURRENCY_LIMIT,
  classifyResearchWorkerResult,
  createInitialResearchState,
  parseResearchPlan,
  parseGapAnalysis,
  extractSources,
  cleanWorkerContent,
  hasUsableContent,
  resolveWaves,
  buildResearchPlanningMessage,
  buildResearchWorkerMessage,
  buildGapAnalysisMessage,
  buildSynthesisMessage,
  buildPlanningPrompt,
  getPlanningModel,
  getSynthesisModel,
  identifyTimedOutModels,
  replaceTimedOutModels,
  buildRetryQuestions,
  mergeWorkerResults,
  buildFallbackResearchContent,
  RESEARCH_WORKER_PROMPT,
  RESEARCH_GAP_PROMPT,
  RESEARCH_SYNTHESIS_PROMPT,
  RESEARCH_PLANNING_TIMEOUT_MS,
  RESEARCH_WORKER_TIMEOUT_MS,
  RESEARCH_GAP_TIMEOUT_MS,
  RESEARCH_SYNTHESIS_TIMEOUT_MS,
} from "../lib/researcher";
import { checkSynthesisQuality, buildRevisionContext } from "../lib/quality-gate";

interface UseResearcherOptions {
  systemPrompt: string | null;
  mcpConfigPath: string | null;
}

/** Broadcast state with properly cloned collections (prevents stale React refs) */
function emitResearchState(
  state: ResearchState,
  onPhaseChange: (s: ResearchState) => void,
) {
  onPhaseChange({
    ...state,
    workerResults: new Map(state.workerResults),
    activeWorkers: new Set(state.activeWorkers),
    workerStreaming: new Map(state.workerStreaming),
    followUpResults: new Map(state.followUpResults),
    activeFollowUps: new Set(state.activeFollowUps),
    followUpStreaming: new Map(state.followUpStreaming),
    sources: [...state.sources],
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useResearcher({ systemPrompt, mcpConfigPath }: UseResearcherOptions) {
  const systemPromptRef = useRef(systemPrompt);
  systemPromptRef.current = systemPrompt;
  const mcpConfigRef = useRef(mcpConfigPath);
  mcpConfigRef.current = mcpConfigPath;

  const abortRef = useRef<AbortController | null>(null);
  const activeQueryIdsRef = useRef(new Set<string>());
  const cancelledRef = useRef(false);
  const pendingApprovalRef = useRef<((proceed: boolean) => void) | null>(null);

  const cancelResearch = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    pendingApprovalRef.current?.(false);
    pendingApprovalRef.current = null;
    for (const qid of activeQueryIdsRef.current) {
      invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId: qid }).catch(() => {});
    }
    activeQueryIdsRef.current.clear();
  }, []);

  /**
   * Execute the full research pipeline:
   * Phase 1: Planning → Phase 1.5: Review (deep) → Phase 2: Research Workers →
   * Phase 3: Gap Check (deep) → Phase 4: Follow-up (conditional) → Phase 5: Synthesis
   */
  const executeResearch = useCallback(
    async (
      userQuery: string,
      conversationContext: ChatMessage[],
      userModel: AIModel,
      depth: ResearchDepth,
      onPhaseChange: (state: ResearchState) => void,
      onStreamingUpdate: (text: string, phase: "planning" | "synthesizing") => void,
    ): Promise<{
      finalContent: string;
      totalCost: number;
      totalDuration: number;
      error?: string;
    } | null> => {
      const abort = new AbortController();
      abortRef.current = abort;
      activeQueryIdsRef.current.clear();
      cancelledRef.current = false;

      const depthConfig = DEPTH_CONFIG[depth];
      const planning = getPlanningModel();
      const synthesis = getSynthesisModel();

      const state = createInitialResearchState(depth);
      state.onCancel = cancelResearch;
      onPhaseChange({ ...state });

      // ── Phase 1: Planning (with single retry for cold-start) ──────────
      const contextStr = conversationContext
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");

      const planningMessage = buildResearchPlanningMessage(userQuery, contextStr);

      console.log(`[Researcher] Planning with ${planning.model} (Claude, tool-free), depth=${depth}, workers will use ${userModel}`);

      const runPlanning = () =>
        executeOneShot(
          {
            message: planningMessage,
            model: planning.model,
            engine: planning.engine,
            systemPrompt: buildPlanningPrompt(depth),
            mcpConfig: null,
            timeoutMs: RESEARCH_PLANNING_TIMEOUT_MS,
            maxTurns: 1,
            tools: "",
            strictMcp: true,
            permissionMode: "bypassPermissions",
            onStreaming: (text) => {
              state.planningText = text;
              emitResearchState(state, onPhaseChange);
              onStreamingUpdate(text, "planning");
            },
          },
          abort.signal,
          activeQueryIdsRef.current,
        );

      let planResult = await runPlanning();

      // Retry once on failure (handles CLI cold-start, transient timeouts)
      if (!planResult && !abort.signal.aborted) {
        console.warn("[Researcher] Planning attempt 1 failed (null result), retrying...");
        planResult = await runPlanning();
      }

      if (abort.signal.aborted) return null;

      if (!planResult || !planResult.content.trim()) {
        const stderr = planResult?.stderr?.slice(0, 500) || "none";
        const detail = `Phase: PLANNING | Model: ${planning.model} | Engine: ${planning.engine} | Timeout: ${RESEARCH_PLANNING_TIMEOUT_MS}ms | Result: ${!planResult ? "null (CLI spawn/timeout)" : "empty content"} | Stderr: ${stderr}`;
        console.error("[Researcher] Planning failed:", detail);
        state.phase = "error";
        delete state.onCancel;
        emitResearchState(state, onPhaseChange);
        return {
          finalContent: "",
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
          error: `Phase PLANNING failed (${planning.model}): ${!planResult ? "CLI returned null after 2 attempts" : stderr !== "none" ? stderr : "empty content"}`,
        };
      }

      console.log(`[Researcher] Planning succeeded (${planResult.content.length} chars)`);
      state.totalCost += planResult.cost || 0;

      const plan = parseResearchPlan(planResult.content, depthConfig.maxQuestions);
      if (!plan) {
        const raw = planResult.content.slice(0, 800);
        console.error("[Researcher] Failed to parse plan JSON. Raw:", raw);
        state.phase = "error";
        delete state.onCancel;
        emitResearchState(state, onPhaseChange);
        return {
          finalContent: "",
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
          error: `Phase PLANNING (${planning.model}): JSON parse failed. Raw output starts with: "${raw.slice(0, 200)}"`,
        };
      }

      console.log(`[Researcher] Plan parsed: ${plan.questions.length} questions`);
      state.plan = plan;

      // ── Phase 1.5: Plan Review Gate (deep mode only) ──────────────────
      if (!depthConfig.skipReview) {
        state.phase = "reviewing";
        state.onApprove = () => pendingApprovalRef.current?.(true);
        state.onReject = cancelResearch;
        state.onCancel = cancelResearch;
        emitResearchState(state, onPhaseChange);

        const proceed = await new Promise<boolean>((resolve) => {
          pendingApprovalRef.current = resolve;
        });
        pendingApprovalRef.current = null;

        delete state.onApprove;
        delete state.onReject;

        if (!proceed || abort.signal.aborted) {
          return null;
        }
      }

      // ── Phase 2: Wave-based Research Workers ────────────────────────────
      // Resolve dependency graph into execution waves:
      // Wave 1 (no deps) → run parallel → Wave 2 (deps on Wave 1, gets findings) → etc.
      state.phase = "researching";
      state.onCancel = cancelResearch;
      emitResearchState(state, onPhaseChange);

      const waves = resolveWaves(plan.questions);
      console.log(`[Researcher] Resolved ${plan.questions.length} questions into ${waves.length} wave(s): ${waves.map((w, i) => `W${i + 1}(${w.length})`).join(" → ")}`);

      const completedFindings = new Map<string, string>();
      let workerResults: ResearchWorkerResult[] = [];

      for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
        if (abort.signal.aborted) return null;

        const wave = waves[waveIdx];
        if (waves.length > 1) {
          console.log(`[Researcher] Starting wave ${waveIdx + 1}/${waves.length} (${wave.length} questions)`);
        }

        const waveResults = await executeWorkers(
          wave,
          userModel,
          state,
          "workerResults",
          "activeWorkers",
          "workerStreaming",
          onPhaseChange,
          abort,
          activeQueryIdsRef.current,
          mcpConfigRef.current,
          waveIdx > 0 ? completedFindings : undefined, // Pass prior findings to Wave 2+
        );

        workerResults.push(...waveResults);

        // Collect usable findings for next wave's context (success + partial)
        for (const r of waveResults) {
          if (hasUsableContent(r)) {
            completedFindings.set(r.questionId, r.content);
          }
        }
      }

      if (abort.signal.aborted) return null;

      // Retry CRITICAL workers that fully failed (error/no result).
      // Partial results (timed out but have content) are usable — don't retry.
      const failedCritical = plan.questions.filter((q) => {
        if (q.priority !== "critical") return false;
        const r = state.workerResults.get(q.id);
        return !r || r.status === "error";
      });

      let retryResults: ResearchWorkerResult[] = [];
      if (failedCritical.length > 0 && !abort.signal.aborted) {
        console.log(`[Researcher] Retrying ${failedCritical.length} failed CRITICAL workers`);
        const retryQuestions = buildRetryQuestions(failedCritical, state.workerResults, userModel);

        retryResults = await executeWorkers(
          retryQuestions,
          userModel,
          state,
          "workerResults",
          "activeWorkers",
          "workerStreaming",
          onPhaseChange,
          abort,
          activeQueryIdsRef.current,
          mcpConfigRef.current,
        );
      }

      if (abort.signal.aborted) return null;

      // Final check — if ALL critical workers have no usable content, abort
      const criticalQs = plan.questions.filter((q) => q.priority === "critical");
      const criticalWithContent = criticalQs.filter((q) => {
        const r = state.workerResults.get(q.id);
        return r && hasUsableContent(r);
      });

      if (criticalQs.length > 0 && criticalWithContent.length === 0) {
        // Collect error details from each failed critical worker
        const failDetails = criticalQs.map((q) => {
          const r = state.workerResults.get(q.id);
          return `  ${q.id} (${q.model || userModel}): ${r?.error || "no result"}`;
        }).join("\n");
        console.error(`[Researcher] All ${criticalQs.length} critical workers failed:\n${failDetails}`);
        state.phase = "error";
        delete state.onCancel;
        emitResearchState(state, onPhaseChange);
        return {
          finalContent: "",
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
          error: `Phase WORKERS: All ${criticalQs.length} critical workers failed (including retries).\n${failDetails}`,
        };
      }

      // ── Phase 3: Gap Check (deep mode only) ──────────────────────────
      let allResults = mergeWorkerResults(workerResults, retryResults);

      // Track models that timed out — avoid assigning them to follow-up workers
      const timedOutModels = identifyTimedOutModels(allResults);
      if (timedOutModels.size > 0) {
        console.log(`[Researcher] Models that timed out: ${[...timedOutModels].join(", ")} — will be replaced in follow-ups`);
      }

      if (!depthConfig.skipGapCheck) {
        state.phase = "gap-check";
        emitResearchState(state, onPhaseChange);

        const gapMessage = buildGapAnalysisMessage(userQuery, plan, workerResults);
        const gapResult = await executeOneShot(
          {
            message: gapMessage,
            model: planning.model,
            engine: planning.engine,
            systemPrompt: RESEARCH_GAP_PROMPT,
            mcpConfig: null,
            timeoutMs: RESEARCH_GAP_TIMEOUT_MS,
            maxTurns: 1,
            tools: "",
            strictMcp: true,
            permissionMode: "bypassPermissions",
            onStreaming: () => {},
          },
          abort.signal,
          activeQueryIdsRef.current,
        );

        if (abort.signal.aborted) return null;
        state.totalCost += gapResult?.cost || 0;

        // ── Phase 4: Follow-up (conditional) ──────────────────────────────
        if (gapResult?.content) {
          const gapAnalysis = parseGapAnalysis(gapResult.content);

          if (gapAnalysis && gapAnalysis.status === "gaps_found" && gapAnalysis.followUpQuestions.length > 0) {
            const safeFollowUps = replaceTimedOutModels(gapAnalysis.followUpQuestions, timedOutModels);

            state.phase = "follow-up";
            state.followUpQuestions = safeFollowUps;
            emitResearchState(state, onPhaseChange);

            const followUpResults = await executeWorkers(
              safeFollowUps,
              userModel,
              state,
              "followUpResults",
              "activeFollowUps",
              "followUpStreaming",
              onPhaseChange,
              abort,
              activeQueryIdsRef.current,
              mcpConfigRef.current,
            );

            if (abort.signal.aborted) return null;
            allResults = [...allResults, ...followUpResults];
          }
        }
      }

      // ── Phase 5: Synthesis ────────────────────────────────────────────
      state.phase = "synthesizing";
      state.onCancel = cancelResearch;
      emitResearchState(state, onPhaseChange);

      // Merge plan questions with follow-up questions for synthesis context
      const fullPlan = {
        ...plan,
        questions: [...plan.questions, ...state.followUpQuestions],
      };

      const synthesisMsg = buildSynthesisMessage(userQuery, fullPlan, allResults);
      const usable = allResults.filter(hasUsableContent);
      const partial = usable.filter(r => r.status === "partial").length;
      console.log(`[Researcher] Synthesis input: ${synthesisMsg.length} chars from ${usable.length} workers (${usable.length - partial} full, ${partial} partial)`);

      const synthesisResult = await executeOneShot(
        {
          message: synthesisMsg,
          model: synthesis.model,
          engine: synthesis.engine,
          systemPrompt: RESEARCH_SYNTHESIS_PROMPT,
          mcpConfig: null,
          timeoutMs: RESEARCH_SYNTHESIS_TIMEOUT_MS,
          maxTurns: 1,
          tools: "",
          strictMcp: true,
          permissionMode: "bypassPermissions",
          onStreaming: (text) => onStreamingUpdate(text, "synthesizing"),
        },
        abort.signal,
        activeQueryIdsRef.current,
      );

      if (abort.signal.aborted) return null;
      state.totalCost += synthesisResult?.cost || 0;

      if (synthesisResult?.content) {
        console.log(`[Researcher] Synthesis succeeded (${synthesisResult.content.length} chars)`);
        let cleanedSynthesis = cleanWorkerContent(synthesisResult.content);

        // ── Quality Gate — fast Haiku check on synthesis completeness ──
        const qualityCheck = await checkSynthesisQuality(
          userQuery, cleanedSynthesis, abort.signal, activeQueryIdsRef.current,
        );
        if (qualityCheck) {
          state.totalCost += 0.001;
          if (!qualityCheck.pass && qualityCheck.issues) {
            console.log(`[Researcher] Quality gate: ${qualityCheck.score}/10 — "${qualityCheck.issues}". Re-synthesizing...`);
            const revisionMsg = buildRevisionContext(synthesisMsg, cleanedSynthesis, qualityCheck.issues);
            const revised = await executeOneShot(
              {
                message: revisionMsg,
                model: synthesis.model,
                engine: synthesis.engine,
                systemPrompt: RESEARCH_SYNTHESIS_PROMPT,
                mcpConfig: null,
                timeoutMs: RESEARCH_SYNTHESIS_TIMEOUT_MS,
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
            if (revised?.content) {
              cleanedSynthesis = cleanWorkerContent(revised.content);
            }
          } else {
            console.log(`[Researcher] Quality gate: ${qualityCheck.score}/10 — pass`);
          }
        }

        if (abort.signal.aborted) return null;

        // Extract any additional sources from synthesis
        const synthSources = extractSources(cleanedSynthesis);
        for (const src of synthSources) {
          if (!state.sources.includes(src)) state.sources.push(src);
        }

        state.phase = "done";
        delete state.onCancel;
        emitResearchState(state, onPhaseChange);
        return {
          finalContent: cleanedSynthesis,
          totalCost: state.totalCost,
          totalDuration: Date.now() - state.startTime,
        };
      }

      // Synthesis failed — log the reason with full detail
      const synthError = synthesisResult?.stderr || "null result (timeout or empty output)";
      console.error(`[Researcher] Synthesis FAILED | Model: ${synthesis.model} | Engine: ${synthesis.engine} | Timeout: ${RESEARCH_SYNTHESIS_TIMEOUT_MS}ms | Error: ${synthError} | Input was ${synthesisMsg.length} chars from ${usable.length} workers`);
      console.warn(`[Researcher] Falling back to cleaned worker output concatenation.`);

      // Fallback: clean and concatenate worker results
      state.phase = "done";
      delete state.onCancel;
      emitResearchState(state, onPhaseChange);

      return {
        finalContent: buildFallbackResearchContent(allResults) || "All research and synthesis phases failed. Please try again.",
        totalCost: state.totalCost,
        totalDuration: Date.now() - state.startTime,
      };
    },
    [cancelResearch],
  );

  return { executeResearch, cancelResearch, wasCancelled: cancelledRef };
}

// ── Worker execution helper ─────────────────────────────────────────────────

async function executeWorkers(
  questions: ResearchQuestion[],
  fallbackModel: AIModel,
  state: ResearchState,
  resultsKey: "workerResults" | "followUpResults",
  activeKey: "activeWorkers" | "activeFollowUps",
  streamingKey: "workerStreaming" | "followUpStreaming",
  onPhaseChange: (s: ResearchState) => void,
  abort: AbortController,
  activeQueryIds: Set<string>,
  mcpConfig: string | null,
  priorFindings?: Map<string, string>,
): Promise<ResearchWorkerResult[]> {
  const limit = createLimiter(RESEARCH_CONCURRENCY_LIMIT);

  // Stagger worker starts to prevent API rate limiting (especially Gemini Pro: 5 RPM)
  // Each worker gets a launch index; delay = index * STAGGER_MS before starting CLI
  const STAGGER_MS = 800;
  let launchIndex = 0;

  const workerPromises = questions.map((question) => {
    // Use planner-assigned model, fallback to user's selected model, then apply failover
    const preferredModel = question.model || fallbackModel;
    const workerModel = getAvailableModel(preferredModel);
    if (workerModel !== preferredModel) {
      console.log(`[Researcher] Worker ${question.id}: ${preferredModel} → ${workerModel} (failover)`);
    }
    const workerEngine = getEngine(workerModel);
    const myLaunchIdx = launchIndex++;

    return limit(async () => {
      // Stagger: wait before spawning to spread API requests over time
      if (myLaunchIdx > 0) {
        await new Promise((r) => setTimeout(r, myLaunchIdx * STAGGER_MS));
      }
      if (abort.signal.aborted) throw new Error("Cancelled");

      state[activeKey].add(question.id);
      emitResearchState(state, onPhaseChange);

      console.log(`[Researcher] Worker ${question.id} starting (${workerModel}, ${question.priority}, stagger=${myLaunchIdx * STAGGER_MS}ms)`);

      const workerMessage = buildResearchWorkerMessage(question, priorFindings);

      return executeOneShot(
        {
          message: workerMessage,
          model: workerModel,
          engine: workerEngine,
          systemPrompt: RESEARCH_WORKER_PROMPT,
          mcpConfig,
          timeoutMs: RESEARCH_WORKER_TIMEOUT_MS,
          permissionMode: "bypassPermissions",
          onStreaming: (text) => {
            state[streamingKey].set(question.id, text);
            emitResearchState(state, onPhaseChange);
          },
        },
        abort.signal,
        activeQueryIds,
      ).then((result): ResearchWorkerResult => {
        const workerResult = classifyResearchWorkerResult(
          result, question.id, abort.signal.aborted, workerModel,
        );

        // Log with appropriate level per status
        if (workerResult.status === "success") {
          console.log(`[Researcher] Worker ${question.id} OK (${workerModel}/${workerEngine}, ${workerResult.content.length} chars, ${workerResult.duration || "?"}ms)`);
        } else if (workerResult.status === "partial") {
          console.warn(`[Researcher] Worker ${question.id} PARTIAL (${workerModel}/${workerEngine}, ${workerResult.content.length} chars before timeout)`);
        } else {
          console.error(`[Researcher] Worker ${question.id} FAIL (${workerModel}/${workerEngine}): ${workerResult.error?.slice(0, 300)}`);
        }

        state[resultsKey].set(question.id, workerResult);
        state[activeKey].delete(question.id);
        state[streamingKey].delete(question.id);
        state.totalCost += workerResult.cost || 0;

        // Extract sources from workers with usable content (success + partial)
        if (hasUsableContent(workerResult)) {
          const newSources = extractSources(workerResult.content);
          for (const src of newSources) {
            if (!state.sources.includes(src)) state.sources.push(src);
          }
        }

        emitResearchState(state, onPhaseChange);

        return workerResult;
      });
    });
  });

  const settled = await Promise.allSettled(workerPromises);

  const results = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      questionId: questions[i].id,
      status: "error" as const,
      content: "",
      error: `Promise rejected: ${String(r.reason)}`,
    };
  });

  // Summary log for this batch
  const ok = results.filter(r => r.status === "success").length;
  const part = results.filter(r => r.status === "partial").length;
  const fail = results.filter(r => r.status === "error").length;
  console.log(`[Researcher] Worker batch done: ${ok} success, ${part} partial, ${fail} failed out of ${results.length} total`);

  return results;
}
