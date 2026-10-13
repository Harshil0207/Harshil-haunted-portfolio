import { useProgress } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import { profile, stops } from './content'
import { Experience, type Mode } from './scene/Experience'
import { SceneBoundary } from './SceneBoundary'
import type { Fx, Manifest, Viewpoint } from './scene/types'

interface SceneData {
  manifest: Manifest
  fx: Fx
  views: Viewpoint[]
}

const getJson = <T,>(path: string): Promise<T> =>
  fetch(path).then((r) => {
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error(`${path} not found`)
    return r.json() as Promise<T>
  })

function Loader({ waiting, error }: { waiting: boolean; error: string | null }) {
  const { active, progress } = useProgress()
  const show = waiting || active || error
  return (
    <div className={`loader ${show ? '' : 'loader--done'}`} aria-hidden={!show}>
      <span>
        {error
          ? 'The 3D scene has not been built yet. Run blender/pipeline/run.sh, then reload.'
          : `Summoning the manor… ${Math.round(progress)}%`}
      </span>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState<SceneData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stop, setStop] = useState(0)
  // Walk mode needs a keyboard + mouse; touch devices get orbit controls.
  const [mode, setMode] = useState<Mode>(() => (matchMedia('(pointer: fine)').matches ? 'walk' : 'orbit'))
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    Promise.all([
      getJson<Manifest>('/scene/manifest.json'),
      getJson<Fx>('/scene/fx.json'),
      getJson<Viewpoint[]>('/scene/viewpoints.json'),
    ])
      .then(([manifest, fx, views]) => setData({ manifest, fx, views }))
      .catch((e: Error) => setError(e.message))
  }, [])

  const current = stops[stop]
  // Stable identity: a new object would re-trigger the camera flight / teleport.
  const view = useMemo<Viewpoint | undefined>(
    () =>
      current.spawn
        ? { name: current.title, fov: 60, ...current.spawn }
        : data?.views.find((v) => v.name === current.view),
    [current, data],
  )

  return (
    <>
      {data && view && (
        <SceneBoundary>
          <Experience manifest={data.manifest} fx={data.fx} view={view} mode={mode} onLockChange={setLocked} />
        </SceneBoundary>
      )}
      <Loader waiting={!data && !error} error={error} />

      <header className="hud hud--top">
        <div>
          <h1>{profile.name}</h1>
          <p>{profile.role}</p>
        </div>
        <nav>
          {profile.links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
          <a href={`mailto:${profile.email}`}>Contact</a>
        </nav>
      </header>

      {mode === 'walk' && !locked && data && (
        <button id="walk-start" className="walk-start">
          <strong>Click to explore</strong>
          <span>WASD to move · mouse to look · Shift to run · Space to jump · Esc to release</span>
        </button>
      )}
      {mode === 'walk' && locked && <div className="crosshair" aria-hidden />}

      <section className={`hud hud--panel ${locked ? 'hud--hidden' : ''}`} aria-live="polite">
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <p className="hint">{mode === 'walk' ? 'Pick a room to teleport there.' : profile.intro}</p>
      </section>

      <nav className={`hud hud--stops ${locked ? 'hud--hidden' : ''}`} aria-label="Rooms">
        <button className="mode" onClick={() => setMode(mode === 'walk' ? 'orbit' : 'walk')}>
          {mode === 'walk' ? 'Orbit view' : 'Walk mode'}
        </button>
        {stops.map((s, i) => (
          <button key={s.title} aria-current={i === stop} onClick={() => setStop(i)}>
            {s.title}
          </button>
        ))}
      </nav>
    </>
  )
}
