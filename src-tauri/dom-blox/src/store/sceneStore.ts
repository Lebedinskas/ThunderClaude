import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { temporal } from 'zundo';

export type NodeType = 'Part' | 'Model' | 'Script' | 'Folder' | 'MeshPart';

export interface SceneNode {
  id: string;
// ... (SceneNode interface remains the same, I will keep it to ensure context match if I replace simpler block)
  name: string;
  type: NodeType;
  properties: {
    position: [number, number, number];
    rotation: [number, number, number];
    size: [number, number, number];
    color: string;
    anchored: boolean;
    transparency: number;
    material: 'Plastic' | 'Neon' | 'Wood' | 'Metal';
    shape: 'Box' | 'Sphere' | 'Cylinder';
    meshPath?: string; // Local path or asset URL
    source?: string; // Lua source code
    // Environment
    timeOfDay?: number;
    ambientColor?: string;
    sunBrightness?: number;
    fogDensity?: number;
    fogColor?: string;
    [key: string]: any;
  };
  children: string[]; // IDs of children
  parentId: string | null;
}

interface SceneState {
  nodes: Record<string, SceneNode>;
  rootId: string;
  selectedId: string | null;
  editingId: string | null;
  isPlaying: boolean;
  transformMode: 'translate' | 'rotate' | 'scale';
  
  addNode: (type: NodeType, parentId?: string, extraProps?: any) => void;
  selectNode: (id: string | null) => void;
  setEditingId: (id: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  updateNode: (id: string, updates: Partial<SceneNode['properties']>) => void;
  removeNode: (id: string) => void;
  loadProject: (state: { nodes: Record<string, SceneNode>, rootId: string }) => void;
}

export const useSceneStore = create<SceneState>()(
  temporal(
    (set, get) => ({
      nodes: {
        'workspace': {
          id: 'workspace',
          name: 'Workspace',
          type: 'Folder',
          properties: { 
              position: [0, 0, 0], 
              rotation: [0, 0, 0], 
              size: [0, 0, 0], 
              color: '#ffffff', 
              anchored: true, 
              transparency: 0, 
              material: 'Plastic',
              shape: 'Box',
              // Environment Properties
              timeOfDay: 12, // 0-24
              ambientColor: '#222222',
              sunBrightness: 1.5,
              fogDensity: 0.02,
              fogColor: '#111111'
          },
          children: [],
          parentId: null
        }
      },
      rootId: 'workspace',
      selectedId: null,
      editingId: null,
      isPlaying: false,
      transformMode: 'translate',

      loadProject: (loadedState) => set({
          nodes: loadedState.nodes,
          rootId: loadedState.rootId,
          selectedId: null,
          editingId: null,
          isPlaying: false,
          transformMode: 'translate'
      }),

      setEditingId: (id) => set({ editingId: id }),
      setIsPlaying: (playing) => set({ isPlaying: playing }),
      setTransformMode: (mode) => set({ transformMode: mode }),

      addNode: (type, parentId = 'workspace', extraProps = {}) => {
        const id = uuidv4();
        const isMesh = type === 'MeshPart';
        const newNode: SceneNode = {
          id,
          name: isMesh ? 'MeshPart' : type,
          type,
          properties: {
            position: [0, 1, 0],
            rotation: [0, 0, 0],
            size: [1, 1, 1],
            color: type === 'Script' ? '#000000' : '#4ade80',
            anchored: true,
            transparency: 0,
            material: 'Plastic',
            shape: 'Box',
            source: type === 'Script' ? '-- Welcome to DomBlox Scripting!\nprint("Hello World!")' : undefined,
            ...extraProps
          },
          children: [],
          parentId,
        };

        set((state) => {
          const parent = state.nodes[parentId];
          if (!parent) return state;

          return {
            nodes: {
              ...state.nodes,
              [id]: newNode,
              [parentId]: {
                ...parent,
                children: [...parent.children, id]
              }
            },
            selectedId: id // Auto-select new node
          };
        });
      },

      selectNode: (id) => set({ selectedId: id }),

      updateNode: (id, updates) => set((state) => ({
        nodes: {
          ...state.nodes,
          [id]: {
            ...state.nodes[id],
            properties: { ...state.nodes[id].properties, ...updates }
          }
        }
      })),

      removeNode: (id) => set((state) => {
        const node = state.nodes[id];
        if (!node || !node.parentId) return state; // Can't delete root

        const parent = state.nodes[node.parentId];
        const { [id]: deleted, ...remainingNodes } = state.nodes;

        return {
          nodes: {
            ...remainingNodes,
            [node.parentId]: {
              ...parent,
              children: parent.children.filter(childId => childId !== id)
            }
          },
          selectedId: null
        };
      }),
    }),
    {
      partialize: (state) => ({ nodes: state.nodes }), // Only track nodes history
      equality: (a, b) => JSON.stringify(a) === JSON.stringify(b) // Simple deep check
    }
  )
);
