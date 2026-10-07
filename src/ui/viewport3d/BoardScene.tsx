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
        {showScaleReference && <span className="muted"> · {SCALE_REFERENCE.label}</span>}
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
 *
 * A yardstick only works if you know how long it is. `SCALE_REFERENCE.label`
 * feeds the caption from the same constant the geometry is built from, so the
 * stated length and the drawn length cannot drift apart -- which is the whole
 * reason the knife is here rather than a dimension line.
 */
const BLADE_LENGTH_IN = 8;
const BLADE_HEEL_IN = 1.8;
const BLADE_THICK_IN = 0.07;
const HANDLE_LENGTH_IN = 4.75;
const HANDLE_WIDTH_IN = 1.02;
const HANDLE_THICK_IN = 0.6;

export const SCALE_REFERENCE = {
  bladeLengthIn: BLADE_LENGTH_IN,
  label: `${BLADE_LENGTH_IN}" chef's knife, actual size`,
} as const;

/**
 * The blade silhouette, seen from above with the knife lying flat.
 *
 * Drawn as a profile rather than a box because the silhouette carries all the
 * recognition: a rectangle reads as a ruler, and nobody knows how long a ruler
 * is by looking. The curve doing the work is the belly -- the edge leaving the
 * heel straight, then sweeping up to meet the spine at the point.
 */
function bladeShape(): THREE.Shape {
  const L = BLADE_LENGTH_IN;
  const h = BLADE_HEEL_IN / 2;
  const s = new THREE.Shape();
  s.moveTo(-h, 0.1); // heel, cutting edge
  s.bezierCurveTo(-h, L * 0.5, -h * 0.95, L * 0.78, -h * 0.34, L * 0.95); // the belly
  s.quadraticCurveTo(-h * 0.04, L, h * 0.26, L * 0.975); // the point
  s.bezierCurveTo(h * 0.78, L * 0.9, h, L * 0.72, h, L * 0.44); // spine falling to the tip
  s.lineTo(h, 0); // spine, straight back to the bolster
  s.closePath();
  return s;
}

/** A gently waisted handle, rounded at the butt. */
function handleShape(): THREE.Shape {
  const L = HANDLE_LENGTH_IN;
  const w = HANDLE_WIDTH_IN / 2;
  const s = new THREE.Shape();
  s.moveTo(-w * 0.84, 0);
  s.bezierCurveTo(-w, -L * 0.3, -w * 0.88, -L * 0.6, -w * 0.92, -L * 0.86);
  s.quadraticCurveTo(-w * 0.86, -L, 0, -L); // the butt
  s.quadraticCurveTo(w * 0.86, -L, w * 0.92, -L * 0.86);
  s.bezierCurveTo(w * 0.88, -L * 0.6, w, -L * 0.3, w * 0.84, 0);
  s.closePath();
  return s;
}

/**
 * Lay an extruded profile flat with its underside on y = 0.
 *
 * ExtrudeGeometry builds in the XY plane and extrudes along +Z, so a quarter
 * turn about X puts the profile in the ground plane; the bevel overshoots both
 * faces, so the translate accounts for it rather than for `depth` alone.
 */
function layFlat(geom: THREE.ExtrudeGeometry, depth: number, bevel: number): THREE.ExtrudeGeometry {
  geom.rotateX(Math.PI / 2);
  geom.translate(0, depth + bevel, 0);
  geom.computeVertexNormals();
  return geom;
}

function ScaleReference({ lengthIn }: { lengthIn: number }) {
  const blade = useMemo(() => {
    const bevel = 0.016;
    return layFlat(
      new THREE.ExtrudeGeometry(bladeShape(), {
        depth: BLADE_THICK_IN,
        bevelEnabled: true,
        // A broad, shallow bevel stands in for the grind: it runs the whole
        // outline rather than just the edge, but at this size it reads as
        // ground steel where a hard square corner reads as sheet metal.
        bevelThickness: bevel,
        bevelSize: 0.028,
        bevelSegments: 2,
        curveSegments: 28,
      }),
      BLADE_THICK_IN,
      bevel,
    );
  }, []);

  const handle = useMemo(() => {
    const bevel = 0.13;
    return layFlat(
      new THREE.ExtrudeGeometry(handleShape(), {
        depth: HANDLE_THICK_IN - bevel * 2,
        bevelEnabled: true,
        // Here the bevel is doing real work: it is what rounds a flat extrusion
        // into something that reads as a handle you could hold.
        bevelThickness: bevel,
        bevelSize: 0.14,
        bevelSegments: 5,
        curveSegments: 22,
      }),
      HANDLE_THICK_IN - bevel * 2,
      bevel,
    );
  }, []);

  return (
    <group position={[-3.2, 0, lengthIn / 2 - (BLADE_LENGTH_IN + HANDLE_LENGTH_IN) / 2]}>
      <mesh geometry={blade} castShadow receiveShadow>
        <meshStandardMaterial color="#ccd2da" metalness={0.95} roughness={0.19} />
      </mesh>

      {/* The bolster: the thick collar where blade meets handle. Small, but it
          is most of why a knife reads as a knife rather than a letter opener. */}
      <mesh position={[0, HANDLE_THICK_IN / 2, -0.2]} castShadow>
        <boxGeometry args={[HANDLE_WIDTH_IN * 0.92, HANDLE_THICK_IN * 1.02, 0.42]} />
        <meshStandardMaterial color="#b9c0c9" metalness={0.9} roughness={0.28} />
      </mesh>

      <mesh geometry={handle} position={[0, 0, -0.34]} castShadow receiveShadow>
        <meshStandardMaterial color="#1b1a1e" metalness={0.05} roughness={0.55} />
      </mesh>

      {/* Three rivets. Pure signal: they cost six triangles each and they are
          the detail that says "chef's knife" from across the viewport. */}
      {[-1.25, -2.4, -3.55].map((z) => (
        <mesh key={z} position={[0, HANDLE_THICK_IN - 0.03, z]} castShadow>
          <cylinderGeometry args={[0.085, 0.085, 0.07, 14]} />
          <meshStandardMaterial color="#aab1ba" metalness={0.92} roughness={0.3} />
        </mesh>
      ))}
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
