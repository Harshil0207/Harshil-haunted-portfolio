export type Vec3 = [number, number, number]

export interface Manifest {
  /** bounds are Y-up but min/max per axis may be swapped (z is negated). */
  chunks: { name: string; file: string; tris: number; bounds: [Vec3, Vec3] }[]
  dynamic?: string
}

export interface Viewpoint {
  name: string
  position: Vec3
  target: Vec3
  fov: number
}

/** fx.json is written by blender/pipeline/prepare.py in Blender's Z-up space. */
export interface Fx {
  cobwebs: { name: string; strands: Vec3[][] }[]
  volumes: { name: string; bounds: [Vec3, Vec3]; color: Vec3; density: number }[]
  emitters: { name: string; bounds: [Vec3, Vec3]; count: number }[]
  /** Already Y-up. */
  lights?: { name: string; type: string; position: Vec3; color: Vec3; energy: number; flicker: boolean }[]
  /** Already Y-up; each is [min, max] or null. */
  weather?: { clouds: [Vec3, Vec3] | null; bolts: [Vec3, Vec3] | null; groundFog: [Vec3, Vec3] | null }
}

/** Blender Z-up -> three.js Y-up (same conversion the glTF exporter applies). */
export const yUp = ([x, y, z]: Vec3): Vec3 => [x, z, -y]
