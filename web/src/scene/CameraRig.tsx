import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Viewpoint } from './types'

/**
 * Free orbit, plus smooth flights to the Blender camera viewpoints. Any drag or
 * scroll by the visitor cancels a flight in progress.
 */
export function CameraRig({ view }: { view: Viewpoint }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const flight = useRef<{ pos: Vector3; target: Vector3; fov: number } | null>(null)

  useEffect(() => {
    flight.current = {
      pos: new Vector3(...view.position),
      target: new Vector3(...view.target),
      fov: view.fov,
    }
  }, [view])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const cancel = () => (flight.current = null)
    c.addEventListener('start', cancel)
    return () => c.removeEventListener('start', cancel)
  }, [])

  useFrame((_, dt) => {
    const f = flight.current
    const c = controls.current
    if (!f || !c) return
    const k = 1 - Math.exp(-dt * 2.5) // frame-rate independent ease
    camera.position.lerp(f.pos, k)
    c.target.lerp(f.target, k)
    camera.fov += (f.fov - camera.fov) * k
    camera.updateProjectionMatrix()
    if (camera.position.distanceTo(f.pos) < 0.02 && c.target.distanceTo(f.target) < 0.02) {
      flight.current = null
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={0.5}
      maxDistance={140}
      maxPolarAngle={Math.PI * 0.55}
    />
  )
}
