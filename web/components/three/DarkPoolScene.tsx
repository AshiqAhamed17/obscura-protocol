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

function Scene() {
  const pool = useRef<THREE.Points>(null);
  const poolMat = useRef<THREE.PointsMaterial>(null);
  const stars = useRef<THREE.Points>(null);
  const camera = useThree((s) => s.camera);

  const poolPos = useMemo(() => spherePoints(2800, 2.3), []);
  const starPos = useMemo(() => starField(900, 26), []);

  useFrame((_, dt) => {
    const p = progress();
    if (pool.current) {
      pool.current.rotation.y += dt * 0.045;
      pool.current.rotation.x = Math.sin(Date.now() * 0.0001) * 0.08;
      pool.current.scale.setScalar(1 + p * 2.4); // expand as you descend
    }
    if (poolMat.current) poolMat.current.opacity = (1 - p) * 0.9;
    if (stars.current) stars.current.rotation.y += dt * 0.01;
    // dolly the camera into the pool
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, 5 - p * 3.1, 0.08);
    camera.lookAt(0, 0, 0);
  });

  return (
    <group>
      <points ref={stars}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[starPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.03}
          sizeAttenuation
          transparent
          opacity={0.35}
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
          size={0.022}
          sizeAttenuation
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color={new THREE.Color(0.62, 0.72, 1)}
        />
      </points>
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
