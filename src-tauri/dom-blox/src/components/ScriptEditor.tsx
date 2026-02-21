import React, { useState, useEffect } from 'react';
import { useSceneStore } from '../store/sceneStore';

interface ScriptEditorProps {
    nodeId: string;
    onClose: () => void;
}

export const ScriptEditor = ({ nodeId, onClose }: ScriptEditorProps) => {
    const { nodes, updateNode } = useSceneStore();
    const node = nodes[nodeId];
    const [code, setCode] = useState('');
    const [isDirty, setIsDirty] = useState(false);

    // Load code when nodeId changes
    useEffect(() => {
        if (node) {
            setCode(node.properties.source || '');
            setIsDirty(false);
        }
    }, [nodeId]);

    const handleSave = () => {
        updateNode(nodeId, { source: code });
        setIsDirty(false);
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setCode(e.target.value);
        setIsDirty(true);
    };

    if (!node) return null;

    return (
        <div className="absolute inset-0 bg-gray-900 z-50 flex flex-col font-mono">
            {/* Toolbar */}
            <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center px-4 justify-between shrink-0">
                <div className="flex items-center space-x-3">
                    <span className="text-blue-400 font-bold text-sm">Lua Script:</span>
                    <span className="text-gray-300 text-sm font-medium">{node.name}</span>
                    {isDirty && <span className="text-yellow-500 text-xs italic">• Unsaved</span>}
                </div>
                <div className="flex space-x-2">
                    <button 
                        onClick={handleSave}
                        disabled={!isDirty}
                        className={`px-3 py-1 rounded text-xs text-white transition-colors ${isDirty ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
                    >
                        Save
                    </button>
                    <button 
                        onClick={onClose}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 relative">
                <textarea
                    className="w-full h-full bg-[#1e1e1e] text-gray-300 p-4 resize-none focus:outline-none text-sm leading-relaxed"
                    value={code}
                    onChange={handleChange}
                    spellCheck={false}
                    placeholder="-- Write your Luau code here..."
                />
            </div>
        </div>
    );
};
