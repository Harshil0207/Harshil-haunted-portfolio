import {
  AdditiveBlending,
  Color,
  CustomBlending,
  type Material,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
} from 'three'

/**
 * Shared lightning state. Weather.tsx drives `flash` (0..1); everything that
 * should light up during a strike reads it.
 */
export const storm = { flash: 0 }

/** Baked chunk materials; tinted brighter during a flash (the bake can't move). */
export const bakedMaterials = new Set<MeshBasicMaterial>()

/** Lightning colour: bolts, sky glow and the flash on the scene. */
export const STORM_COLOR = new Color('#ff2a1f')

/** Added on top of white at full flash, so the whole manor glows red. */
const FLASH_TINT = new Color(1.3, 0.25, 0.18)
const tint = new Color()

export function applyFlashToBaked(flash: number) {
  tint.setRGB(1 + FLASH_TINT.r * flash, 1 + FLASH_TINT.g * flash, 1 + FLASH_TINT.b * flash)
  for (const m of bakedMaterials) m.color.copy(tint)
}

/**
 * Sky layers are drawn first, in order (clouds, moon, halo), without depth, so
 * the moon stays clear, its halo glows over the clouds, and every piece of the
 * world still draws in front of the sky.
 */
export const SKY_ORDER = { clouds: -3000, moon: -2900, halo: -2800 }

export function makeSkyLayer(material: Material) {
  const additive = material.blending === AdditiveBlending
  material.transparent = false // keep it in the opaque pass, which is sorted by renderOrder
  material.blending = CustomBlending
  material.blendSrc = SrcAlphaFactor
  material.blendDst = additive ? OneFactor : OneMinusSrcAlphaFactor
  material.depthTest = false
  material.depthWrite = false
}
