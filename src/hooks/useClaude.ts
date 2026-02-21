import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../lib/claude-protocol";
import { upsertStreaming } from "../lib/messages";
import { STORAGE_KEYS, TAURI_COMMANDS } from "../lib/constants";
import type { AIModel, OrchestrationMode, PermissionMode } from "../lib/models";
import type { CommanderState } from "../lib/commander";
import type { ResearchState, ResearchDepth } from "../lib/researcher";
import { getAvailableModelWithEngine } from "../lib/failover";
import { compactSession, softTrimMessages } from "../lib/memory";
import { detectMode, type ConcreteMode } from "../lib/mode-triggers";
import { useCommander } from "./useCommander";
import { useResearcher } from "./useResearcher";
import { useStreamHandler } from "./useStreamHandler";
import { trackCost } from "../lib/cost-tracker";
import {
  type ActiveBranchMap,
  type ChildrenMap,
  buildChildrenMap,
  getActivePath,
  deserializeActiveBranches,
} from "../lib/branching";

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useClaude(
  systemPrompt: string | null = null,
  mcpConfigPath: string | null = null,
  searchRelevantContext?: (query: string) => Promise<string | null>,
  projectContext: import("../lib/project-context").ProjectContext | null = null,
) {
  // ── Tree-based message state (conversation branching) ─────────────────────
  // allMessages: the full message tree (all branches).
  // messages: the visible path through the tree (computed from active branches).
  // setMessages: adapter that translates flat-array mutations into tree ops.
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [activeBranches, setActiveBranches] = useState<ActiveBranchMap>(new Map());
  const activeBranchesRef = useRef<ActiveBranchMap>(new Map());
  activeBranchesRef.current = activeBranches;

  const childrenMap: ChildrenMap = useMemo(
    () => buildChildrenMap(allMessages),
    [allMessages],
  );
  const messages: ChatMessage[] = useMemo(
    () => getActivePath(allMessages, childrenMap, activeBranches),
    [allMessages, childrenMap, activeBranches],
  );

  /** Branch point: when set, the next sendMessage creates a new branch from this message. */
  const branchPointRef = useRef<string | null>(null);
  const [branchPointId, setBranchPointId] = useState<string | null>(null);

  /**
   * setMessages adapter — translates flat-array mutations (from upsertStreaming,
   * addPipelineError, etc.) into tree-aware operations on allMessages.
   * Handles three cases: streaming update, append, or full replacement.
   */
  const setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>> = useCallback(
    (action) => {
      setAllMessages((prevAll) => {
        const cmap = buildChildrenMap(prevAll);
        const prevVisible = getActivePath(prevAll, cmap, activeBranchesRef.current);
        const nextVisible =
          typeof action === "function" ? action(prevVisible) : action;

        // No change
        if (nextVisible === prevVisible) return prevAll;

        // Full clear (newChat)
        if (nextVisible.length === 0) return [];

        // Streaming update: same length, last msg has same ID but different object
        if (nextVisible.length === prevVisible.length && nextVisible.length > 0) {
          const lastNew = nextVisible[nextVisible.length - 1];
          const lastOld = prevVisible[prevVisible.length - 1];
          if (lastNew.id === lastOld.id && lastNew !== lastOld) {
            const idx = prevAll.findIndex((m) => m.id === lastNew.id);
            if (idx >= 0) {
              // Preserve parentId from tree if the update didn't set one
              const updated = lastNew.parentId
                ? lastNew
                : { ...lastNew, parentId: prevAll[idx].parentId };
              return [...prevAll.slice(0, idx), updated, ...prevAll.slice(idx + 1)];
            }
          }
        }

        // Append: nextVisible starts with prevVisible prefix
        if (nextVisible.length > prevVisible.length) {
          let isAppend = true;
          for (let i = 0; i < prevVisible.length; i++) {
            if (nextVisible[i] !== prevVisible[i] && nextVisible[i].id !== prevVisible[i].id) {
              isAppend = false;
              break;
            }
          }
          if (isAppend) {
            const newMsgs: ChatMessage[] = [];
            for (let i = prevVisible.length; i < nextVisible.length; i++) {
              const msg = nextVisible[i];
              if (msg.parentId) {
                newMsgs.push(msg);
              } else {
                const prevMsg =
                  newMsgs.length > 0
                    ? newMsgs[newMsgs.length - 1]
                    : prevVisible[prevVisible.length - 1];
                newMsgs.push({ ...msg, parentId: prevMsg?.id });
              }
            }
            return [...prevAll, ...newMsgs];
          }
        }

        // Fallback: full replacement (compact, loadSession via setMessages)
        const result: ChatMessage[] = [];
        for (let i = 0; i < nextVisible.length; i++) {
          const msg = nextVisible[i];
          if (msg.parentId || i === 0) {
            result.push(msg);
          } else {
            result.push({ ...msg, parentId: result[i - 1].id });
          }
        }
        return result;
      });
    },
    [],
  );

  // ── Standard state ────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Separate session IDs per engine — switching models resumes the correct session
  const sessionIdsRef = useRef<Record<string, string | null>>({ claude: null, gemini: null });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState<AIModel>(() => {
    return (
      (localStorage.getItem(STORAGE_KEYS.MODEL) as AIModel) ||
      "claude-sonnet-4-6"
    );
  });

  // Orchestration mode: "direct" (single model) or "commander" (Opus orchestrates workers)
  const [orchestrationMode, setOrchestrationMode] = useState<OrchestrationMode>(() => {
    return (localStorage.getItem(STORAGE_KEYS.ORCHESTRATION) as OrchestrationMode) || "direct";
  });
  const [researchDepth, setResearchDepth] = useState<ResearchDepth>(() => {
    return (localStorage.getItem(STORAGE_KEYS.RESEARCH_DEPTH) as ResearchDepth) || "deep";
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    return (localStorage.getItem(STORAGE_KEYS.PERMISSION_MODE) as PermissionMode) || "default";
  });
  const [commanderState, setCommanderState] = useState<CommanderState | null>(null);
  const [researcherState, setResearcherState] = useState<ResearchState | null>(null);

  const systemPromptRef = useRef(systemPrompt);
  systemPromptRef.current = systemPrompt;

  const mcpConfigPathRef = useRef(mcpConfigPath);
  mcpConfigPathRef.current = mcpConfigPath;

  const searchContextRef = useRef(searchRelevantContext);
  searchContextRef.current = searchRelevantContext;

  const activeQueryRef = useRef<string | null>(null);
  const activeEngineRef = useRef<"claude" | "gemini">("claude");
  const activeModelRef = useRef<string>(model);
  /** Set after /compact — tells sendDirect to inject compacted context on next send. */
  const compactedRef = useRef(false);
  const orchestrationModeRef = useRef(orchestrationMode);
  orchestrationModeRef.current = orchestrationMode;
  /** Tracks the resolved mode for the current request (for cancel + cost tracking). */
  const effectiveModeRef = useRef<ConcreteMode>("direct");

  /** Stable ref to sendMessage — used by auto-drain to avoid stale closures. */
  const sendMessageRef = useRef<(text: string, images?: { name: string; dataUrl: string }[]) => void>(() => {});

  /** Message queue: holds messages typed while AI is working. Auto-sent on completion. */
  const messageQueueRef = useRef<{ text: string; images?: { name: string; dataUrl: string }[] }[]>([]);
  const [queueLength, setQueueLength] = useState(0);
  /** Drain generation counter — incremented on cancel/newChat/loadSession to invalidate pending setTimeout. */
  const drainGenRef = useRef(0);

  // Persist model selection
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MODEL, model);
  }, [model]);

  // Persist orchestration mode
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ORCHESTRATION, orchestrationMode);
  }, [orchestrationMode]);

  // Persist research depth
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RESEARCH_DEPTH, researchDepth);
  }, [researchDepth]);

  // Persist permission mode
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PERMISSION_MODE, permissionMode);
  }, [permissionMode]);

  // Loop detection — auto-cancel when repetitive tool call patterns are detected
  const handleLoopDetected = useCallback((pattern: string) => {
    if (activeQueryRef.current) {
      invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId: activeQueryRef.current }).catch(() => {});
      activeQueryRef.current = null;
    }
    setIsLoading(false);
    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(),
      role: "system" as const,
      content: `Loop detected: ${pattern}. Auto-cancelled to save tokens. Try a different approach.`,
      timestamp: Date.now(),
    }]);
  }, [setMessages, setIsLoading]);

  // Stream handler — owns event listeners, streaming buffers, and protocol parsing
  const { resetStreaming } = useStreamHandler({
    setMessages,
    sessionIdsRef,
    setSessionId,
    setError,
    setIsLoading,
    activeQueryRef,
    activeEngineRef,
    activeModelRef,
    onLoopDetected: handleLoopDetected,
  });

  // Commander hook
  const { executeCommander, cancelCommander, wasCancelled } = useCommander({
    systemPrompt,
    mcpConfigPath,
    projectContext,
  });

  // Researcher hook
  const { executeResearch, cancelResearch, wasCancelled: researchWasCancelled } = useResearcher({
    systemPrompt,
    mcpConfigPath,
  });

  // Check if Claude CLI is available on mount
  useEffect(() => {
    invoke<string>(TAURI_COMMANDS.CHECK_CLAUDE)
      .then((bin) => {
        console.log("Claude CLI found:", bin);
        setIsConnected(true);
      })
      .catch((e) => {
        setError(String(e));
        setIsConnected(false);
      });
  }, []);

  // ── Direct mode: send to a single model ─────────────────────────────────
  /** Track the last failover switch to display to user (null = using preferred model) */
  const [failoverInfo, setFailoverInfo] = useState<string | null>(null);

  const sendDirect = useCallback(
    async (text: string, currentMessages: ChatMessage[]) => {
      resetStreaming();

      // Check failover registry — use alternative if preferred model is rate-limited
      const { model: effectiveModel, engine, wasFailover } = getAvailableModelWithEngine(model);
      if (wasFailover) {
        console.log(`[Failover] ${model} rate-limited → using ${effectiveModel}`);
        setFailoverInfo(`Using ${effectiveModel} (${model} rate-limited)`);
      } else {
        setFailoverInfo(null);
      }

      const prevEngine = activeEngineRef.current;
      const switchingEngines = prevEngine !== engine;

      const engineSessionId = sessionIdsRef.current[engine];
      // Can't resume if failover switched models mid-session (different model = different session)
      const canResume = !!engineSessionId && !switchingEngines && !wasFailover;

      // Inject conversation context when no CLI session to resume
      // (engine switch or post-compaction — the LLM needs prior context)
      let messageToSend = text;
      const needsContextInjection = (switchingEngines || compactedRef.current) && currentMessages.length > 0;
      if (needsContextInjection) {
        const transcript = currentMessages
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
          .slice(-20)
          .map((m) => {
            if (m.role === "system") return `[Summary]\n${m.content}`;
            const prefix = m.role === "user" ? "User" : "Assistant";
            const content = m.content.length > 800
              ? m.content.slice(0, 800) + "... [truncated]"
              : m.content;
            return `${prefix}: ${content}`;
          })
          .join("\n");
        const label = switchingEngines
          ? `Previous conversation with ${prevEngine === "gemini" ? "Gemini" : "Claude"}`
          : "Conversation context (compacted)";
        messageToSend = `[${label}]\n${transcript}\n\n[Continue the conversation — you are now responding]\nUser: ${text}`;
        compactedRef.current = false;
      }

      activeEngineRef.current = engine;
      activeModelRef.current = effectiveModel;

      // Inject relevant vault context into system prompt (hybrid BM25 + vector search)
      let enhancedPrompt = systemPromptRef.current;
      if (searchContextRef.current) {
        try {
          const vaultContext = await searchContextRef.current(text);
          if (vaultContext) {
            const section = `## Relevant Vault Context\nThe following excerpts from your Obsidian vault are relevant to this query:\n\n${vaultContext}`;
            enhancedPrompt = enhancedPrompt
              ? enhancedPrompt + "\n\n" + section
              : section;
          }
        } catch {
          // Search failed — proceed without vault context
        }
      }

      try {
        const queryId = await invoke<string>(TAURI_COMMANDS.SEND_QUERY, {
          config: {
            message: messageToSend,
            model: effectiveModel,
            engine,
            mcp_config: mcpConfigPathRef.current,
            system_prompt: enhancedPrompt,
            session_id: canResume ? engineSessionId : null,
            resume: canResume,
            permission_mode: permissionMode === "default" ? null : permissionMode,
          },
        });
        activeQueryRef.current = queryId;
      } catch (e) {
        setError(String(e));
        setIsLoading(false);
      }
    },
    [model, permissionMode, resetStreaming],
  );

  /** Add a persistent error message to chat for any orchestration pipeline failure */
  const addPipelineError = useCallback((label: string, reason: string, details?: string) => {
    const errorContent = details
      ? `**${label} failed:** ${reason}\n\n\`\`\`\n${details}\n\`\`\``
      : `**${label} failed:** ${reason}`;
    console.error(`[${label}] FAIL: ${reason}`, details || "");
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: errorContent,
        timestamp: Date.now(),
      },
    ]);
  }, [setMessages]);

  // ── Commander mode: Opus plans → review → workers execute → Opus synthesizes

  const sendCommander = useCallback(
    async (text: string, currentMessages: ChatMessage[]) => {
      setCommanderState(null);

      try {
        const result = await executeCommander(
          text,
          currentMessages,
          (state) => setCommanderState(state),
          (streamText, phase) => {
            if (phase === "synthesizing") {
              upsertStreaming(setMessages, { content: streamText });
            }
          },
        );

        if (result) {
          if (result.error) {
            setCommanderState(null);
            addPipelineError("Commander", result.error);
            setIsLoading(false);
            return true;
          }

          upsertStreaming(setMessages, {
            content: result.finalContent,
            isStreaming: false,
            cost: result.totalCost,
            duration: result.totalDuration,
          });
          trackCost({
            ts: new Date().toISOString(),
            cost: result.totalCost || 0,
            tokensIn: 0, tokensOut: 0,
            model: activeModelRef.current,
            mode: "commander",
            durationMs: result.totalDuration || 0,
          });
          setIsLoading(false);
          return true;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        setCommanderState(null);
        addPipelineError(
          "Commander",
          "Unexpected pipeline error",
          `${errMsg}${stack ? `\n\nStack:\n${stack}` : ""}`,
        );
        setIsLoading(false);
        return true;
      }

      if (wasCancelled.current) {
        setCommanderState(null);
        setIsLoading(false);
        return true;
      }

      setCommanderState(null);
      addPipelineError("Commander", "Pipeline returned no result — the CLI process may have crashed or been rate-limited. Try again in a moment.");
      setIsLoading(false);
      return true;
    },
    [executeCommander, wasCancelled, addPipelineError, setMessages],
  );

  // ── Researcher mode: multi-step deep research with MCP tools ────────────

  const sendResearch = useCallback(
    async (text: string, currentMessages: ChatMessage[]) => {
      setResearcherState(null);

      try {
        const result = await executeResearch(
          text,
          currentMessages,
          model,
          researchDepth,
          (state) => setResearcherState(state),
          (streamText, phase) => {
            if (phase === "synthesizing") {
              upsertStreaming(setMessages, { content: streamText });
            }
          },
        );

        if (result) {
          if (result.error) {
            console.error("[Researcher] Pipeline returned error:", result.error);
            setResearcherState(null);
            addPipelineError("Research", result.error);
            setIsLoading(false);
            return true;
          }

          upsertStreaming(setMessages, {
            content: result.finalContent,
            isStreaming: false,
            cost: result.totalCost,
            duration: result.totalDuration,
          });
          trackCost({
            ts: new Date().toISOString(),
            cost: result.totalCost || 0,
            tokensIn: 0, tokensOut: 0,
            model: activeModelRef.current,
            mode: "researcher",
            durationMs: result.totalDuration || 0,
          });
          setIsLoading(false);
          return true;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        console.error("[Researcher] Pipeline exception:", errMsg, errStack);
        setResearcherState(null);
        addPipelineError("Research", "Unexpected pipeline crash", errMsg);
        setIsLoading(false);
        return true;
      }

      if (researchWasCancelled.current) {
        setResearcherState(null);
        setIsLoading(false);
        return true;
      }

      console.error("[Researcher] Research returned null (no result, no error, not cancelled)");
      setResearcherState(null);
      addPipelineError(
        "Research",
        "Research returned no result — likely all workers timed out or the planning phase failed silently.",
        `Model: ${model}, Depth: ${researchDepth}`,
      );
      setIsLoading(false);
      return true;
    },
    [executeResearch, researchWasCancelled, model, researchDepth, addPipelineError, setMessages],
  );

  // ── Main send entry point ──────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, images?: { name: string; dataUrl: string }[]) => {
      if (!text.trim()) return;

      // Queue the message if AI is busy — it'll be auto-sent on completion
      if (isLoading) {
        messageQueueRef.current.push({ text, images });
        setQueueLength(messageQueueRef.current.length);
        return;
      }

      // Clear previous orchestration walkthroughs
      setCommanderState(null);
      setResearcherState(null);

      // Determine parent for the new message (branching or normal)
      const parentId = branchPointRef.current || messages[messages.length - 1]?.id;
      const isBranching = !!branchPointRef.current;
      branchPointRef.current = null;
      setBranchPointId(null);

      // Add user message directly to tree (with explicit parentId)
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
        parentId,
        images,
      };
      setAllMessages((prev) => [...prev, userMsg]);

      // If branching, switch active branch to the new child
      if (isBranching && parentId) {
        setActiveBranches((prev) => {
          const next = new Map(prev);
          // Set to MAX_SAFE_INTEGER — getActivePath clamps to last child (the new one)
          next.set(parentId, Number.MAX_SAFE_INTEGER);
          return next;
        });
      }

      setIsLoading(true);
      setError(null);

      // Resolve auto mode to a concrete mode per-message
      const effectiveMode: ConcreteMode = orchestrationMode === "auto"
        ? detectMode(text)
        : orchestrationMode;
      effectiveModeRef.current = effectiveMode;

      if (effectiveMode === "commander") {
        if (orchestrationMode === "auto") console.log("[Auto] Routed to Commander");
        const success = await sendCommander(text, messages);
        if (success) return;
        console.log("[Commander] Falling back to direct mode");
      }

      if (effectiveMode === "researcher") {
        if (orchestrationMode === "auto") console.log("[Auto] Routed to Researcher");
        const success = await sendResearch(text, messages);
        if (success) return;
        console.log("[Researcher] Falling back to direct mode");
      }

      // Direct mode (or fallback)
      if (orchestrationMode === "auto" && effectiveMode === "direct") {
        console.log("[Auto] Routed to Direct");
      }
      await sendDirect(text, messages);
    },
    [messages, isLoading, orchestrationMode, sendDirect, sendCommander, sendResearch],
  );
  sendMessageRef.current = sendMessage;

  // ── Steer: cancel current + send immediately (mid-response redirection) ──
  const steerMessage = useCallback(
    async (text: string, images?: { name: string; dataUrl: string }[]) => {
      if (!text.trim()) return;

      // Cancel any in-progress work
      const mode = orchestrationMode === "auto" ? effectiveModeRef.current : orchestrationMode;
      if (mode === "commander") {
        cancelCommander();
        setCommanderState(null);
      } else if (mode === "researcher") {
        cancelResearch();
        setResearcherState(null);
      } else if (activeQueryRef.current) {
        invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId: activeQueryRef.current }).catch(() => {});
        activeQueryRef.current = null;
        upsertStreaming(setMessages, { isStreaming: false }, false);
      }

      // Clear queue + invalidate pending drains
      messageQueueRef.current = [];
      setQueueLength(0);
      drainGenRef.current++;

      // Reset loading state so sendMessage doesn't queue
      setIsLoading(false);

      // Small delay for React state to flush, then send
      await new Promise((r) => setTimeout(r, 0));
      sendMessageRef.current(text, images);
    },
    [orchestrationMode, cancelCommander, cancelResearch, setMessages],
  );

  // ── Cancel active query (any mode) ─────────────────────────────────────
  const cancelQuery = useCallback(() => {
    // Clear message queue and invalidate any pending drain timeout
    messageQueueRef.current = [];
    setQueueLength(0);
    drainGenRef.current++;
    // For auto mode, use the resolved effective mode to determine what to cancel
    const mode = orchestrationMode === "auto" ? effectiveModeRef.current : orchestrationMode;
    if (mode === "commander") {
      cancelCommander();
      setCommanderState(null);
      setIsLoading(false);
    } else if (mode === "researcher") {
      cancelResearch();
      setResearcherState(null);
      setIsLoading(false);
    } else if (activeQueryRef.current) {
      invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId: activeQueryRef.current }).catch(() => {});
      activeQueryRef.current = null;
      setIsLoading(false);
      upsertStreaming(setMessages, { isStreaming: false }, false);
    }
  }, [orchestrationMode, cancelCommander, cancelResearch, setMessages]);

  const newChat = useCallback(() => {
    messageQueueRef.current = [];
    setQueueLength(0);
    drainGenRef.current++;
    setAllMessages([]);
    setActiveBranches(new Map());
    setBranchPointId(null);
    branchPointRef.current = null;
    setSessionId(null);
    sessionIdsRef.current = { claude: null, gemini: null };
    setError(null);
    setIsLoading(false);
    resetStreaming();
    activeQueryRef.current = null;
  }, [resetStreaming]);

  const loadSession = useCallback(
    (savedMessages: ChatMessage[], savedSessionId: string | null, savedBranches?: Record<string, number>) => {
      // Invalidate any pending queue drain from previous session
      messageQueueRef.current = [];
      setQueueLength(0);
      drainGenRef.current++;
      setAllMessages(savedMessages);
      setActiveBranches(deserializeActiveBranches(savedBranches));
      setBranchPointId(null);
      branchPointRef.current = null;
      setSessionId(savedSessionId);
      setError(null);
      setIsLoading(false);
      resetStreaming();
      activeQueryRef.current = null;
    },
    [resetStreaming],
  );

  // ── Load past research — inject saved content directly, no API call ────────
  const loadResearch = useCallback((query: string, content: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      timestamp: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
  }, [setMessages]);

  // ── Inject a system message (used by /context, etc.) ──────────────────────
  const injectSystemMessage = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "system",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
  }, [setMessages]);

  // ── /trim — strip old tool results to free context ────────────────────────
  const trimMessages = useCallback(() => {
    const { messages: trimmed, trimmedCount, charsSaved } = softTrimMessages(messages);
    if (trimmedCount === 0) {
      injectSystemMessage("No tool results to trim — all messages are recent or have no large tool outputs.");
      return;
    }
    setMessages(trimmed);
    injectSystemMessage(
      `**Soft-trimmed** ${trimmedCount} tool result${trimmedCount === 1 ? "" : "s"}, freeing ~${Math.round(charsSaved / 4).toLocaleString()} tokens.`
    );
  }, [messages, setMessages, injectSystemMessage]);

  // ── /compact — summarize older messages, keep recent ──────────────────────
  const compactMessages = useCallback(async () => {
    if (isLoading) return;
    if (messages.length < 10) {
      setError("Not enough messages to compact (need at least 10).");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await compactSession(messages);
      if (!result) {
        setError("Compaction failed — could not summarize the conversation.");
        setIsLoading(false);
        return;
      }

      const summaryMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "system",
        content: result.summary,
        timestamp: Date.now(),
      };

      // Full replacement: clears tree, rebuilds as linear chain
      setAllMessages([summaryMessage, ...result.keptMessages].map((msg, i, arr) => {
        if (i === 0 || msg.parentId) return msg;
        return { ...msg, parentId: arr[i - 1].id };
      }));
      setActiveBranches(new Map());

      // Clear CLI sessions — next send injects compacted context
      sessionIdsRef.current = { claude: null, gemini: null };
      setSessionId(null);
      compactedRef.current = true;
      resetStreaming();
      activeQueryRef.current = null;
    } catch (err) {
      setError(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setIsLoading(false);
  }, [messages, isLoading, resetStreaming]);

  // ── Branching actions ─────────────────────────────────────────────────────

  /** Start a branch from a specific message. The next sendMessage creates a new branch. */
  const branchFrom = useCallback((messageId: string) => {
    branchPointRef.current = messageId;
    setBranchPointId(messageId);
  }, []);

  /** Cancel an in-progress branch (user changed their mind). */
  const cancelBranch = useCallback(() => {
    branchPointRef.current = null;
    setBranchPointId(null);
  }, []);

  /** Switch to a different branch at a given parent message. */
  const switchBranch = useCallback((parentId: string, newIndex: number) => {
    setActiveBranches((prev) => {
      const next = new Map(prev);
      next.set(parentId, newIndex);
      return next;
    });
  }, []);

  /**
   * Edit a user message — creates a new branch from the edited message's parent
   * with the new text. The original message is preserved and navigable via branch selector.
   */
  const editMessage = useCallback(
    (messageId: string, newText: string) => {
      const msg = allMessages.find((m) => m.id === messageId);
      if (!msg || msg.role !== "user" || !newText.trim() || isLoading) return;
      // Branch from the parent of this message (creates a sibling)
      branchPointRef.current = msg.parentId || null;
      setBranchPointId(null); // Don't show branch point UI — send immediately
      // sendMessage will pick up branchPointRef and create a new branch
      sendMessage(newText, msg.images);
    },
    [allMessages, isLoading, sendMessage],
  );

  /**
   * Regenerate an assistant response — re-sends the preceding user message,
   * creating a new branch so the original response is preserved.
   */
  const regenerate = useCallback(
    (assistantMessageId: string) => {
      if (isLoading) return;
      const assistantMsg = allMessages.find((m) => m.id === assistantMessageId);
      if (!assistantMsg || assistantMsg.role !== "assistant") return;
      // Find the user message that preceded this assistant message
      const userMsg = allMessages.find((m) => m.id === assistantMsg.parentId);
      if (!userMsg || userMsg.role !== "user") return;
      // Branch from the user message's parent (creates a sibling user→assistant pair)
      branchPointRef.current = userMsg.parentId || null;
      setBranchPointId(null);
      sendMessage(userMsg.content, userMsg.images);
    },
    [allMessages, isLoading, sendMessage],
  );

  // ── Track direct mode completions ─────────────────────────────────────────
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const last = messages[messages.length - 1];
      const trackMode = orchestrationModeRef.current === "auto"
        ? effectiveModeRef.current
        : orchestrationModeRef.current;
      if (last.role === "assistant" && !last.isStreaming && trackMode === "direct") {
        trackCost({
          ts: new Date().toISOString(),
          cost: last.cost || 0,
          tokensIn: last.tokens?.input || 0,
          tokensOut: last.tokens?.output || 0,
          model: activeModelRef.current,
          mode: "direct",
          durationMs: last.duration || 0,
        });
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // ── Auto-drain message queue when response completes ─────────────────────
  // Collect mode: batches ALL queued messages into a single combined prompt,
  // reducing round-trips and giving the AI full context at once.
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    // Detect loading → not-loading transition (response completed)
    if (wasLoadingRef.current && !isLoading && messageQueueRef.current.length > 0) {
      const queued = messageQueueRef.current.splice(0);
      setQueueLength(0);
      const combinedText = queued.map((q) => q.text).join("\n\n");
      const combinedImages = queued.flatMap((q) => q.images || []);
      // Guard: capture drain generation so cancel/switch/newChat can invalidate
      const gen = drainGenRef.current;
      setTimeout(() => {
        if (drainGenRef.current === gen) {
          sendMessageRef.current(
            combinedText,
            combinedImages.length > 0 ? combinedImages : undefined,
          );
        }
      }, 50);
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]); // Only re-run on isLoading transitions, not every streaming update

  return {
    messages,
    allMessages,
    isConnected,
    isLoading,
    error,
    sessionId,
    model,
    setModel,
    sendMessage,
    steerMessage,
    cancelQuery,
    newChat,
    loadSession,
    compactMessages,
    trimMessages,
    injectSystemMessage,
    loadResearch,
    orchestrationMode,
    setOrchestrationMode,
    commanderState,
    researcherState,
    researchDepth,
    setResearchDepth,
    permissionMode,
    setPermissionMode,
    /** Non-null when failover is active: "Using X (Y rate-limited)" */
    failoverInfo,
    /** Number of queued messages waiting to be sent after current response. */
    queueLength,
    // Branching
    childrenMap,
    activeBranches,
    branchPointId,
    branchFrom,
    cancelBranch,
    switchBranch,
    editMessage,
    regenerate,
  };
}
