# DomBlox Studio

A next-generation game creation studio, inspired by Roblox Studio but built with modern web technologies (React, Three.js, Tauri).

## Project Structure

This project was created inside the `ThunderClaude` workspace to ensure safety and persistence.

- **Frontend:** React + Vite + TailwindCSS
- **3D Engine:** Three.js (@react-three/fiber)
- **Backend:** Rust (Tauri)

## How to Run

1.  Navigate to this directory:
    ```bash
    cd dom-blox
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Run the development server (Desktop App):
    ```bash
    npm run tauri dev
    ```

## Features Implemented

- **3D Viewport:** Interactive scene with camera controls (OrbitControls).
- **Toolbox:** Drag-and-drop assets (placeholder UI).
- **Properties Panel:** Inspect and modify object properties.
- **AI Integration:** Placeholder for "Generate Game Concept" command.
