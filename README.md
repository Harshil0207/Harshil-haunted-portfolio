# Hollow Manor portfolio

React + Vite + React Three Fiber site built around the Hollow Manor Blender scene.

```
blender/
  source/     copy of HollowManor_GreatHall4.blend (the original in Documents/ is never touched)
  pipeline/   Blender scripts that turn the scene into web assets
  work/       intermediate .blend files (prepared, uv)
  out/        bakes, raw GLBs, fx.json, viewpoints.json
web/          the site (assets land in web/public/scene)
```

## Rebuilding the 3D assets

```bash
PREVIEW=1 bash blender/pipeline/run.sh      # quick low-res bake (~15 min) to check the look
bash blender/pipeline/run.sh                # full quality bake (~1.5 h on CPU)
CHUNKS="tantrik" bash blender/pipeline/run.sh   # re-bake one chunk
REPREP=1 bash blender/pipeline/run.sh       # after editing the source .blend
```

Copy a newer version of the scene to `blender/source/HollowManor_GreatHall4.blend`, then run with `REPREP=1`.

| Stage | Script | What it does |
|---|---|---|
| 1 | `prepare.py` | Drops hidden/helper objects, records cobwebs, fog and particles to `fx.json`, applies modifiers, decimates meshes over 6k tris |
| 2 | `uv.py` | Packs every static object of a chunk into one shared lightmap UV atlas (`LM`) |
| 3 | `bake.py` | Cycles bake of diffuse lighting (all 86 lights + bounce) into the atlas |
|   | `denoise.py` | OIDN denoise + your AgX High Contrast view transform → `<chunk>_lm.png` |
| 4 | `export.py` | Joins each chunk into one mesh, exports chunk GLBs + `dynamic.glb` (animated objects) |
| 5 | `run.sh` | meshopt + WebP compression via gltf-transform, copies into `web/public/scene` |

Chunks and their atlas sizes are configured in `blender/pipeline/common.py`.

## Running the site

```bash
cd web
npm run dev          # http://localhost:5173  (add ?stats for an FPS meter)
npm run build
```

Portfolio text and the camera stops live in `web/src/content.ts`.
