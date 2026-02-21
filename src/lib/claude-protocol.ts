// NDJSON message types from Claude CLI --output-format stream-json

export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ContentBlockToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlockText[];
}

export type ContentBlock =
  | ContentBlockText
  | ContentBlockToolUse
  | ContentBlockToolResult;

export interface SystemInitMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  tools?: { name: string; description: string }[];
}

export interface AssistantMessage {
  type: "assistant";
  uuid?: string;
  session_id?: string;
  message: {
    role: "assistant";
    content: ContentBlock[];
  };
}

export interface UserMessage {
  type: "user";
  session_id?: string;
  message: {
    role: "user";
    content: ContentBlock[];
  };
}

export interface StreamEvent {
  type: "stream_event";
  event: {
    type: string;
    index?: number;
    delta?: {
      type: string;
      text?: string;
    };
  };
}

export interface ResultMessage {
  type: "result";
  subtype: "success" | "error_max_turns" | "error_tool";
  result: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
}

export type ClaudeMessage =
  | SystemInitMessage
  | AssistantMessage
  | UserMessage
  | StreamEvent
  | ResultMessage;

export function parseClaudeMessage(line: string): ClaudeMessage | null {
  try {
    return JSON.parse(line) as ClaudeMessage;
  } catch {
    return null;
  }
}

// ── Gemini CLI stream-json message types ─────────────────────────────────────

export interface GeminiInitMessage {
  type: "init";
  session_id: string;
  model: string;
  timestamp: string;
}

export interface GeminiTextMessage {
  type: "message";
  role: "assistant" | "user";
  content: string;
  delta?: boolean;
  timestamp: string;
}

export interface GeminiToolUseMessage {
  type: "tool_use";
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
  timestamp: string;
}

export interface GeminiToolResultMessage {
  type: "tool_result";
  tool_id: string;
  status: "success" | "error";
  output?: string;
  error?: { type: string; message: string };
  timestamp: string;
}

export interface GeminiResultMessage {
  type: "result";
  status: "success" | "error";
  stats: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cached?: number;
    duration_ms: number;
    tool_calls: number;
  };
  timestamp: string;
}

export type GeminiMessage =
  | GeminiInitMessage
  | GeminiTextMessage
  | GeminiToolUseMessage
  | GeminiToolResultMessage
  | GeminiResultMessage;

export function parseGeminiMessage(line: string): GeminiMessage | null {
  try {
    return JSON.parse(line) as GeminiMessage;
  } catch {
    return null;
  }
}

// ── Display types (shared by both engines) ───────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallInfo[];
  timestamp: number;
  isStreaming?: boolean;
  cost?: number;
  duration?: number;
  numTurns?: number;
  /** Token stats from Gemini (no dollar cost, but token counts) */
  tokens?: { input: number; output: number; total: number };
  /** Parent message ID for conversation branching (undefined = root message). */
  parentId?: string;
  /** Image attachments — stored as data URLs for conversation history display. */
  images?: { name: string; dataUrl: string }[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isRunning: boolean;
}
