import { PerformanceMonitor, Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useMemo, useState } from 'react'
import { AgXToneMapping } from 'three'
import { Atmosphere, box } from './Atmosphere'
import { CameraRig } from './CameraRig'
import { Chunks } from './Chunks'
import { Dynamic } from './Dynamic'
import { Glows } from './Glows'
import { Player } from './Player'
import type { Fx, Manifest, Viewpoint } from './types'
import { Weather } from './Weather'

const FOG = '#0b1416'
const params = new URLSearchParams(location.search)
const showStats = params.has('stats')
/** Debug: ?off=chunks,dynamic,atmosphere,glows,weather disables parts of the scene. */
const off = new Set((params.get('off') ?? '').split(','))

export type Mode = 'walk' | 'orbit'

export function Experience({ manifest, fx, view, mode, onLockChange }: {
  manifest: Manifest
  fx: Fx
  view: Viewpoint
  mode: Mode
  onLockChange: (locked: boolean) => void
}) {
  const houseChunk = manifest.chunks.find((c) => c.name === 'house_exterior')
  const house = useMemo(() => houseChunk && box(houseChunk.bounds, false), [houseChunk])
  // Start sharp, drop resolution if the GPU can't hold the frame rate.
  const [dpr, setDpr] = useState(Math.min(window.devicePixelRatio, 1.5))

  return (
    <Canvas
      dpr={dpr}
      camera={{ position: view.position, fov: view.fov, near: 0.05, far: 700 }}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: AgXToneMapping }}
      // Dev only: lets the browser console reach the three.js state (camera, scene).
      onCreated={(state) => {
        if (import.meta.env.DEV) (window as unknown as { __r3f: typeof state }).__r3f = state
      }}
    >
      <PerformanceMonitor
        onDecline={() => setDpr((d) => Math.max(0.75, d - 0.25))}
        onIncline={() => setDpr((d) => Math.min(window.devicePixelRatio, 1.5, d + 0.25))}
      />
      <color attach="background" args={[FOG]} />
      <fogExp2 attach="fog" args={[FOG, 0.012]} />

      {/* Only the animated objects use real-time lights; everything else is baked. */}
      <hemisphereLight args={['#5b7f8a', '#140d0a', 0.6]} />
      <directionalLight position={[-20, 40, 25]} intensity={0.8} color="#9fb8ff" />
      <pointLight position={[0, 4, -8]} intensity={25} distance={18} color="#ff9a4a" />

      {!off.has('chunks') && <Chunks manifest={manifest} />}
      {manifest.dynamic && !off.has('dynamic') && (
        <Suspense fallback={null}>
          <Dynamic file={manifest.dynamic} house={house} />
        </Suspense>
      )}
      {!off.has('atmosphere') && <Atmosphere fx={fx} manifest={manifest} />}
      {!off.has('glows') && <Glows fx={fx} />}
      {!off.has('weather') && <Weather fx={fx} manifest={manifest} />}
      {mode === 'walk' ? <Player spawn={view} onLockChange={onLockChange} /> : <CameraRig view={view} />}
      {showStats && <Stats />}
    </Canvas>
  )
}
