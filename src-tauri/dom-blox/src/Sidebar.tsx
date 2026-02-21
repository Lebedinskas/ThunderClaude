import React from 'react';
import { useSceneStore, NodeType } from './store/sceneStore';
import { Plus, Trash2, Folder, FileCode, Box, Cuboid } from 'lucide-react';

interface SidebarProps {
  position: 'left' | 'right';
}

const IconMap = {
  Part: Box,
  Model: Folder,
  Script: FileCode,
  Folder: Folder,
  MeshPart: Cuboid,
};

export const Sidebar = ({ position }: SidebarProps) => {
  const { nodes, rootId, selectedId, addNode, selectNode, updateNode, removeNode, setEditingId } = useSceneStore();

  const renderTree = (nodeId: string, depth = 0) => {
    const node = nodes[nodeId];
    if (!node) return null;

    const Icon = IconMap[node.type] || Folder;
    const isSelected = selectedId === nodeId;

    return (
      <div key={nodeId} style={{ paddingLeft: `${depth * 12}px` }}>
        <div 
          className={`flex items-center p-1 rounded cursor-pointer ${isSelected ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
          onClick={() => selectNode(nodeId)}
          onDoubleClick={() => {
              if (node.type === 'Script') {
                  setEditingId(nodeId);
              }
          }}
        >
          <Icon size={14} className="mr-2 text-gray-400" />
          <span className="text-sm truncate">{node.name}</span>
        </div>
        {node.children && node.children.map(childId => renderTree(childId, depth + 1))}
      </div>
    );
  };

  const renderProperties = () => {
    // Default to Workspace if nothing selected (or explicitly selected)
    const activeId = selectedId || rootId;
    const node = nodes[activeId];
    
    if (!node) return <div className="p-4 text-gray-500 text-sm">Select an object to edit properties.</div>;

    const props = node.properties;

    const updateProp = (key: string, value: any) => {
      updateNode(activeId, { [key]: value });
    };

    return (
      <div className="space-y-4 p-2">
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Name</label>
          <input 
            type="text" 
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm" 
            value={node.name} 
            onChange={(e) => updateNode(activeId, { name: e.target.value })}
          />
        </div>

        {/* Environment Controls for Workspace */}
        {node.type === 'Folder' && node.id === 'workspace' && (
            <>
                <div className="pt-4 pb-2 border-t border-gray-700 font-bold text-xs text-blue-400 uppercase tracking-wider">
                    Environment
                </div>
                <div className="space-y-1">
                    <label className="text-xs text-gray-400">Time of Day ({props.timeOfDay?.toFixed(1) ?? 12})</label>
                    <input 
                        type="range" 
                        min="0" max="24" step="0.1"
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        value={props.timeOfDay ?? 12}
                        onChange={(e) => updateProp('timeOfDay', parseFloat(e.target.value))}
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs text-gray-400">Fog Density</label>
                    <input 
                        type="range" 
                        min="0" max="0.1" step="0.001"
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        value={props.fogDensity ?? 0.02}
                        onChange={(e) => updateProp('fogDensity', parseFloat(e.target.value))}
                    />
                </div>
                <div className="space-y-1">
                   <label className="text-xs text-gray-400">Fog Color</label>
                   <div className="flex items-center space-x-2">
                     <input 
                       type="color" 
                       value={props.fogColor ?? '#111111'}
                       onChange={(e) => updateProp('fogColor', e.target.value)}
                       className="h-8 w-full bg-transparent cursor-pointer rounded"
                     />
                   </div>
                </div>
            </>
        )}

        {node.type === 'Script' && (
            <div className="pb-4 border-b border-gray-700 mb-4">
                <button 
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center space-x-2"
                    onClick={() => setEditingId(activeId)}
                >
                    <FileCode size={14} />
                    <span>Open Script Editor</span>
                </button>
            </div>
        )}

        {node.type === 'MeshPart' && (
            <div className="space-y-1">
                <label className="text-xs text-gray-400">Mesh Path</label>
                <input 
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-500 truncate" 
                    value={node.properties.meshPath || ''} 
                    readOnly
                    title={node.properties.meshPath}
                />
            </div>
        )}

        {(node.type === 'Part' || node.type === 'MeshPart') && (
            <>
                <div className="space-y-1">
                   <label className="text-xs text-gray-400">Shape</label>
                   <select 
                     className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs"
                     value={props.shape || 'Box'}
                     onChange={(e) => updateProp('shape', e.target.value)}
                   >
                     <option value="Box">Box</option>
                     <option value="Sphere">Sphere</option>
                     <option value="Cylinder">Cylinder</option>
                   </select>
                </div>

                <div className="space-y-1">
                   <label className="text-xs text-gray-400">Material</label>
                   <select 
                     className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs"
                     value={props.material || 'Plastic'}
                     onChange={(e) => updateProp('material', e.target.value)}
                   >
                     <option value="Plastic">Plastic</option>
                     <option value="Neon">Neon</option>
                     <option value="Wood">Wood</option>
                     <option value="Metal">Metal</option>
                   </select>
                </div>

                <div className="space-y-1">
                   <label className="text-xs text-gray-400">Color</label>
                   <div className="flex items-center space-x-2">
                     <input 
                       type="color" 
                       value={props.color}
                       onChange={(e) => updateProp('color', e.target.value)}
                       className="h-8 w-full bg-transparent cursor-pointer rounded"
                     />
                   </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Position</label>
                  <div className="grid grid-cols-3 gap-1">
                     {['x', 'y', 'z'].map((axis, i) => (
                       <input 
                         key={axis}
                         type="number" 
                         className="bg-gray-900 border border-gray-600 rounded px-1 py-1 text-xs" 
                         value={props.position[i]} 
                         onChange={(e) => {
                           const newPos = [...props.position];
                           newPos[i] = parseFloat(e.target.value);
                           updateProp('position', newPos);
                         }}
                       />
                     ))}
                  </div>
                </div>
                
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Size</label>
                  <div className="grid grid-cols-3 gap-1">
                     {['x', 'y', 'z'].map((axis, i) => (
                       <input 
                         key={axis}
                         type="number" 
                         className="bg-gray-900 border border-gray-600 rounded px-1 py-1 text-xs" 
                         value={props.size[i]} 
                         onChange={(e) => {
                           const newSize = [...props.size];
                           newSize[i] = parseFloat(e.target.value);
                           updateProp('size', newSize);
                         }}
                       />
                     ))}
                  </div>
                </div>
            </>
        )}

        <div className="pt-4 border-t border-gray-700">
           <button 
             onClick={() => removeNode(activeId)}
             className="w-full flex items-center justify-center space-x-2 bg-red-900/50 hover:bg-red-900 text-red-200 py-1 rounded text-xs transition-colors"
           >
             <Trash2 size={12} />
             <span>Delete Object</span>
           </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`w-64 bg-gray-800 border-${position === 'left' ? 'r' : 'l'} border-gray-700 flex flex-col h-full`}>
      <div className="p-2 bg-gray-750 border-b border-gray-700 font-semibold text-xs uppercase tracking-wider text-gray-400 flex justify-between items-center">
        {position === 'left' ? 'Explorer' : 'Properties'}
        {position === 'left' && (
           <div className="flex space-x-1">
             <button onClick={() => addNode('Part')} title="Add Part" className="hover:bg-gray-600 p-1 rounded"><Plus size={12} /></button>
             <button onClick={() => addNode('Script')} title="Add Script" className="hover:bg-gray-600 p-1 rounded"><FileCode size={12} /></button>
           </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {position === 'left' ? (
          <div className="p-2">
            {renderTree(rootId)}
          </div>
        ) : (
          renderProperties()
        )}
      </div>
    </div>
  );
};
