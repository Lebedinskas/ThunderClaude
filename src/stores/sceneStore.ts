// ============================================================================
// DomBlox Scene Store
// Zustand + Immer store that owns the scene graph, selection, transform mode,
// and full undo/redo history.
// ============================================================================

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { v4 as uuid } from "uuid";
import {
  type DomBloxNode,
  type SceneState,
  type HistorySnapshot,
  type Vector3,
  type Color4,
  NodeType,
  TransformMode,
  MAX_HISTORY,
  createDefaultNode,
} from "../types/scene";

// ---------------------------------------------------------------------------
// Action signatures
// ---------------------------------------------------------------------------

interface SceneActions {
  // --- Node CRUD -----------------------------------------------------------
  /** Insert a new node into the scene (returns the new ID) */
  addNode: (
    type: NodeType,
    overrides?: Partial<DomBloxNode>,
    parentId?: string | null,
  ) => string;

  /** Recursively remove a node and all its descendants */
  removeNode: (id: string) => void;

  /** Patch one or more fields on an existing node */
  updateNode: (id: string, patch: Partial<DomBloxNode>) => void;

  // --- Selection -----------------------------------------------------------
  selectNode: (id: string | null) => void;

  // --- Duplication ---------------------------------------------------------
  /** Deep-clone a node (and its subtree), placing the copy as a sibling */
  duplicateNode: (id: string) => string | null;

  // --- Grouping ------------------------------------------------------------
  /** Wrap the given node IDs in a new Model node */
  groupNodes: (ids: string[]) => string | null;

  // --- Transform -----------------------------------------------------------
  setTransformMode: (mode: TransformMode) => void;

  // --- Grid ----------------------------------------------------------------
  setGridSnap: (size: number) => void;

  // --- History -------------------------------------------------------------
  undo: () => void;
  redo: () => void;

  /** Force-push current state onto the undo stack (called internally) */
  _pushHistory: () => void;

  // --- Bulk ----------------------------------------------------------------
  /** Replace the entire node map (used for file load / deserialise) */
  loadScene: (nodes: Map<string, DomBloxNode>) => void;

  /** Wipe everything back to an empty scene */
  clearScene: () => void;
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

function takeSnapshot(state: SceneState): HistorySnapshot {
  // Serialise the Map to a plain record for safe cloning
  const plain: Record<string, DomBloxNode> = {};
  for (const [id, node] of state.nodes) {
    plain[id] = structuredClone(node);
  }
  return {
    nodes: plain,
    selectedNodeId: state.selectedNodeId,
    timestamp: Date.now(),
  };
}

function restoreSnapshot(
  snapshot: HistorySnapshot,
): Pick<SceneState, "nodes" | "selectedNodeId"> {
  const map = new Map<string, DomBloxNode>();
  for (const [id, node] of Object.entries(snapshot.nodes)) {
    map.set(id, structuredClone(node));
  }
  return { nodes: map, selectedNodeId: snapshot.selectedNodeId };
}

// ---------------------------------------------------------------------------
// Deep-clone subtree helper
// ---------------------------------------------------------------------------

/** Recursively clone a node and all descendants, generating fresh IDs */
function cloneSubtree(
  sourceId: string,
  nodes: Map<string, DomBloxNode>,
  newParentId: string | null,
): Map<string, DomBloxNode> {
  const source = nodes.get(sourceId);
  if (!source) return new Map();

  const newId = uuid();
  const cloned: DomBloxNode = {
    ...structuredClone(source),
    id: newId,
    name: `${source.name} (copy)`,
    parent: newParentId,
    children: [],
  };

  const result = new Map<string, DomBloxNode>();
  result.set(newId, cloned);

  for (const childId of source.children) {
    const childClones = cloneSubtree(childId, nodes, newId);
    for (const [cid, cnode] of childClones) {
      result.set(cid, cnode);
      // The first entry in childClones is the direct child
      if (cnode.parent === newId) {
        cloned.children.push(cid);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Recursive removal helper
// ---------------------------------------------------------------------------

function removeSubtree(id: string, nodes: Map<string, DomBloxNode>): void {
  const node = nodes.get(id);
  if (!node) return;

  // Depth-first: remove children first
  for (const childId of [...node.children]) {
    removeSubtree(childId, nodes);
  }
  nodes.delete(id);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSceneStore = create<SceneState & SceneActions>()(
  immer((set, get) => ({
    // ---- Initial state ----------------------------------------------------
    nodes: new Map<string, DomBloxNode>(),
    selectedNodeId: null,
    transformMode: TransformMode.Translate,
    gridSnap: 1,
    history: [],
    future: [],

    // ---- Internal ---------------------------------------------------------
    _pushHistory: () =>
      set((state) => {
        const snap = takeSnapshot(state as SceneState);
        state.history.push(snap);
        if (state.history.length > MAX_HISTORY) {
          state.history.shift();
        }
        // Any mutation after a push invalidates the redo stack
        state.future = [];
      }),

    // ---- Node CRUD --------------------------------------------------------
    addNode: (type, overrides = {}, parentId = null) => {
      const id = uuid();
      const node = createDefaultNode(type, { ...overrides, id, parent: parentId });

      get()._pushHistory();

      set((state) => {
        state.nodes.set(id, node);

        // Wire into parent's children array
        if (parentId) {
          const parent = state.nodes.get(parentId);
          if (parent) {
            parent.children.push(id);
          }
        }

        state.selectedNodeId = id;
      });

      return id;
    },

    removeNode: (id) => {
      const state = get();
      const node = state.nodes.get(id);
      if (!node) return;

      state._pushHistory();

      set((draft) => {
        // Unlink from parent
        if (node.parent) {
          const parent = draft.nodes.get(node.parent);
          if (parent) {
            parent.children = parent.children.filter((cid) => cid !== id);
          }
        }

        removeSubtree(id, draft.nodes);

        // Clear selection if the removed node (or a descendant) was selected
        if (draft.selectedNodeId && !draft.nodes.has(draft.selectedNodeId)) {
          draft.selectedNodeId = null;
        }
      });
    },

    updateNode: (id, patch) => {
      const existing = get().nodes.get(id);
      if (!existing) return;

      get()._pushHistory();

      set((state) => {
        const node = state.nodes.get(id);
        if (!node) return;
        Object.assign(node, patch, { id }); // never overwrite the id
      });
    },

    // ---- Selection --------------------------------------------------------
    selectNode: (id) =>
      set((state) => {
        state.selectedNodeId = id;
      }),

    // ---- Duplicate --------------------------------------------------------
    duplicateNode: (id) => {
      const state = get();
      const source = state.nodes.get(id);
      if (!source) return null;

      state._pushHistory();

      const clones = cloneSubtree(id, state.nodes, source.parent);
      // The first key in the map is the root clone
      const rootCloneId = clones.keys().next().value as string;

      set((draft) => {
        for (const [cid, cnode] of clones) {
          draft.nodes.set(cid, cnode);
        }

        // Insert into parent's children right after the original
        if (source.parent) {
          const parent = draft.nodes.get(source.parent);
          if (parent) {
            const idx = parent.children.indexOf(id);
            parent.children.splice(idx + 1, 0, rootCloneId);
          }
        }

        draft.selectedNodeId = rootCloneId;
      });

      return rootCloneId;
    },

    // ---- Grouping ---------------------------------------------------------
    groupNodes: (ids) => {
      if (ids.length === 0) return null;

      const state = get();

      // Validate all nodes exist
      const validNodes = ids
        .map((id) => state.nodes.get(id))
        .filter((n): n is DomBloxNode => n !== undefined);
      if (validNodes.length === 0) return null;

      state._pushHistory();

      const groupId = uuid();

      // The group becomes a child of the first node's parent
      const commonParent = validNodes[0].parent;

      const groupNode = createDefaultNode(NodeType.Model, {
        id: groupId,
        name: "Model",
        parent: commonParent,
        children: [...ids],
      });

      set((draft) => {
        draft.nodes.set(groupId, groupNode);

        // Re-parent each node into the group
        for (const id of ids) {
          const node = draft.nodes.get(id);
          if (!node) continue;

          // Remove from old parent's children
          if (node.parent) {
            const oldParent = draft.nodes.get(node.parent);
            if (oldParent) {
              oldParent.children = oldParent.children.filter((cid) => cid !== id);
            }
          }
          node.parent = groupId;
        }

        // Insert group into the common parent's children
        if (commonParent) {
          const parent = draft.nodes.get(commonParent);
          if (parent) {
            parent.children.push(groupId);
          }
        }

        draft.selectedNodeId = groupId;
      });

      return groupId;
    },

    // ---- Transform mode ---------------------------------------------------
    setTransformMode: (mode) =>
      set((state) => {
        state.transformMode = mode;
      }),

    // ---- Grid snap --------------------------------------------------------
    setGridSnap: (size) =>
      set((state) => {
        state.gridSnap = Math.max(0, size);
      }),

    // ---- Undo / Redo ------------------------------------------------------
    undo: () =>
      set((state) => {
        if (state.history.length === 0) return;

        // Save current state to future (redo stack)
        const currentSnap = takeSnapshot(state as unknown as SceneState);
        state.future.push(currentSnap);

        // Pop the most recent history entry
        const previous = state.history.pop()!;
        const restored = restoreSnapshot(previous);

        state.nodes = restored.nodes as typeof state.nodes;
        state.selectedNodeId = restored.selectedNodeId;
      }),

    redo: () =>
      set((state) => {
        if (state.future.length === 0) return;

        // Save current state to history
        const currentSnap = takeSnapshot(state as unknown as SceneState);
        state.history.push(currentSnap);

        // Pop the most recent future entry
        const next = state.future.pop()!;
        const restored = restoreSnapshot(next);

        state.nodes = restored.nodes as typeof state.nodes;
        state.selectedNodeId = restored.selectedNodeId;
      }),

    // ---- Bulk operations --------------------------------------------------
    loadScene: (nodes) => {
      get()._pushHistory();
      set((state) => {
        state.nodes = nodes as typeof state.nodes;
        state.selectedNodeId = null;
      });
    },

    clearScene: () => {
      get()._pushHistory();
      set((state) => {
        state.nodes = new Map() as typeof state.nodes;
        state.selectedNodeId = null;
      });
    },
  })),
);

// ---------------------------------------------------------------------------
// Selectors (for performance — avoids re-renders)
// ---------------------------------------------------------------------------

/** Select a single node by ID */
export const selectNode = (id: string) => (state: SceneState) =>
  state.nodes.get(id) ?? null;

/** All root-level nodes (parent === null) */
export const selectRootNodes = (state: SceneState & SceneActions) =>
  [...state.nodes.values()].filter((n) => n.parent === null);

/** The currently-selected node object */
export const selectSelectedNode = (state: SceneState & SceneActions) =>
  state.selectedNodeId ? state.nodes.get(state.selectedNodeId) ?? null : null;

/** Whether undo is available */
export const selectCanUndo = (state: SceneState & SceneActions) =>
  state.history.length > 0;

/** Whether redo is available */
export const selectCanRedo = (state: SceneState & SceneActions) =>
  state.future.length > 0;
