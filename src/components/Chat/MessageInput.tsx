import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isGeminiModel, type PermissionMode, PERMISSION_MODE_LABELS, MODEL_LABELS, type OrchestrationMode } from "../../lib/models";
import { useChatState, useChatActions } from "../../contexts/ChatContext";
import { TAURI_COMMANDS } from "../../lib/constants";
import {
  type Attachment,
  type ImageAttachment,
  MAX_FILE_SIZE,
  MAX_IMAGE_SIZE,
  detectLanguage,
  isTextFile,
  isImageFile,
  extractBase64,
  buildAttachmentPrefix,
  buildImageInstruction,
} from "../../lib/file-utils";
import { useMention } from "../../hooks/useMention";
import { MentionPopup } from "./MentionPopup";
import { ModelSelector } from "./ModelSelector";
import { OrchestrationToggle } from "./OrchestrationToggle";
import type { Skill } from "../../lib/skills";
import { suggestSkill } from "../../lib/skill-triggers";
import { type ModeSuggestion, suggestMode } from "../../lib/mode-triggers";
import { exportConversation } from "../../lib/export";
import { generateTitle } from "../../lib/sessions";
import type { ResearchEntry, ResearchMatch } from "../../lib/research-library";
import { loadResearchIndex, findSimilarResearch, loadResearchContent } from "../../lib/research-library";

// ── Slash commands ──────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: "/compact", desc: "Summarize older messages" },
  { cmd: "/clear", desc: "Start a new chat" },
  { cmd: "/export", desc: "Export as markdown" },
  { cmd: "/mode", desc: "Switch mode (direct/commander/researcher/auto)" },
  { cmd: "/context", desc: "Show system prompt sections" },
  { cmd: "/trim", desc: "Strip old tool results to free context" },
] as const;

// ── Permission mode toggle ──────────────────────────────────────────────────

const PERMISSION_CYCLE: PermissionMode[] = ["default", "acceptEdits", "bypassPermissions"];

const PERMISSION_COLORS: Record<PermissionMode, { bg: string; text: string; ring: string }> = {
  default: { bg: "hover:bg-zinc-800", text: "text-zinc-500", ring: "" },
  acceptEdits: { bg: "bg-amber-600/10 hover:bg-amber-600/20", text: "text-amber-400", ring: "ring-1 ring-amber-500/20" },
  bypassPermissions: { bg: "bg-red-600/10 hover:bg-red-600/20", text: "text-red-400", ring: "ring-1 ring-red-500/20" },
};

function PermissionToggle({ mode, onChange }: { mode: PermissionMode; onChange: (m: PermissionMode) => void }) {
  const colors = PERMISSION_COLORS[mode];
  const nextMode = PERMISSION_CYCLE[(PERMISSION_CYCLE.indexOf(mode) + 1) % PERMISSION_CYCLE.length];
  return (
    <button
      onClick={() => onChange(nextMode)}
      className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-all ${colors.bg} ${colors.text} ${colors.ring}`}
      title={`Permission: ${PERMISSION_MODE_LABELS[mode]} — click to switch to ${PERMISSION_MODE_LABELS[nextMode]}`}
    >
      {mode === "default" ? (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ) : mode === "acceptEdits" ? (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      )}
      <span className="hidden sm:inline">{PERMISSION_MODE_LABELS[mode]}</span>
    </button>
  );
}

interface MessageInputProps {
  activeSkills?: Skill[];
  allSkills?: Skill[];
  onToggleSkill?: (id: string) => void;
  onOpenSkills?: () => void;
  onShowContext?: () => void;
}

export function MessageInput({
  activeSkills = [],
  allSkills,
  onToggleSkill,
  onOpenSkills,
  onShowContext,
}: MessageInputProps) {
  const { isLoading, model, orchestrationMode, researchDepth, permissionMode, queueLength, messages } = useChatState();
  const { sendMessage, steerMessage, cancelQuery, newChat, setModel, setOrchestrationMode, setResearchDepth, setPermissionMode, compactMessages, trimMessages, loadResearch } = useChatActions();
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [suggestedSkill, setSuggestedSkill] = useState<Skill | null>(null);
  const [modeSuggestion, setModeSuggestion] = useState<ModeSuggestion | null>(null);
  const [researchMatch, setResearchMatch] = useState<ResearchMatch | null>(null);
  const [loadingResearch, setLoadingResearch] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const dismissedSuggestionsRef = useRef(new Set<string>());
  const researchIndexRef = useRef<ResearchEntry[] | null>(null);
  const researchDismissedRef = useRef(new Set<string>());
  const modeDismissedRef = useRef(false);

  // Input history — Up/Down arrow cycles through previous user messages
  const historyIndexRef = useRef(-1); // -1 = not browsing
  const savedInputRef = useRef(""); // preserves what user was typing before browsing

  // @ Mention system
  const mention = useMention({ input, setInput, setAttachments, textareaRef });

  // Focus textarea on Ctrl+L
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  // Listen for file attachments from FileTree panel
  useEffect(() => {
    const handler = (e: Event) => {
      const { name, content, language } = (e as CustomEvent).detail;
      setAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name, content, language },
      ]);
      textareaRef.current?.focus();
    };
    window.addEventListener("thunderclaude-attach-file", handler);
    return () => window.removeEventListener("thunderclaude-attach-file", handler);
  }, []);

  // Debounced skill suggestion — check input against triggers every 500ms
  useEffect(() => {
    if (!allSkills || allSkills.length === 0) {
      setSuggestedSkill(null);
      return;
    }
    const timer = setTimeout(() => {
      setSuggestedSkill(suggestSkill(input, allSkills, dismissedSuggestionsRef.current));
    }, 500);
    return () => clearTimeout(timer);
  }, [input, allSkills]);

  const handleDismissSuggestion = useCallback((id: string) => {
    dismissedSuggestionsRef.current.add(id);
    setSuggestedSkill(null);
  }, []);

  // Debounced mode suggestion — check input against mode triggers every 600ms
  useEffect(() => {
    if (modeDismissedRef.current) {
      setModeSuggestion(null);
      return;
    }
    const timer = setTimeout(() => {
      setModeSuggestion(suggestMode(input, orchestrationMode));
    }, 600);
    return () => clearTimeout(timer);
  }, [input, orchestrationMode]);

  // Reset mode dismissal when orchestration mode changes or input clears
  useEffect(() => {
    modeDismissedRef.current = false;
  }, [orchestrationMode]);

  const handleAcceptModeSuggestion = useCallback(() => {
    if (modeSuggestion) {
      setOrchestrationMode(modeSuggestion.mode);
      setModeSuggestion(null);
      modeDismissedRef.current = false;
    }
  }, [modeSuggestion, setOrchestrationMode]);

  const handleDismissModeSuggestion = useCallback(() => {
    modeDismissedRef.current = true;
    setModeSuggestion(null);
  }, []);

  // Debounced research reuse check — only in researcher mode
  useEffect(() => {
    if (orchestrationMode !== "researcher" && orchestrationMode !== "auto") {
      setResearchMatch(null);
      return;
    }

    let stale = false;
    const timer = setTimeout(async () => {
      // Lazy-load research index on first check
      if (!researchIndexRef.current) {
        researchIndexRef.current = await loadResearchIndex();
      }
      if (stale) return; // Effect was cleaned up during async load
      const match = findSimilarResearch(input, researchIndexRef.current);
      if (match && !researchDismissedRef.current.has(match.entry.filename)) {
        setResearchMatch(match);
      } else {
        setResearchMatch(null);
      }
    }, 600);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [input, orchestrationMode]);

  const handleLoadResearch = useCallback(async () => {
    if (!researchMatch || loadingResearch) return;
    setLoadingResearch(true);
    try {
      const content = await loadResearchContent(researchMatch.entry.filename);
      if (content) {
        const query = input.trim() || researchMatch.entry.title;
        loadResearch(query, content);
        setInput("");
        setResearchMatch(null);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    } catch {
      // Silently fail — user can still send fresh research
    }
    setLoadingResearch(false);
  }, [researchMatch, loadingResearch, input, loadResearch]);

  const handleDismissResearch = useCallback(() => {
    if (researchMatch) {
      researchDismissedRef.current.add(researchMatch.entry.filename);
      setResearchMatch(null);
    }
  }, [researchMatch]);

  // ── Image paste handling ────────────────────────────────────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file || file.size > MAX_IMAGE_SIZE) continue;
      const reader = new FileReader();
      reader.onload = () => {
        setImageAttachments((prev) => [...prev, {
          id: crypto.randomUUID(),
          name: file.name || `paste-${Date.now()}.png`,
          dataUrl: reader.result as string,
          size: file.size,
        }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removeImageAttachment = useCallback((id: string) => {
    setImageAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && imageAttachments.length === 0) return;

    // Slash commands — execute immediately, never queue
    if (text.startsWith("/")) {
      const clearInput = () => {
        setInput("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      };
      if (text === "/compact") { compactMessages(); clearInput(); return; }
      if (text === "/clear") { newChat(); clearInput(); return; }
      if (text === "/export") {
        if (messages.length > 0) exportConversation(messages, generateTitle(messages), MODEL_LABELS[model]);
        clearInput();
        return;
      }
      if (text === "/context") { onShowContext?.(); clearInput(); return; }
      if (text === "/trim") { trimMessages(); clearInput(); return; }
      if (text.startsWith("/mode ")) {
        const mode = text.slice(6).trim().toLowerCase();
        const validModes: OrchestrationMode[] = ["direct", "commander", "researcher", "auto"];
        if (validModes.includes(mode as OrchestrationMode)) {
          setOrchestrationMode(mode as OrchestrationMode);
        }
        clearInput();
        return;
      }
      // Unknown slash commands (including /help) — fall through to send as normal message
    }

    // Save images to temp files and build instruction prefix
    let imageInstruction = "";
    const imagesToStore = imageAttachments.map((img) => ({ name: img.name, dataUrl: img.dataUrl }));
    if (imageAttachments.length > 0) {
      try {
        const paths = await Promise.all(imageAttachments.map((img) =>
          invoke<string>(TAURI_COMMANDS.SAVE_TEMP_IMAGE, {
            name: img.name,
            base64Data: extractBase64(img.dataUrl),
          })
        ));
        imageInstruction = buildImageInstruction(paths);
      } catch (err) {
        console.error("[MessageInput] Failed to save temp images:", err);
      }
    }

    const fullMessage = imageInstruction + buildAttachmentPrefix(attachments) + (text || "Describe this image.");
    sendMessage(fullMessage, imagesToStore.length > 0 ? imagesToStore : undefined);
    setInput("");
    setAttachments([]);
    setImageAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, sendMessage, attachments, imageAttachments, compactMessages, newChat, messages, model, setOrchestrationMode]);

  // Steer: cancel current response and send this message immediately
  const handleSteer = useCallback(async () => {
    const text = input.trim();
    if (!text && imageAttachments.length === 0) return;

    let imageInstruction = "";
    const imagesToStore = imageAttachments.map((img) => ({ name: img.name, dataUrl: img.dataUrl }));
    if (imageAttachments.length > 0) {
      try {
        const paths = await Promise.all(imageAttachments.map((img) =>
          invoke<string>(TAURI_COMMANDS.SAVE_TEMP_IMAGE, {
            name: img.name,
            base64Data: extractBase64(img.dataUrl),
          })
        ));
        imageInstruction = buildImageInstruction(paths);
      } catch (err) {
        console.error("[MessageInput] Failed to save temp images:", err);
      }
    }

    const fullMessage = imageInstruction + buildAttachmentPrefix(attachments) + (text || "Describe this image.");
    steerMessage(fullMessage, imagesToStore.length > 0 ? imagesToStore : undefined);
    setInput("");
    setAttachments([]);
    setImageAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, steerMessage, attachments, imageAttachments]);

  // ── Drag-and-drop file handling ──────────────────────────────────────────

  const processFiles = useCallback((files: FileList) => {
    Array.from(files).forEach((file) => {
      // Image files → image attachment
      if (isImageFile(file)) {
        if (file.size > MAX_IMAGE_SIZE) {
          console.warn(`[Attach] Skipped ${file.name} — exceeds ${MAX_IMAGE_SIZE / (1024 * 1024)}MB image limit`);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          setImageAttachments((prev) => [...prev, {
            id: crypto.randomUUID(),
            name: file.name,
            dataUrl: reader.result as string,
            size: file.size,
          }]);
        };
        reader.readAsDataURL(file);
        return;
      }
      // Text files → text attachment
      if (!isTextFile(file)) return;
      if (file.size > MAX_FILE_SIZE) {
        console.warn(`[Attach] Skipped ${file.name} — exceeds ${MAX_FILE_SIZE / 1024}KB limit`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name,
            content,
            language: detectLanguage(file.name),
          },
        ]);
      };
      reader.readAsText(file);
    });
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── Keyboard handling ────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mention.handleMentionKeyDown(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      historyIndexRef.current = -1;
      handleSend();
      return;
    }
    if (e.key === "Escape" && isLoading) {
      e.preventDefault();
      cancelQuery();
      return;
    }

    // Input history — Up/Down arrow in empty input (or while browsing)
    const userMessages = messages.filter((m) => m.role === "user");
    if (e.key === "ArrowUp" && userMessages.length > 0) {
      const isEmpty = !input.trim() && attachments.length === 0 && imageAttachments.length === 0;
      const isBrowsing = historyIndexRef.current >= 0;
      if (isEmpty || isBrowsing) {
        e.preventDefault();
        if (historyIndexRef.current < 0) savedInputRef.current = input;
        const nextIdx = Math.min(historyIndexRef.current + 1, userMessages.length - 1);
        historyIndexRef.current = nextIdx;
        const msg = userMessages[userMessages.length - 1 - nextIdx];
        setInput(msg.content);
        // Move cursor to end
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = textareaRef.current.value.length;
            textareaRef.current.selectionEnd = textareaRef.current.value.length;
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
          }
        });
      }
    } else if (e.key === "ArrowDown" && historyIndexRef.current >= 0) {
      e.preventDefault();
      const nextIdx = historyIndexRef.current - 1;
      if (nextIdx < 0) {
        // Back to original input
        historyIndexRef.current = -1;
        setInput(savedInputRef.current);
      } else {
        historyIndexRef.current = nextIdx;
        const msg = userMessages[userMessages.length - 1 - nextIdx];
        setInput(msg.content);
      }
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.value.length;
          textareaRef.current.selectionEnd = textareaRef.current.value.length;
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
        }
      });
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    // Manual typing exits history browsing mode
    if (historyIndexRef.current >= 0) historyIndexRef.current = -1;
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
    const cursorPos = el.selectionStart ?? value.length;
    mention.handleMentionDetection(value, cursorPos);
  };

  const hasContent = input.trim().length > 0 || attachments.length > 0 || imageAttachments.length > 0;
  const canSend = hasContent;
  const willQueue = isLoading && hasContent;

  // Slash command hints — show matching commands when user types "/"
  const slashHints = input.startsWith("/") && !input.includes(" ")
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase()))
    : [];

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-4xl mx-auto">
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`rounded-2xl border transition-all duration-200 relative ${
            isDragOver
              ? "border-purple-500 bg-purple-950/30 ring-1 ring-purple-500/30"
              : focused
                ? "border-zinc-600 bg-zinc-800/90 shadow-lg shadow-black/20 ring-1 ring-zinc-700/50"
                : "border-zinc-800 bg-zinc-850 hover:border-zinc-700"
          }`}
          style={{ backgroundColor: isDragOver ? "rgba(59, 7, 100, 0.2)" : focused ? "rgba(39, 39, 42, 0.9)" : "rgba(39, 39, 42, 0.5)" }}
        >
          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl z-10 pointer-events-none">
              <div className="flex items-center gap-2 text-purple-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-[12px] font-medium">Drop files to attach</span>
              </div>
            </div>
          )}

          {/* @ Mention popup */}
          {mention.mentionOpen && (
            <MentionPopup
              results={mention.mentionResults}
              activeIndex={mention.mentionIndex}
              query={mention.mentionQuery}
              projectRoot={mention.projectRoot}
              onSelect={mention.selectMention}
              onHover={mention.setMentionIndex}
            />
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              isLoading
                ? "Type next message — it will be queued..."
                : orchestrationMode === "commander"
                  ? "Message Commander..."
                  : orchestrationMode === "researcher"
                    ? "Research a topic..."
                    : orchestrationMode === "auto"
                      ? "Ask anything \u2014 auto-routes to the best mode..."
                      : `Message ${isGeminiModel(model) ? "Gemini" : "Claude"}...`
            }
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-zinc-100 placeholder-zinc-600 focus:outline-none text-[13px] leading-relaxed"
            style={{ maxHeight: "160px" }}
          />

          {/* Slash command hints */}
          {slashHints.length > 0 && focused && (
            <div className="mx-3 mt-0.5 mb-0.5 flex flex-wrap gap-1.5">
              {slashHints.map((hint) => (
                <button
                  key={hint.cmd}
                  onClick={() => {
                    setInput(hint.cmd === "/mode" ? "/mode " : hint.cmd);
                    textareaRef.current?.focus();
                  }}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/60 hover:bg-zinc-700/60 border border-zinc-700/30 transition-colors text-[11px]"
                >
                  <span className="font-mono text-zinc-300">{hint.cmd}</span>
                  <span className="text-zinc-500">{hint.desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* Research reuse suggestion — only in researcher mode */}
          {researchMatch && !isLoading && (
            <div className="mx-3 mt-1 mb-0.5 px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-950/10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 text-[11px]">
                  <svg className="w-3.5 h-3.5 text-emerald-500/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-emerald-400/70 truncate">
                    Similar research
                    {researchMatch.entry.daysAgo === 0 ? " from today" :
                     researchMatch.entry.daysAgo === 1 ? " from yesterday" :
                     ` from ${researchMatch.entry.daysAgo}d ago`}
                    {" — "}
                    <span className="text-emerald-400/90 font-medium">{researchMatch.entry.title}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={handleLoadResearch}
                    disabled={loadingResearch}
                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25 hover:text-emerald-300 transition-colors disabled:opacity-50"
                  >
                    {loadingResearch ? "Loading..." : "Load"}
                  </button>
                  <button
                    onClick={handleDismissResearch}
                    className="px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
                  >
                    Fresh
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mode suggestion chip */}
          {modeSuggestion && !isLoading && (
            <div className="mx-3 mt-1 mb-0.5 px-3 py-1.5 rounded-lg border border-dashed border-violet-500/25 bg-violet-950/10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 text-[11px]">
                  {modeSuggestion.mode === "researcher" ? (
                    <svg className="w-3.5 h-3.5 text-teal-500/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-purple-500/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                  <span className="text-violet-400/70">
                    This looks like a{" "}
                    <span className={`font-medium ${modeSuggestion.mode === "researcher" ? "text-teal-400/90" : "text-purple-400/90"}`}>
                      {modeSuggestion.label}
                    </span>
                    {" "}task — switch mode?
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={handleAcceptModeSuggestion}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      modeSuggestion.mode === "researcher"
                        ? "bg-teal-600/15 text-teal-400 hover:bg-teal-600/25 hover:text-teal-300"
                        : "bg-purple-600/15 text-purple-400 hover:bg-purple-600/25 hover:text-purple-300"
                    }`}
                  >
                    Switch
                  </button>
                  <button
                    onClick={handleDismissModeSuggestion}
                    className="px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active skill chips + suggestion */}
          {(activeSkills.length > 0 || suggestedSkill) && (
            <div className="flex items-center gap-1.5 px-3 pb-1 flex-wrap">
              {activeSkills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => onToggleSkill?.(skill.id)}
                  className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-600/10 border border-orange-600/20 hover:border-orange-500/40 hover:bg-orange-600/20 transition-all text-[11px] text-orange-400/80 hover:text-orange-300"
                  title={`Disable "${skill.name}"`}
                >
                  <span className="text-orange-500/60 font-mono">/</span>
                  <span className="font-medium truncate max-w-[100px]">{skill.name.toLowerCase().replace(/\s+/g, '-')}</span>
                  <svg className="w-2.5 h-2.5 text-orange-500/40 group-hover:text-orange-400 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ))}

              {/* Suggested skill chip — dashed border, blue tint */}
              {suggestedSkill && (
                <div className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-blue-500/30 bg-blue-600/5 transition-all text-[11px]">
                  <button
                    onClick={() => onToggleSkill?.(suggestedSkill.id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-blue-400/70 hover:text-blue-300 transition-colors"
                    title={`Enable "${suggestedSkill.name}" for this conversation`}
                  >
                    <svg className="w-2.5 h-2.5 text-blue-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="font-medium">{suggestedSkill.name.toLowerCase().replace(/\s+/g, '-')}</span>
                    <span className="text-blue-500/40">?</span>
                  </button>
                  <button
                    onClick={() => handleDismissSuggestion(suggestedSkill.id)}
                    className="px-1 py-0.5 text-blue-500/30 hover:text-blue-400 transition-colors"
                    title="Dismiss suggestion"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {activeSkills.length > 0 && (
                <button
                  onClick={onOpenSkills}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-zinc-800 transition-colors text-[11px] text-zinc-600 hover:text-zinc-400"
                  title="Manage skills (Ctrl+K)"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
              {attachments.map((att) => (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700/50 text-[11px] text-zinc-400 group"
                >
                  <svg className="w-3 h-3 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate max-w-[120px]">{att.name}</span>
                  <span className="text-zinc-600 text-[10px]">
                    {att.content.length > 1000
                      ? `${(att.content.length / 1000).toFixed(1)}k`
                      : att.content.length}
                  </span>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                    title="Remove"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Image attachment thumbnails */}
          {imageAttachments.length > 0 && (
            <div className="flex items-center gap-2 px-3 pb-1.5 flex-wrap">
              {imageAttachments.map((img) => (
                <div key={img.id} className="relative group rounded-lg overflow-hidden border border-zinc-700/50 bg-zinc-800">
                  <img src={img.dataUrl} alt={img.name} className="h-16 w-auto max-w-[120px] object-cover" />
                  <button
                    onClick={() => removeImageAttachment(img.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-zinc-900/80 text-zinc-400 hover:text-red-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <div className="absolute bottom-0 inset-x-0 bg-zinc-900/70 px-1 py-0.5 text-[9px] text-zinc-400 truncate">
                    {img.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <div className="flex items-center gap-0.5">
              <ModelSelector model={model} onChange={setModel} />
              <div className="w-px h-3 bg-zinc-700/50 mx-1" />
              <OrchestrationToggle
                mode={orchestrationMode}
                onChange={setOrchestrationMode}
                depth={researchDepth}
                onDepthChange={setResearchDepth}
              />
              <div className="w-px h-3 bg-zinc-700/50 mx-1" />
              <PermissionToggle mode={permissionMode} onChange={setPermissionMode} />
            </div>

            <div className="flex items-center gap-1.5">
              {/* Queue badge */}
              {queueLength > 0 && (
                <span className="text-[10px] font-medium text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded-md tabular-nums">
                  {queueLength} queued
                </span>
              )}

              {isLoading && (
                <>
                  <button
                    onClick={cancelQuery}
                    className="p-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-400 hover:text-red-300 active:scale-95 transition-all duration-150"
                    title="Stop (Esc)"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                  </button>
                  {canSend && (
                    <button
                      onClick={handleSteer}
                      className="p-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 hover:text-amber-300 active:scale-95 transition-all duration-150"
                      title="Steer — cancel current and send this instead"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 12h14" />
                      </svg>
                    </button>
                  )}
                </>
              )}

              <button
                onClick={handleSend}
                disabled={!canSend}
                className={`p-2 rounded-xl transition-all duration-150 ${
                  !canSend
                    ? "text-zinc-700"
                    : willQueue
                      ? "bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white shadow-md shadow-violet-900/30 active:scale-95"
                      : "bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white shadow-md shadow-orange-900/30 active:scale-95"
                }`}
                title={willQueue ? "Queue message (Enter)" : "Send (Enter)"}
              >
                {willQueue ? (
                  /* Stack/queue icon */
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0l-3-3m3 3l-3 3" />
                    <path stroke="currentColor" strokeLinecap="round" strokeWidth={2} d="M19 17H5" opacity={0.5} />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12m-5-5l5 5-5 5" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
