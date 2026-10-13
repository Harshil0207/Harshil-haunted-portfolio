"""Export the source file's cameras as web viewpoints (Y-up, like the glTF).

  blender -b source.blend -P viewpoints.py   -> out/viewpoints.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
from common import OUT

bpy.context.scene.frame_set(1)
yup = lambda v: [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]
dg = bpy.context.evaluated_depsgraph_get()
views = []
for ob in bpy.data.objects:
    if ob.type != "CAMERA":
        continue
    m = ob.matrix_world
    pos = m.translation
    fwd = (m.to_3x3() @ Vector((0, 0, -1))).normalized()
    # Orbit target: first surface the camera looks at, else 8m ahead.
    hit, loc, *_ = bpy.context.scene.ray_cast(dg, pos + fwd * 0.3, fwd, distance=60)
    target = loc if hit else pos + fwd * 8
    views.append({"name": ob.name, "position": yup(pos), "target": yup(target),
                  "fov": round(ob.data.angle_y * 57.2958, 2)})
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "viewpoints.json"), "w") as f:
    json.dump(views, f, indent=1)
print("VIEWS", json.dumps(views))
