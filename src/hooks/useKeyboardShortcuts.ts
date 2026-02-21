import { useEffect } from "react";
import type { OrchestrationMode } from "../lib/models";

export type RightPanel = "skills" | "mcp" | "settings" | "files" | "memory" | "research" | "goals" | "costs" | "artifacts" | "projects" | null;

interface UseKeyboardShortcutsOptions {
  onNewChat: () => void;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRightPanel: React.Dispatch<React.SetStateAction<RightPanel>>;
  setOrchestrationMode: (mode: OrchestrationMode | ((prev: OrchestrationMode) => OrchestrationMode)) => void;
  setShortcutsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onNewTab?: () => void;
  onCloseTab?: () => void;
  onCycleTab?: (direction: 1 | -1) => void;
  onSwitchToTab?: (index: number) => void;
  onExport?: () => void;
  onSearch?: () => void;
}

/**
 * Global keyboard shortcut handler for the app shell.
 * Ctrl+N=new chat, Ctrl+T=new tab, Ctrl+B=sidebar, Ctrl+K=skills, etc.
 */
export function useKeyboardShortcuts({
  onNewChat,
  setSidebarOpen,
  setRightPanel,
  setOrchestrationMode,
  setShortcutsOpen,
  onNewTab,
  onCloseTab,
  onCycleTab,
  onSwitchToTab,
  onExport,
  onSearch,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // Ctrl+1-9: switch to tab by position
      if (e.key >= "1" && e.key <= "9" && !e.shiftKey) {
        e.preventDefault();
        onSwitchToTab?.(parseInt(e.key, 10));
        return;
      }

      switch (e.key) {
        case "n":
          e.preventDefault();
          onNewChat();
          break;
        case "t":
          e.preventDefault();
          onNewTab?.();
          break;
        case "w":
          e.preventDefault();
          onCloseTab?.();
          break;
        case "Tab":
          e.preventDefault();
          onCycleTab?.(e.shiftKey ? -1 : 1);
          break;
        case "b":
          e.preventDefault();
          setSidebarOpen((prev) => !prev);
          break;
        case "k":
          e.preventDefault();
          setRightPanel((prev) => (prev === "skills" ? null : "skills"));
          break;
        case "p":
          e.preventDefault();
          setRightPanel((prev) => (prev === "projects" ? null : "projects"));
          break;
        case "m":
          if (!e.shiftKey) {
            e.preventDefault();
            setRightPanel((prev) => (prev === "mcp" ? null : "mcp"));
          }
          break;
        case ",":
          e.preventDefault();
          setRightPanel((prev) => (prev === "settings" ? null : "settings"));
          break;
        case "e":
          e.preventDefault();
          setRightPanel((prev) => (prev === "files" ? null : "files"));
          break;
        case "M":
          if (e.shiftKey) {
            e.preventDefault();
            setRightPanel((prev) => (prev === "memory" ? null : "memory"));
          }
          break;
        case "R":
          if (e.shiftKey) {
            e.preventDefault();
            setRightPanel((prev) => (prev === "research" ? null : "research"));
          }
          break;
        case "G":
          if (e.shiftKey) {
            e.preventDefault();
            setRightPanel((prev) => (prev === "goals" ? null : "goals"));
          }
          break;
        case "C":
          if (e.shiftKey) {
            e.preventDefault();
            setOrchestrationMode((prev) => (prev === "commander" ? "direct" : "commander"));
          }
          break;
        case "D":
          if (e.shiftKey) {
            e.preventDefault();
            setRightPanel((prev) => (prev === "costs" ? null : "costs"));
          }
          break;
        case "A":
          if (e.shiftKey) {
            e.preventDefault();
            setRightPanel((prev) => (prev === "artifacts" ? null : "artifacts"));
          }
          break;
        case "S":
          if (e.shiftKey) {
            e.preventDefault();
            onExport?.();
          }
          break;
        case "F":
          if (e.shiftKey) {
            e.preventDefault();
            onSearch?.();
          }
          break;
        case "/":
          e.preventDefault();
          setShortcutsOpen((prev) => !prev);
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onNewChat, setSidebarOpen, setRightPanel, setOrchestrationMode, setShortcutsOpen,
    onNewTab, onCloseTab, onCycleTab, onSwitchToTab, onExport, onSearch]);
}
