// ── Multi-tab conversation management ────────────────────────────────────────
// Pure types and localStorage persistence for tab state.
// Session data (messages, branches) stays on filesystem via sessions.ts.

import type { AIModel, OrchestrationMode } from "./models";
import type { ResearchDepth } from "./researcher";
import { STORAGE_KEYS } from "./constants";

/** Represents a single open tab. */
export interface Tab {
  /** Unique tab identifier — same as the session's local UUID. */
  id: string;
  /** Display title ("New Chat" for empty tabs, AI-generated after first exchange). */
  title: string;
  /** The AI model selected for this tab's conversation. */
  model: AIModel;
  /** Orchestration mode for this tab. */
  orchestrationMode: OrchestrationMode;
  /** Research depth setting for this tab. */
  researchDepth: ResearchDepth;
  /** Whether this tab has ever had messages (false = pristine, skip disk load). */
  hasMessages: boolean;
  /** Timestamp of last activity. */
  lastActivity: number;
}

/** Serializable tabs state for localStorage. */
export interface TabsState {
  tabs: Tab[];
  activeTabId: string;
}

export const MAX_TABS = 12;

/** Create a fresh tab with sensible defaults. */
export function createTab(overrides?: Partial<Tab>): Tab {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    model: "claude-sonnet-4-6" as AIModel,
    orchestrationMode: "direct",
    researchDepth: "deep",
    hasMessages: false,
    lastActivity: Date.now(),
    ...overrides,
  };
}

/** Load persisted tabs state from localStorage. Returns null if none/corrupt. */
export function loadTabsState(): TabsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TABS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TabsState;
    if (!parsed.tabs || parsed.tabs.length === 0) return null;
    // Validate activeTabId exists in tabs
    if (!parsed.tabs.some((t) => t.id === parsed.activeTabId)) {
      parsed.activeTabId = parsed.tabs[0].id;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Save tabs state to localStorage. */
export function saveTabsState(state: TabsState): void {
  localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(state));
}

/** Find a tab by its session local ID. */
export function findTabBySessionId(tabs: Tab[], sessionId: string): Tab | undefined {
  return tabs.find((t) => t.id === sessionId);
}
