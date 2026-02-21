// ============================================================================
// DomBlox Scene Type System
// The core data model for a Roblox-like 3D game editor.
// Every object in the scene tree is a DomBloxNode.
// ============================================================================

/** Primitive 3D vector — used for position, rotation, scale, size */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** RGBA color (0-1 range per channel) */
export interface Color4 {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Every node in the scene tree has exactly one of these types */
export enum NodeType {
  Part = "Part",
  Model = "Model",
  SpawnLocation = "SpawnLocation",
  Script = "Script",
  Folder = "Folder",
  Camera = "Camera",
  Light = "Light",
}

/** Surface / material appearance applied to renderable nodes */
export enum MaterialType {
  Plastic = "Plastic",
  Wood = "Wood",
  Metal = "Metal",
  Glass = "Glass",
  Neon = "Neon",
  Brick = "Brick",
  Concrete = "Concrete",
  Marble = "Marble",
  Sand = "Sand",
  Grass = "Grass",
  Ice = "Ice",
  SmoothPlastic = "SmoothPlastic",
}

/** Active transform gizmo mode in the viewport */
export enum TransformMode {
  Translate = "Translate",
  Rotate = "Rotate",
  Scale = "Scale",
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/** A single node in the DomBlox scene hierarchy */
export interface DomBloxNode {
  /** Globally unique identifier (UUID v4) */
  id: string;

  /** Human-readable display name shown in the explorer panel */
  name: string;

  /** Determines rendering behaviour and available properties */
  type: NodeType;

  // --- Transform -----------------------------------------------------------
  /** World-space position */
  position: Vector3;

  /** Euler rotation in degrees (XYZ order) */
  rotation: Vector3;

  /** Per-axis scale multiplier (default 1,1,1) */
  scale: Vector3;

  /** Base dimensions in studs — only meaningful for Part / SpawnLocation */
  size: Vector3;

  // --- Appearance ----------------------------------------------------------
  /** Surface color */
  color: Color4;

  /** Material / surface finish */
  material: MaterialType;

  // --- Hierarchy -----------------------------------------------------------
  /** Ordered child node IDs */
  children: string[];

  /** Parent node ID — null for root-level nodes */
  parent: string | null;

  // --- Editor state --------------------------------------------------------
  /** Locked nodes cannot be selected or moved in the viewport */
  locked: boolean;

  /** Hidden nodes are not rendered but still exist in the tree */
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Snapshot (for undo/redo)
// ---------------------------------------------------------------------------

/** Serialisable snapshot of the entire node map at a point in time */
export interface HistorySnapshot {
  nodes: Record<string, DomBloxNode>;
  selectedNodeId: string | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Scene state (what the scene store manages)
// ---------------------------------------------------------------------------

export interface SceneState {
  /** All nodes keyed by their ID — the single source of truth */
  nodes: Map<string, DomBloxNode>;

  /** Currently-selected node (null = nothing selected) */
  selectedNodeId: string | null;

  /** Active transform gizmo */
  transformMode: TransformMode;

  /** Snap increment for grid-snapping (studs). 0 = disabled */
  gridSnap: number;

  /** Undo stack — most recent snapshot last */
  history: HistorySnapshot[];

  /** Redo stack — populated when the user undoes */
  future: HistorySnapshot[];
}

// ---------------------------------------------------------------------------
// Helpers / Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_VECTOR3: Vector3 = { x: 0, y: 0, z: 0 };
export const DEFAULT_SCALE: Vector3 = { x: 1, y: 1, z: 1 };
export const DEFAULT_SIZE: Vector3 = { x: 4, y: 1, z: 2 };

export const DEFAULT_COLOR: Color4 = {
  r: 0.639, // Roblox "Medium stone grey" feel
  g: 0.635,
  b: 0.647,
  a: 1,
};

export const WHITE: Color4 = { r: 1, g: 1, b: 1, a: 1 };

/** Maximum number of undo steps retained */
export const MAX_HISTORY = 50;

/** Factory: create a blank node with sensible defaults */
export function createDefaultNode(
  type: NodeType,
  overrides: Partial<DomBloxNode> = {},
): DomBloxNode {
  return {
    id: "", // caller must assign a uuid
    name: type, // e.g. "Part"
    type,
    position: { ...DEFAULT_VECTOR3 },
    rotation: { ...DEFAULT_VECTOR3 },
    scale: { ...DEFAULT_SCALE },
    size: { ...DEFAULT_SIZE },
    color: { ...DEFAULT_COLOR },
    material: MaterialType.SmoothPlastic,
    children: [],
    parent: null,
    locked: false,
    visible: true,
    ...overrides,
  };
}
