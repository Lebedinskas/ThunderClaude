import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { parseClaudeMessage, parseGeminiMessage } from "./claude-protocol";
import { TAURI_EVENTS, TAURI_COMMANDS } from "./constants";
import type { AIModel } from "./models";
import { isRateLimitError, reportRateLimit, reportSuccess } from "./failover";

// ── One-shot query helper ───────────────────────────────────────────────────

export interface OneShotConfig {
  message: string;
  model: AIModel;
  engine: "claude" | "gemini";
  systemPrompt: string | null;
  mcpConfig: string | null;
  timeoutMs: number;
  /** Limit agentic turns. 1 = single response, no tool loops. */
  maxTurns?: number;
  /**
   * Control built-in tool availability (Claude only).
   * undefined = default (all tools), "" = disable all tools.
   */
  tools?: string;
  /** When true, ignore user's default MCP config — pure reasoning mode. */
  strictMcp?: boolean;
  /** Claude CLI --permission-mode. "bypassPermissions" = auto-approve all tools. */
  permissionMode?: string;
  /** Working directory for the CLI process — sets cwd so file operations use correct paths. */
  cwd?: string;
  onStreaming: (fullText: string) => void;
}

export interface OneShotResult {
  content: string;
  cost?: number;
  tokens?: { input: number; output: number; total: number };
  duration?: number;
  /** stderr output from CLI — contains MCP errors, tool failures, etc. */
  stderr?: string;
  /** Structured outcome — switch on this instead of parsing stderr for status detection */
  outcome: "success" | "partial" | "error";
}

/**
 * Execute a single CLI query and collect the complete result.
 * Supports cancellation via AbortSignal and process tracking.
 *
 * Shared by Commander and Researcher orchestration modes.
 */
export async function executeOneShot(
  config: OneShotConfig,
  signal?: AbortSignal,
  activeQueryIds?: Set<string>,
): Promise<OneShotResult | null> {
  if (signal?.aborted) return null;

  // ── Phase 1: Start the CLI process ──────────────────────────────────────────
  let queryId: string;
  try {
    queryId = await invoke<string>(TAURI_COMMANDS.SEND_QUERY, {
      config: {
        message: config.message,
        model: config.model,
        engine: config.engine,
        mcp_config: config.mcpConfig,
        system_prompt: config.systemPrompt,
        session_id: null,
        resume: false,
        max_turns: config.maxTurns ?? null,
        tools: config.tools ?? null,
        strict_mcp: config.strictMcp ?? false,
        permission_mode: config.permissionMode ?? null,
        cwd: config.cwd ?? null,
      },
    });
  } catch (err) {
    console.error(`[executeOneShot] invoke failed for ${config.model}:`, err);
    return { content: "", stderr: `CLI spawn failed: ${String(err)}`, outcome: "error" };
  }

  activeQueryIds?.add(queryId);

  // Check if aborted while we were awaiting invoke
  if (signal?.aborted) {
    invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId }).catch(() => {});
    activeQueryIds?.delete(queryId);
    return null;
  }

  // ── Phase 2: Set up event listeners and wait for completion ─────────────────
  // Use a deferred pattern — async function handles setup, event callbacks resolve.
  let resolve: (value: OneShotResult | null) => void;
  const promise = new Promise<OneShotResult | null>((r) => { resolve = r; });

  let textBuffer = "";
  let stderrBuffer = "";
  let resultCost: number | undefined;
  let resultTokens: OneShotResult["tokens"];
  let resultDuration: number | undefined;
  let resolved = false;
  const listeners: UnlistenFn[] = [];

  const cleanup = () => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeoutId);
    activeQueryIds?.delete(queryId);
    listeners.forEach((fn) => fn());
  };

  // Kill the process and resolve null on abort
  const onAbort = () => {
    invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId }).catch(() => {});
    cleanup();
    resolve(null);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  // Timeout — kill process. Preserve partial content if the worker was streaming.
  const timeoutId = setTimeout(() => {
    invoke(TAURI_COMMANDS.CANCEL_QUERY, { queryId }).catch(() => {});
    cleanup();
    signal?.removeEventListener("abort", onAbort);

    const partialContent = textBuffer.trim();
    if (partialContent) {
      console.warn(`[OneShot ${config.model}] Timeout after ${config.timeoutMs}ms — preserving ${partialContent.length} chars of partial output`);
      resolve({
        content: partialContent,
        cost: resultCost,
        tokens: resultTokens,
        duration: config.timeoutMs,
        stderr: `Timeout after ${config.timeoutMs}ms (partial output: ${partialContent.length} chars)`,
        outcome: "partial",
      });
    } else {
      const stderr = stderrBuffer.trim() || undefined;
      console.warn(`[OneShot ${config.model}] Timeout after ${config.timeoutMs}ms — no output produced`, stderr ? `Stderr: ${stderr}` : "(no stderr)");
      resolve({ content: "", stderr: stderr ? `Timeout after ${config.timeoutMs}ms. CLI stderr: ${stderr}` : `Timeout after ${config.timeoutMs}ms — CLI produced no output`, outcome: "error" });
    }
  }, config.timeoutMs);

  // Register all listeners atomically to avoid missing events
  const [unMsg, unDone, unErr] = await Promise.all([
    // Streaming data
    listen<{ queryId: string; data: string; engine?: string }>(
      TAURI_EVENTS.MESSAGE,
      (event) => {
        if (event.payload.queryId !== queryId) return;

        const engine = event.payload.engine || config.engine;
        if (engine === "gemini") {
          const msg = parseGeminiMessage(event.payload.data);
          if (msg?.type === "message" && msg.role === "assistant" && msg.delta) {
            textBuffer += msg.content;
            config.onStreaming(textBuffer);
          }
          if (msg?.type === "result") {
            resultTokens = {
              input: msg.stats.input_tokens,
              output: msg.stats.output_tokens,
              total: msg.stats.total_tokens,
            };
            resultDuration = msg.stats.duration_ms;
          }
        } else {
          const msg = parseClaudeMessage(event.payload.data);
          if (msg?.type === "assistant") {
            const text = msg.message.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { text: string }).text)
              .join("");
            if (text) {
              textBuffer += text;
              config.onStreaming(textBuffer);
            }
          }
          if (msg?.type === "result") {
            if (msg.result) textBuffer = msg.result;
            resultCost = msg.total_cost_usd;
            resultDuration = msg.duration_ms;
          }
        }
      },
    ),

    // Completion
    listen<{ queryId: string; exitCode: number }>(
      TAURI_EVENTS.DONE,
      (event) => {
        if (event.payload.queryId !== queryId) return;
        cleanup();
        signal?.removeEventListener("abort", onAbort);
        const exitCode = event.payload.exitCode;
        const stderr = stderrBuffer.trim() || undefined;
        if (textBuffer.trim()) {
          resolve({
            content: textBuffer,
            cost: resultCost,
            tokens: resultTokens,
            duration: resultDuration,
            stderr,
            outcome: "success",
          });
        } else if (stderr) {
          resolve({ content: "", stderr, outcome: "error" });
        } else if (exitCode !== 0) {
          console.error(`[OneShot ${config.model}] Process exited with code ${exitCode} (no output, no stderr)`);
          resolve({ content: "", stderr: `CLI process exited with code ${exitCode} (likely rate limit or spawn failure)`, outcome: "error" });
        } else {
          console.warn(`[OneShot ${config.model}] Process exited cleanly (code 0) but produced no output`);
          resolve({ content: "", stderr: `CLI exited cleanly (code 0) but produced no output — possible silent initialization failure`, outcome: "error" });
        }
      },
    ),

    // Stderr capture
    listen<{ queryId: string; data: string }>(
      TAURI_EVENTS.ERROR,
      (event) => {
        if (event.payload.queryId !== queryId) return;
        stderrBuffer += event.payload.data + "\n";
        console.warn(`[OneShot ${config.model}]`, event.payload.data);
      },
    ),
  ]);

  listeners.push(unMsg, unDone, unErr);

  // Auto-report to failover registry — all callers benefit without code changes.
  return promise.then((result) => {
    if (result?.stderr && isRateLimitError(result.stderr)) {
      reportRateLimit(config.model, result.stderr.split("\n")[0]);
    } else if (result?.content) {
      reportSuccess(config.model);
    }
    return result;
  });
}
