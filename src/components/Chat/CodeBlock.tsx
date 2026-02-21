import { useState, useEffect } from "react";
import { highlightSync, highlight } from "../../lib/highlighter";
import type { MCPServer } from "../../lib/mcp";

// ── MCP config detection ─────────────────────────────────────────────────────

/** Try to parse a code block as MCP server config. Returns servers or null. */
function tryParseMCPServers(code: string): MCPServer[] | null {
  try {
    const parsed = JSON.parse(code);

    // Format 1: Full config — { "mcpServers": { "name": { "command": ..., "args": ... } } }
    if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
      const servers: MCPServer[] = [];
      for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
        const c = cfg as Record<string, unknown>;
        if (typeof c.command === "string") {
          servers.push({
            name,
            command: c.command,
            args: Array.isArray(c.args) ? c.args.map(String) : [],
            env: (c.env && typeof c.env === "object") ? c.env as Record<string, string> : {},
            enabled: true,
          });
        }
      }
      return servers.length > 0 ? servers : null;
    }

    // Format 2: Single server — { "name": ..., "command": ..., "args": ... }
    if (typeof parsed.command === "string" && typeof parsed.name === "string") {
      return [{
        name: parsed.name,
        command: parsed.command,
        args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
        env: (parsed.env && typeof parsed.env === "object") ? parsed.env as Record<string, string> : {},
        enabled: true,
      }];
    }

    return null;
  } catch {
    return null;
  }
}

function MCPInstallCard({
  servers,
  installedNames,
  onInstall,
}: {
  servers: MCPServer[];
  installedNames: string[];
  onInstall: (servers: MCPServer[]) => void;
}) {
  const allInstalled = servers.every((s) => installedNames.includes(s.name));
  const [justInstalled, setJustInstalled] = useState(false);

  const handleInstall = () => {
    onInstall(servers);
    setJustInstalled(true);
  };

  const isInstalled = allInstalled || justInstalled;

  return (
    <div className="mt-2 flex items-center gap-2 p-2.5 rounded-lg bg-blue-950/30 border border-blue-800/30">
      <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
      </svg>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] text-blue-300">
          {servers.length === 1
            ? `MCP Server: ${servers[0].name}`
            : `${servers.length} MCP Servers: ${servers.map((s) => s.name).join(", ")}`}
        </span>
      </div>
      <button
        onClick={handleInstall}
        disabled={isInstalled}
        className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all shrink-0 ${
          isInstalled
            ? "bg-green-600/20 text-green-400 cursor-default"
            : "bg-blue-600 hover:bg-blue-500 text-white active:scale-95"
        }`}
      >
        {isInstalled ? "Installed" : "Install"}
      </button>
    </div>
  );
}

// ── CodeBlock ────────────────────────────────────────────────────────────────

export function CodeBlock({
  lang,
  code,
  onInstallMCP,
  installedMCPNames,
}: {
  lang: string;
  code: string;
  onInstallMCP?: (servers: MCPServer[]) => void;
  installedMCPNames?: string[];
}) {
  const [copied, setCopied] = useState(false);
  // Try sync first (instant if highlighter is warm), fall back to async
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(
    () => highlightSync(code, lang || "text"),
  );

  useEffect(() => {
    if (highlightedHtml) return; // Already highlighted synchronously
    let cancelled = false;
    highlight(code, lang || "text").then((html) => {
      if (!cancelled && html) setHighlightedHtml(html);
    });
    return () => { cancelled = true; };
  }, [code, lang, highlightedHtml]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isMCPLang = ["json", "jsonc", "mcp", "mcp-config"].includes(lang);
  const mcpServers = isMCPLang ? tryParseMCPServers(code) : null;

  return (
    <div className="not-prose rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden my-2">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/60 bg-zinc-900/50">
        <span className="text-[10px] font-mono text-zinc-500 select-none">
          {lang || "text"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-green-400">Copied</span>
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code content — Shiki-highlighted HTML or plain fallback */}
      {highlightedHtml ? (
        <div
          className="shiki-wrapper overflow-x-auto [&_pre]:p-3 [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:text-[12px] [&_code]:leading-relaxed [&_code]:font-mono"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 m-0 bg-transparent">
          <code className="text-[12px] leading-relaxed text-zinc-300 font-mono whitespace-pre">
            {code}
          </code>
        </pre>
      )}

      {/* MCP Install Card */}
      {mcpServers && onInstallMCP && (
        <MCPInstallCard
          servers={mcpServers}
          installedNames={installedMCPNames || []}
          onInstall={onInstallMCP}
        />
      )}
    </div>
  );
}
