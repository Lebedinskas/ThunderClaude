use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// Global registry of running query processes, keyed by query_id.
pub type ProcessRegistry = Arc<Mutex<HashMap<String, Child>>>;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QueryConfig {
    pub message: String,
    pub model: Option<String>,
    pub mcp_config: Option<String>,
    pub system_prompt: Option<String>,
    pub session_id: Option<String>,
    pub resume: bool,
    /// "claude" or "gemini" — determines which CLI to spawn
    pub engine: Option<String>,
    /// Limit agentic turns (1 = single response, no tool loops)
    pub max_turns: Option<u32>,
    /// Control built-in tool availability.
    /// None = default (all tools), Some("") = disable all, Some("Bash,Read") = specific tools only.
    pub tools: Option<String>,
    /// When true, ignore user's default MCP config — only use servers from mcp_config field.
    /// Combined with tools="" this creates a "pure reasoning" mode with zero tool access.
    #[serde(default)]
    pub strict_mcp: bool,
    /// Claude CLI --permission-mode flag. Controls tool approval behavior.
    /// None = CLI default, Some("acceptEdits") = auto-approve edits,
    /// Some("bypassPermissions") = auto-approve everything (autonomous mode).
    pub permission_mode: Option<String>,
    /// Working directory for the CLI process. Set by send_query from the active project root.
    #[serde(default)]
    pub cwd: Option<String>,
}

/// Get the user's home directory (cross-platform).
fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default()
}

/// Find the Claude CLI binary (cross-platform).
fn find_claude_binary() -> String {
    let home = home_dir();

    // ── Windows ────────────────────────────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        // 1. VS Code extension (direct .exe — no cmd wrapper needed)
        let vscode_ext = format!("{}\\.vscode\\extensions", home);
        if let Ok(entries) = std::fs::read_dir(&vscode_ext) {
            let mut best: Option<std::path::PathBuf> = None;
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("anthropic.claude-code-") && name.contains("win32") {
                    let bin = entry
                        .path()
                        .join("resources")
                        .join("native-binary")
                        .join("claude.exe");
                    if bin.exists() {
                        best = Some(bin);
                    }
                }
            }
            if let Some(bin) = best {
                return bin.to_string_lossy().to_string();
            }
        }

        // 2. npm global install (.cmd wrapper)
        let npm_path = format!("{}\\AppData\\Roaming\\npm\\claude.cmd", home);
        if std::path::Path::new(&npm_path).exists() {
            return npm_path;
        }
    }

    // ── macOS ──────────────────────────────────────────────────────────────
    #[cfg(target_os = "macos")]
    {
        // 1. VS Code extension
        let vscode_ext = format!("{}/.vscode/extensions", home);
        if let Ok(entries) = std::fs::read_dir(&vscode_ext) {
            let mut best: Option<std::path::PathBuf> = None;
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("anthropic.claude-code-") && name.contains("darwin") {
                    let bin = entry
                        .path()
                        .join("resources")
                        .join("native-binary")
                        .join("claude");
                    if bin.exists() {
                        best = Some(bin);
                    }
                }
            }
            if let Some(bin) = best {
                return bin.to_string_lossy().to_string();
            }
        }

        // 2. Standalone install
        let standalone = format!("{}/.claude/local/claude", home);
        if std::path::Path::new(&standalone).exists() {
            return standalone;
        }

        // 3. Homebrew
        for brew_path in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] {
            if std::path::Path::new(brew_path).exists() {
                return brew_path.to_string();
            }
        }

        // 4. npm global
        let npm_path = format!("{}/.npm-global/bin/claude", home);
        if std::path::Path::new(&npm_path).exists() {
            return npm_path;
        }
    }

    // ── Linux ──────────────────────────────────────────────────────────────
    #[cfg(target_os = "linux")]
    {
        // 1. VS Code extension
        let vscode_ext = format!("{}/.vscode/extensions", home);
        if let Ok(entries) = std::fs::read_dir(&vscode_ext) {
            let mut best: Option<std::path::PathBuf> = None;
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("anthropic.claude-code-") && name.contains("linux") {
                    let bin = entry
                        .path()
                        .join("resources")
                        .join("native-binary")
                        .join("claude");
                    if bin.exists() {
                        best = Some(bin);
                    }
                }
            }
            if let Some(bin) = best {
                return bin.to_string_lossy().to_string();
            }
        }

        // 2. Standalone
        let standalone = format!("{}/.claude/local/claude", home);
        if std::path::Path::new(&standalone).exists() {
            return standalone;
        }

        // 3. Common paths
        for path in ["/usr/local/bin/claude", "/usr/bin/claude"] {
            if std::path::Path::new(path).exists() {
                return path.to_string();
            }
        }

        // 4. npm global
        let npm_path = format!("{}/.npm-global/bin/claude", home);
        if std::path::Path::new(&npm_path).exists() {
            return npm_path;
        }
    }

    // Final fallback: hope it's in PATH
    "claude".to_string()
}

/// Public wrapper so lib.rs can reuse the same discovery for `check_claude`.
pub fn check_claude_available() -> String {
    find_claude_binary()
}

/// Find the Gemini CLI binary (cross-platform).
/// Returns (executable, pre_args) — either node + script path, or wrapper/fallback.
fn find_gemini_binary() -> (String, Vec<String>) {
    let home = home_dir();

    // ── Windows: prefer node.exe + script directly (bypasses .cmd issues with CREATE_NO_WINDOW)
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "{}\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js",
            home
        );
        if std::path::Path::new(&script).exists() {
            let node_npm = format!("{}\\AppData\\Roaming\\npm\\node.exe", home);
            if std::path::Path::new(&node_npm).exists() {
                return (node_npm, vec![script]);
            }
            let node_pf = r"C:\Program Files\nodejs\node.exe".to_string();
            if std::path::Path::new(&node_pf).exists() {
                return (node_pf, vec![script]);
            }
            return ("node".to_string(), vec![script]);
        }

        let npm_path = format!("{}\\AppData\\Roaming\\npm\\gemini.cmd", home);
        if std::path::Path::new(&npm_path).exists() {
            return (npm_path, vec![]);
        }
    }

    // ── macOS / Linux: check common node_modules and PATH
    #[cfg(not(target_os = "windows"))]
    {
        // npm global node_modules
        let npm_global = format!(
            "{}/.npm-global/lib/node_modules/@google/gemini-cli/dist/index.js",
            home
        );
        if std::path::Path::new(&npm_global).exists() {
            return ("node".to_string(), vec![npm_global]);
        }

        // Standard npm prefix
        let usr_lib = "/usr/local/lib/node_modules/@google/gemini-cli/dist/index.js";
        if std::path::Path::new(usr_lib).exists() {
            return ("node".to_string(), vec![usr_lib.to_string()]);
        }

        // npm global bin
        let npm_bin = format!("{}/.npm-global/bin/gemini", home);
        if std::path::Path::new(&npm_bin).exists() {
            return (npm_bin, vec![]);
        }

        // Homebrew (macOS)
        #[cfg(target_os = "macos")]
        for brew_path in ["/opt/homebrew/bin/gemini", "/usr/local/bin/gemini"] {
            if std::path::Path::new(brew_path).exists() {
                return (brew_path.to_string(), vec![]);
            }
        }
    }

    // Final fallback
    ("gemini".to_string(), vec![])
}

/// Run a query using either Claude or Gemini CLI and stream output as events
pub async fn run_query(app: &AppHandle, query_id: &str, config: QueryConfig, registry: ProcessRegistry) -> Result<String, String> {
    let engine = config.engine.as_deref().unwrap_or("claude");
    let is_gemini = engine == "gemini";

    let (binary, pre_args) = if is_gemini {
        find_gemini_binary()
    } else {
        (find_claude_binary(), vec![])
    };

    let is_cmd = binary.ends_with(".cmd");
    let mut cmd = if is_cmd {
        let mut c = Command::new("cmd.exe");
        c.arg("/c").arg(&binary);
        for arg in &pre_args {
            c.arg(arg);
        }
        c
    } else {
        let mut c = Command::new(&binary);
        for arg in &pre_args {
            c.arg(arg);
        }
        c
    };

    if is_gemini {
        // Gemini CLI: --prompt <message> --output-format stream-json --model <m> --yolo
        // Prepend system prompt to message if provided
        let full_message = if let Some(ref sp) = config.system_prompt {
            format!("[System Instructions]\n{}\n\n[User Message]\n{}", sp, config.message)
        } else {
            config.message.clone()
        };

        cmd.arg("--prompt").arg(&full_message)
            .arg("--output-format").arg("stream-json")
            .arg("--yolo");

        if let Some(ref model) = config.model {
            cmd.arg("--model").arg(model);
        }
        if let Some(ref sid) = config.session_id {
            if config.resume {
                cmd.arg("--resume").arg(sid);
            }
        }
    } else {
        // Claude CLI: -p --verbose --output-format stream-json --model <m> <message>
        cmd.arg("-p")
            .arg("--verbose")
            .arg("--output-format")
            .arg("stream-json");

        if let Some(ref model) = config.model {
            cmd.arg("--model").arg(model);
        }
        if let Some(ref mcp) = config.mcp_config {
            cmd.arg("--mcp-config").arg(mcp);
        }
        if let Some(ref prompt) = config.system_prompt {
            cmd.arg("--system-prompt").arg(prompt);
        }
        if let Some(turns) = config.max_turns {
            cmd.arg("--max-turns").arg(turns.to_string());
        }
        // Tool control: --tools "" disables all built-in tools (Read, Write, Bash, etc.)
        if let Some(ref tools) = config.tools {
            cmd.arg("--tools").arg(tools);
        }
        // Strict MCP: ignore user's default MCP servers, only use explicit --mcp-config
        if config.strict_mcp {
            cmd.arg("--strict-mcp-config");
        }
        // Permission mode: controls tool approval behavior (default/acceptEdits/bypassPermissions)
        if let Some(ref mode) = config.permission_mode {
            cmd.arg("--permission-mode").arg(mode);
        }
        if let Some(ref sid) = config.session_id {
            if config.resume {
                cmd.arg("-r").arg(sid);
            }
        }

        // Claude: user message goes last as positional arg.
        // Long messages are piped via stdin instead (Windows cmd.exe limit: ~8191 chars).
        if config.message.len() <= 6000 {
            cmd.arg(&config.message);
        }
    }

    // Set working directory to the active project root (if available)
    if let Some(ref cwd) = config.cwd {
        cmd.current_dir(cwd);
    }

    // For long Claude messages, pipe via stdin instead of command-line args.
    // Claude CLI `-p` reads from stdin when no positional message arg is provided.
    let pipe_stdin = !is_gemini && config.message.len() > 6000;

    // Strip env vars that prevent Claude from running inside another Claude session
    cmd.env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_ENTRY_POINT")
        .stdin(if pipe_stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    // kill_on_drop ensures child is killed if the future is dropped (e.g. cancel)
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {} (binary: {})", engine, e, binary))?;

    // Pipe long messages via stdin (Claude CLI reads from stdin in -p mode when no positional arg)
    if pipe_stdin {
        if let Some(mut stdin_handle) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let msg_bytes = config.message.as_bytes().to_vec();
            tokio::spawn(async move {
                let _ = stdin_handle.write_all(&msg_bytes).await;
                // Drop closes stdin → EOF → CLI processes the message
            });
        }
    }

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    // Register the process so it can be cancelled via cancel_query
    registry.lock().await.insert(query_id.to_string(), child);

    let query_id_owned = query_id.to_string();
    let engine_name = engine.to_string();
    let app_stdout = app.clone();

    // Stream stdout → events
    let stdout_handle = tokio::spawn({
        let qid = query_id_owned.clone();
        let eng = engine_name.clone();
        async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut last_session_id: Option<String> = None;

            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                // Try to extract session_id from any JSON message
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(sid) = val.get("session_id").and_then(|v| v.as_str()) {
                        if !sid.is_empty() {
                            last_session_id = Some(sid.to_string());
                        }
                    }
                }
                let _ = app_stdout.emit(
                    "claude-message",
                    serde_json::json!({ "queryId": qid, "data": line, "engine": eng }),
                );
            }
            last_session_id
        }
    });

    // Stream stderr → events
    let app_stderr = app.clone();
    let qid_err = query_id_owned.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                let _ = app_stderr.emit(
                    "claude-error",
                    serde_json::json!({ "queryId": qid_err, "data": line }),
                );
            }
        }
    });

    // Wait for stdout/stderr streams to finish (process exit closes the pipes)
    let session_id = stdout_handle.await.unwrap_or(None);

    // Retrieve the child from registry and wait for it (may already be exited)
    let status = {
        let mut reg = registry.lock().await;
        if let Some(mut child) = reg.remove(&query_id_owned) {
            child.wait().await.ok()
        } else {
            // Process was cancelled/removed — treat as killed
            None
        }
    };

    let raw_exit = status.and_then(|s| s.code()).unwrap_or(-1);

    // Gemini CLI has a known libuv assertion crash on Windows that causes non-zero
    // exit even when output is complete. Treat it as success if we got a session_id.
    let exit_code = if is_gemini && raw_exit != 0 && session_id.is_some() {
        0 // Output was received successfully despite process crash
    } else {
        raw_exit
    };

    // Emit completion event
    let _ = app.emit(
        "claude-done",
        serde_json::json!({
            "queryId": query_id_owned,
            "exitCode": exit_code,
            "sessionId": session_id,
        }),
    );

    Ok(session_id.unwrap_or_default())
}
