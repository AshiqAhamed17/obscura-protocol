"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/// Evenly-distributed points on a sphere (Fibonacci), with slight radial jitter
/// so it reads as a cloud, not a shell.
function spherePoints(n: number, radius: number): Float32Array {
  const arr = new Float32Array(n * 3);
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const rad = radius * (0.82 + Math.random() * 0.18);
    arr[i * 3] = Math.cos(theta) * r * rad;
    arr[i * 3 + 1] = y * rad;
    arr[i * 3 + 2] = Math.sin(theta) * r * rad;
  }
  return arr;
}

/// Random points in a large box — a faint backdrop starfield for depth.
function starField(n: number, spread: number): Float32Array {
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (Math.random() - 0.5) * spread;
    arr[i * 3 + 1] = (Math.random() - 0.5) * spread;
    arr[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  return arr;
}

function progress(): number {
  if (typeof window === "undefined") return 0;
  return Math.min(1, window.scrollY / (window.innerHeight * 1.1));
}

/// Floating "commitment nodes" that emerge as you descend into the pool —
/// Obscura's take on Morpho's field of logo-nodes. They fade in as the sphere
/// fades out, so scrolling reveals a field of nodes.
function Nodes() {
  const group = useRef<THREE.Group>(null);
  const nodes = useMemo(() => {
    const cols: [number, number, number][] = [
      [0.68, 0.78, 1], // cool
      [0.56, 0.9, 0.8], // mint (proven)
      [0.9, 0.92, 1], // near-white
      [0.6, 0.7, 1],
    ];
    return Array.from({ length: 20 }, (_, i) => ({
      pos: [
        (Math.random() - 0.5) * 7.5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 4 - 0.6,
      ] as [number, number, number],
      size: 0.05 + Math.random() * 0.1,
      color: cols[i % cols.length],
      phase: Math.random() * Math.PI * 2,
    }));
  }, []);

  useFrame(() => {
    const p = progress();
    const vis = Math.max(0, Math.min(1, (p - 0.28) / 0.5));
    const g = group.current;
    if (!g) return;
    const now = Date.now();
    g.children.forEach((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat) mat.opacity = vis * (mesh.userData.baseOpacity as number);
      mesh.position.y = (mesh.userData.baseY as number) + Math.sin(now * 0.0004 + (mesh.userData.phase as number)) * 0.16;
    });
  });

  return (
    <group ref={group}>
      {nodes.map((n, i) => (
        <mesh key={i} position={n.pos} userData={{ baseY: n.pos[1], phase: n.phase, baseOpacity: 0.8 }}>
          <circleGeometry args={[n.size, 28]} />
          <meshBasicMaterial
            color={new THREE.Color(...n.color)}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  const pool = useRef<THREE.Points>(null);
  const poolMat = useRef<THREE.PointsMaterial>(null);
  const stars = useRef<THREE.Points>(null);
  const camera = useThree((s) => s.camera);

  const poolPos = useMemo(() => spherePoints(3600, 2.3), []);
  const starPos = useMemo(() => starField(1100, 28), []);

  useFrame((_, dt) => {
    const p = progress();
    if (pool.current) {
      pool.current.rotation.y += dt * 0.04;
      pool.current.rotation.x = Math.sin(Date.now() * 0.0001) * 0.08;
      pool.current.scale.setScalar(1 + p * 2.7); // expand as you descend
    }
    if (poolMat.current) poolMat.current.opacity = Math.max(0, 1 - p * 1.15) * 0.92;
    if (stars.current) stars.current.rotation.y += dt * 0.008;
    // dolly the camera into the pool (eased)
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, 5 - p * 3.3, 0.07);
    camera.lookAt(0, 0, 0);
  });

  return (
    <group>
      <points ref={stars}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[starPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.028}
          sizeAttenuation
          transparent
          opacity={0.32}
          depthWrite={false}
          color={new THREE.Color(0.72, 0.78, 0.95)}
        />
      </points>

      <points ref={pool}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[poolPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={poolMat}
          size={0.02}
          sizeAttenuation
          transparent
          opacity={0.92}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color={new THREE.Color(0.62, 0.72, 1)}
        />
      </points>

      <Nodes />
    </group>
  );
}

export function DarkPoolScene() {
  return (
    <Canvas
      className="darkpool"
      camera={{ position: [0, 0, 5], fov: 62 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
    >
      <Scene />
    </Canvas>
  );
}
