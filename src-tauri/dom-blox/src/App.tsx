import React, { Suspense, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, TransformControls, Sky } from '@react-three/drei';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { useSceneStore } from './store/sceneStore';
import { SceneNode } from './components/SceneNode';
import { ScriptEditor } from './components/ScriptEditor';
import { Physics } from '@react-three/cannon';
import * as THREE from 'three';

function EnvironmentController() {
    const { nodes } = useSceneStore();
    const workspace = nodes['workspace'];
    const { scene } = useThree();

    const time = workspace?.properties.timeOfDay ?? 12;
    const ambient = workspace?.properties.ambientColor ?? '#222222';
    const brightness = workspace?.properties.sunBrightness ?? 1.5;
    const fogDensity = workspace?.properties.fogDensity ?? 0.02;
    const fogColor = workspace?.properties.fogColor ?? '#111111';

    // Calculate Sun Position based on Time (0-24)
    // 12 = 90 deg (noon), 6 = 0 deg (sunrise), 18 = 180 deg (sunset)
    const theta = Math.PI * ((time - 6) / 12); 
    const sunX = Math.cos(theta) * 100;
    const sunY = Math.sin(theta) * 100;
    const sunZ = 50; // Offset slightly

    useEffect(() => {
        scene.fog = new THREE.FogExp2(fogColor, fogDensity);
        scene.background = new THREE.Color(fogColor);
    }, [fogColor, fogDensity, scene]);

    return (
        <>
            <ambientLight intensity={0.5} color={ambient} />
            <directionalLight 
                position={[sunX, sunY, sunZ]} 
                intensity={brightness} 
                castShadow 
                shadow-mapSize={[2048, 2048]} 
            />
            {/* Skybox that syncs with sun position */}
            <Sky 
                sunPosition={[sunX, sunY, sunZ]} 
                turbidity={10} 
                rayleigh={2} 
                mieCoefficient={0.005} 
                mieDirectionalG={0.8} 
            />
        </>
    );
}

function SceneContent() {
  const { rootId } = useSceneStore();
  return <SceneNode id={rootId} />;
}

export default function App() {
  const { selectNode, addNode, editingId, setEditingId, isPlaying } = useSceneStore();

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const file = files[0];
      const fileName = file.name.toLowerCase();

      // In Tauri, the File object often has a 'path' property if configured
      // @ts-ignore
      const filePath = file.path; 

      if (filePath && (fileName.endsWith('.glb') || fileName.endsWith('.gltf'))) {
          addNode('MeshPart', 'workspace', { 
              meshPath: filePath,
              name: file.name.replace(/\.[^/.]+$/, "") // Remove extension
          });
      } else {
          console.warn('Dropped file is not a supported mesh (.glb, .gltf) or path is missing.');
      }
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
  };

  return (
    <div 
        className="flex flex-col h-screen w-screen bg-gray-900 text-white relative"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
    >
      {/* Script Editor Overlay */}
      {editingId && (
          <ScriptEditor 
              nodeId={editingId} 
              onClose={() => setEditingId(null)} 
          />
      )}

      {/* Top Toolbar */}
      <Toolbar />
      
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Explorer */}
        <Sidebar position="left" />

        {/* Main 3D Viewport */}
        <div className="flex-1 relative bg-black" onClick={() => selectNode(null)}>
          <Canvas camera={{ position: [8, 8, 8], fov: 50 }} shadows>
            <Suspense fallback={null}>
              <EnvironmentController />
              
              <Grid infiniteGrid fadeDistance={50} sectionColor="#444" cellColor="#222" />
              <OrbitControls makeDefault enabled={!isPlaying} />

              {isPlaying ? (
                  <Physics gravity={[0, -9.81, 0]}>
                      <SceneContent />
                  </Physics>
              ) : (
                  <SceneContent />
              )}
            </Suspense>
          </Canvas>
          
          <div className="absolute top-4 right-4 bg-black/50 p-2 rounded text-xs select-none pointer-events-none text-gray-400">
            {isPlaying ? '▶ Simulation Running' : 'DomBlox v0.5 • Editor Mode'}
          </div>
        </div>

        {/* Right Sidebar - Properties */}
        <Sidebar position="right" />
      </div>
    </div>
  );
}
