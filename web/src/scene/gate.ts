import { AnimationAction, AnimationClip, AnimationMixer, LoopOnce, Object3D, Vector3 } from 'three'

const OPEN_WITHIN = 6 // metres from the gate (the Approach spawn is 9 m away)
const CLOSE_BEYOND = 12
const GATE_CLIP = /^PROP_Grounds_Gate/

/** True for clips this module drives (they must not autoplay). */
export const isGateClip = (name: string) => GATE_CLIP.test(name)

export interface Gate {
  update(viewer: Vector3): void
}

/**
 * The gate opens when the visitor walks up to it and closes when they leave.
 * In Blender the chain drops at frame 300 and the doors swing open over frames
 * 313-457; the clips are shifted so that sequence starts at t=0.
 */
export function createGate(scene: Object3D, clips: AnimationClip[], mixer: AnimationMixer): Gate | null {
  const gateClips = clips.filter((c) => isGateClip(c.name))
  if (!gateClips.length) return null

  // Shift every gate clip by the same amount so the chain and doors stay in sync.
  const start = Math.min(...gateClips.flatMap((c) => c.tracks.map((t) => t.times[0])))
  const actions: AnimationAction[] = gateClips.map((c) => {
    const clip = c.clone()
    for (const t of clip.tracks) t.shift(-start)
    clip.resetDuration()
    const a = mixer.clipAction(clip, scene) // drei's mixer has no default root
    a.setLoop(LoopOnce, 1)
    a.clampWhenFinished = true
    a.play()
    a.paused = true // closed
    return a
  })

  // Gate position: the middle of the door nodes.
  const center = new Vector3()
  let n = 0
  for (const c of gateClips) {
    const node = scene.getObjectByName(c.name.replace(/Action$/, ''))
    if (node) {
      center.add(node.getWorldPosition(new Vector3()))
      n++
    }
  }
  if (!n) return null
  center.divideScalar(n)

  let open = false
  return {
    update(viewer: Vector3) {
      const d = Math.hypot(viewer.x - center.x, viewer.z - center.z)
      const want = open ? d < CLOSE_BEYOND : d < OPEN_WITHIN
      if (want === open) return
      open = want
      for (const a of actions) {
        a.timeScale = open ? 1 : -1.5 // closing is a bit quicker
        a.paused = false
        if (!a.isRunning() && !a.paused) a.play()
      }
    },
  }
}
