import { useChatState } from "../../contexts/ChatContext";
import { Skill } from "../../lib/skills";
import { MCPServer } from "../../lib/mcp";
import type { ProjectConfig } from "../../lib/projects";
import { exportConversation } from "../../lib/export";
import { MODEL_LABELS } from "../../lib/models";
import { generateTitle } from "../../lib/sessions";
import { ProjectSwitcher } from "../Projects/ProjectSwitcher";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";

interface ChatViewProps {
  // Layout & toolbar — these are App-level UI concerns, not chat state
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  projectName?: string;
  projectType?: string;
  activeSkillCount: number;
  onToggleSkills: () => void;
  activeSkills: Skill[];
  allSkills?: Skill[];
  onToggleSkill: (id: string) => void;
  mcpServerCount: number;
  onToggleMCP: () => void;
  onToggleFiles: () => void;
  onToggleMemory: () => void;
  onToggleResearch: () => void;
  onToggleGoals: () => void;
  hasMemory?: boolean;
  activeGoalCount?: number;
  onInstallMCP?: (servers: MCPServer[]) => void;
  installedMCPNames?: string[];
  onShowContext?: () => void;
  projects?: ProjectConfig[];
  activeProjectId?: string | null;
  onSwitchProject?: (id: string | null) => void;
  onToggleProjects?: () => void;
}

function StatusBar() {
  const { isConnected, messages } = useChatState();

  let lastCompleted: (typeof messages)[number] | null = null;
  let totalCost = 0;
  let totalTokens = 0;
  let completedCount = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && !msg.isStreaming) {
      if (!lastCompleted) lastCompleted = msg;
      if (msg.cost != null) totalCost += msg.cost;
      if (msg.tokens) totalTokens += msg.tokens.total;
      completedCount++;
    }
  }

  const showCumulative = completedCount >= 2 && (totalCost > 0 || totalTokens > 0);

  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-zinc-800/80 bg-zinc-950 text-[11px] select-none shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          <span className="text-zinc-600">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
        {showCumulative && (
          <div className="flex items-center gap-1.5 font-mono text-zinc-700">
            {totalTokens > 0 && <span>{totalTokens.toLocaleString()} tok</span>}
            {totalCost > 0 && <span>${totalCost.toFixed(4)}</span>}
            <span className="text-zinc-800">session</span>
          </div>
        )}
      </div>
      {lastCompleted && (lastCompleted.tokens || lastCompleted.cost != null || lastCompleted.duration != null) && (
        <div className="flex items-center gap-2 font-mono text-zinc-600">
          {lastCompleted.tokens && (
            <span>{lastCompleted.tokens.total.toLocaleString()} tok</span>
          )}
          {lastCompleted.cost != null && (
            <span>${lastCompleted.cost.toFixed(4)}</span>
          )}
          {lastCompleted.duration != null && (
            <span>{(lastCompleted.duration / 1000).toFixed(1)}s</span>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatView({
  sidebarOpen,
  onToggleSidebar,
  onNewChat,
  projectName,
  projectType,
  activeSkillCount,
  onToggleSkills,
  activeSkills,
  allSkills,
  onToggleSkill,
  mcpServerCount,
  onToggleMCP,
  onToggleFiles,
  onToggleMemory,
  onToggleResearch,
  onToggleGoals,
  hasMemory,
  activeGoalCount = 0,
  onInstallMCP,
  installedMCPNames,
  onShowContext,
  projects = [],
  activeProjectId = null,
  onSwitchProject,
  onToggleProjects,
}: ChatViewProps) {
  // Chat state and actions from context — no prop drilling needed
  const { messages, error, model, failoverInfo } = useChatState();

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-800/80 shrink-0">
        <div className="flex items-center gap-2">
          {!sidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors"
              title="Open sidebar (Ctrl+B)"
            >
              <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <span className="text-[13px] font-medium text-zinc-300 tracking-tight select-none">ThunderClaude</span>
          <ProjectSwitcher
            projects={projects}
            activeProjectId={activeProjectId}
            projectName={projectName}
            projectType={projectType}
            onSwitchProject={onSwitchProject ?? (() => {})}
            onManageProjects={onToggleProjects ?? (() => {})}
          />
        </div>

        <div className="flex items-center gap-0.5">
          {/* File tree button */}
          <button
            onClick={onToggleFiles}
            className="p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
            title="File Explorer (Ctrl+E)"
          >
            <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>

          {/* Memory button */}
          <button
            onClick={onToggleMemory}
            className="relative p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
            title="Memory (Ctrl+Shift+M)"
          >
            <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            {hasMemory && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500" />
            )}
          </button>

          {/* Research library button */}
          <button
            onClick={onToggleResearch}
            className="p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
            title="Research Library (Ctrl+Shift+R)"
          >
            <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {/* Goals button */}
          <button
            onClick={onToggleGoals}
            className="relative p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
            title="Goals (Ctrl+Shift+G)"
          >
            <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {activeGoalCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-cyan-500 text-[8px] font-bold text-white flex items-center justify-center">
                {activeGoalCount}
              </span>
            )}
          </button>

          {/* MCP servers button */}
          <button
            onClick={onToggleMCP}
            className="relative p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
            title="MCP Servers (Ctrl+M)"
          >
            <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
            {mcpServerCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 text-[8px] font-bold text-white flex items-center justify-center">
                {mcpServerCount}
              </span>
            )}
          </button>

          {/* Skills button */}
          <button
            onClick={onToggleSkills}
            className="relative p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
            title="Skills (Ctrl+K)"
          >
            <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
            </svg>
            {activeSkillCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-orange-500 text-[8px] font-bold text-white flex items-center justify-center">
                {activeSkillCount}
              </span>
            )}
          </button>

          {/* Export conversation */}
          {messages.length > 0 && (
            <button
              onClick={() => exportConversation(messages, generateTitle(messages), MODEL_LABELS[model])}
              className="p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
              title="Export conversation"
            >
              <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}

          {/* New chat button */}
          <button
            onClick={onNewChat}
            className="p-1.5 hover:bg-zinc-800/80 rounded-md transition-colors group"
            title="New Chat (Ctrl+N)"
          >
            <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-950/50 border-b border-red-900/50 text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* Failover info banner */}
      {failoverInfo && !error && (
        <div className="px-4 py-1.5 bg-amber-950/40 border-b border-amber-900/40 text-amber-400 text-xs font-mono">
          {failoverInfo}
        </div>
      )}

      {/* Messages — reads from ChatContext internally */}
      <MessageList
        onInstallMCP={onInstallMCP}
        installedMCPNames={installedMCPNames}
      />

      {/* Input — reads model/orchestration from ChatContext internally */}
      <MessageInput
        activeSkills={activeSkills}
        allSkills={allSkills}
        onToggleSkill={onToggleSkill}
        onOpenSkills={onToggleSkills}
        onShowContext={onShowContext}
      />

      {/* VS Code-style status bar */}
      <StatusBar />
    </div>
  );
}
