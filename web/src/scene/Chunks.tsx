import { useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo } from 'react'
import { Mesh, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace } from 'three'
import { registerCollider } from './collision'
import { bakedMaterials } from './storm'
import type { Manifest } from './types'

/**
 * One static chunk: a single mesh whose texture already contains the baked
 * lighting, so it is drawn unlit (no lights, no shadows, one draw call).
 */
function Chunk({ name, file }: { name: string; file: string }) {
  const { scene } = useGLTF(`/scene/${file}`)
  useEffect(() => {
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) registerCollider(name, o as Mesh)
    })
  }, [name, scene])
  useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const map = (mesh.material as MeshStandardMaterial).map
      if (map) {
        map.colorSpace = SRGBColorSpace
        map.anisotropy = 4
      }
      // The bake already went through Blender's AgX view transform.
      const baked = new MeshBasicMaterial({ map, toneMapped: false })
      bakedMaterials.add(baked)
      mesh.material = baked
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
    })
  }, [scene])
  return <primitive object={scene} />
}

/** Each chunk suspends on its own, so the manor streams in piece by piece. */
export function Chunks({ manifest }: { manifest: Manifest }) {
  return (
    <>
      {manifest.chunks.map((c) => (
        <Suspense key={c.name} fallback={null}>
          <Chunk name={c.name} file={c.file} />
        </Suspense>
      ))}
    </>
  )
}
