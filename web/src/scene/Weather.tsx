import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Fog,
  FogExp2,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from 'three'
import { box } from './Atmosphere'
import { applyFlashToBaked, makeSkyLayer, SKY_ORDER, storm, STORM_COLOR } from './storm'
import type { Fx, Manifest, Vec3 } from './types'

/** Cheap value-noise fbm shared by the cloud and mist shaders. */
const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }`

/**
 * Storm clouds on a dome that follows the camera (so they always look far away).
 * The dome is closer than the moon, so clouds drift across it; they get moonlit
 * edges, and glow from inside when lightning strikes.
 */
function Clouds() {
  const mesh = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uFlash: { value: 0 }, uStorm: { value: STORM_COLOR } }),
    [],
  )
  useFrame((_, dt) => {
    uniforms.uTime.value += dt
    uniforms.uFlash.value = storm.flash
    mesh.current?.position.copy(camera.position)
  })
  return (
    <mesh ref={mesh} renderOrder={SKY_ORDER.clouds} frustumCulled={false}>
      <sphereGeometry args={[70, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
      <shaderMaterial
        ref={(m) => m && makeSkyLayer(m)}
        uniforms={uniforms}
        side={BackSide}
        fog={false}
        vertexShader={/* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`}
        fragmentShader={/* glsl */ `
          uniform float uTime, uFlash;
          uniform vec3 uStorm;
          varying vec3 vDir;
          ${NOISE}
          void main() {
            float up = max(vDir.y, 0.0);
            // Project onto a cloud layer overhead: far clouds bunch up at the horizon.
            vec2 p = vDir.xz / (up + 0.18) * 1.6 + vec2(uTime * 0.035, uTime * 0.012);
            float n = fbm(p + 0.6 * fbm(p * 0.6 - uTime * 0.02));
            float cover = smoothstep(0.5, 0.82, n); // broken cover: the moon shows through
            float lit = smoothstep(0.55, 0.85, fbm(p * 1.3 + 4.0)); // moonlit tops
            vec3 col = mix(vec3(0.05, 0.07, 0.08), vec3(0.32, 0.38, 0.4), lit * 0.7 + n * 0.2);
            col += uStorm * uFlash * (0.6 + 0.8 * n);
            float horizon = smoothstep(0.0, 0.12, up); // fade out below the hills
            gl_FragColor = vec4(col, cover * horizon * 0.75);
          }`}
      />
    </mesh>
  )
}

const SKY_FLASH = new Color('#5a0d0a')
const FOG_FLASH = new Color('#3a0907')

/** A jagged bolt from the clouds towards the ground, as line segments. */
function boltGeometry(top: Vec3, groundY: number) {
  const pts: number[] = []
  const branch = (x: number, y: number, z: number, length: number, depth: number) => {
    const steps = Math.max(4, Math.round(length / 3))
    const dy = length / steps
    for (let i = 0; i < steps && y > groundY; i++) {
      const nx = x + (Math.random() - 0.5) * 3.5
      const nz = z + (Math.random() - 0.5) * 3.5
      const ny = y - dy * (0.7 + Math.random() * 0.6)
      pts.push(x, y, z, nx, ny, nz)
      if (depth < 2 && Math.random() < 0.18) branch(nx, ny, nz, length * 0.35, depth + 1)
      ;[x, y, z] = [nx, ny, nz]
    }
  }
  branch(top[0], top[1], top[2], top[1] - groundY, 0)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3))
  return g
}

/**
 * Thunderstorm: a strike every 6-16 s with a double flicker. The flash brightens
 * the baked chunks, the sky/fog, the real-time lights and the clouds.
 */
function Lightning({ area }: { area: [Vec3, Vec3] }) {
  const scene = useThree((s) => s.scene)
  const bolt = useRef<LineSegments>(null)
  const state = useRef({ next: 4, t: -1, base: new Color(), baseFog: new Color(), hemi: 0 })
  const material = useMemo(
    () => new LineBasicMaterial({ color: STORM_COLOR, transparent: true, opacity: 0, blending: AdditiveBlending, fog: false }),
    [],
  )

  useFrame((_, dt) => {
    const s = state.current
    const bg = scene.background instanceof Color ? scene.background : null
    const fog = scene.fog as Fog | FogExp2 | null
    const hemi = scene.getObjectByProperty('type', 'HemisphereLight') as HemisphereLight | undefined
    if (s.t < 0) {
      s.next -= dt
      if (s.next > 0 || !bolt.current) return
      // New strike: remember the calm values, grow a new bolt somewhere in the storm area.
      if (bg) s.base.copy(bg)
      if (fog) s.baseFog.copy(fog.color)
      if (hemi) s.hemi = hemi.intensity
      const [lo, hi] = area
      const top: Vec3 = [lo[0] + Math.random() * (hi[0] - lo[0]), hi[1], lo[2] + Math.random() * (hi[2] - lo[2])]
      bolt.current.geometry.dispose()
      bolt.current.geometry = boltGeometry(top, 0)
      s.t = 0
    }
    s.t += dt
    // Two quick flickers, then a fast fade.
    const t = s.t
    const flash = t < 0.08 ? 1 : t < 0.16 ? 0.25 : t < 0.26 ? 0.9 : 0.9 * Math.exp(-(t - 0.26) * 5)
    const done = t > 1.6
    const f = done ? 0 : flash
    storm.flash = f
    material.opacity = t < 0.3 ? f : 0
    applyFlashToBaked(f * 0.9)
    if (bg) bg.copy(s.base).lerp(SKY_FLASH, f * 0.8)
    if (fog) fog.color.copy(s.baseFog).lerp(FOG_FLASH, f * 0.7)
    if (hemi) hemi.intensity = s.hemi * (1 + f * 4)
    if (done) {
      s.t = -1
      s.next = 6 + Math.random() * 10
    }
  })

  return <lineSegments ref={bolt} material={material} frustumCulled={false} />
}

/** Low ground mist: a few stacked noise layers hugging the ground, kept out of the house. */
function GroundMist({ bounds, hole }: { bounds: { min: number[]; max: number[] }; hole?: { min: number[]; max: number[] } }) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uStorm: { value: STORM_COLOR },
      uHoleMin: { value: hole?.min ?? [0, 0, 0] },
      uHoleMax: { value: hole?.max ?? [0, 0, 0] },
    }),
    [hole],
  )
  useFrame((_, dt) => {
    uniforms.uTime.value += dt
    uniforms.uFlash.value = storm.flash
  })
  const w = bounds.max[0] - bounds.min[0]
  const d = bounds.max[2] - bounds.min[2]
  const cx = (bounds.max[0] + bounds.min[0]) / 2
  const cz = (bounds.max[2] + bounds.min[2]) / 2
  const mat = (
    <shaderMaterial
      uniforms={uniforms}
      transparent
      depthWrite={false}
      side={DoubleSide}
      vertexShader={/* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`}
      fragmentShader={/* glsl */ `
        uniform float uTime, uFlash;
        uniform vec3 uStorm, uHoleMin, uHoleMax;
        varying vec3 vWorld;
        ${NOISE}
        void main() {
          vec3 inHole = step(uHoleMin, vWorld) * step(vWorld, uHoleMax);
          if (inHole.x * inHole.y * inHole.z > 0.5) discard;
          vec2 p = vWorld.xz * 0.07 + vec2(uTime * 0.03, uTime * 0.012) + vWorld.y * 3.0;
          float n = smoothstep(0.35, 0.85, fbm(p));
          vec3 col = vec3(0.32, 0.4, 0.42) + uStorm * 0.6 * uFlash;
          gl_FragColor = vec4(col, n * 0.16);
        }`}
    />
  )
  return (
    <group position={[cx, 0, cz]}>
      {[0.15, 0.5, 0.95].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w, d]} />
          {mat}
        </mesh>
      ))}
    </group>
  )
}

export function Weather({ fx, manifest }: { fx: Fx; manifest: Manifest }) {
  const house = manifest.chunks.find((c) => c.name === 'house_exterior')
  const hole = useMemo(() => house && box(house.bounds, false), [house])
  const fog = fx.volumes.find((v) => v.name === 'PRS_Fog')
  const mist = useMemo(() => fog && box(fog.bounds), [fog])
  const w = fx.weather
  return (
    <>
      <Clouds />
      {w?.bolts && <Lightning area={w.bolts} />}
      {mist && <GroundMist bounds={mist} hole={hole} />}
    </>
  )
}
