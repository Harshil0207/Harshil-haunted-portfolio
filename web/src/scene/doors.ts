import { AnimationClip, Box3, Matrix4, Mesh, Object3D, Vector3 } from 'three'

// Upper-floor room doors (OPENABLE in blender/pipeline/common.py) and the front door.
const DOOR = /^(UF_Door_|HOUSE_Door_Front$)/
const OPEN_WITHIN = 2.2 // metres from the door
const CLOSE_BEYOND = 3.5
const SAME_FLOOR = 2.5 // vertical reach, so doors don't open for someone on the floor below
const OPEN_ANGLE = 1.75 // ~100 degrees
const SPEED = 3 // ease rate

export interface Doors {
  update(viewer: Vector3, dt: number): void
}

interface Door {
  node: Object3D
  restWorld: Matrix4
  parentInv: Matrix4
  center: Vector3
  hinge: Vector3
  swing: Vector3 // world direction the free edge moves for a positive angle
  angle: number
  target: number
}

const UP = new Vector3(0, 1, 0)

/** True for clips that move a door this module drives (e.g. the front door's slam scare): they must not play. */
export const isDoorClip = (clip: AnimationClip) =>
  clip.tracks.some((t) => DOOR.test(t.name.slice(0, t.name.lastIndexOf('.'))))

/**
 * Room doors and the front door swing open, away from the visitor, when they walk up
 * and close again when they leave. Doors are not in the collider.
 *
 * Compression re-centres meshes, so the Blender hinge origin is lost: the hinge
 * is found from the geometry instead, as the vertical edge opposite the knob.
 */
export function createDoors(scene: Object3D): Doors | null {
  const doors: Door[] = []
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    if (!DOOR.test(o.name) || doors.some((d) => d.node === o || isAncestor(d.node, o))) return
    const hinge = findHinge(o)
    if (!hinge) return
    const center = new Box3().setFromObject(o).getCenter(new Vector3())
    const edge = center.clone().sub(hinge).setY(0)
    doors.push({
      node: o,
      restWorld: o.matrixWorld.clone(),
      parentInv: o.parent ? o.parent.matrixWorld.clone().invert() : new Matrix4(),
      center,
      hinge,
      swing: new Vector3().crossVectors(UP, edge).normalize(),
      angle: 0,
      target: 0,
    })
  })
  if (!doors.length) return null

  const toViewer = new Vector3()
  const m = new Matrix4()
  const rot = new Matrix4()
  return {
    update(viewer, dt) {
      for (const d of doors) {
        const dist = Math.hypot(viewer.x - d.center.x, viewer.z - d.center.z)
        const near = Math.abs(viewer.y - d.center.y) < SAME_FLOOR
        const isOpen = d.target !== 0
        if (!isOpen && near && dist < OPEN_WITHIN) {
          // Push the door away from the visitor.
          toViewer.subVectors(viewer, d.hinge).setY(0)
          d.target = toViewer.dot(d.swing) > 0 ? -OPEN_ANGLE : OPEN_ANGLE
        } else if (isOpen && (!near || dist > CLOSE_BEYOND)) {
          d.target = 0
        }
        if (d.angle === d.target) continue
        d.angle += (d.target - d.angle) * (1 - Math.exp(-dt * SPEED))
        if (Math.abs(d.target - d.angle) < 1e-3) d.angle = d.target
        // world = T(hinge) * Ry(angle) * T(-hinge) * rest, then back into the parent's space.
        m.makeTranslation(d.hinge.x, d.hinge.y, d.hinge.z)
          .multiply(rot.makeRotationY(d.angle))
          .multiply(rot.makeTranslation(-d.hinge.x, -d.hinge.y, -d.hinge.z))
          .multiply(d.restWorld)
        m.premultiply(d.parentInv).decompose(d.node.position, d.node.quaternion, d.node.scale)
      }
    },
  }
}

/** World-space hinge point: bottom of the door's long horizontal edge furthest from the knob. */
function findHinge(door: Object3D): Vector3 | null {
  const pts: Vector3[] = []
  door.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) pts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld))
  })
  if (!pts.length) return null
  const box = new Box3().setFromPoints(pts)
  const size = box.getSize(new Vector3())
  const c = box.getCenter(new Vector3())
  const along = size.x >= size.z ? 'x' : 'z' // door width
  const across = along === 'x' ? 'z' : 'x' // door thickness
  // The knob sticks out furthest from the door face.
  const reach = Math.max(...pts.map((p) => Math.abs(p[across] - c[across])))
  const knob = pts.filter((p) => Math.abs(p[across] - c[across]) > reach * 0.8)
  const knobSide = knob.reduce((s, p) => s + p[along], 0) / knob.length - c[along]
  const hinge = c.clone().setY(box.min.y)
  hinge[along] = knobSide > 0 ? box.min[along] : box.max[along]
  return hinge
}

function isAncestor(a: Object3D, b: Object3D) {
  for (let o = b.parent; o; o = o.parent) if (o === a) return true
  return false
}
