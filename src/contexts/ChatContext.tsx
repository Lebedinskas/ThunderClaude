import { createContext, useContext, useMemo } from "react";
import type { ChatMessage } from "../lib/claude-protocol";
import type { CommanderState } from "../lib/commander";
import type { ResearchState, ResearchDepth } from "../lib/researcher";
import type { AIModel, OrchestrationMode, PermissionMode } from "../lib/models";
import type { ChildrenMap } from "../lib/branching";

// ── State context (changes often — messages, loading, errors) ────────────────

interface ChatState {
  messages: ChatMessage[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  sessionId: string | null;
  model: AIModel;
  orchestrationMode: OrchestrationMode;
  commanderState: CommanderState | null;
  researcherState: ResearchState | null;
  researchDepth: ResearchDepth;
  permissionMode: PermissionMode;
  /** Non-null when failover is active: "Using X (Y rate-limited)" */
  failoverInfo: string | null;
  /** Number of queued messages waiting to be sent after current response. */
  queueLength: number;
  // Branching
  childrenMap: ChildrenMap;
  /** Non-null when user has started a branch (UI truncates to this point). */
  branchPointId: string | null;
}

const ChatStateContext = createContext<ChatState | null>(null);

// ── Actions context (stable references — callbacks) ──────────────────────────

interface ChatActions {
  sendMessage: (text: string, images?: { name: string; dataUrl: string }[]) => void;
  steerMessage: (text: string, images?: { name: string; dataUrl: string }[]) => void;
  cancelQuery: () => void;
  newChat: () => void;
  loadSession: (messages: ChatMessage[], sessionId: string | null, activeBranches?: Record<string, number>) => void;
  setModel: (model: AIModel) => void;
  setOrchestrationMode: (mode: OrchestrationMode) => void;
  setResearchDepth: (depth: ResearchDepth) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  compactMessages: () => Promise<void>;
  trimMessages: () => void;
  injectSystemMessage: (content: string) => void;
  loadResearch: (query: string, content: string) => void;
  // Branching
  branchFrom: (messageId: string) => void;
  cancelBranch: () => void;
  switchBranch: (parentId: string, newIndex: number) => void;
  // Edit & regenerate
  editMessage: (messageId: string, newText: string) => void;
  regenerate: (assistantMessageId: string) => void;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

interface ChatProviderProps {
  state: ChatState;
  actions: ChatActions;
  children: React.ReactNode;
}

/**
 * Provides chat state + actions to the entire Chat subtree.
 * Eliminates prop drilling from App → ChatView → MessageList/MessageInput.
 *
 * Split into two contexts so action-only consumers (like MessageInput)
 * don't re-render on every message chunk.
 */
export function ChatProvider({ state, actions, children }: ChatProviderProps) {
  // Actions object should be stable (callbacks are useCallback-wrapped in useClaude)
  // but we memoize the value object itself to prevent context from triggering re-renders
  const stableActions = useMemo(() => actions, [
    actions.sendMessage,
    actions.steerMessage,
    actions.cancelQuery,
    actions.newChat,
    actions.loadSession,
    actions.setModel,
    actions.setOrchestrationMode,
    actions.setResearchDepth,
    actions.setPermissionMode,
    actions.compactMessages,
    actions.trimMessages,
    actions.injectSystemMessage,
    actions.loadResearch,
    actions.branchFrom,
    actions.cancelBranch,
    actions.switchBranch,
    actions.editMessage,
    actions.regenerate,
  ]);

  return (
    <ChatStateContext.Provider value={state}>
      <ChatActionsContext.Provider value={stableActions}>
        {children}
      </ChatActionsContext.Provider>
    </ChatStateContext.Provider>
  );
}

// ── Consumer hooks ───────────────────────────────────────────────────────────

export function useChatState(): ChatState {
  const ctx = useContext(ChatStateContext);
  if (!ctx) throw new Error("useChatState must be used within ChatProvider");
  return ctx;
}

export function useChatActions(): ChatActions {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) throw new Error("useChatActions must be used within ChatProvider");
  return ctx;
}
