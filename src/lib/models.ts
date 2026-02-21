// ── Model definitions ────────────────────────────────────────────────────────
// Pure data — types, constants, helpers. No React dependency.

export type ClaudeModel =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-sonnet-4-5-20250929"
  | "claude-haiku-4-5-20251001";

export type GeminiModel =
  | "gemini-3.1-pro-preview"
  | "gemini-3-pro-preview"
  | "gemini-3-flash-preview"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash";

export type AIModel = ClaudeModel | GeminiModel;

export const MODEL_LABELS: Record<AIModel, string> = {
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-sonnet-4-5-20250929": "Sonnet 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "gemini-3-pro-preview": "Gemini 3 Pro",
  "gemini-3-flash-preview": "Gemini 3 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
};

export const ALL_MODELS: AIModel[] = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
  "gemini-3.1-pro-preview",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

/** Group labels for model selector sections */
export const MODEL_GROUPS: { label: string; models: AIModel[] }[] = [
  {
    label: "Claude",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
  },
  {
    label: "Gemini",
    models: ["gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
  },
];

export function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

export function getEngine(model: string): "claude" | "gemini" {
  return isGeminiModel(model) ? "gemini" : "claude";
}

export type OrchestrationMode = "direct" | "commander" | "researcher" | "auto";

// ── Permission modes (Claude CLI --permission-mode) ─────────────────────────

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: "Default",
  acceptEdits: "Auto-Edit",
  bypassPermissions: "Autonomous",
};
