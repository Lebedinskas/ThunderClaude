import { useState, useCallback, useRef, useEffect } from "react";
import type { AIModel, OrchestrationMode } from "../lib/models";
import type { ResearchDepth } from "../lib/researcher";
import type { ChatMessage } from "../lib/claude-protocol";
import type { ActiveBranchMap } from "../lib/branching";
import { serializeActiveBranches } from "../lib/branching";
import {
  type Tab,
  MAX_TABS,
  createTab,
  loadTabsState,
  saveTabsState,
  findTabBySessionId,
} from "../lib/tabs";
import { loadSessionById, saveSession, generateTitle } from "../lib/sessions";

// ── Types ────────────────────────────────────────────────────────────────────

/** Subset of useClaude's return type that useTabs needs to interact with. */
interface ChatHook {
  messages: ChatMessage[];
  allMessages: ChatMessage[];
  activeBranches: ActiveBranchMap;
  sessionId: string | null;
  model: AIModel;
  orchestrationMode: OrchestrationMode;
  researchDepth: ResearchDepth;
  isLoading: boolean;
  cancelQuery: () => void;
  newChat: () => void;
  loadSession: (
    msgs: ChatMessage[],
    sessionId: string | null,
    branches?: Record<string, number>,
  ) => void;
  setModel: (model: AIModel) => void;
  setOrchestrationMode: (
    mode: OrchestrationMode | ((prev: OrchestrationMode) => OrchestrationMode),
  ) => void;
  setResearchDepth: (depth: ResearchDepth) => void;
}

interface UseTabsOptions {
  chat: ChatHook;
  aiTitle: string | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTabs({ chat, aiTitle }: UseTabsOptions) {
  // Initialize from localStorage or create a single default tab
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = loadTabsState();
    if (saved) return saved.tabs;
    return [createTab()];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const saved = loadTabsState();
    if (saved) return saved.activeTabId;
    return tabs[0].id;
  });

  // Refs to avoid stale closures
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Race guard — increment on every switch to detect stale loads
  const switchSeqRef = useRef(0);

  // Persist tabs state on every change
  useEffect(() => {
    saveTabsState({ tabs, activeTabId });
  }, [tabs, activeTabId]);

  // ── Load active tab's session on startup ────────────────────────────────────
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const activeTab = tabsRef.current.find((t) => t.id === activeTabId);
    if (activeTab?.hasMessages) {
      loadSessionById(activeTabId).then((session) => {
        if (session) {
          chat.loadSession(
            session.messages,
            session.sessionId,
            session.activeBranches,
          );
          if (session.model) chat.setModel(session.model as AIModel);
        }
      });
    }
    // Restore per-tab model/mode regardless
    if (activeTab) {
      chat.setModel(activeTab.model);
      chat.setOrchestrationMode(activeTab.orchestrationMode);
      chat.setResearchDepth(activeTab.researchDepth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save current tab to disk ────────────────────────────────────────────────
  const saveCurrentTab = useCallback(() => {
    if (chat.allMessages.length === 0) return;

    const branchData = serializeActiveBranches(chat.activeBranches);
    const title = aiTitle || generateTitle(chat.messages);

    saveSession({
      id: activeTabIdRef.current,
      sessionId: chat.sessionId,
      title,
      model: chat.model,
      messageCount: chat.messages.length,
      timestamp: chat.allMessages[0]?.timestamp ?? Date.now(),
      lastActivity: Date.now(),
      messages: chat.allMessages,
      activeBranches:
        Object.keys(branchData).length > 0 ? branchData : undefined,
    });

    // Update tab metadata
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabIdRef.current
          ? {
              ...t,
              title,
              model: chat.model,
              orchestrationMode: chat.orchestrationMode,
              researchDepth: chat.researchDepth,
              hasMessages: true,
              lastActivity: Date.now(),
            }
          : t,
      ),
    );
  }, [chat, aiTitle]);

  // ── Switch to a different tab ───────────────────────────────────────────────
  const switchToTab = useCallback(
    async (targetId: string) => {
      if (targetId === activeTabIdRef.current) return;
      const targetTab = tabsRef.current.find((t) => t.id === targetId);
      if (!targetTab) return;

      // Cancel any active query
      if (chat.isLoading) chat.cancelQuery();

      // Save current tab
      saveCurrentTab();

      // Race guard
      const seq = ++switchSeqRef.current;

      // Load target tab
      if (targetTab.hasMessages) {
        const session = await loadSessionById(targetId);
        // Check that we haven't switched again while loading
        if (switchSeqRef.current !== seq) return;

        if (session) {
          chat.loadSession(
            session.messages,
            session.sessionId,
            session.activeBranches,
          );
        } else {
          chat.newChat();
        }
      } else {
        chat.newChat();
      }

      // Restore per-tab settings
      chat.setModel(targetTab.model);
      chat.setOrchestrationMode(targetTab.orchestrationMode);
      chat.setResearchDepth(targetTab.researchDepth);

      setActiveTabId(targetId);
    },
    [chat, saveCurrentTab],
  );

  // ── Open a new tab ──────────────────────────────────────────────────────────
  const newTab = useCallback(() => {
    if (tabsRef.current.length >= MAX_TABS) return null;

    if (chat.isLoading) chat.cancelQuery();
    saveCurrentTab();

    const tab = createTab({
      model: chat.model,
      orchestrationMode: chat.orchestrationMode,
      researchDepth: chat.researchDepth,
    });

    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    chat.newChat();

    return tab.id;
  }, [chat, saveCurrentTab]);

  // ── Close a tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback(
    async (tabId: string) => {
      const tabIndex = tabsRef.current.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return;

      // Cancel query if closing the active tab while loading
      if (tabId === activeTabIdRef.current && chat.isLoading) {
        chat.cancelQuery();
      }

      // If closing the last tab, create a fresh replacement
      if (tabsRef.current.length === 1) {
        const freshTab = createTab({
          model: chat.model,
          orchestrationMode: chat.orchestrationMode,
          researchDepth: chat.researchDepth,
        });
        setTabs([freshTab]);
        setActiveTabId(freshTab.id);
        chat.newChat();
        return;
      }

      // Remove the tab
      const remaining = tabsRef.current.filter((t) => t.id !== tabId);
      setTabs(remaining);

      // If closing the active tab, switch to an adjacent tab
      if (tabId === activeTabIdRef.current) {
        const newActiveIndex = Math.min(tabIndex, remaining.length - 1);
        const newActiveTab = remaining[newActiveIndex];
        setActiveTabId(newActiveTab.id);

        if (newActiveTab.hasMessages) {
          const session = await loadSessionById(newActiveTab.id);
          if (session) {
            chat.loadSession(
              session.messages,
              session.sessionId,
              session.activeBranches,
            );
          } else {
            chat.newChat();
          }
        } else {
          chat.newChat();
        }
        chat.setModel(newActiveTab.model);
        chat.setOrchestrationMode(newActiveTab.orchestrationMode);
        chat.setResearchDepth(newActiveTab.researchDepth);
      }
    },
    [chat],
  );

  // ── Open a session from sidebar in a tab ────────────────────────────────────
  const openSessionInTab = useCallback(
    async (
      sessionId: string,
      session: {
        messages: ChatMessage[];
        sessionId: string | null;
        title: string;
        model?: string;
        activeBranches?: Record<string, number>;
      },
    ) => {
      // Check if already open in a tab
      const existingTab = findTabBySessionId(tabsRef.current, sessionId);
      if (existingTab) {
        await switchToTab(existingTab.id);
        return;
      }

      // If max tabs reached, replace current tab
      if (tabsRef.current.length >= MAX_TABS) {
        saveCurrentTab();
        chat.loadSession(
          session.messages,
          session.sessionId,
          session.activeBranches,
        );
        if (session.model) chat.setModel(session.model as AIModel);

        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabIdRef.current
              ? {
                  ...t,
                  id: sessionId,
                  title: session.title,
                  model: (session.model || t.model) as AIModel,
                  hasMessages: true,
                  lastActivity: Date.now(),
                }
              : t,
          ),
        );
        setActiveTabId(sessionId);
        return;
      }

      // Cancel any active query and save current tab
      if (chat.isLoading) chat.cancelQuery();
      saveCurrentTab();

      // Create a new tab for the session
      const tab = createTab({
        id: sessionId,
        title: session.title,
        model: (session.model || chat.model) as AIModel,
        hasMessages: true,
      });

      setTabs((prev) => [...prev, tab]);
      setActiveTabId(sessionId);

      chat.loadSession(
        session.messages,
        session.sessionId,
        session.activeBranches,
      );
      if (session.model) chat.setModel(session.model as AIModel);
    },
    [switchToTab, saveCurrentTab, chat],
  );

  // ── Reset current tab (Ctrl+N: new chat in same tab position) ───────────────
  const resetCurrentTab = useCallback(() => {
    const newId = crypto.randomUUID();
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabIdRef.current
          ? createTab({
              id: newId,
              model: t.model,
              orchestrationMode: t.orchestrationMode,
              researchDepth: t.researchDepth,
            })
          : t,
      ),
    );
    setActiveTabId(newId);
    chat.newChat();
    return newId;
  }, [chat]);

  // ── Tab metadata updates ────────────────────────────────────────────────────
  const updateActiveTabTitle = useCallback(
    (title: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabIdRef.current ? { ...t, title } : t,
        ),
      );
    },
    [],
  );

  const markActiveTabHasMessages = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabIdRef.current
          ? { ...t, hasMessages: true, lastActivity: Date.now() }
          : t,
      ),
    );
  }, []);

  const syncActiveTabSettings = useCallback(
    (
      updates: Partial<
        Pick<Tab, "model" | "orchestrationMode" | "researchDepth">
      >,
    ) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabIdRef.current ? { ...t, ...updates } : t,
        ),
      );
    },
    [],
  );

  // ── Navigation helpers ──────────────────────────────────────────────────────
  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = tabsRef.current.findIndex(
        (t) => t.id === activeTabIdRef.current,
      );
      if (currentIndex === -1) return;
      const nextIndex =
        (currentIndex + direction + tabsRef.current.length) %
        tabsRef.current.length;
      switchToTab(tabsRef.current[nextIndex].id);
    },
    [switchToTab],
  );

  const switchToTabByIndex = useCallback(
    (oneBasedIndex: number) => {
      const index = oneBasedIndex - 1;
      if (index >= 0 && index < tabsRef.current.length) {
        switchToTab(tabsRef.current[index].id);
      }
    },
    [switchToTab],
  );

  return {
    tabs,
    activeTabId,
    switchToTab,
    newTab,
    closeTab,
    openSessionInTab,
    resetCurrentTab,
    updateActiveTabTitle,
    markActiveTabHasMessages,
    syncActiveTabSettings,
    cycleTab,
    switchToTabByIndex,
    saveCurrentTab,
  };
}
