import { createHighlighter, type Highlighter } from "shiki";

// Singleton — created once, reused for all code blocks.
// First call is async (loads WASM + grammars), subsequent calls are instant.
let instance: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;

const THEME = "github-dark-default";

// Pre-load the most common programming languages.
// Shiki loads additional languages on-demand if needed.
const PRELOAD_LANGS = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "python",
  "go",
  "rust",
  "json",
  "bash",
  "html",
  "css",
  "sql",
  "yaml",
  "markdown",
  "toml",
  "dockerfile",
  "c",
  "cpp",
  "java",
  "ruby",
  "swift",
  "kotlin",
];

export async function getHighlighter(): Promise<Highlighter> {
  if (instance) return instance;
  if (!loading) {
    loading = createHighlighter({
      themes: [THEME],
      langs: PRELOAD_LANGS,
    }).then((h) => {
      instance = h;
      return h;
    });
  }
  return loading;
}

/**
 * Highlight code synchronously if the highlighter is ready.
 * Returns HTML string or null if still loading.
 */
export function highlightSync(code: string, lang: string): string | null {
  if (!instance) return null;
  try {
    const loadedLangs = instance.getLoadedLanguages();
    const resolvedLang = loadedLangs.includes(lang) ? lang : "text";
    return instance.codeToHtml(code, { lang: resolvedLang, theme: THEME });
  } catch {
    return null;
  }
}

/**
 * Highlight code (async — waits for highlighter if needed).
 * Returns HTML string.
 */
export async function highlight(code: string, lang: string): Promise<string> {
  const h = await getHighlighter();
  try {
    const loadedLangs = h.getLoadedLanguages();
    const resolvedLang = loadedLangs.includes(lang) ? lang : "text";
    return h.codeToHtml(code, { lang: resolvedLang, theme: THEME });
  } catch {
    return "";
  }
}

// Pre-warm on module load — starts the WASM fetch immediately
getHighlighter();
