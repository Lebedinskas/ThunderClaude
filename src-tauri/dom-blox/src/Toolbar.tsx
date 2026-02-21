import React, { useState, useEffect } from 'react';
import { useSceneStore } from './store/sceneStore';
import { invoke } from '@tauri-apps/api/tauri';
import { save, open } from '@tauri-apps/api/dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/api/fs';
import { parseCommand } from './ai/commandParser';
import { Play, Square, RotateCcw, RotateCw, Save, FolderOpen, Box, Move, RefreshCw, Maximize } from 'lucide-react';

export const Toolbar = () => {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { 
      addNode, nodes, rootId, updateNode, selectedId, loadProject, 
      isPlaying, setIsPlaying, transformMode, setTransformMode 
  } = useSceneStore();
  
  // Zundo temporal store access
  const { undo, redo, pastStates, futureStates } = useSceneStore.temporal((state: any) => state);
  const hasPast = pastStates.length > 0;
  const hasFuture = futureStates.length > 0;

  // Keyboard Shortcuts
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
          
          switch(e.key.toLowerCase()) {
              case 'w': setTransformMode('translate'); break;
              case 'e': setTransformMode('rotate'); break;
              case 'r': setTransformMode('scale'); break;
              case 'z': if (e.ctrlKey || e.metaKey) { e.preventDefault(); undo(); } break;
              case 'y': if (e.ctrlKey || e.metaKey) { e.preventDefault(); redo(); } break;
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, setTransformMode]);

  const handleAICommand = async (e: React.FormEvent) => {
// ... (rest unchanged until return) ...
  return (
    <div className="h-14 bg-gray-800 border-b border-gray-700 flex items-center px-4 space-x-4 shadow-md z-10 shrink-0">
      <div className="font-bold text-blue-400 text-xl tracking-tight mr-2 flex items-center">
          <Box className="mr-2" /> DomBlox
      </div>
      
      <div className="flex space-x-1 border-r border-gray-600 pr-4">
        <button onClick={handleSaveProject} title="Save Project" className="p-2 hover:bg-gray-700 rounded text-gray-300 transition-colors"><Save size={18} /></button>
        <button onClick={handleLoadProject} title="Load Project" className="p-2 hover:bg-gray-700 rounded text-gray-300 transition-colors"><FolderOpen size={18} /></button>
      </div>

      <div className="flex space-x-1 border-r border-gray-600 pr-4">
        <button 
            onClick={() => undo()} 
            disabled={!hasPast} 
            title="Undo (Ctrl+Z)" 
            className={`p-2 rounded transition-colors ${hasPast ? 'hover:bg-gray-700 text-gray-300' : 'text-gray-600 cursor-not-allowed'}`}
        >
            <RotateCcw size={18} />
        </button>
        <button 
            onClick={() => redo()} 
            disabled={!hasFuture} 
            title="Redo (Ctrl+Y)" 
            className={`p-2 rounded transition-colors ${hasFuture ? 'hover:bg-gray-700 text-gray-300' : 'text-gray-600 cursor-not-allowed'}`}
        >
            <RotateCw size={18} />
        </button>
      </div>

      <div className="flex space-x-1 border-r border-gray-600 pr-4">
        <button 
            onClick={() => setTransformMode('translate')} 
            title="Move (W)" 
            className={`p-2 rounded transition-colors ${transformMode === 'translate' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'}`}
        >
            <Move size={18} />
        </button>
        <button 
            onClick={() => setTransformMode('rotate')} 
            title="Rotate (E)" 
            className={`p-2 rounded transition-colors ${transformMode === 'rotate' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'}`}
        >
            <RefreshCw size={18} />
        </button>
        <button 
            onClick={() => setTransformMode('scale')} 
            title="Scale (R)" 
            className={`p-2 rounded transition-colors ${transformMode === 'scale' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'}`}
        >
            <Maximize size={18} />
        </button>
      </div>

      {/* AI Command Bar */}
      <form onSubmit={handleAICommand} className="flex-1 max-w-2xl relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <span className="text-purple-400 text-lg">✨</span>
        </div>
        <input 
            type="text" 
            className="w-full bg-gray-900 border border-gray-600 rounded-md py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all placeholder-gray-500"
            placeholder="Describe what to build... (e.g., 'Make a red lava block')"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isProcessing}
        />
        {isProcessing && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                <div className="animate-spin h-4 w-4 border-2 border-purple-500 rounded-full border-t-transparent"></div>
            </div>
        )}
      </form>

      <div className="flex-1" />

      <div className="flex space-x-2 items-center">
        <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className={`px-6 py-1.5 rounded font-bold shadow-lg transition-all active:scale-95 flex items-center space-x-2 ${
                isPlaying 
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20' 
                : 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/20'
            }`}
        >
          {isPlaying ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>
        
        <button 
            onClick={handleExport}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-sm font-medium transition-colors flex items-center space-x-2"
        >
            <span>Export .rbxlx</span>
        </button>
      </div>
    </div>
  );
};

  const handleExport = async () => {
      try {
          const sceneState = { nodes, rootId };
          const xmlContent = await invoke<string>('export_scene', { sceneJson: JSON.stringify(sceneState) });
          
          const filePath = await save({
              filters: [{
                  name: 'Roblox Place',
                  extensions: ['rbxlx']
              }]
          });

          if (filePath) {
              await writeTextFile(filePath, xmlContent);
              alert('Exported successfully!');
          }
      } catch (e) {
          console.error('Export failed:', e);
          alert('Export failed: ' + e);
      }
  };

  return (
    <div className="h-14 bg-gray-800 border-b border-gray-700 flex items-center px-4 space-x-4 shadow-md z-10 shrink-0">
      <div className="font-bold text-blue-400 text-xl tracking-tight mr-2">DomBlox</div>
      
      <div className="flex space-x-1 border-r border-gray-600 pr-4">
        <button className="px-3 py-1.5 hover:bg-gray-700 rounded text-sm text-gray-300 transition-colors">File</button>
        <button className="px-3 py-1.5 hover:bg-gray-700 rounded text-sm text-gray-300 transition-colors">Edit</button>
        <button className="px-3 py-1.5 hover:bg-gray-700 rounded text-sm text-gray-300 transition-colors">View</button>
      </div>

      {/* AI Command Bar */}
      <form onSubmit={handleAICommand} className="flex-1 max-w-2xl relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <span className="text-purple-400 text-lg">✨</span>
        </div>
        <input 
            type="text" 
            className="w-full bg-gray-900 border border-gray-600 rounded-md py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all placeholder-gray-500"
            placeholder="Describe what to build... (e.g., 'Make a red lava block')"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isProcessing}
        />
        {isProcessing && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                <div className="animate-spin h-4 w-4 border-2 border-purple-500 rounded-full border-t-transparent"></div>
            </div>
        )}
      </form>

      <div className="flex-1" />

      <div className="flex space-x-2 items-center">
        <button 
            onClick={handleExport}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-sm font-medium transition-colors flex items-center space-x-2"
        >
            <span>💾 Export .rbxlx</span>
        </button>
        <button className="px-6 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded font-bold shadow-lg shadow-green-900/20 transition-transform active:scale-95 flex items-center space-x-1">
          <span>▶ Play</span>
        </button>
      </div>
    </div>
  );
};
