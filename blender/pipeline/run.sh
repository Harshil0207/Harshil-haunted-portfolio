#!/usr/bin/env bash
# Hollow Manor -> web pipeline.
#   bash blender/pipeline/run.sh            full quality (slow: ~1.5h CPU bake)
#   PREVIEW=1 bash blender/pipeline/run.sh  quick low-res bake to check the look
#   CHUNKS="tantrik hall_props" bash ...    only (re)bake + export these chunks
set -euo pipefail
cd "$(dirname "$0")/../.."
B="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
P=blender/pipeline
ALL="hall_structure hall_props house_exterior grounds_terrain grounds_props tantrik faith_gallery backdrop moving"
CHUNKS="${CHUNKS:-$ALL}"
run() { "$B" --python-exit-code 1 -b "$@" 2>&1 | grep -E '^(NOTE|VIEWS|FX|FROZE|REALISED|DELETE|RIGGED|DECIMATE|STATIC|UV |BAKE|BAKED|DENOISED|EXPORTED|DYNAMIC|MOVING|SKIP|DONE|SAVED)|Error|Traceback|  File'; }

if [[ ! -f blender/work/uv.blend || "${REPREP:-0}" == 1 ]]; then
  run blender/source/HollowManor_GreatHall4.blend -P $P/prepare.py
  run blender/work/prepared.blend -P $P/uv.py
  run blender/source/HollowManor_GreatHall4.blend -P $P/viewpoints.py
fi
for c in $CHUNKS; do
  if [[ "${PREVIEW:-0}" == 1 ]]; then
    run blender/work/uv.blend -P $P/bake.py -- "$c" 16 512
  else
    run blender/work/uv.blend -P $P/bake.py -- "$c"
  fi
  run --factory-startup -P $P/denoise.py -- "$c"
done
run blender/work/uv.blend -P $P/export.py -- $CHUNKS dynamic

# Compress + copy into the web app.
mkdir -p web/public/scene
for f in blender/out/glb/*.glb; do
  n=$(basename "$f")
  if [[ "$n" == dynamic.glb ]]; then
    (cd web && npx gltf-transform optimize "../$f" "public/scene/$n" --compress meshopt \
       --texture-compress webp --simplify false --instance false --join false --flatten false \
       --palette false)  # keep material names (MAT_Moon, LM_moving) for the web code
  else
    (cd web && npx gltf-transform optimize "../$f" "public/scene/$n" --compress meshopt \
       --texture-compress webp --simplify false)
  fi
done
cp blender/out/glb/manifest.json blender/out/fx.json blender/out/viewpoints.json web/public/scene/
ls -la web/public/scene
