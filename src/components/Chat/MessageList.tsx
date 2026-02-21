import { useState, useEffect, useRef, useCallback, useMemo, isValidElement, Children } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../../lib/claude-protocol";
import type { MCPServer } from "../../lib/mcp";
import { getBranchInfo, type ChildrenMap } from "../../lib/branching";
import { useChatState, useChatActions } from "../../contexts/ChatContext";
import { CommanderStatus } from "./CommanderStatus";
import { ResearchStatus } from "./ResearchStatus";
import { CodeBlock } from "./CodeBlock";
import { ToolCallList, AgenticStatusBar, ThinkingIndicator } from "./ToolCallCard";
import { InlineImage } from "./InlineImage";
import { extractTitle, saveResearchToVault } from "../../lib/memory";

interface MessageListProps {
  onInstallMCP?: (servers: MCPServer[]) => void;
  installedMCPNames?: string[];
}

// ── Branch Selector ──────────────────────────────────────────────────────────

function BranchSelector({
  message,
  childrenMap,
  onSwitch,
}: {
  message: ChatMessage;
  childrenMap: ChildrenMap;
  onSwitch: (parentId: string, newIndex: number) => void;
}) {
  const info = getBranchInfo(message, childrenMap);
  if (!info) return null;

  return (
    <div className="flex items-center gap-0.5 ml-9 -mt-2 mb-1">
      <button
        onClick={() => onSwitch(info.parentId, info.currentIndex - 1)}
        disabled={info.currentIndex === 0}
        className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-30 disabled:cursor-default transition-colors"
        title="Previous branch"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-[10px] text-zinc-500 font-mono tabular-nums min-w-[28px] text-center">
        {info.currentIndex + 1}/{info.totalBranches}
      </span>
      <button
        onClick={() => onSwitch(info.parentId, info.currentIndex + 1)}
        disabled={info.currentIndex >= info.totalBranches - 1}
        className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-30 disabled:cursor-default transition-colors"
        title="Next branch"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <svg className="w-3 h-3 text-zinc-600 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    </div>
  );
}

// ── Branch From Here button ──────────────────────────────────────────────────

function BranchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-[10px] font-medium text-zinc-600 hover:text-cyan-400 hover:bg-cyan-500/10 cursor-pointer"
      title="Branch from here — start a new conversation path"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
      Branch
    </button>
  );
}

// ── User Message ─────────────────────────────────────────────────────────────

/** Strip the image instruction prefix from user message content for display. */
function stripImageInstruction(content: string): string {
  return content.replace(/^\[The user attached \d+ image\(s\)\. You MUST use[^\]]*\]\n\n/s, "");
}

function UserMessage({ message, onEdit }: { message: ChatMessage; onEdit?: (newText: string) => void }) {
  const displayContent = message.images ? stripImageInstruction(message.content) : message.content;
  // Also strip file attachment prefixes for editing
  const editableContent = stripImageInstruction(
    message.content.replace(/^\[File: [^\]]+\]\n```[\s\S]*?```\n\n/gm, ""),
  );
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(editableContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = useCallback(() => {
    setEditText(editableContent);
    setIsEditing(true);
  }, [editableContent]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditText(editableContent);
  }, [editableContent]);

  const submitEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || !onEdit) return;
    setIsEditing(false);
    if (trimmed !== editableContent.trim()) {
      onEdit(trimmed);
    }
  }, [editText, editableContent, onEdit]);

  // Auto-resize textarea and focus on edit
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [isEditing]);

  return (
    <div className="group py-4 border-b border-zinc-800/40">
      <div className="flex items-start gap-3">
        <div className="w-6 h-6 rounded-md bg-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          {message.images && message.images.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {message.images.map((img, i) => (
                <InlineImage key={i} src={img.dataUrl} alt={img.name} />
              ))}
            </div>
          )}
          {isEditing ? (
            <div>
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={(e) => {
                  setEditText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitEdit();
                  }
                  if (e.key === "Escape") cancelEdit();
                }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 leading-[1.7] resize-none focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600/50"
                rows={1}
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={submitEdit}
                  className="px-3 py-1 rounded-md text-[11px] font-medium bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 transition-colors"
                >
                  Send
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1 rounded-md text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-zinc-600 ml-auto">Enter to send, Esc to cancel</span>
              </div>
            </div>
          ) : (
            <>
              {displayContent.trim() && (
                <p className="text-sm text-zinc-100 whitespace-pre-wrap leading-[1.7]">{displayContent}</p>
              )}
              {onEdit && (
                <button
                  onClick={startEdit}
                  className="mt-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-[10px] font-medium text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 cursor-pointer opacity-0 group-hover:opacity-100"
                  title="Edit message"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-[10px] font-medium ${
        copied
          ? "text-green-400 bg-green-500/10"
          : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 cursor-pointer"
      }`}
      title="Copy message"
    >
      {copied ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function AssistantMessage({
  message,
  previousQuestion,
  onInstallMCP,
  installedMCPNames,
  onBranch,
  isLastAssistant,
  onRegenerate,
}: {
  message: ChatMessage;
  previousQuestion?: string;
  onInstallMCP?: (servers: MCPServer[]) => void;
  installedMCPNames?: string[];
  onBranch?: () => void;
  isLastAssistant: boolean;
  onRegenerate?: () => void;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const markdownComponents = useMemo<Components>(() => ({
    pre({ children }) {
      const child = Children.toArray(children)[0];
      if (isValidElement(child)) {
        const childProps = child.props as { className?: string; children?: React.ReactNode };
        const lang = (childProps.className || "").replace("language-", "");
        const code = String(childProps.children || "").replace(/\n$/, "");
        return (
          <CodeBlock
            lang={lang}
            code={code}
            onInstallMCP={onInstallMCP}
            installedMCPNames={installedMCPNames}
          />
        );
      }
      return <pre>{children}</pre>;
    },
    img({ src, alt }) {
      return <InlineImage src={src} alt={alt} />;
    },
    table({ children }) {
      return (
        <div className="not-prose my-3 rounded-lg border border-zinc-800 overflow-hidden bg-zinc-950/30">
          <div className="overflow-x-auto">
            <table className="tc-table w-full text-[12px]">{children}</table>
          </div>
        </div>
      );
    },
    thead({ children }) {
      return <thead className="bg-zinc-800/60">{children}</thead>;
    },
    th({ children, style }) {
      return (
        <th className="px-3 py-2 text-[12px] font-semibold text-zinc-200 border-b border-zinc-700" style={style}>
          {children}
        </th>
      );
    },
    td({ children, style }) {
      return (
        <td className="px-3 py-2 text-zinc-400 border-t border-zinc-800/50" style={style}>
          {children}
        </td>
      );
    },
    tr({ children }) {
      return <tr className="transition-colors hover:bg-zinc-800/30">{children}</tr>;
    },
  }), [onInstallMCP, installedMCPNames]);

  return (
    <div className="py-4 border-b border-zinc-800/40">
      <div className="flex items-start gap-3">
        <div className="w-6 h-6 rounded-md bg-orange-600/20 flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-3.5 h-3.5 text-orange-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          {/* Tool calls — compacts into category groups when 5+ completed */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mb-3">
              <ToolCallList tools={message.toolCalls} isStreaming={message.isStreaming} />
              {/* Live agentic status during multi-turn tool use */}
              {message.isStreaming && message.toolCalls.some((t) => t.isRunning) && (
                <AgenticStatusBar tools={message.toolCalls} startTime={message.timestamp} />
              )}
            </div>
          )}

          {/* Text content */}
          {message.content && (
            <div className="tc-prose prose prose-invert prose-sm max-w-none
              prose-p:text-zinc-300 prose-p:leading-[1.75] prose-p:my-3
              prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-lg
              prose-code:text-amber-300 prose-code:text-xs
              prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
              prose-headings:text-zinc-100 prose-headings:font-semibold prose-headings:tracking-tight
              prose-h1:text-[15px] prose-h1:border-b prose-h1:border-zinc-800 prose-h1:pb-2 prose-h1:mt-6 prose-h1:mb-4
              prose-h2:text-[14px] prose-h2:mt-7 prose-h2:mb-3 prose-h2:border-l-2 prose-h2:border-l-orange-500/50 prose-h2:pl-3
              prose-h3:text-[13px] prose-h3:mt-5 prose-h3:mb-2 prose-h3:border-l-2 prose-h3:border-l-zinc-600 prose-h3:pl-3 prose-h3:text-zinc-200
              prose-h4:text-xs prose-h4:mt-4 prose-h4:mb-2 prose-h4:text-zinc-300 prose-h4:uppercase prose-h4:tracking-wide
              prose-strong:text-zinc-100 prose-strong:font-semibold
              prose-li:text-zinc-300 prose-li:leading-[1.75] prose-li:marker:text-zinc-600 prose-li:my-1
              prose-blockquote:border-l-orange-500/30 prose-blockquote:text-zinc-400 prose-blockquote:bg-zinc-800/20 prose-blockquote:rounded-r-lg prose-blockquote:py-0.5 prose-blockquote:pr-3
              prose-hr:border-zinc-800 prose-hr:my-6"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Streaming cursor */}
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-orange-400/80 animate-pulse ml-0.5 rounded-sm" />
          )}

          {/* Metadata footer + actions */}
          {!message.isStreaming && (
            <div className="mt-2.5 flex items-center gap-1.5">
              {message.tokens != null && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-800/60 text-[10px] text-zinc-600 font-mono">
                  {message.tokens.total.toLocaleString()} tok
                </span>
              )}
              {message.cost != null && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-800/60 text-[10px] text-zinc-600 font-mono">
                  ${message.cost.toFixed(4)}
                </span>
              )}
              {message.duration != null && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-800/60 text-[10px] text-zinc-600 font-mono">
                  {(message.duration / 1000).toFixed(1)}s
                </span>
              )}
              {message.numTurns != null && message.numTurns > 1 && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-800/60 text-[10px] text-zinc-600 font-mono">
                  {message.numTurns} turns
                </span>
              )}

              {/* Copy message button */}
              {message.content && (
                <CopyButton text={message.content} />
              )}

              {/* Save to Vault button */}
              {message.content && (
                <button
                  onClick={async () => {
                    if (saveState !== "idle") return;
                    setSaveState("saving");
                    try {
                      const title = extractTitle(message.content, previousQuestion || "Research");
                      await saveResearchToVault(title, previousQuestion || "", message.content);
                      setSaveState("saved");
                      setTimeout(() => setSaveState("idle"), 3000);
                    } catch {
                      setSaveState("idle");
                    }
                  }}
                  disabled={saveState === "saving"}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-[10px] font-medium ${
                    saveState === "saved"
                      ? "text-green-400 bg-green-500/10"
                      : saveState === "saving"
                        ? "text-zinc-600 bg-zinc-800/60 cursor-wait"
                        : "text-zinc-600 hover:text-violet-400 hover:bg-violet-500/10 cursor-pointer"
                  }`}
                  title="Save to Obsidian vault"
                >
                  {saveState === "saved" ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  )}
                  {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving..." : "Save"}
                </button>
              )}

              {/* Branch from here button — only on completed, non-last assistant messages */}
              {!isLastAssistant && onBranch && (
                <BranchButton onClick={onBranch} />
              )}

              {/* Regenerate button — only on the last assistant message */}
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-[10px] font-medium text-zinc-600 hover:text-orange-400 hover:bg-orange-500/10 cursor-pointer"
                  title="Regenerate response"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Regenerate
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemMessage({ message }: { message: ChatMessage }) {
  const isContext = message.content.startsWith("**System prompt sections**");
  const label = isContext ? "Context Summary" : "Compacted Summary";
  const iconColor = isContext ? "text-cyan-400" : "text-violet-400";
  const bgColor = isContext ? "bg-cyan-600/20" : "bg-violet-600/20";
  const labelColor = isContext ? "text-cyan-400/70" : "text-violet-400/70";

  return (
    <div className="py-3 border-b border-zinc-800/40">
      <div className="flex items-start gap-3">
        <div className={`w-6 h-6 rounded-md ${bgColor} flex items-center justify-center shrink-0 mt-0.5`}>
          {isContext ? (
            <svg className={`w-3.5 h-3.5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className={`w-3.5 h-3.5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[10px] uppercase tracking-wider ${labelColor} font-semibold`}>{label}</span>
          <div className="mt-1 text-[12px] text-zinc-400 leading-relaxed whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    </div>
  );
}

export function MessageList({ onInstallMCP, installedMCPNames }: MessageListProps) {
  const { messages, isLoading, commanderState, researcherState, childrenMap, branchPointId } = useChatState();
  const { branchFrom, cancelBranch, switchBranch, editMessage, regenerate, setOrchestrationMode } = useChatActions();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  // When a branch point is set, truncate display to that point
  const displayMessages = useMemo(() => {
    if (!branchPointId) return messages;
    const idx = messages.findIndex((m) => m.id === branchPointId);
    return idx >= 0 ? messages.slice(0, idx + 1) : messages;
  }, [messages, branchPointId]);

  // Cancel branch on Escape key
  useEffect(() => {
    if (!branchPointId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelBranch();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [branchPointId, cancelBranch]);

  // Find the last assistant message index for the "Branch" button visibility logic
  const lastAssistantIdx = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === "assistant") return i;
    }
    return -1;
  }, [displayMessages]);

  // Track whether user is scrolled near the bottom (within 150px)
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom < 150;
  }, []);

  // Auto-scroll: only when user is near bottom, or when a new message was added (user just sent)
  useEffect(() => {
    const newMessageAdded = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    // Force scroll when a new message appears (user sent or new assistant message started)
    // Use instant for streaming updates to prevent animation queue buildup
    if (newMessageAdded || isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({
        behavior: newMessageAdded ? "smooth" : "instant",
      });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-lg">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/5 border border-orange-500/10 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-orange-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-zinc-100 mb-1 tracking-tight">
            ThunderClaude
          </h2>
          <p className="text-zinc-500 text-[13px] mb-6">
            Dual-engine AI desktop — Claude + Gemini with full agentic power
          </p>

          {/* Quick start actions */}
          <div className="grid grid-cols-3 gap-2.5 mb-6">
            {[
              {
                label: "Direct Chat",
                desc: "Ask anything",
                icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
                color: "orange" as const,
                mode: "direct" as const,
              },
              {
                label: "Commander",
                desc: "Opus orchestrates workers",
                icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
                color: "purple" as const,
                mode: "commander" as const,
              },
              {
                label: "Deep Research",
                desc: "Multi-wave analysis",
                icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
                color: "teal" as const,
                mode: "researcher" as const,
              },
            ].map(({ label, desc, icon, color, mode }) => {
              const colors = {
                orange: "border-orange-500/15 hover:border-orange-500/30 hover:bg-orange-500/5 text-orange-400",
                purple: "border-purple-500/15 hover:border-purple-500/30 hover:bg-purple-500/5 text-purple-400",
                teal: "border-teal-500/15 hover:border-teal-500/30 hover:bg-teal-500/5 text-teal-400",
              };
              return (
                <button
                  key={mode}
                  onClick={() => {
                    setOrchestrationMode(mode);
                    // Focus the input textarea
                    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
                    textarea?.focus();
                  }}
                  className={`flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl bg-zinc-800/20 border transition-all ${colors[color]} cursor-pointer group`}
                >
                  <svg className="w-5 h-5 opacity-60 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
                  </svg>
                  <span className="text-[12px] font-medium">{label}</span>
                  <span className="text-[10px] text-zinc-600">{desc}</span>
                </button>
              );
            })}
          </div>

          {/* Hints */}
          <div className="flex items-center justify-center gap-4 text-[10px] text-zinc-600">
            <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-zinc-500 font-mono text-[9px]">/</kbd> commands</span>
            <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-zinc-500 font-mono text-[9px]">@</kbd> mention files</span>
            <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-zinc-500 font-mono text-[9px]">&uarr;</kbd> input history</span>
            <span><kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-zinc-500 font-mono text-[9px]">Ctrl+/</kbd> all shortcuts</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-4">
        {displayMessages.map((msg, idx) => (
          <div key={msg.id}>
            {/* Branch selector — shows 1/N navigation for messages that have siblings */}
            <BranchSelector message={msg} childrenMap={childrenMap} onSwitch={switchBranch} />

            {msg.role === "system" ? (
              <SystemMessage message={msg} />
            ) : msg.role === "user" ? (
              <UserMessage
                message={msg}
                onEdit={!isLoading ? (newText) => editMessage(msg.id, newText) : undefined}
              />
            ) : (
              <AssistantMessage
                message={msg}
                previousQuestion={
                  idx > 0 && displayMessages[idx - 1].role === "user"
                    ? displayMessages[idx - 1].content
                    : undefined
                }
                onInstallMCP={onInstallMCP}
                installedMCPNames={installedMCPNames}
                onBranch={() => branchFrom(msg.id)}
                isLastAssistant={idx === lastAssistantIdx}
                onRegenerate={idx === lastAssistantIdx && !isLoading && !msg.isStreaming
                  ? () => regenerate(msg.id) : undefined}
              />
            )}
          </div>
        ))}

        {/* Branch mode indicator */}
        {branchPointId && (
          <div className="py-3 flex items-center gap-2 ml-9">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
              <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <span className="text-[11px] text-cyan-400/80">Branching — type your new message</span>
            </div>
            <button
              onClick={cancelBranch}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800/60 transition-colors"
            >
              Cancel (Esc)
            </button>
          </div>
        )}

        {commanderState && <CommanderStatus state={commanderState} />}
        {researcherState && <ResearchStatus state={researcherState} />}

        {/* Thinking indicator (direct mode only — orchestrated modes have their own status) */}
        {isLoading &&
          !commanderState &&
          !researcherState &&
          displayMessages.length > 0 &&
          displayMessages[displayMessages.length - 1].role === "user" && (
            <ThinkingIndicator startTime={displayMessages[displayMessages.length - 1].timestamp} />
          )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
