import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { STORAGE_KEYS } from "./lib/constants";
import { useClaude } from "./hooks/useClaude";
import { useAppContext } from "./hooks/useAppContext";
import { useTabs } from "./hooks/useTabs";
import { useKeyboardShortcuts, type RightPanel } from "./hooks/useKeyboardShortcuts";
import { ChatProvider } from "./contexts/ChatContext";
import { ChatView } from "./components/Chat/ChatView";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TabBar } from "./components/Tabs/TabBar";
import { SkillsPanel } from "./components/Skills/SkillsPanel";
import { MCPPanel } from "./components/MCP/MCPPanel";
import { MemoryPanel } from "./components/Memory/MemoryPanel";
import { ResearchPanel } from "./components/Research/ResearchPanel";
import { GoalsPanel } from "./components/Goals/GoalsPanel";
import { ProjectsPanel } from "./components/Projects/ProjectsPanel";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { FileTree } from "./components/FileTree/FileTree";
import { CostPanel } from "./components/CostDashboard/CostPanel";
import { ArtifactsPanel } from "./components/Artifacts/ArtifactsPanel";
import { SearchOverlay } from "./components/Search/SearchOverlay";
import { ShortcutsOverlay } from "./components/shared/ShortcutsOverlay";
import { PanelErrorBoundary } from "./components/shared/ErrorBoundary";
import { MAX_TABS } from "./lib/tabs";
import {
  SessionIndexEntry,
  SessionInfo,
  loadSessionIndex,
  loadSessionById,
  saveSession,
  generateTitle,
  updateSessionTitle,
} from "./lib/sessions";
import { serializeActiveBranches } from "./lib/branching";
import { generateAITitle } from "./lib/title-generator";
import { exportConversation } from "./lib/export";
import { MODEL_LABELS } from "./lib/models";
import {
  appendDailyLog,
  formatSessionSummary,
  extractAndSaveSession,
} from "./lib/memory";

export default function App() {
  // ── App-level context (vault, memory, goals, skills, MCP, system prompt) ──
  const ctx = useAppContext();

  // ── Core chat hook ────────────────────────────────────────────────────────
  const chat = useClaude(ctx.systemPrompt, ctx.mcpConfigPath, ctx.searchRelevantContext, ctx.projectContext);

  // ── Session management refs ───────────────────────────────────────────────
  const prevMessagesLenRef = useRef(0);
  const aiTitleRef = useRef<string | null>(null);
  const titleGenAttemptedRef = useRef(new Set<string>());
  const messagesRef = useRef(chat.messages);
  messagesRef.current = chat.messages;

  // ── Multi-tab state ─────────────────────────────────────────────────────
  const tabState = useTabs({ chat, aiTitle: aiTitleRef.current });

  // ── Chat context for ChatProvider ─────────────────────────────────────────
  const chatState = useMemo(() => ({
    messages: chat.messages, isConnected: chat.isConnected, isLoading: chat.isLoading,
    error: chat.error, sessionId: chat.sessionId, model: chat.model,
    orchestrationMode: chat.orchestrationMode, commanderState: chat.commanderState,
    researcherState: chat.researcherState, researchDepth: chat.researchDepth,
    permissionMode: chat.permissionMode, failoverInfo: chat.failoverInfo,
    queueLength: chat.queueLength,
    childrenMap: chat.childrenMap, branchPointId: chat.branchPointId,
  }), [chat.messages, chat.isConnected, chat.isLoading, chat.error, chat.sessionId,
    chat.model, chat.orchestrationMode, chat.commanderState, chat.researcherState,
    chat.researchDepth, chat.permissionMode, chat.failoverInfo, chat.queueLength,
    chat.childrenMap, chat.branchPointId]);

  const chatActions = useMemo(() => ({
    sendMessage: chat.sendMessage, steerMessage: chat.steerMessage, cancelQuery: chat.cancelQuery, newChat: chat.newChat,
    loadSession: chat.loadSession, setModel: chat.setModel,
    setOrchestrationMode: chat.setOrchestrationMode, setResearchDepth: chat.setResearchDepth,
    setPermissionMode: chat.setPermissionMode,
    compactMessages: chat.compactMessages, trimMessages: chat.trimMessages, injectSystemMessage: chat.injectSystemMessage, loadResearch: chat.loadResearch,
    branchFrom: chat.branchFrom, cancelBranch: chat.cancelBranch, switchBranch: chat.switchBranch,
    editMessage: chat.editMessage, regenerate: chat.regenerate,
  }), [chat.sendMessage, chat.steerMessage, chat.cancelQuery, chat.newChat, chat.loadSession, chat.setModel,
    chat.setOrchestrationMode, chat.setResearchDepth, chat.setPermissionMode,
    chat.compactMessages, chat.trimMessages, chat.injectSystemMessage, chat.loadResearch,
    chat.branchFrom, chat.cancelBranch, chat.switchBranch, chat.editMessage, chat.regenerate]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(STORAGE_KEYS.SIDEBAR) !== "closed"
  );
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState<SessionIndexEntry[]>([]);

  // ── Session handlers ──────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    const currentMessages = messagesRef.current;
    if (currentMessages.length >= 2) {
      const title = aiTitleRef.current || generateTitle(currentMessages);
      if (currentMessages.length >= 4) {
        extractAndSaveSession(title, currentMessages)
          .then(ctx.reloadMemory)
          .catch(() => {
            appendDailyLog(formatSessionSummary(title, currentMessages))
              .then(ctx.reloadMemory)
              .catch(() => {});
          });
      } else {
        appendDailyLog(formatSessionSummary(title, currentMessages))
          .then(ctx.reloadMemory)
          .catch(() => {});
      }
    }
    aiTitleRef.current = null;
    tabState.resetCurrentTab();
  }, [tabState.resetCurrentTab, ctx.reloadMemory]);

  const handleLoadSession = useCallback((session: SessionInfo) => {
    aiTitleRef.current = session.title;
    tabState.openSessionInTab(session.id, session);
  }, [tabState.openSessionInTab]);

  // ── Search handlers ──────────────────────────────────────────────────────
  const handleOpenSearch = useCallback(() => {
    loadSessionIndex().then(setSearchIndex);
    setSearchOpen(true);
  }, []);

  const handleSearchSelect = useCallback(async (sessionId: string) => {
    const session = await loadSessionById(sessionId);
    if (session) handleLoadSession(session);
  }, [handleLoadSession]);

  // ── Context introspection ────────────────────────────────────────────────
  const handleShowContext = useCallback(() => {
    chat.injectSystemMessage(ctx.buildContextSummary());
  }, [chat.injectSystemMessage, ctx.buildContextSummary]);

  // ── Persist sidebar state ─────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR, sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (chat.messages.length > 0) {
      exportConversation(chat.messages, generateTitle(chat.messages), MODEL_LABELS[chat.model]);
    }
  }, [chat.messages, chat.model]);

  useKeyboardShortcuts({
    onNewChat: handleNewChat,
    setSidebarOpen,
    setRightPanel,
    setOrchestrationMode: chat.setOrchestrationMode,
    setShortcutsOpen,
    onNewTab: () => tabState.newTab(),
    onCloseTab: () => tabState.closeTab(tabState.activeTabId),
    onCycleTab: (dir) => tabState.cycleTab(dir),
    onSwitchToTab: (index) => tabState.switchToTabByIndex(index),
    onExport: handleExport,
    onSearch: handleOpenSearch,
  });

  // ── Sync per-tab settings when user changes model/mode ──────────────────
  useEffect(() => {
    tabState.syncActiveTabSettings({
      model: chat.model,
      orchestrationMode: chat.orchestrationMode,
      researchDepth: chat.researchDepth,
    });
  }, [chat.model, chat.orchestrationMode, chat.researchDepth, tabState.syncActiveTabSettings]);

  // ── Auto-save session on new assistant messages ───────────────────────────
  useEffect(() => {
    if (chat.messages.length > 0 && chat.messages.length !== prevMessagesLenRef.current) {
      const last = chat.messages[chat.messages.length - 1];
      if (last.role === "assistant" && !last.isStreaming) {
        const branchData = serializeActiveBranches(chat.activeBranches);
        saveSession({
          id: tabState.activeTabId,
          sessionId: chat.sessionId,
          title: aiTitleRef.current || generateTitle(chat.messages),
          model: chat.model,
          messageCount: chat.messages.length,
          timestamp: chat.messages[0].timestamp,
          lastActivity: Date.now(),
          messages: chat.allMessages,
          activeBranches: Object.keys(branchData).length > 0 ? branchData : undefined,
        });

        tabState.markActiveTabHasMessages();

        const localId = tabState.activeTabId;
        if (chat.messages.length === 2 && !titleGenAttemptedRef.current.has(localId)) {
          titleGenAttemptedRef.current.add(localId);
          generateAITitle(chat.messages[0].content, chat.messages[1].content).then((title) => {
            if (title) {
              aiTitleRef.current = title;
              updateSessionTitle(localId, title);
              tabState.updateActiveTabTitle(title);
            }
          });
        }
      }
    }
    prevMessagesLenRef.current = chat.messages.length;
  }, [chat.messages, chat.allMessages, chat.activeBranches, chat.sessionId, chat.model,
    tabState.activeTabId, tabState.markActiveTabHasMessages, tabState.updateActiveTabTitle]);

  // ── Render ────────────────────────────────────────────────────────────────
  const closePanel = useCallback(() => setRightPanel(null), []);

  return (
    <ChatProvider state={chatState} actions={chatActions}>
      <div className="h-screen w-screen bg-zinc-900 text-zinc-100 overflow-hidden flex">
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          currentSessionId={tabState.activeTabId}
          onNewChat={handleNewChat}
          onLoadSession={handleLoadSession}
          onToggleSettings={() => setRightPanel((p) => (p === "settings" ? null : "settings"))}
        />
        <div className="flex-1 min-w-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <TabBar
              tabs={tabState.tabs}
              activeTabId={tabState.activeTabId}
              onSwitchTab={tabState.switchToTab}
              onCloseTab={tabState.closeTab}
              onNewTab={() => tabState.newTab()}
              canAddTab={tabState.tabs.length < MAX_TABS}
            />
            <div className="flex-1 min-h-0">
              <ChatView
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                onNewChat={handleNewChat}
                projectName={ctx.projectContext?.name}
                projectType={ctx.projectContext?.type}
                activeSkillCount={ctx.activeSkillCount}
                onToggleSkills={() => setRightPanel((p) => (p === "skills" ? null : "skills"))}
                activeSkills={ctx.activeSkills}
                allSkills={ctx.skills}
                onToggleSkill={ctx.handleToggleSkill}
                mcpServerCount={ctx.mcpServers.filter((s) => s.enabled).length}
                onToggleMCP={() => setRightPanel((p) => (p === "mcp" ? null : "mcp"))}
                onToggleFiles={() => setRightPanel((p) => (p === "files" ? null : "files"))}
                onToggleMemory={() => setRightPanel((p) => (p === "memory" ? null : "memory"))}
                onToggleResearch={() => setRightPanel((p) => (p === "research" ? null : "research"))}
                onToggleGoals={() => setRightPanel((p) => (p === "goals" ? null : "goals"))}
                hasMemory={ctx.hasMemory}
                activeGoalCount={ctx.goals.filter((g) => g.status === "active").length}
                onInstallMCP={ctx.handleInstallMCP}
                installedMCPNames={ctx.installedMCPNames}
                onShowContext={handleShowContext}
                projects={ctx.projects}
                activeProjectId={ctx.activeProjectId}
                onSwitchProject={ctx.switchProject}
                onToggleProjects={() => setRightPanel((p) => (p === "projects" ? null : "projects"))}
              />
            </div>
          </div>

          {rightPanel && (
            <div className="w-80 h-full border-l border-zinc-800/80 shrink-0 tc-panel-enter">
              {rightPanel === "skills" && (
                <PanelErrorBoundary name="Skills" onClose={closePanel}>
                  <SkillsPanel skills={ctx.skills} onSkillsChange={ctx.setSkills} onClose={closePanel} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "mcp" && (
                <PanelErrorBoundary name="MCP" onClose={closePanel}>
                  <MCPPanel servers={ctx.mcpServers} onServersChange={ctx.setMcpServers} onClose={closePanel} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "settings" && (
                <PanelErrorBoundary name="Settings" onClose={closePanel}>
                  <SettingsPanel
                    onClose={closePanel}
                    onVaultPathChange={ctx.reloadVaultContext}
                    customInstructions={ctx.customInstructions}
                    onCustomInstructionsChange={ctx.setCustomInstructions}
                  />
                </PanelErrorBoundary>
              )}
              {rightPanel === "files" && (
                <PanelErrorBoundary name="Files" onClose={closePanel}>
                  <FileTree onClose={closePanel} onSetProjectRoot={ctx.setProjectRoot} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "memory" && (
                <PanelErrorBoundary name="Memory" onClose={closePanel}>
                  <MemoryPanel onClose={closePanel} onMemoryChange={ctx.reloadMemory} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "research" && (
                <PanelErrorBoundary name="Research" onClose={closePanel}>
                  <ResearchPanel onClose={closePanel} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "goals" && (
                <PanelErrorBoundary name="Goals" onClose={closePanel}>
                  <GoalsPanel onClose={closePanel} onGoalsChange={ctx.reloadGoals} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "costs" && (
                <PanelErrorBoundary name="Costs" onClose={closePanel}>
                  <CostPanel onClose={closePanel} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "artifacts" && (
                <PanelErrorBoundary name="Artifacts" onClose={closePanel}>
                  <ArtifactsPanel onClose={closePanel} />
                </PanelErrorBoundary>
              )}
              {rightPanel === "projects" && (
                <PanelErrorBoundary name="Projects" onClose={closePanel}>
                  <ProjectsPanel
                    onClose={closePanel}
                    projects={ctx.projects}
                    activeProjectId={ctx.activeProjectId}
                    onSwitchProject={ctx.switchProject}
                    onProjectsChange={ctx.setProjects}
                    currentMcpNames={ctx.mcpServers.filter((s) => s.enabled).map((s) => s.name)}
                    currentSkillIds={ctx.skills.filter((s) => s.enabled).map((s) => s.id)}
                  />
                </PanelErrorBoundary>
              )}
            </div>
          )}
        </div>
      </div>
      <SearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        sessionIndex={searchIndex}
        currentSessionId={tabState.activeTabId}
        onSelectSession={handleSearchSelect}
      />
      <ShortcutsOverlay isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </ChatProvider>
  );
}
