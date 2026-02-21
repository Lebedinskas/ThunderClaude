import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

interface SettingsPanelProps {
  onClose: () => void;
  onVaultPathChange?: () => void;
  customInstructions?: string;
  onCustomInstructionsChange?: (text: string) => void;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-10 h-[22px] rounded-full transition-colors ${
        disabled
          ? "bg-zinc-800 cursor-not-allowed"
          : checked
            ? "bg-amber-500"
            : "bg-zinc-700 hover:bg-zinc-600"
      }`}
    >
      <span
        className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : ""
        }`}
      />
    </button>
  );
}

export function SettingsPanel({ onClose, onVaultPathChange, customInstructions = "", onCustomInstructionsChange }: SettingsPanelProps) {
  const [autostart, setAutostart] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [vaultPath, setVaultPath] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      isEnabled().catch(() => false),
      invoke<{ close_to_tray: boolean; vault_path?: string }>("get_settings").catch(() => ({
        close_to_tray: true,
        vault_path: undefined as string | undefined,
      })),
    ]).then(([auto, settings]) => {
      setAutostart(auto);
      setCloseToTray(settings.close_to_tray);
      setVaultPath(settings.vault_path || "");
      setLoading(false);
    });
  }, []);

  const handleAutostart = async (value: boolean) => {
    setAutostart(value);
    try {
      if (value) await enable();
      else await disable();
    } catch (e) {
      console.error("Autostart toggle failed:", e);
      setAutostart(!value);
    }
  };

  const handleCloseToTray = async (value: boolean) => {
    setCloseToTray(value);
    try {
      await invoke("save_settings", {
        settings: { close_to_tray: value, vault_path: vaultPath || null },
      });
    } catch (e) {
      console.error("Settings save failed:", e);
      setCloseToTray(!value);
    }
  };

  const handleVaultPathBlur = async () => {
    try {
      await invoke("save_settings", {
        settings: { close_to_tray: closeToTray, vault_path: vaultPath || null },
      });
      onVaultPathChange?.();
    } catch (e) {
      console.error("Vault path save failed:", e);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
          Settings
        </span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-800 rounded transition-colors"
          title="Close"
        >
          <svg
            className="w-3.5 h-3.5 text-zinc-500"
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* General section */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            General
          </h3>

          <div className="space-y-4">
            {/* Run on startup */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 font-medium">
                  Run on startup
                </p>
                <p className="text-[11px] text-zinc-600 mt-0.5 leading-relaxed">
                  Automatically start ThunderClaude when you log in
                </p>
              </div>
              <Toggle
                checked={autostart}
                onChange={handleAutostart}
                disabled={loading}
              />
            </div>

            {/* System tray */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 font-medium">
                  System tray
                </p>
                <p className="text-[11px] text-zinc-600 mt-0.5 leading-relaxed">
                  Keep running in the system tray when window is closed
                </p>
              </div>
              <Toggle
                checked={closeToTray}
                onChange={handleCloseToTray}
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-800/50" />

        {/* Custom Instructions section */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Custom Instructions
          </h3>
          <p className="text-[11px] text-zinc-600 mb-2 leading-relaxed">
            Persistent instructions injected into every conversation. Use this to set your preferences, coding style, language, or role.
          </p>
          <textarea
            value={customInstructions}
            onChange={(e) => onCustomInstructionsChange?.(e.target.value)}
            placeholder={"Examples:\n• Always respond in Czech\n• Use TypeScript with strict types\n• I'm a senior engineer — skip basics\n• Prefer functional programming patterns"}
            rows={5}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 resize-y text-[12px] leading-relaxed"
            style={{ minHeight: "80px", maxHeight: "200px" }}
          />
          {customInstructions.trim() && (
            <p className="text-[10px] text-zinc-600 mt-1">
              {customInstructions.trim().split("\n").length} line{customInstructions.trim().split("\n").length !== 1 ? "s" : ""} · active in all conversations
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-800/50" />

        {/* Obsidian Vault section */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Obsidian Vault
          </h3>

          <div className="space-y-2">
            <div>
              <p className="text-sm text-zinc-200 font-medium">
                Vault path
              </p>
              <p className="text-[11px] text-zinc-600 mt-0.5 leading-relaxed mb-2">
                Path to your Obsidian vault. CLAUDE.md in this folder will be loaded as system context.
              </p>
              <input
                type="text"
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                onBlur={handleVaultPathBlur}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="C:\TOMO\tomo_urvas"
                disabled={loading}
                className="w-full px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50 disabled:opacity-40 font-mono text-[12px]"
              />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-800/50" />

        {/* About section */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            About
          </h3>
          <div className="space-y-1.5">
            <p className="text-sm text-zinc-300">ThunderClaude</p>
            <p className="text-[11px] text-zinc-600">
              v0.1.0 — Fast Claude Desktop App
            </p>
            <p className="text-[11px] text-zinc-700 mt-2">
              Ctrl+N New chat · Ctrl+B Sidebar · Ctrl+, Settings
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
