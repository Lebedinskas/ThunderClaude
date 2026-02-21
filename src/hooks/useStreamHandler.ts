import { useCallback, useEffect, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { TAURI_EVENTS } from "../lib/constants";
import {
  ChatMessage,
  ToolCallInfo,
  parseClaudeMessage,
  parseGeminiMessage,
} from "../lib/claude-protocol";
import { upsertStreaming } from "../lib/messages";
import { isRateLimitError, reportRateLimit, reportSuccess } from "../lib/failover";
import { detectLoop } from "../lib/loop-detection";

// ── Stream handler hook ─────────────────────────────────────────────────────
// Owns streaming buffers (text, tool calls) and Tauri event subscriptions.
// Delegates session/error/loading state to the parent hook via refs + setters.

interface UseStreamHandlerDeps {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionIdsRef: React.MutableRefObject<Record<string, string | null>>;
  setSessionId: (id: string | null) => void;
  setError: (err: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  activeQueryRef: React.MutableRefObject<string | null>;
  activeEngineRef: React.MutableRefObject<"claude" | "gemini">;
  /** Current model ID — used for failover rate limit reporting. */
  activeModelRef: React.MutableRefObject<string>;
  /** Called when a repetitive tool call pattern is detected during streaming. */
  onLoopDetected?: (pattern: string) => void;
}

export function useStreamHandler({
  setMessages,
  sessionIdsRef,
  setSessionId,
  setError,
  setIsLoading,
  activeQueryRef,
  activeEngineRef,
  activeModelRef,
  onLoopDetected,
}: UseStreamHandlerDeps) {
  const streamingTextRef = useRef("");
  const toolCallsRef = useRef<Map<string, ToolCallInfo>>(new Map());
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  /** Block coalescing: debounced text flush to reduce re-renders during streaming. */
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFlushRef = useRef(false);

  /** Schedule a debounced flush of accumulated text. Coalesces rapid token chunks into blocks. */
  const scheduleFlush = useCallback(() => {
    if (pendingFlushRef.current) return; // already scheduled
    pendingFlushRef.current = true;
    flushTimerRef.current = setTimeout(() => {
      pendingFlushRef.current = false;
      const tc = Array.from(toolCallsRef.current.values());
      upsertStreaming(setMessages, {
        content: streamingTextRef.current,
        toolCalls: tc.length > 0 ? [...tc] : undefined,
      });
    }, 50); // 50ms coalescing window — ~20fps, smooth enough for reading
  }, [setMessages]);

  /** Immediately flush any pending text (used for tool calls and result events). */
  const flushNow = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingFlushRef.current = false;
    const tc = Array.from(toolCallsRef.current.values());
    upsertStreaming(setMessages, {
      content: streamingTextRef.current,
      toolCalls: tc.length > 0 ? [...tc] : undefined,
    });
  }, [setMessages]);

  // ── Claude event handler ─────────────────────────────────────────────────
  const handleClaudeEvent = useCallback((data: string) => {
    const msg = parseClaudeMessage(data);
    if (!msg) return;

    if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
      sessionIdsRef.current.claude = msg.session_id;
      setSessionId(msg.session_id);
    }

    if (msg.type === "assistant") {
      const text = msg.message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");

      const toolUses = msg.message.content.filter((b) => b.type === "tool_use");
      for (const tool of toolUses) {
        if (tool.type === "tool_use") {
          toolCallsRef.current.set(tool.id, {
            id: tool.id,
            name: tool.name,
            input: tool.input,
            isRunning: true,
          });
        }
      }

      const toolResults = msg.message.content.filter((b) => b.type === "tool_result");
      for (const tr of toolResults) {
        if (tr.type === "tool_result") {
          const existing = toolCallsRef.current.get(tr.tool_use_id);
          if (existing) {
            const resultText =
              typeof tr.content === "string"
                ? tr.content
                : tr.content.map((c) => c.text).join("");
            toolCallsRef.current.set(tr.tool_use_id, {
              ...existing,
              result: resultText,
              isRunning: false,
            });
          }
        }
      }

      // Check for repetitive tool call patterns
      if (toolResults.length > 0) {
        const loop = detectLoop(Array.from(toolCallsRef.current.values()));
        if (loop) onLoopDetected?.(loop.pattern);
      }

      if (text) {
        streamingTextRef.current += text;
      }

      // Tool events flush immediately (UX: show tool activity right away)
      // Text-only events use coalesced flushing (reduces re-renders)
      if (toolUses.length > 0 || toolResults.length > 0) {
        flushNow();
      } else if (text) {
        scheduleFlush();
      }
    }

    if (msg.type === "result") {
      // Cancel any pending coalesced flush before final result
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingFlushRef.current = false;

      const ftc = Array.from(toolCallsRef.current.values()).map((tc) => ({
        ...tc,
        isRunning: false,
      }));

      upsertStreaming(setMessages, {
        content: msg.result || undefined,
        toolCalls: ftc.length > 0 ? ftc : undefined,
        isStreaming: false,
        cost: msg.total_cost_usd,
        duration: msg.duration_ms,
        numTurns: msg.num_turns,
      }, !!msg.result);
      if (msg.session_id) {
        sessionIdsRef.current.claude = msg.session_id;
        setSessionId(msg.session_id);
      }
    }
  }, [setMessages, sessionIdsRef, setSessionId, scheduleFlush, flushNow, onLoopDetected]);

  // ── Gemini event handler ─────────────────────────────────────────────────
  const handleGeminiEvent = useCallback((data: string) => {
    const msg = parseGeminiMessage(data);
    if (!msg) return;

    if (msg.type === "init") {
      sessionIdsRef.current.gemini = msg.session_id;
      setSessionId(msg.session_id);
    }

    if (msg.type === "message" && msg.role === "assistant" && msg.delta) {
      streamingTextRef.current += msg.content;
      scheduleFlush();
    }

    if (msg.type === "tool_use") {
      toolCallsRef.current.set(msg.tool_id, {
        id: msg.tool_id,
        name: msg.tool_name,
        input: msg.parameters,
        isRunning: true,
      });
      flushNow();
    }

    if (msg.type === "tool_result") {
      const existing = toolCallsRef.current.get(msg.tool_id);
      if (existing) {
        const resultText = msg.error?.message || msg.output || "";
        toolCallsRef.current.set(msg.tool_id, {
          ...existing,
          result: resultText,
          isRunning: false,
        });
        flushNow();

        // Check for repetitive tool call patterns
        const loop = detectLoop(Array.from(toolCallsRef.current.values()));
        if (loop) onLoopDetected?.(loop.pattern);
      }
    }

    if (msg.type === "result") {
      // Cancel any pending coalesced flush before final result
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingFlushRef.current = false;

      const ftc = Array.from(toolCallsRef.current.values()).map((tc) => ({
        ...tc,
        isRunning: false,
      }));

      upsertStreaming(setMessages, {
        toolCalls: ftc.length > 0 ? ftc : undefined,
        isStreaming: false,
        duration: msg.stats.duration_ms,
        tokens: {
          input: msg.stats.input_tokens,
          output: msg.stats.output_tokens,
          total: msg.stats.total_tokens,
        },
      }, false);
    }
  }, [setMessages, sessionIdsRef, setSessionId, scheduleFlush, flushNow, onLoopDetected]);

  // ── Listen for events from Rust backend ──────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const unMsg = await listen<{ queryId: string; data: string; engine?: string }>(
        TAURI_EVENTS.MESSAGE,
        (event) => {
          if (!mounted) return;
          if (event.payload.queryId !== activeQueryRef.current) return;

          const engine = event.payload.engine || activeEngineRef.current;
          if (engine === "gemini") {
            handleGeminiEvent(event.payload.data);
          } else {
            handleClaudeEvent(event.payload.data);
          }
        }
      );

      const stderrBuffer = { current: "" };
      // Gemini CLI writes informational messages to stderr that aren't errors
      const GEMINI_STDERR_NOISE = [
        "YOLO mode is enabled",
        "Loaded cached credentials",
        "Hook registry initialized",
        "Assertion failed:",
      ];
      const unErr = await listen<{ queryId: string; data: string }>(
        TAURI_EVENTS.ERROR,
        (event) => {
          if (!mounted) return;
          if (event.payload.queryId !== activeQueryRef.current) return;
          const line = event.payload.data;
          console.warn("[stderr]", line);
          if (GEMINI_STDERR_NOISE.some((noise) => line.includes(noise))) return;
          stderrBuffer.current += line + "\n";
        }
      );

      const unDone = await listen<{
        queryId: string;
        exitCode: number;
        sessionId: string;
      }>(
        TAURI_EVENTS.DONE,
        (event) => {
          if (!mounted) return;
          if (event.payload.queryId !== activeQueryRef.current) return;
          const stderr = stderrBuffer.current.trim();
          const currentModel = activeModelRef.current;
          if (event.payload.exitCode !== 0 && stderr) {
            if (stderr.includes("Invalid session identifier") || stderr.includes("Error resuming session")) {
              sessionIdsRef.current[activeEngineRef.current] = null;
              setSessionId(null);
            } else if (isRateLimitError(stderr)) {
              reportRateLimit(currentModel, stderr.split("\n")[0]);
              setError(`${currentModel} rate-limited. Try again — failover will auto-switch to an available model.`);
            } else {
              setError(stderr);
            }
          } else if (event.payload.exitCode === 0) {
            // Successful completion — clear any cooldown for this model
            reportSuccess(currentModel);
          }
          stderrBuffer.current = "";
          setIsLoading(false);
          activeQueryRef.current = null;
          if (event.payload.sessionId) {
            sessionIdsRef.current[activeEngineRef.current] = event.payload.sessionId;
            setSessionId(event.payload.sessionId);
          }
        }
      );

      unlistenRefs.current = [unMsg, unErr, unDone];
    };

    setup();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((fn) => fn());
    };
  }, [handleClaudeEvent, handleGeminiEvent, activeQueryRef, activeEngineRef, activeModelRef, sessionIdsRef, setSessionId, setError, setIsLoading]);

  /** Reset streaming buffers — call before starting a new direct query or clearing chat. */
  const resetStreaming = useCallback(() => {
    streamingTextRef.current = "";
    toolCallsRef.current = new Map();
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingFlushRef.current = false;
  }, []);

  return { resetStreaming };
}
