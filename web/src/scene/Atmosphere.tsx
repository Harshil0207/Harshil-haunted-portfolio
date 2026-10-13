import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial } from 'three'
import { yUp, type Fx, type Manifest, type Vec3 } from './types'

/** All cobweb strands in one LineSegments draw call. */
export function Cobwebs({ fx }: { fx: Fx }) {
  const geometry = useMemo(() => {
    const pts: number[] = []
    for (const web of fx.cobwebs)
      for (const s of web.strands)
        for (let i = 1; i < s.length; i++) pts.push(...yUp(s[i - 1]), ...yUp(s[i]))
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3))
    return g
  }, [fx])
  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#b9c4c2" transparent opacity={0.28} depthWrite={false} />
    </lineSegments>
  )
}

/** Axis-aligned box from a pair of corners (converted from Blender Z-up unless told not to). */
export const box = (bounds: [Vec3, Vec3], blenderSpace = true) => {
  const [a, b] = blenderSpace ? bounds.map(yUp) : bounds
  return { min: a.map((v, i) => Math.min(v, b[i])), max: a.map((v, i) => Math.max(v, b[i])) }
}

/**
 * GPU-animated particles in a box: every particle's motion is computed in the
 * vertex shader from its seed, so there is no per-frame CPU work.
 */
function Particles({ min, max, count, mode, hole }: {
  min: number[]
  max: number[]
  count: number
  mode: 'dust' | 'rain'
  /** particles inside this box are hidden (keeps rain out of the house) */
  hole?: { min: number[]; max: number[] }
}) {
  const mat = useRef<ShaderMaterial>(null)
  const geometry = useMemo(() => {
    const seeds = new Float32Array(count * 3)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(seeds, 3))
    return g
  }, [count])
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMin: { value: min },
      uMax: { value: max },
      uHoleMin: { value: hole?.min ?? [0, 0, 0] },
      uHoleMax: { value: hole?.max ?? [0, 0, 0] },
    }),
    [min, max, hole],
  )
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt
  })
  const rain = mode === 'rain'
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        vertexShader={/* glsl */ `
          uniform float uTime; uniform vec3 uMin, uMax, uHoleMin, uHoleMax;
          varying float vA;
          void main() {
            vec3 s = position, size = uMax - uMin;
            vec3 p = uMin + s * size;
            ${rain
              ? `p.y = uMax.y - mod(s.y * size.y + uTime * (14.0 + s.x * 4.0), size.y);
                 p.x += uTime * 1.5 - floor((uTime * 1.5) / size.x) * size.x;`
              : `p += vec3(sin(uTime * 0.21 + s.y * 40.0), sin(uTime * 0.13 + s.z * 30.0) * 0.6,
                           cos(uTime * 0.17 + s.x * 50.0)) * 0.35;`}
            p = uMin + mod(p - uMin, size);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = ${rain ? '2.0' : '3.0'} * (6.0 / -mv.z);
            vA = ${rain ? '0.35' : '0.55'} * smoothstep(60.0, 2.0, -mv.z);
            vec3 inHole = step(uHoleMin, p) * step(p, uHoleMax);
            vA *= 1.0 - inHole.x * inHole.y * inHole.z;
          }`}
        fragmentShader={/* glsl */ `
          varying float vA;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = ${rain ? 'step(abs(c.x), 0.12)' : 'smoothstep(0.5, 0.0, length(c))'};
            gl_FragColor = vec4(vec3(${rain ? '0.55, 0.65, 0.75' : '1.0, 0.85, 0.6'}), d * vA);
          }`}
      />
    </points>
  )
}

export function Atmosphere({ fx, manifest }: { fx: Fx; manifest: Manifest }) {
  const dust = fx.emitters.find((e) => /dust/i.test(e.name))
  const dustBox = useMemo(() => dust && box(dust.bounds), [dust])
  const house = manifest.chunks.find((c) => c.name === 'house_exterior')
  const hole = useMemo(() => house && box(house.bounds, false), [house])
  return (
    <>
      <Cobwebs fx={fx} />
      {dustBox && <Particles {...dustBox} count={1500} mode="dust" />}
      {/* Rain falls over the grounds, around (not inside) the house. */}
      <Particles min={[-45, 0, -40]} max={[45, 30, 50]} count={9000} mode="rain" hole={hole} />
    </>
  )
}
