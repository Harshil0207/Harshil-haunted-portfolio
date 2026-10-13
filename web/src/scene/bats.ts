import { Bone, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'

/**
 * Bats are animated here instead of from the glTF: in Blender their wing flap is
 * a repeating NLA strip and the flight only starts at frame 1801, neither of
 * which survives export. Burst bats circle the tower; roosting bats hang and
 * twitch their wings now and then.
 *
 * Rig: body (points forward, +Y in bone space) -> wing.L/R -> wingtip.L/R.
 * Flapping rotates each wing about the body's forward axis.
 */
const FORWARD = new Vector3(0, 1, 0) // body bone space
const BACK = new Vector3()
const tmpQ = new Quaternion()
const vel = new Vector3()
const target = new Vector3()

interface Wing {
  bone: Bone
  rest: Quaternion
  side: 1 | -1
  tip: boolean
  /** what we set last frame */
  written: Quaternion
}

interface Bat {
  rig: Object3D
  wings: Wing[]
  flying: boolean
  phase: number
  flapHz: number
  radius: number
  height: number
  speed: number
  restPos: Vector3
  restQuat: Quaternion
}

export interface BatFlock {
  update(time: number): void
}

// GLTFLoader strips "." and de-duplicates names: "wing.L" -> "wingL", "wingL_3"...
const WING = /^wing(tip)?\.?([LR])(_\d+)?$/

/** Where to fly: the house's bounding box (three.js Y-up), so loops stay outside it. */
export interface FlightArea {
  min: number[]
  max: number[]
}

export function createBatFlock(scene: Object3D, area?: FlightArea): BatFlock | null {
  const rigs: Object3D[] = []
  scene.traverse((o) => {
    if (/^BAT_(Burst|Roost)_\d+_Rig$/.test(o.name)) rigs.push(o)
  })
  if (!rigs.length) return null

  const flyers = rigs.filter((r) => r.name.includes('Burst'))
  // Circle the whole house, above the roofline, so the flight is actually visible
  // (around the roost they spent their time hidden inside the roof).
  const center = new Vector3()
  let baseRadius = 14
  let roof = 0
  if (area) {
    center.set((area.min[0] + area.max[0]) / 2, 0, (area.min[2] + area.max[2]) / 2)
    baseRadius = Math.max(area.max[0] - area.min[0], area.max[2] - area.min[2]) * 0.5 + 6
    roof = area.max[1] * 0.8 // main roofs; the spire pokes above
  } else {
    for (const r of flyers) center.add(r.getWorldPosition(target))
    center.divideScalar(Math.max(1, flyers.length))
    roof = center.y
  }

  const bats: Bat[] = rigs.map((rig, i) => {
    scene.attach(rig) // world-space control, independent of the master rig
    const wings: Wing[] = []
    rig.traverse((o) => {
      const m = WING.exec(o.name)
      if (m && (o as Bone).isBone)
        wings.push({
          bone: o as Bone,
          rest: o.quaternion.clone(),
          side: m[2] === 'L' ? 1 : -1,
          tip: !!m[1],
          written: new Quaternion(NaN, NaN, NaN, NaN),
        })
      if ((o as SkinnedMesh).isSkinnedMesh) o.frustumCulled = false // bounds don't follow the flight
    })
    const flying = rig.name.includes('Burst')
    return {
      rig,
      wings,
      flying,
      phase: i * 1.7,
      flapHz: flying ? 7 + (i % 4) : 0,
      radius: baseRadius + (i % 5) * 2.5,
      height: roof + 2 + ((i * 7) % 7),
      speed: (0.35 + (i % 3) * 0.12) * (i % 2 ? 1 : -1),
      restPos: rig.position.clone(),
      restQuat: rig.quaternion.clone(),
    }
  })

  return {
    update(t: number) {
      for (const b of bats) {
        // Wings: flying bats flap continuously, roosting bats twitch every few seconds.
        let flap = 0
        if (b.flying) flap = Math.sin(t * b.flapHz * Math.PI * 2 + b.phase)
        else {
          const cycle = (t + b.phase * 3) % 5
          flap = cycle < 0.8 ? Math.sin(cycle * Math.PI * 6) * 0.5 : 0
        }
        for (const w of b.wings) {
          const angle = (w.tip ? 0.5 : 0.95) * flap * w.side
          // Flyers flap from the spread rest pose; roosting bats twitch on top of
          // the hang pose the animation mixer wrote this frame.
          // If nothing wrote the bone since our last frame, start from rest again
          // (otherwise the rotation would compound frame after frame).
          if (b.flying || w.bone.quaternion.equals(w.written)) w.bone.quaternion.copy(w.rest)
          w.bone.quaternion.premultiply(tmpQ.setFromAxisAngle(FORWARD, angle))
          w.written.copy(w.bone.quaternion)
        }

        if (!b.flying) {
          // Hanging: a slow sway.
          b.rig.position.copy(b.restPos)
          b.rig.quaternion.copy(b.restQuat)
          b.rig.rotateZ(Math.sin(t * 0.8 + b.phase) * 0.08)
          continue
        }
        // Flight: a wobbly loop around the tower, rising and dipping, banking into the turn.
        const a = t * b.speed + b.phase
        const r = b.radius + Math.sin(t * 0.37 + b.phase) * 3
        b.rig.position.set(
          center.x + Math.cos(a) * r,
          b.height + Math.sin(t * 0.9 + b.phase) * 2.5 + flap * 0.08,
          center.z + Math.sin(a) * r,
        )
        vel.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.sign(b.speed))
        // Rig forward is -Z (Blender +Y); lookAt aims +Z, so look at a point behind.
        b.rig.lookAt(BACK.copy(b.rig.position).sub(vel))
        b.rig.rotateZ(-Math.sign(b.speed) * 0.35)
      }
    },
  }
}
