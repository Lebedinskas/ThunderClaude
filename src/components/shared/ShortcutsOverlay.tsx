import { useEffect, useRef } from "react";

interface ShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { group: "Chat", items: [
    { keys: "Enter", desc: "Send message (or queue)" },
    { keys: "Shift+Enter", desc: "New line" },
    { keys: "Escape", desc: "Cancel response" },
    { keys: "Ctrl+L", desc: "Focus input" },
    { keys: "Ctrl+N", desc: "New chat" },
    { keys: "\u2191/\u2193", desc: "Input history (empty input)" },
    { keys: "@", desc: "Mention file" },
    { keys: "Ctrl+Shift+F", desc: "Search all conversations" },
    { keys: "Ctrl+Shift+S", desc: "Export conversation" },
    { keys: "/compact", desc: "Compact messages" },
    { keys: "/trim", desc: "Strip old tool results" },
    { keys: "/context", desc: "Show system prompt sections" },
  ]},
  { group: "Tabs", items: [
    { keys: "Ctrl+T", desc: "New tab" },
    { keys: "Ctrl+W", desc: "Close tab" },
    { keys: "Ctrl+Tab", desc: "Next tab" },
    { keys: "Ctrl+Shift+Tab", desc: "Previous tab" },
    { keys: "Ctrl+1-9", desc: "Switch to tab N" },
  ]},
  { group: "Panels", items: [
    { keys: "Ctrl+B", desc: "Toggle sidebar" },
    { keys: "Ctrl+K", desc: "Skills" },
    { keys: "Ctrl+M", desc: "MCP servers" },
    { keys: "Ctrl+P", desc: "Projects" },
    { keys: "Ctrl+E", desc: "File explorer" },
    { keys: "Ctrl+,", desc: "Settings" },
    { keys: "Ctrl+Shift+M", desc: "Memory" },
    { keys: "Ctrl+Shift+R", desc: "Research library" },
    { keys: "Ctrl+Shift+G", desc: "Goals" },
    { keys: "Ctrl+Shift+D", desc: "Cost analytics" },
    { keys: "Ctrl+Shift+A", desc: "Artifacts" },
  ]},
  { group: "Modes", items: [
    { keys: "Ctrl+Shift+C", desc: "Toggle Commander" },
    { keys: "Ctrl+/", desc: "This help" },
  ]},
  { group: "Sessions", items: [
    { keys: "Double-click", desc: "Rename session" },
    { keys: "Star icon", desc: "Pin/unpin session" },
  ]},
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-[11px] font-mono text-zinc-300 leading-none">
      {children}
    </kbd>
  );
}

function KeyCombo({ keys }: { keys: string }) {
  const parts = keys.split("+");
  return (
    <span className="flex items-center gap-0.5">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-zinc-700 text-[10px]">+</span>}
          <Kbd>{p}</Kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutsOverlay({ isOpen, onClose }: ShortcutsOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl w-[480px] max-h-[70vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200 tracking-tight">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-500 hover:text-zinc-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-3 space-y-4">
          {SHORTCUTS.map((group) => (
            <div key={group.group}>
              <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">{group.group}</h3>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.keys} className="flex items-center justify-between py-1">
                    <span className="text-[12px] text-zinc-400">{item.desc}</span>
                    <KeyCombo keys={item.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-2.5 border-t border-zinc-800/50">
          <p className="text-[10px] text-zinc-600 text-center">Press <Kbd>Esc</Kbd> to close</p>
        </div>
      </div>
    </div>
  );
}
