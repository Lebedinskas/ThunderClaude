import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Attachment } from "../lib/file-utils";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MentionResult {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension: string;
}

export const MENTION_EXT_COLORS: Record<string, string> = {
  ts: "text-blue-400", tsx: "text-blue-400",
  js: "text-yellow-400", jsx: "text-yellow-400",
  py: "text-green-400", rs: "text-orange-400",
  go: "text-cyan-400", json: "text-yellow-500",
  md: "text-zinc-400", css: "text-purple-400",
  html: "text-red-400", sql: "text-blue-300",
};

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseMentionDeps {
  input: string;
  setInput: (value: string) => void;
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useMention({ input, setInput, setAttachments, textareaRef }: UseMentionDeps) {
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionResults, setMentionResults] = useState<MentionResult[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const mentionSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Get project root on mount
  useEffect(() => {
    invoke<string>("get_working_directory")
      .then((dir) => setProjectRoot(dir))
      .catch(() => {});
  }, []);

  // Debounced search when mentionQuery changes
  useEffect(() => {
    if (!mentionOpen || !projectRoot) return;
    if (mentionQuery.length === 0) {
      invoke<MentionResult[]>("list_directory", { path: projectRoot })
        .then((results) => {
          setMentionResults(results.slice(0, 15));
          setMentionIndex(0);
        })
        .catch(() => setMentionResults([]));
      return;
    }

    clearTimeout(mentionSearchTimer.current);
    mentionSearchTimer.current = setTimeout(() => {
      invoke<MentionResult[]>("search_files", { root: projectRoot, query: mentionQuery })
        .then((results) => {
          setMentionResults(results);
          setMentionIndex(0);
        })
        .catch(() => setMentionResults([]));
    }, 120);

    return () => clearTimeout(mentionSearchTimer.current);
  }, [mentionOpen, mentionQuery, projectRoot]);

  const selectMention = useCallback(async (result: MentionResult) => {
    const before = input.slice(0, mentionStart);
    const afterCursor = input.slice(mentionStart + 1 + mentionQuery.length);
    setInput(before + afterCursor);
    setMentionOpen(false);
    setMentionQuery("");

    if (!result.is_dir) {
      try {
        const content = await invoke<string>("read_file_content", { path: result.path });
        const ext = result.extension.toLowerCase();
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: result.name,
            content,
            language: ext || "text",
          },
        ]);
      } catch (err) {
        console.warn("[Mention] Failed to read file:", err);
      }
    } else {
      try {
        const entries = await invoke<MentionResult[]>("list_directory", { path: result.path });
        const summary = entries
          .map((e) => `${e.is_dir ? "\u{1F4C1}" : "\u{1F4C4}"} ${e.name}`)
          .join("\n");
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: result.name + "/",
            content: `Directory listing of ${result.name}:\n${summary}`,
            language: "text",
          },
        ]);
      } catch (err) {
        console.warn("[Mention] Failed to list directory:", err);
      }
    }

    textareaRef.current?.focus();
  }, [input, mentionStart, mentionQuery, setInput, setAttachments, textareaRef]);

  /** Detect @ trigger from input value + cursor position */
  const handleMentionDetection = useCallback((value: string, cursorPos: number) => {
    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === "@") {
        if (i === 0 || /\s/.test(value[i - 1])) {
          atPos = i;
        }
        break;
      }
      if (/\s/.test(ch)) break;
    }

    if (atPos >= 0) {
      const query = value.slice(atPos + 1, cursorPos);
      setMentionOpen(true);
      setMentionStart(atPos);
      setMentionQuery(query);
    } else if (mentionOpen) {
      setMentionOpen(false);
      setMentionQuery("");
    }
  }, [mentionOpen]);

  /**
   * Handle keyboard events for the mention popup.
   * Returns true if the event was consumed (caller should preventDefault + return).
   */
  const handleMentionKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!mentionOpen || mentionResults.length === 0) return false;

    if (e.key === "ArrowDown") {
      setMentionIndex((i) => (i + 1) % mentionResults.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      setMentionIndex((i) => (i - 1 + mentionResults.length) % mentionResults.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      selectMention(mentionResults[mentionIndex]);
      return true;
    }
    if (e.key === "Escape") {
      setMentionOpen(false);
      return true;
    }
    return false;
  }, [mentionOpen, mentionResults, mentionIndex, selectMention]);

  return {
    mentionOpen,
    mentionResults,
    mentionIndex,
    projectRoot,
    setMentionIndex,
    selectMention,
    handleMentionDetection,
    handleMentionKeyDown,
    closeMention: () => setMentionOpen(false),
    mentionQuery,
  };
}
