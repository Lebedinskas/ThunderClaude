#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod export;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn generate_game_concept(prompt: &str) -> String {
    // Placeholder for AI logic
    format!("Generating a game concept for: {}", prompt)
}

#[tauri::command]
async fn export_scene(scene_json: String) -> Result<String, String> {
    // Deserialize JSON from frontend to Rust struct
    let scene_state: export::SceneState = serde_json::from_str(&scene_json)
        .map_err(|e| format!("Failed to parse scene: {}", e))?;

    // Generate XML
    let xml_content = export::generate_rbxlx(&scene_state)?;

    Ok(xml_content)
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![greet, generate_game_concept, export_scene])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
