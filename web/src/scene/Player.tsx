import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { getCollider, onCollidersChanged } from './collision'
import { createBody, EYE, stepBody } from './physics'
import type { Viewpoint } from './types'

const WALK = 3.2
const RUN = 6.5

const keys = new Set<string>()
const onKey = (e: KeyboardEvent) => {
  if (e.type === 'keydown') keys.add(e.code)
  else keys.delete(e.code)
}

/** First-person walk mode: WASD + mouse look, colliding with the baked chunks. */
export function Player({ spawn, onLockChange }: { spawn: Viewpoint; onLockChange: (locked: boolean) => void }) {
  const camera = useThree((s) => s.camera)
  const body = useRef(createBody(new Vector3()))
  const eyeY = useRef(0)
  const [ready, setReady] = useState(() => !!getCollider())

  useEffect(() => onCollidersChanged(() => setReady(true)), [])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      keys.clear()
    }
  }, [])

  // Spawn / teleport: stand at the viewpoint, looking at its target (level gaze).
  const respawn = () => {
    const [x, y, z] = spawn.position
    body.current = createBody(new Vector3(x, y - EYE + 0.2, z))
    eyeY.current = y
    camera.position.set(x, y, z)
    camera.lookAt(spawn.target[0], y, spawn.target[2])
  }
  useEffect(respawn, [spawn, camera])

  const forward = useRef(new Vector3())
  const right = useRef(new Vector3())
  const move = useRef(new Vector3())

  useFrame((_, dt) => {
    const collider = ready ? getCollider() : null
    if (!collider) return

    // Input, relative to where the camera faces (flattened to the ground).
    const f = camera.getWorldDirection(forward.current).setY(0).normalize()
    const r = right.current.crossVectors(f, camera.up).normalize()
    const m = move.current.set(0, 0, 0)
    if (keys.has('KeyW') || keys.has('ArrowUp')) m.add(f)
    if (keys.has('KeyS') || keys.has('ArrowDown')) m.sub(f)
    if (keys.has('KeyD') || keys.has('ArrowRight')) m.add(r)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) m.sub(r)
    if (m.lengthSq() > 0) m.normalize().multiplyScalar(keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK)

    const b = body.current
    stepBody(collider, b, m, keys.has('Space'), dt)
    if (b.feet.y < -30) respawn() // fell out of the world

    // Ease the eye height so stepping onto stairs doesn't jolt the view.
    const target = b.feet.y + EYE
    eyeY.current += (target - eyeY.current) * (1 - Math.exp(-dt * 18))
    if (Math.abs(target - eyeY.current) > 1) eyeY.current = target // falls/teleports: no lag
    camera.position.set(b.feet.x, eyeY.current, b.feet.z)
  })

  return (
    <PointerLockControls
      makeDefault
      selector="#walk-start"
      onLock={() => onLockChange(true)}
      onUnlock={() => onLockChange(false)}
    />
  )
}
