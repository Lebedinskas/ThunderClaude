import { useState } from "react";
import { MCPServer } from "../../lib/mcp";

interface MCPPanelProps {
  servers: MCPServer[];
  onServersChange: (servers: MCPServer[]) => void;
  onClose: () => void;
}

function ServerEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: MCPServer;
  onSave: (server: Omit<MCPServer, "enabled">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [command, setCommand] = useState(initial?.command || "");
  const [argsText, setArgsText] = useState(
    initial?.args.join("\n") || ""
  );
  const [envText, setEnvText] = useState(
    initial?.env
      ? Object.entries(initial.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : ""
  );

  const canSave = name.trim() && command.trim();

  const handleSave = () => {
    if (!canSave) return;
    const args = argsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const env: Record<string, string> = {};
    for (const line of envText.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    onSave({ name: name.trim(), command: command.trim(), args, env });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-200">
          {initial ? "Edit Server" : "Add MCP Server"}
        </h3>
        <button
          onClick={onCancel}
          className="p-1 hover:bg-zinc-800 rounded transition-colors"
        >
          <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., gmail"
            disabled={!!initial}
            className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 transition-colors disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Command
          </label>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g., npx, node, python"
            className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 transition-colors font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Arguments <span className="text-zinc-600 normal-case">(one per line)</span>
          </label>
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder={"-y\n@gongrzhe/server-gmail-autoauth-mcp"}
            rows={4}
            className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 transition-colors resize-none font-mono leading-relaxed"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Environment <span className="text-zinc-600 normal-case">(KEY=VALUE, one per line)</span>
          </label>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder="API_KEY=your-key-here"
            rows={3}
            className="w-full px-3 py-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 transition-colors resize-none font-mono leading-relaxed"
          />
        </div>
      </div>

      <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className={`px-4 py-1.5 text-sm rounded-lg transition-all ${
            canSave
              ? "bg-orange-600 hover:bg-orange-500 text-white"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          }`}
        >
          {initial ? "Save" : "Add Server"}
        </button>
      </div>
    </div>
  );
}

function ServerRow({
  server,
  onToggle,
  onEdit,
  onDelete,
}: {
  server: MCPServer;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group px-4 py-3 hover:bg-zinc-800/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-200 truncate">
              {server.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] font-mono text-zinc-500 truncate">
              {server.command} {server.args.join(" ")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {/* Toggle */}
          <button
            onClick={onToggle}
            className={`relative w-8 h-[18px] rounded-full transition-colors ${
              server.enabled ? "bg-orange-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${
                server.enabled ? "left-[16px]" : "left-[2px]"
              }`}
            />
          </button>

          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 rounded transition-all"
            >
              <svg className="w-3.5 h-3.5 text-zinc-500" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="6" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="18" r="1.5" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 py-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 min-w-[100px]">
                <button
                  onClick={() => { onEdit(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => { onDelete(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-red-400 hover:bg-zinc-700/50 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MCPPanel({ servers, onServersChange, onClose }: MCPPanelProps) {
  const [editing, setEditing] = useState<MCPServer | "new" | null>(null);

  const enabledCount = servers.filter((s) => s.enabled).length;

  const handleToggle = (name: string) => {
    const updated = servers.map((s) =>
      s.name === name ? { ...s, enabled: !s.enabled } : s
    );
    onServersChange(updated);
  };

  const handleDelete = (name: string) => {
    onServersChange(servers.filter((s) => s.name !== name));
  };

  const handleSave = (data: Omit<MCPServer, "enabled">) => {
    let updated: MCPServer[];
    if (editing && editing !== "new") {
      updated = servers.map((s) =>
        s.name === editing.name
          ? { ...data, enabled: s.enabled }
          : s
      );
    } else {
      // Check for duplicate name
      if (servers.some((s) => s.name === data.name)) {
        return; // silently reject duplicates
      }
      updated = [...servers, { ...data, enabled: true }];
    }
    onServersChange(updated);
    setEditing(null);
  };

  if (editing) {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <ServerEditor
          initial={editing === "new" ? undefined : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">MCP Servers</h2>
          {enabledCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600/20 text-blue-400">
              {enabledCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditing("new")}
            className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors"
            title="Add server"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="px-4 py-2 border-b border-zinc-800/50">
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          MCP servers extend Claude with external tools. Each enabled server is loaded when you send a message.
        </p>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto">
        {servers.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="w-10 h-10 rounded-lg bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
              </svg>
            </div>
            <p className="text-[12px] text-zinc-500 mb-1">No MCP servers</p>
            <p className="text-[11px] text-zinc-600">
              Add servers for Gmail, filesystem, web search, and more.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {servers.map((server) => (
              <ServerRow
                key={server.name}
                server={server}
                onToggle={() => handleToggle(server.name)}
                onEdit={() => setEditing(server)}
                onDelete={() => handleDelete(server.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
