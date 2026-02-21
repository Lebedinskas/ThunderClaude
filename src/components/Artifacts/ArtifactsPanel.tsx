import { useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatState } from "../../contexts/ChatContext";
import { extractArtifacts, type Artifact } from "../../lib/artifacts";
import { highlightSync } from "../../lib/highlighter";

interface ArtifactsPanelProps {
  onClose: () => void;
}

export function ArtifactsPanel({ onClose }: ArtifactsPanelProps) {
  const { messages } = useChatState();
  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;

  const handleCopy = useCallback(async (artifact: Artifact) => {
    await navigator.clipboard.writeText(artifact.content);
    setCopiedId(artifact.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleSave = useCallback(async (artifact: Artifact) => {
    const ext = guessExtension(artifact.language);
    const filename = artifact.title.includes(".")
      ? artifact.title
      : `${artifact.title.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_")}${ext}`;

    try {
      await invoke("create_file", {
        path: filename,
        content: artifact.content,
      });
      setSavedId(artifact.id);
      setTimeout(() => setSavedId(null), 2000);
    } catch (e) {
      console.warn("[Artifacts] Save failed:", e);
    }
  }, []);

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-cyan-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span className="text-[13px] font-medium text-zinc-300">
            Artifacts
            {artifacts.length > 0 && (
              <span className="ml-1.5 text-zinc-600 font-normal">({artifacts.length})</span>
            )}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      {artifacts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <svg className="w-8 h-8 text-zinc-800 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <p className="text-[12px] text-zinc-600">No code artifacts yet</p>
            <p className="text-[11px] text-zinc-700 mt-1">Code blocks from AI responses will appear here.</p>
          </div>
        </div>
      ) : selected ? (
        /* Detail view */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Back + actions */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/50">
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleCopy(selected)}
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                {copiedId === selected.id ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => handleSave(selected)}
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-600/15 text-cyan-400 hover:bg-cyan-600/25 hover:text-cyan-300 transition-colors"
              >
                {savedId === selected.id ? "Saved!" : "Save"}
              </button>
            </div>
          </div>

          {/* Title */}
          <div className="px-3 py-1.5">
            <div className="text-[12px] font-medium text-zinc-300 truncate">{selected.title}</div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 mt-0.5">
              <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-500">{selected.language}</span>
              {selected.version > 1 && <span>v{selected.version}</span>}
              <span>{selected.content.split("\n").length} lines</span>
            </div>
          </div>

          {/* Code */}
          <div className="flex-1 overflow-auto px-1 pb-2">
            <ArtifactCode code={selected.content} lang={selected.language} />
          </div>
        </div>
      ) : (
        /* List view */
        <div className="flex-1 overflow-y-auto">
          {artifacts.map((artifact) => (
            <ArtifactRow
              key={artifact.id}
              artifact={artifact}
              isCopied={copiedId === artifact.id}
              onSelect={() => setSelectedId(artifact.id)}
              onCopy={() => handleCopy(artifact)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactRow({
  artifact,
  isCopied,
  onSelect,
  onCopy,
}: {
  artifact: Artifact;
  isCopied: boolean;
  onSelect: () => void;
  onCopy: () => void;
}) {
  return (
    <div
      className="group px-3 py-2 border-b border-zinc-800/40 hover:bg-zinc-800/30 cursor-pointer transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-zinc-300 truncate">{artifact.title}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-500">
              {artifact.language}
            </span>
            {artifact.version > 1 && (
              <span className="text-[10px] text-zinc-600">v{artifact.version}</span>
            )}
            <span className="text-[10px] text-zinc-700">
              {artifact.content.split("\n").length}L
            </span>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-all"
          title="Copy to clipboard"
        >
          {isCopied ? (
            <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          )}
        </button>
      </div>

      {/* Preview — first 3 lines */}
      <div className="mt-1.5 text-[10px] font-mono text-zinc-600 leading-relaxed line-clamp-3 whitespace-pre overflow-hidden">
        {artifact.content.split("\n").slice(0, 3).join("\n")}
      </div>
    </div>
  );
}

function ArtifactCode({ code, lang }: { code: string; lang: string }) {
  const html = useMemo(() => highlightSync(code, lang || "text"), [code, lang]);

  if (html) {
    return (
      <div
        className="shiki-wrapper overflow-x-auto [&_pre]:p-2.5 [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:text-[11px] [&_code]:leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="p-2.5 text-[11px] leading-relaxed text-zinc-400 font-mono whitespace-pre overflow-x-auto">
      {code}
    </pre>
  );
}

function guessExtension(lang: string): string {
  const map: Record<string, string> = {
    typescript: ".ts", ts: ".ts", tsx: ".tsx",
    javascript: ".js", js: ".js", jsx: ".jsx",
    python: ".py", py: ".py",
    rust: ".rs", rs: ".rs",
    go: ".go", golang: ".go",
    sql: ".sql",
    json: ".json", jsonc: ".jsonc",
    yaml: ".yaml", yml: ".yml",
    html: ".html", css: ".css",
    bash: ".sh", sh: ".sh", zsh: ".sh",
    dockerfile: "",
    toml: ".toml",
    java: ".java",
    ruby: ".rb", rb: ".rb",
    swift: ".swift",
    kotlin: ".kt",
    c: ".c", cpp: ".cpp",
  };
  return map[lang.toLowerCase()] || `.${lang}`;
}
