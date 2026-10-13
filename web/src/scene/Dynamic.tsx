import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { LoopRepeat, Mesh, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace } from 'three'
import { createBatFlock, type FlightArea } from './bats'
import { createDoors, isDoorClip } from './doors'
import { createGate, isGateClip } from './gate'
import { bakedMaterials, makeSkyLayer, SKY_ORDER } from './storm'

/** Animated / emissive / transparent objects: bats, ghosts, flames, door... */
export function Dynamic({ file, house }: { file: string; house?: FlightArea }) {
  const { scene, animations } = useGLTF(`/scene/${file}`)
  const { actions, mixer } = useAnimations(animations, scene)

  useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as MeshStandardMaterial
      if (mat.name.startsWith('LM_') && mat.map) {
        // Animated prop with a lightmap baked in its rest pose: draw it like the chunks.
        mat.map.colorSpace = SRGBColorSpace
        const baked = new MeshBasicMaterial({ map: mat.map, toneMapped: false })
        bakedMaterials.add(baked)
        mesh.material = baked
        return
      }
      if (mat.name.startsWith('MAT_Moon')) {
        // Moon + halo are sky: drawn behind the clouds (see SKY_ORDER).
        mesh.renderOrder = mat.name === 'MAT_Moon' ? SKY_ORDER.moon : SKY_ORDER.halo
        mat.toneMapped = false // glowing, like the other emissive objects
        makeSkyLayer(mat)
        return
      }
      if (mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0) {
        mat.toneMapped = false // let flames and glows stay hot
      }
      if (mat.transparent) mat.depthWrite = false
    })
  }, [scene])

  useEffect(() => {
    for (const [name, a] of Object.entries(actions)) {
      if (!a || name.startsWith('BAT_') || isGateClip(name) || isDoorClip(a.getClip())) continue // driven by bats.ts / gate.ts / doors.ts
      // Clips with no length (single-key poses) would make the mixer produce NaN times.
      if (a.getClip().duration > 0) a.setLoop(LoopRepeat, Infinity).play()
    }
    // Roosting bats keep Blender's folded hang pose (that clip covers every bat,
    // so only the tracks under roost rigs are kept; flyers use the spread pose).
    const hang = animations.find((c) => c.name === 'BAT_Hang')
    if (hang) {
      const underRoost = (nodeName: string) => {
        for (let o = scene.getObjectByName(nodeName) ?? null; o; o = o.parent)
          if (o.name.startsWith('BAT_Roost_')) return true
        return false
      }
      const clip = hang.clone()
      clip.name = 'BAT_Hang_roost'
      clip.tracks = clip.tracks.filter((t) => underRoost(t.name.slice(0, t.name.lastIndexOf('.'))))
      mixer.clipAction(clip, scene).setLoop(LoopRepeat, Infinity).play()
    }
  }, [actions, animations, mixer, scene])

  const flock = useMemo(() => createBatFlock(scene, house), [scene, house])
  const gate = useMemo(() => createGate(scene, animations, mixer), [scene, animations, mixer])
  const doors = useMemo(() => createDoors(scene), [scene])
  useFrame(({ clock, camera }, dt) => {
    flock?.update(clock.elapsedTime)
    gate?.update(camera.position)
    doors?.update(camera.position, Math.min(dt, 0.1))
  })

  return <primitive object={scene} />
}
