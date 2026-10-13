import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, PerspectiveCamera } from 'three'
import type { Fx } from './types'

const FLAME = /candle|torch|fire|flame|havan|diya|lamp|lantern|camphor|agarbatti/i

/**
 * The Blender lights themselves are baked into the walls; this draws the glow
 * around each light source (one draw call for all of them). Flames flicker.
 */
export function Glows({ fx }: { fx: Fx }) {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera) as PerspectiveCamera

  const geometry = useMemo(() => {
    const lights = fx.lights ?? []
    const pos = new Float32Array(lights.length * 3)
    const col = new Float32Array(lights.length * 3)
    const data = new Float32Array(lights.length * 3) // radius, flicker, seed
    lights.forEach((l, i) => {
      pos.set(l.position, i * 3)
      col.set(l.color, i * 3)
      // Bigger halo for stronger lights; sqrt keeps the porch lamp from dwarfing candles.
      const radius = Math.min(1.6, 0.18 + Math.sqrt(l.energy) * 0.12)
      data.set([radius, FLAME.test(l.name) ? 1 : 0, Math.random() * 100], i * 3)
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('color', new BufferAttribute(col, 3))
    g.setAttribute('data', new BufferAttribute(data, 3))
    return g
  }, [fx])

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uScale: { value: 1 } }), [])
  useFrame((_, dt) => {
    uniforms.uTime.value += dt
    // World-size -> pixels for gl_PointSize.
    uniforms.uScale.value = (size.height * Math.min(devicePixelRatio, 1.5)) / (2 * Math.tan((camera.fov * Math.PI) / 360))
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        vertexShader={/* glsl */ `
          uniform float uTime, uScale;
          attribute vec3 color, data;
          varying vec3 vColor;
          varying float vIntensity;
          void main() {
            float flicker = data.y * (0.18 * sin(uTime * 13.0 + data.z) + 0.12 * sin(uTime * 23.0 + data.z * 1.7));
            vIntensity = 0.85 + flicker;
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(data.x * 2.0 * uScale / -mv.z, 0.0, 256.0);
          }`}
        fragmentShader={/* glsl */ `
          varying vec3 vColor;
          varying float vIntensity;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float core = exp(-d * d * 18.0);
            float halo = exp(-d * d * 3.5) * 0.35;
            gl_FragColor = vec4(vColor * (core + halo) * vIntensity, 1.0) * (1.0 - smoothstep(0.85, 1.0, d));
          }`}
      />
    </points>
  )
}
