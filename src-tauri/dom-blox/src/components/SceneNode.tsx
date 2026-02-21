import React, { useRef } from 'react';
import { TransformControls, Edges, useGLTF } from '@react-three/drei';
import { useSceneStore, SceneNode as SceneNodeData } from '../store/sceneStore';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useBox, useSphere, useCylinder } from '@react-three/cannon';
import * as THREE from 'three';

// --- Visual Components ---

function MeshRenderer({ url, color }: { url: string, color: string }) {
  const { scene } = useGLTF(url);
  const clone = React.useMemo(() => {
      const c = scene.clone();
      c.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
              const m = child as THREE.Mesh;
              m.castShadow = true;
              m.receiveShadow = true;
          }
      });
      return c;
  }, [scene, color]);
  return <primitive object={clone} />;
}

// --- Physics Node Implementation ---

function PhysicsNode({ node }: { node: SceneNodeData }) {
    const { position, rotation, size, shape, anchored, meshPath, color } = node.properties;
    
    // Common physics props
    const physProps: any = {
        mass: anchored ? 0 : 1, // 0 = Static/Kinematic, >0 = Dynamic
        position,
        rotation,
        type: anchored ? 'Static' : 'Dynamic'
    };

    let ref: any;
    let Geometry = <boxGeometry args={[1, 1, 1]} />;

    if (shape === 'Sphere') {
        [ref] = useSphere(() => ({ ...physProps, args: [size[0] / 2] })); // Approx radius from size X
        Geometry = <sphereGeometry args={[size[0] / 2, 32, 32]} />;
    } else if (shape === 'Cylinder') {
        [ref] = useCylinder(() => ({ ...physProps, args: [size[0] / 2, size[0] / 2, size[1], 32] }));
        Geometry = <cylinderGeometry args={[size[0] / 2, size[0] / 2, size[1], 32]} />;
    } else {
        // Box default (also for MeshPart fallback collider)
        [ref] = useBox(() => ({ ...physProps, args: size }));
        Geometry = <boxGeometry args={[1, 1, 1]} />; // Geometry scales via mesh scale, but physics needs explicit args
        // Note: useBox args are half-extents? No, cannon-es uses halfExtents, @react-three/cannon useBox args depends.
        // Actually @react-three/cannon useBox args match Three.js geometry args usually (width, height, depth).
    }

    // MeshPart visual handling in physics
    const isMesh = node.type === 'MeshPart' && meshPath;
    const assetUrl = isMesh ? convertFileSrc(meshPath!) : '';

    return (
        <mesh ref={ref} castShadow receiveShadow>
            {isMesh ? (
                <MeshRenderer url={assetUrl} color={color} />
            ) : (
                Geometry
            )}
            <meshStandardMaterial color={color} />
            {/* Children are rendered but might be detached physically if they have their own bodies */}
            {node.children.map(childId => <SceneNode key={childId} id={childId} />)}
        </mesh>
    );
}

// --- Visual Node Implementation ---

function VisualNode({ node }: { node: SceneNodeData }) {
    const { selectedId, selectNode, updateNode, transformMode } = useSceneStore();
    const isSelected = selectedId === node.id;
    const { position, rotation, size, shape, color, material, meshPath } = node.properties;

    const handleTransform = (e: any) => {
        if (!e?.target?.object) return;
        const o = e.target.object;
        updateNode(node.id, {
            position: [o.position.x, o.position.y, o.position.z],
            rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
            size: [o.scale.x, o.scale.y, o.scale.z]
        });
    };

    let Geometry = <boxGeometry />;
    if (shape === 'Sphere') Geometry = <sphereGeometry args={[0.5, 32, 32]} />;
    if (shape === 'Cylinder') Geometry = <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;

    const isMesh = node.type === 'MeshPart' && meshPath;
    const assetUrl = isMesh ? convertFileSrc(meshPath!) : '';

    const Component = (
        <mesh
            key={node.id}
            position={position}
            rotation={rotation}
            scale={isMesh ? size : size} // Scale applies to geometry
            onClick={(e) => {
                e.stopPropagation();
                selectNode(node.id);
            }}
            castShadow
            receiveShadow
        >
            {isMesh ? <MeshRenderer url={assetUrl} color={color} /> : Geometry}
            
            <meshStandardMaterial
                color={color}
                emissive={material === 'Neon' ? color : '#000'}
                emissiveIntensity={material === 'Neon' ? 2 : 0}
                roughness={material === 'Plastic' ? 0.5 : material === 'Metal' ? 0.2 : 0.8}
                metalness={material === 'Metal' ? 0.8 : 0.1}
            />
            
            {isSelected && <Edges scale={1.05} threshold={15} color="white" />}
            
            {node.children.map(childId => <SceneNode key={childId} id={childId} />)}
        </mesh>
    );

    if (isSelected) {
        return (
            <TransformControls 
                mode={transformMode} 
                onObjectChange={handleTransform}
            >
                {Component}
            </TransformControls>
        );
    }
    return Component;
}

// --- Main Component ---

export function SceneNode({ id }: { id: string }) {
  const { nodes, isPlaying } = useSceneStore();
  const node = nodes[id];

  if (!node) return null;

  if (node.type === 'Folder' || node.type === 'Model' || node.type === 'Script') {
      // Containers / Non-physical
      return (
          <group position={node.properties.position} rotation={node.properties.rotation}>
              {node.children.map(childId => <SceneNode key={childId} id={childId} />)}
          </group>
      );
  }

  // Parts and MeshParts
  if (isPlaying) {
      return <PhysicsNode node={node} />;
  } else {
      return <VisualNode node={node} />;
  }
}
