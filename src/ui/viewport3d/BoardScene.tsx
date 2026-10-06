/**
 * The 3-D preview.
 *
 * Answers "will this actually look good", which a flat 2-D fill cannot: end
 * grain has depth and figure, and the sides show long grain instead. The
 * geometry is extruded directly from the evaluated cross-section, so it is the
 * same single source of truth the cut list comes from.
 */

import { Canvas } from '@react-three/fiber';
import { Bounds, Environment, OrbitControls } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { boardDimensions } from '../../core/geometry/evaluate.js';
import { SPECIES } from '../../core/knowledge/species.js';
import type { EdgeTreatments, PartitionFace, Workpiece } from '../../core/model/types.js';
import { TICKS_PER_INCH, formatTicks } from '../../core/units/ticks.js';

export interface BoardSceneProps {
  readonly workpiece: Workpiece;
  readonly edgeTreatments?: EdgeTreatments;
  readonly showScaleReference?: boolean;
}

/** Work in inches in the scene; ticks are an authoring unit, not a display one. */
const toScene = (t: number): number => t / TICKS_PER_INCH;

export function BoardScene({ workpiece, edgeTreatments, showScaleReference = true }: BoardSceneProps) {
  const dims = boardDimensions(workpiece);
  const widthIn = toScene(dims.width);
  const lengthIn = toScene(dims.length);
  const span = Math.max(widthIn, lengthIn);

  return (
    <div className="viewport3d">
      <Canvas
        shadows
        // A high three-quarter view: the face pattern is the thing being
        // judged, so it has to read clearly, while enough of the edge shows to
        // convey thickness. A low camera flattens the pattern into stripes.
        camera={{ position: [span * 0.55, span * 1.15, span * 0.95], fov: 34 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#15130f']} />
        {/* Lit as a kitchen rather than a studio: the point is to judge how the
            board will actually look, not to flatter it. */}
        <hemisphereLight intensity={0.5} groundColor="#2a2621" />
        <directionalLight
          position={[span, span * 1.6, span * 0.6]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-span, span * 0.6, -span]} intensity={0.45} />
        <Environment preset="apartment" />

        {/* Fit the camera to the content rather than hand-tuning a distance:
            boards range from a 6" trivet to a 24" butcher block, and a fixed
            distance crops one and strands the other. `observe` re-fits when the
            design changes. */}
        <Bounds fit clip observe margin={1.25}>
          <group position={[-widthIn / 2, 0, -lengthIn / 2]}>
            <Board workpiece={workpiece} />
            {edgeTreatments?.feet && <Feet widthIn={widthIn} lengthIn={lengthIn} />}
            {showScaleReference && <ScaleReference lengthIn={lengthIn} />}
          </group>
        </Bounds>

        <ShadowFloor span={span} />
        <OrbitControls makeDefault enablePan target={[0, 0, 0]} minDistance={span * 0.5} maxDistance={span * 4} />
      </Canvas>

      <div className="viewport3d-caption">
        {formatTicks(dims.width)} × {formatTicks(dims.length)} × {formatTicks(dims.thickness)}
        {showScaleReference && <span className="muted"> · knife shown at true scale</span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Board({ workpiece }: { workpiece: Workpiece }) {
  const thickness = toScene(workpiece.length);

  // One merged mesh per species keeps the draw-call count at the number of
  // woods rather than the number of pieces.
  const bySpecies = useMemo(() => {
    const groups = new Map<string, PartitionFace[]>();
    for (const face of workpiece.crossSection.faces) {
      const list = groups.get(face.species) ?? [];
      list.push(face);
      groups.set(face.species, list);
    }
    return groups;
  }, [workpiece]);

  return (
    <group>
      {[...bySpecies].map(([species, faces]) => (
        <SpeciesMesh key={species} species={species} faces={faces} thickness={thickness} />
      ))}
    </group>
  );
}

function SpeciesMesh({
  species,
  faces,
  thickness,
}: {
  species: string;
  faces: readonly PartitionFace[];
  thickness: number;
}) {
  const info = SPECIES[species];
  const colour = info?.color ?? '#999999';

  const geometry = useMemo(() => {
    const shapes = faces.map((face) => {
      const shape = new THREE.Shape();
      face.polygon.forEach((p, i) => {
        const x = toScene(p.x);
        const y = toScene(p.y);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      });
      shape.closePath();
      return shape;
    });

    const geom = new THREE.ExtrudeGeometry(shapes, {
      depth: thickness,
      bevelEnabled: true,
      // A tiny bevel reads as the eased arris a real board has, and catches a
      // highlight so adjoining pieces of the same species stay distinguishable.
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 1,
    });
    // Extrude builds in the XY plane; lay it flat with the face upward.
    geom.rotateX(-Math.PI / 2);
    geom.computeVertexNormals();
    return geom;
  }, [faces, thickness]);

  // ExtrudeGeometry emits two material groups: 0 for the caps, 1 for the sides.
  // That is exactly the distinction that matters here -- caps are end grain,
  // sides are long grain.
  const endGrain = useMemo(() => endGrainMaterial(colour), [colour]);
  const longGrain = useMemo(() => longGrainMaterial(colour), [colour]);

  return <mesh geometry={geometry} material={[endGrain, longGrain]} castShadow receiveShadow />;
}

/* -------------------------------------------------------------------------- */
/* Materials                                                                   */
/* -------------------------------------------------------------------------- */

/** Concentric growth rings and scattered pores: what a cut-off end looks like. */
function endGrainMaterial(colour: string): THREE.Material {
  const texture = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, size, size);

    const cx = size * (0.2 + Math.random() * 0.6);
    const cy = size * (0.2 + Math.random() * 0.6);
    ctx.lineWidth = 1.4;
    for (let r = 4; r < size * 1.6; r += 5 + Math.random() * 5) {
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.07})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, 0.6 + Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  texture.repeat.set(1.6, 1.6);
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0 });
}

/** Lengthwise figure for the board's sides. */
function longGrainMaterial(colour: string): THREE.Material {
  const texture = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 42; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.07})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.6;
      const y = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.33, y + (Math.random() - 0.5) * 9, size * 0.66, y + (Math.random() - 0.5) * 9, size, y);
      ctx.stroke();
    }
  });
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.68, metalness: 0 });
}

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A chef's knife at true scale.
 *
 * "12 inches" means little in an empty viewport, and board size is the decision
 * people most often get wrong. An 8" chef's knife is the thing a cutting board
 * is actually used with, so it is the honest yardstick.
 */
function ScaleReference({ lengthIn }: { lengthIn: number }) {
  const bladeLength = 8;
  const handleLength = 4.75;
  return (
    <group position={[-3.2, 0, lengthIn / 2 - (bladeLength + handleLength) / 2]}>
      <mesh position={[0, 0.02, bladeLength / 2]} castShadow>
        <boxGeometry args={[1.65, 0.05, bladeLength]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.09, -handleLength / 2]} castShadow>
        <boxGeometry args={[0.85, 0.72, handleLength]} />
        <meshStandardMaterial color="#1d1b18" roughness={0.6} />
      </mesh>
    </group>
  );
}

function Feet({ widthIn, lengthIn }: { widthIn: number; lengthIn: number }) {
  const inset = 1.25;
  const corners: Array<[number, number]> = [
    [inset, inset],
    [widthIn - inset, inset],
    [inset, lengthIn - inset],
    [widthIn - inset, lengthIn - inset],
  ];
  return (
    <group>
      {corners.map(([x, z], i) => (
        <mesh key={i} position={[x, -0.19, z]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.38, 20]} />
          <meshStandardMaterial color="#26241f" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function ShadowFloor({ span }: { span: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} receiveShadow>
      <planeGeometry args={[span * 6, span * 6]} />
      <shadowMaterial opacity={0.34} />
    </mesh>
  );
}
