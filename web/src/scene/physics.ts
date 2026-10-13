import { Box3, DoubleSide, Line3, Ray, Vector3 } from 'three'
import type { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh'

// Player body, in metres. Kept free of React so it can be tested in Node.
export const RADIUS = 0.3
export const HEIGHT = 1.7 // feet to top of head
export const EYE = 1.6
/** Anything lower than this (stairs, porch steps, rugs, clutter) is stepped onto. */
export const STEP = 0.45
/** How far below the feet the ground still counts as underfoot (walking down stairs). */
const SNAP = 0.3
const GRAVITY = -18
const SUBSTEPS = 5

export interface Body {
  feet: Vector3
  velocity: Vector3
  onGround: boolean
}

export const createBody = (feet: Vector3): Body => ({ feet: feet.clone(), velocity: new Vector3(), onGround: false })

const seg = new Line3()
const box = new Box3()
const triPoint = new Vector3()
const capPoint = new Vector3()
const ray = new Ray(new Vector3(), new Vector3(0, -1, 0))

/**
 * Advance the body by dt seconds. `move` is the desired horizontal velocity.
 * Walls are handled by a capsule that floats STEP above the feet; the floor by a
 * downward ray, which is what lets the body walk up and down steps.
 */
export function stepBody(bvh: MeshBVH, body: Body, move: Vector3, jump: boolean, frameDt: number) {
  const dt = Math.min(frameDt, 0.05) / SUBSTEPS
  const { feet, velocity } = body
  if (jump && body.onGround) {
    velocity.y = 4.5
    body.onGround = false
  }

  for (let s = 0; s < SUBSTEPS; s++) {
    if (!body.onGround) velocity.y += GRAVITY * dt
    feet.x += move.x * dt
    feet.z += move.z * dt
    feet.y += velocity.y * dt

    // Walls: push the floating capsule out of anything it overlaps (horizontally).
    seg.start.set(feet.x, feet.y + STEP + RADIUS, feet.z)
    seg.end.set(feet.x, feet.y + HEIGHT - RADIUS, feet.z)
    box.makeEmpty().expandByPoint(seg.start).expandByPoint(seg.end)
    box.min.addScalar(-RADIUS)
    box.max.addScalar(RADIUS)
    let ceiling = false
    bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri: ExtendedTriangle) => {
        const d = tri.closestPointToSegment(seg, triPoint, capPoint)
        if (d >= RADIUS) return
        const push = capPoint.sub(triPoint).normalize().multiplyScalar(RADIUS - d)
        if (push.y < 0 && velocity.y > 0) ceiling = true
        push.y = 0
        seg.start.add(push)
        seg.end.add(push)
      },
    })
    feet.x = seg.start.x
    feet.z = seg.start.z
    if (ceiling) velocity.y = 0

    // Floor: highest surface under the body, within step height above the feet.
    ray.origin.set(feet.x, feet.y + STEP, feet.z)
    const hit = bvh.raycastFirst(ray, DoubleSide)
    const reach = STEP + (body.onGround ? SNAP : 0)
    if (hit && velocity.y <= 0 && hit.distance <= reach + 1e-3) {
      feet.y = hit.point.y
      velocity.y = 0
      body.onGround = true
    } else {
      body.onGround = false
    }
  }
}
