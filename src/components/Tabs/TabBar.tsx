import type { Tab } from "../../lib/tabs";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  canAddTab: boolean;
}

export function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
  canAddTab,
}: TabBarProps) {
  // Hidden when only 1 tab — default experience unchanged
  if (tabs.length <= 1) return null;

  return (
    <div className="flex items-center h-8 bg-zinc-950 border-b border-zinc-800/80 shrink-0 select-none overflow-x-auto">
      <div className="flex items-center min-w-0 flex-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              onClick={() => onSwitchTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSwitchTab(tab.id);
              }}
              className={`group relative flex items-center gap-1.5 px-3 h-8 max-w-[180px] min-w-[100px] cursor-pointer border-r border-zinc-800/50 transition-colors ${
                isActive
                  ? "bg-zinc-900 text-zinc-200"
                  : "bg-zinc-950 text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-400"
              }`}
              title={tab.title}
            >
              {/* Active tab indicator line */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-orange-500/70" />
              )}

              {/* Tab title */}
              <span className="text-[11px] truncate flex-1 leading-none">
                {tab.title}
              </span>

              {/* Close button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`p-0.5 rounded transition-colors shrink-0 ${
                  isActive
                    ? "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50"
                    : "text-zinc-700 hover:text-zinc-400 hover:bg-zinc-800 opacity-0 group-hover:opacity-100"
                }`}
                title="Close tab (Ctrl+W)"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* New tab button */}
      {canAddTab && (
        <button
          onClick={onNewTab}
          className="p-1.5 mx-1 hover:bg-zinc-800/60 rounded transition-colors shrink-0"
          title="New tab (Ctrl+T)"
        >
          <svg
            className="w-3 h-3 text-zinc-600 hover:text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
