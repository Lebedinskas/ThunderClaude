import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEYS } from "./constants";

export interface MCPServer {
  /** Display name (also used as the key in mcpServers config) */
  name: string;
  /** The command to run (e.g., "npx", "node", "python") */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Whether this server is enabled */
  enabled: boolean;
}

/**
 * The format Claude CLI expects for --mcp-config:
 * { "mcpServers": { "name": { "command": "...", "args": [...], "env": {...} } } }
 */
interface MCPConfigFile {
  mcpServers: Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  >;
}


/**
 * Helper to create npx-based MCP server entries (cross-platform).
 * On Windows, npx needs `cmd /c` to resolve; on Mac/Linux it runs directly.
 */
function npxServer(name: string, pkg: string, extraArgs: string[] = [], env: Record<string, string> = {}, enabled = true): MCPServer {
  const isWindows = navigator.platform.startsWith("Win");
  return {
    name,
    command: isWindows ? "cmd" : "npx",
    args: isWindows ? ["/c", "npx", "-y", pkg, ...extraArgs] : ["-y", pkg, ...extraArgs],
    env,
    enabled,
  };
}

/** Pre-configured MCP servers shipped with ThunderClaude (all npx-based, cross-platform) */
const DEFAULT_SERVERS: MCPServer[] = [
  npxServer("context7", "@upstash/context7-mcp"),
  npxServer("chrome-devtools", "chrome-devtools-mcp@latest"),
];

/** Create an obsidian-vault MCP server for a specific vault path. */
export function createVaultServer(vaultPath: string): MCPServer {
  const normalized = vaultPath.replace(/\\/g, "/");
  return npxServer("obsidian-vault", "@modelcontextprotocol/server-filesystem", [normalized]);
}

/** Load server list from localStorage, merging in any missing defaults */
export function loadMCPServers(): MCPServer[] {
  let servers: MCPServer[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MCP_SERVERS);
    if (raw) servers = JSON.parse(raw);
  } catch { /* ignore */ }

  // Merge in defaults that don't exist yet (by name)
  const existing = new Set(servers.map((s) => s.name));
  for (const def of DEFAULT_SERVERS) {
    if (!existing.has(def.name)) {
      servers.push(def);
    }
  }
  return servers;
}

/** Save server list to localStorage */
export function saveMCPServers(servers: MCPServer[]): void {
  localStorage.setItem(STORAGE_KEYS.MCP_SERVERS, JSON.stringify(servers));
}

/** Build the CLI config JSON from enabled servers */
function buildConfigJSON(servers: MCPServer[]): string {
  const config: MCPConfigFile = { mcpServers: {} };
  for (const s of servers) {
    if (!s.enabled) continue;
    config.mcpServers[s.name] = {
      command: s.command,
      args: s.args,
    };
    if (Object.keys(s.env).length > 0) {
      config.mcpServers[s.name].env = s.env;
    }
  }
  return JSON.stringify(config, null, 2);
}

/**
 * Write the MCP config file to disk and return its path.
 * Returns null if no servers are enabled.
 */
export async function syncMCPConfigToDisk(
  servers: MCPServer[]
): Promise<string | null> {
  const enabled = servers.filter((s) => s.enabled);
  if (enabled.length === 0) return null;

  const json = buildConfigJSON(servers);
  const path = await invoke<string>("save_mcp_config", {
    configJson: json,
  });
  return path;
}

