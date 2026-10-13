import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'

/**
 * Chunks register their meshes here as they stream in; the walk-mode player
 * collides against one BVH built from all of them (already in world space).
 */
const meshes = new Map<string, Mesh>()
const listeners = new Set<() => void>()
let bvh: MeshBVH | null = null

/** Chunks that are scenery, not something you can walk on or into. */
const NOT_SOLID = new Set(['backdrop'])

export function registerCollider(chunk: string, mesh: Mesh) {
  if (NOT_SOLID.has(chunk)) return
  meshes.set(chunk, mesh)
  bvh = null
  listeners.forEach((l) => l())
}

export function onCollidersChanged(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function getCollider(): MeshBVH | null {
  if (bvh || meshes.size === 0) return bvh
  let vertexCount = 0
  let indexCount = 0
  for (const m of meshes.values()) {
    vertexCount += m.geometry.attributes.position.count
    indexCount += m.geometry.index?.count ?? m.geometry.attributes.position.count
  }
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(indexCount)
  const v = new Vector3()
  let vo = 0
  let io = 0
  for (const m of meshes.values()) {
    m.updateWorldMatrix(true, false)
    // Positions may be quantized (meshopt); getX/Y/Z de-normalizes, matrixWorld rescales.
    const pos = m.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
      positions.set([v.x, v.y, v.z], (vo + i) * 3)
    }
    const index = m.geometry.index
    const n = index?.count ?? pos.count
    for (let i = 0; i < n; i++) indices[io + i] = vo + (index ? index.getX(i) : i)
    vo += pos.count
    io += n
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  bvh = new MeshBVH(geometry)
  return bvh
}
