import { invoke } from "@tauri-apps/api/core";

// ── Project context scanner ──────────────────────────────────────────────────
// Scans the working directory on startup to provide the AI with immediate
// project awareness. Injected into the system prompt alongside memory/goals.

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension: string;
}

export interface ProjectContext {
  /** Absolute path to the project root */
  rootPath: string;
  /** Short display name (directory basename) */
  name: string;
  /** Detected project type (e.g., "Node.js", "Rust", "Python") */
  type: string;
  /** Key metadata from manifest files (dependencies, scripts, etc.) */
  manifest: string | null;
  /** Compact file tree (top-level + key subdirectories) */
  fileTree: string;
  /** Contents of README.md or CLAUDE.md (first found, truncated) */
  readme: string | null;
  /** Git branch if available */
  gitBranch: string | null;
}

// ── Project type detection ───────────────────────────────────────────────────

interface ProjectSignature {
  file: string;
  type: string;
  /** Extract key info from the manifest file */
  extractManifest?: (content: string) => string;
}

const PROJECT_SIGNATURES: ProjectSignature[] = [
  {
    file: "package.json",
    type: "Node.js",
    extractManifest: (content) => {
      try {
        const pkg = JSON.parse(content);
        const parts: string[] = [];
        if (pkg.name) parts.push(`name: ${pkg.name}`);
        if (pkg.description) parts.push(`description: ${pkg.description}`);
        const deps = Object.keys(pkg.dependencies || {});
        if (deps.length > 0) parts.push(`dependencies: ${deps.slice(0, 15).join(", ")}${deps.length > 15 ? ` (+${deps.length - 15} more)` : ""}`);
        const devDeps = Object.keys(pkg.devDependencies || {});
        if (devDeps.length > 0) parts.push(`devDependencies: ${devDeps.slice(0, 10).join(", ")}${devDeps.length > 10 ? ` (+${devDeps.length - 10} more)` : ""}`);
        const scripts = Object.keys(pkg.scripts || {});
        if (scripts.length > 0) parts.push(`scripts: ${scripts.join(", ")}`);
        return parts.join("\n");
      } catch { return ""; }
    },
  },
  {
    file: "Cargo.toml",
    type: "Rust",
    extractManifest: (content) => {
      const lines: string[] = [];
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) lines.push(`name: ${nameMatch[1]}`);
      const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
      if (descMatch) lines.push(`description: ${descMatch[1]}`);
      // Extract [dependencies] section keys
      const depsSection = content.match(/\[dependencies\]([\s\S]*?)(?=\n\[|$)/);
      if (depsSection) {
        const deps = depsSection[1].match(/^(\w[\w-]*)\s*=/gm);
        if (deps) lines.push(`dependencies: ${deps.map(d => d.replace(/\s*=.*/, "")).join(", ")}`);
      }
      return lines.join("\n");
    },
  },
  {
    file: "pyproject.toml",
    type: "Python",
    extractManifest: (content) => {
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      return nameMatch ? `name: ${nameMatch[1]}` : "";
    },
  },
  { file: "requirements.txt", type: "Python" },
  { file: "go.mod", type: "Go" },
  { file: "pom.xml", type: "Java (Maven)" },
  { file: "build.gradle", type: "Java (Gradle)" },
  { file: "composer.json", type: "PHP" },
  { file: "Gemfile", type: "Ruby" },
  { file: "pubspec.yaml", type: "Flutter/Dart" },
  { file: ".csproj", type: "C#/.NET" },
];

// Directories to skip in the file tree
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".cache", "target", ".turbo", ".vercel", ".svelte-kit", "coverage",
  ".tauri", ".vscode", ".idea", "vendor", ".gradle", ".dart_tool",
  ".pub-cache", ".flutter-plugins",
]);

// ── File tree generation ─────────────────────────────────────────────────────

function buildFileTree(entries: DirEntry[], depth: number, prefix: string): string {
  const lines: string[] = [];
  // Limit entries per level to keep compact
  const maxEntries = depth === 0 ? 30 : 15;
  const shown = entries.slice(0, maxEntries);
  const remaining = entries.length - shown.length;

  for (let i = 0; i < shown.length; i++) {
    const entry = shown[i];
    const isLast = i === shown.length - 1 && remaining === 0;
    const connector = isLast ? "└── " : "├── ";
    const suffix = entry.is_dir ? "/" : "";
    lines.push(`${prefix}${connector}${entry.name}${suffix}`);
  }

  if (remaining > 0) {
    lines.push(`${prefix}└── ... +${remaining} more`);
  }

  return lines.join("\n");
}

// ── Main scanner ─────────────────────────────────────────────────────────────

export async function scanProjectContext(): Promise<ProjectContext | null> {
  let rootPath: string;
  try {
    rootPath = await invoke<string>("get_working_directory");
  } catch {
    return null;
  }

  const name = rootPath.split(/[/\\]/).pop() || rootPath;

  // List top-level directory
  let topLevel: DirEntry[];
  try {
    topLevel = await invoke<DirEntry[]>("list_directory", { path: rootPath });
  } catch {
    return null;
  }

  // Skip if this looks like a home directory or system root (too many entries, no project files)
  if (topLevel.length > 100) return null;

  // ── Detect project type ──────────────────────────────────────────────────
  const topFiles = new Set(topLevel.filter(e => !e.is_dir).map(e => e.name));
  let projectType = "Unknown";
  let manifest: string | null = null;

  for (const sig of PROJECT_SIGNATURES) {
    if (topFiles.has(sig.file)) {
      projectType = sig.type;
      if (sig.extractManifest) {
        try {
          const content = await invoke<string>("read_file_content", {
            path: `${rootPath}/${sig.file}`.replace(/\\/g, "/"),
          });
          manifest = sig.extractManifest(content) || null;
        } catch { /* manifest extraction is optional */ }
      }
      break;
    }
  }

  // Refine type based on additional signals
  if (projectType === "Node.js") {
    if (topFiles.has("tsconfig.json")) projectType = "TypeScript";
    if (topLevel.some(e => e.name === "src-tauri")) projectType = "Tauri (Rust + TypeScript)";
    if (topFiles.has("next.config.js") || topFiles.has("next.config.ts") || topFiles.has("next.config.mjs")) projectType = "Next.js";
    if (topFiles.has("vite.config.ts") || topFiles.has("vite.config.js")) {
      if (projectType === "TypeScript") projectType = "Vite + TypeScript";
    }
  }

  // ── Build compact file tree ──────────────────────────────────────────────
  // Top level + 1 level deep for key directories (src, lib, app, etc.)
  const keyDirs = ["src", "lib", "app", "pages", "components", "supabase", "api", "tests", "test"];
  const filteredTop = topLevel.filter(e => !IGNORED_DIRS.has(e.name));

  let tree = buildFileTree(filteredTop, 0, "");

  // Expand key subdirectories one level
  for (const entry of filteredTop) {
    if (!entry.is_dir || !keyDirs.includes(entry.name)) continue;
    try {
      const subEntries = await invoke<DirEntry[]>("list_directory", { path: entry.path });
      const filtered = subEntries.filter(e => !IGNORED_DIRS.has(e.name));
      if (filtered.length > 0) {
        const subTree = buildFileTree(filtered, 1, "│   ");
        // Insert sub-tree after the parent directory line
        const parentLine = tree.split("\n").findIndex(l => l.includes(`${entry.name}/`));
        if (parentLine >= 0) {
          const lines = tree.split("\n");
          lines.splice(parentLine + 1, 0, subTree);
          tree = lines.join("\n");
        }
      }
    } catch { /* directory listing failed — skip */ }
  }

  // ── Read README or CLAUDE.md ─────────────────────────────────────────────
  let readme: string | null = null;
  for (const readmeFile of ["CLAUDE.md", "README.md", "readme.md"]) {
    if (!topFiles.has(readmeFile)) continue;
    try {
      const content = await invoke<string>("read_file_content", {
        path: `${rootPath}/${readmeFile}`.replace(/\\/g, "/"),
      });
      // Truncate to keep system prompt reasonable
      const maxChars = 2000;
      readme = content.length > maxChars
        ? content.slice(0, maxChars) + "\n... [truncated]"
        : content;
      break;
    } catch { /* optional */ }
  }

  // ── Detect git branch ────────────────────────────────────────────────────
  let gitBranch: string | null = null;
  if (topLevel.some(e => e.name === ".git" && e.is_dir)) {
    try {
      const headContent = await invoke<string>("read_file_content", {
        path: `${rootPath}/.git/HEAD`.replace(/\\/g, "/"),
      });
      const match = headContent.match(/ref: refs\/heads\/(.+)/);
      if (match) gitBranch = match[1].trim();
    } catch { /* optional */ }
  }

  return { rootPath, name, type: projectType, manifest, fileTree: tree, readme, gitBranch };
}

// ── System prompt builder ────────────────────────────────────────────────────

export function buildProjectPrompt(ctx: ProjectContext): string {
  const parts: string[] = [];

  parts.push(`## Project Context`);
  parts.push(`You are working in: **${ctx.name}** (${ctx.type})`);
  parts.push(`Path: ${ctx.rootPath.replace(/\\/g, "/")}`);
  if (ctx.gitBranch) parts.push(`Branch: ${ctx.gitBranch}`);

  if (ctx.manifest) {
    parts.push(`\n### Manifest\n${ctx.manifest}`);
  }

  parts.push(`\n### File Structure\n\`\`\`\n${ctx.fileTree}\n\`\`\``);

  if (ctx.readme) {
    parts.push(`\n### Project README\n${ctx.readme}`);
  }

  return parts.join("\n");
}
