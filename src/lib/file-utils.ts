// ── File attachment types and utilities ───────────────────────────────────────
// Pure functions with no React dependency — shared between MessageInput, FileTree, etc.

export interface Attachment {
  id: string;
  name: string;
  content: string;
  language: string;
}

export const MAX_FILE_SIZE = 50 * 1024; // 50KB

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
  c: "c", cpp: "cpp", h: "c", cs: "csharp", swift: "swift", kt: "kotlin",
  css: "css", scss: "css", html: "html", xml: "xml", svg: "xml",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", txt: "", csv: "", log: "", env: "",
  dockerfile: "dockerfile", makefile: "makefile",
};

export function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] ?? "";
}

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  if (file.type === "application/xml") return true;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return ext in EXT_TO_LANG;
}

export function buildAttachmentPrefix(attachments: Attachment[]): string {
  if (attachments.length === 0) return "";
  return attachments
    .map((a) => {
      const lang = a.language || "text";
      return `[File: ${a.name}]\n\`\`\`${lang}\n${a.content}\n\`\`\``;
    })
    .join("\n\n") + "\n\n";
}

// ── Image attachment types and utilities ──────────────────────────────────────

export interface ImageAttachment {
  id: string;
  name: string;
  dataUrl: string;  // data:image/png;base64,...
  size: number;     // bytes
}

export const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
]);

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export function isImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.has(file.type);
}

/** Extract raw base64 from a data URL (strips "data:image/png;base64," prefix). */
export function extractBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/** Build instruction prefix that tells the CLI AI to read attached image files. */
export function buildImageInstruction(tempPaths: string[]): string {
  if (tempPaths.length === 0) return "";
  const pathList = tempPaths.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
  return `[The user attached ${tempPaths.length} image(s). You MUST use your file reading tool to view each image before responding.\n${pathList}]\n\n`;
}
