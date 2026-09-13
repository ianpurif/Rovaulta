"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type PipelineStage = 0 | 1 | 2 | 3 | 4;

const STAGE_X = [-3.65, -1.82, 0, 1.82, 3.65] as const;
const STAGES = [0, 1, 2, 3, 4] as const;
const STAGE_COLORS = ["#9a552c", "#3a8d78", "#5f7d77", "#8a5110", "#9a552c"] as const;

function Connector({ from, to, active }: { from: number; to: number; active: boolean }) {
  const length = Math.abs(to - from);
  return (
    <mesh position={[(from + to) / 2, -0.05, 0]}>
      <boxGeometry args={[length, 0.024, 0.024]} />
      <meshBasicMaterial
        color={active ? "#9a552c" : "#aab8b0"}
        transparent
        opacity={active ? 0.82 : 0.52}
      />
    </mesh>
  );
}

function StageNode({
  stage,
  active,
  motion,
}: {
  stage: PipelineStage;
  active: boolean;
  motion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const accent = STAGE_COLORS[stage];

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    const targetScale = active ? 1.13 : 0.86;
    const targetY = active ? 0.11 : 0;
    group.current.scale.x = THREE.MathUtils.damp(group.current.scale.x, targetScale, 5, delta);
    group.current.scale.y = THREE.MathUtils.damp(group.current.scale.y, targetScale, 5, delta);
    group.current.scale.z = THREE.MathUtils.damp(group.current.scale.z, targetScale, 5, delta);
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, targetY, 5, delta);
    if (motion) {
      group.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.55 + stage) * 0.045;
      group.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.38 + stage) * 0.018;
    }
  });

  return (
    <group ref={group} position={[STAGE_X[stage], 0, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.23, 0]}>
        <ringGeometry args={[0.39, 0.43, 32]} />
        <meshBasicMaterial color={accent} transparent opacity={active ? 0.7 : 0.16} />
      </mesh>
      {stage === 0 ? (
        <group>
          <mesh>
            <boxGeometry args={[0.72, 0.44, 0.54]} />
            <meshStandardMaterial color="#b46a42" roughness={0.68} metalness={0.12} />
          </mesh>
          <mesh position={[0, 0.27, 0]}>
            <boxGeometry args={[0.54, 0.035, 0.4]} />
            <meshBasicMaterial color="#f4d7bf" />
          </mesh>
          <mesh position={[0.18, -0.02, 0.28]}>
            <boxGeometry args={[0.08, 0.13, 0.03]} />
            <meshBasicMaterial color="#7b3f20" />
          </mesh>
        </group>
      ) : null}
      {stage === 1 ? (
        <group>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <octahedronGeometry args={[0.46, 0]} />
            <meshStandardMaterial color="#4f9b88" roughness={0.52} metalness={0.18} />
          </mesh>
          <mesh position={[0, 0, 0.3]}>
            <boxGeometry args={[0.1, 0.1, 0.03]} />
            <meshBasicMaterial color="#d8f0e4" />
          </mesh>
        </group>
      ) : null}
      {stage === 2 ? (
        <group>
          <mesh position={[0, -0.12, 0]}>
            <boxGeometry args={[0.7, 0.08, 0.48]} />
            <meshStandardMaterial color="#718b84" roughness={0.74} metalness={0.1} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.7, 0.08, 0.48]} />
            <meshStandardMaterial color="#9eb9af" roughness={0.74} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <boxGeometry args={[0.7, 0.08, 0.48]} />
            <meshStandardMaterial color="#d5e4dd" roughness={0.74} metalness={0.1} />
          </mesh>
          <mesh position={[0.18, 0.17, 0.25]}>
            <boxGeometry args={[0.04, 0.025, 0.04]} />
            <meshBasicMaterial color="#276b4c" />
          </mesh>
        </group>
      ) : null}
      {stage === 3 ? (
        <group>
          <mesh>
            <boxGeometry args={[0.58, 0.12, 0.82]} />
            <meshStandardMaterial color="#b7813f" roughness={0.56} metalness={0.22} />
          </mesh>
          <mesh position={[0, 0.08, 0.02]}>
            <boxGeometry args={[0.39, 0.025, 0.54]} />
            <meshBasicMaterial color="#fff6e6" />
          </mesh>
          <mesh position={[0, 0.1, 0.26]}>
            <boxGeometry args={[0.16, 0.018, 0.018]} />
            <meshBasicMaterial color="#8a5110" />
          </mesh>
        </group>
      ) : null}
      {stage === 4 ? (
        <group>
          <mesh position={[-0.25, 0.18, 0]}>
            <boxGeometry args={[0.12, 0.78, 0.16]} />
            <meshStandardMaterial color="#a65f37" roughness={0.62} metalness={0.2} />
          </mesh>
          <mesh position={[0.25, 0.18, 0]}>
            <boxGeometry args={[0.12, 0.78, 0.16]} />
            <meshStandardMaterial color="#a65f37" roughness={0.62} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[0.62, 0.1, 0.16]} />
            <meshStandardMaterial color="#7b3f20" roughness={0.58} metalness={0.25} />
          </mesh>
          <mesh position={[0, 0.18, 0.02]}>
            <boxGeometry args={[0.25, 0.48, 0.025]} />
            <meshBasicMaterial color="#f3e7dd" transparent opacity={0.75} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

function SignalPulse({ motion }: { motion: boolean }) {
  const pulse = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!pulse.current) return;
    const progress = motion ? (clock.getElapsedTime() * 0.065) % 1 : 0.76;
    pulse.current.position.x = THREE.MathUtils.lerp(STAGE_X[0], STAGE_X[4], progress);
    pulse.current.position.y = 0.18 + Math.sin(progress * Math.PI * 2) * 0.035;
  });
  return (
    <mesh ref={pulse} position={[STAGE_X[3], 0.18, 0.08]}>
      <boxGeometry args={[0.1, 0.1, 0.1]} />
      <meshBasicMaterial color="#9a552c" />
    </mesh>
  );
}

function PipelineScene({ activeStage, motion }: { activeStage: PipelineStage; motion: boolean }) {
  const activeX = STAGE_X[activeStage];
  useFrame(({ camera }, delta) => {
    const targetX = activeX * 0.1;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 2.8, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.7, 2.8, delta);
    camera.lookAt(targetX * 0.4, 0.02, 0);
  });

  return (
    <>
      <ambientLight intensity={1.35} />
      <directionalLight position={[2, 4, 6]} intensity={2.1} color="#fffaf3" />
      <directionalLight position={[-4, 1, -3]} intensity={0.9} color="#d7eee4" />
      <gridHelper args={[10, 20, "#c3d1c9", "#e4ebe6"]} position={[0, -0.39, 0]} />
      {STAGE_X.slice(0, -1).map((x, index) => {
        const nextX = STAGE_X[index + 1];
        if (nextX === undefined) return null;
        return <Connector from={x} to={nextX} active={index < activeStage} key={x} />;
      })}
      {STAGES.map((stage) => (
        <StageNode active={stage === activeStage} motion={motion} stage={stage} key={stage} />
      ))}
      <SignalPulse motion={motion} />
    </>
  );
}

export function ReleasePipelineScene({
  activeStage = 3,
  paused = false,
  className,
}: {
  readonly activeStage?: PipelineStage;
  readonly paused?: boolean;
  readonly className?: string | undefined;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const safeStage = Math.min(Math.max(activeStage, 0), 4) as PipelineStage;
  const sceneClassName = className ?? "";

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const camera = useMemo(
    () => ({ position: [0, 0.7, 8.8] as [number, number, number], fov: 31 }),
    [],
  );

  return (
    <div className={sceneClassName} aria-hidden="true">
      <Canvas
        camera={camera}
        dpr={[1, 1.5]}
        frameloop={reducedMotion || paused ? "demand" : "always"}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      >
        <PipelineScene activeStage={safeStage} motion={!reducedMotion} />
      </Canvas>
    </div>
  );
}
