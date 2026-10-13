"""Stage 2: work/prepared.blend -> work/uv.blend

Adds an "LM" UV layer to every static object (and every bakeable animated prop) and packs all objects of a chunk
into one shared, non-overlapping atlas (uniform texel density across the chunk).
The original UV layers stay the render-active ones, so procedural materials that
read UVs bake exactly as before.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import ATLAS, CHUNKS, MOVING, WORK, static_objects

ALL = list(CHUNKS) + [MOVING]
targets = {c: static_objects(c) for c in ALL}
for ob in targets[MOVING]:
    if ob.data.users > 1:  # instanced books/chairs need their own lightmap UVs
        ob.data = ob.data.copy()

for ob in (o for obs in targets.values() for o in obs):
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")  # all-zero, same as having no UVs when rendering
    render_uv = next(l for l in me.uv_layers if l.active_render)
    lm = me.uv_layers.get("LM") or me.uv_layers.new(name="LM", do_init=False)
    me.uv_layers.active = lm
    render_uv.active_render = True

view_layer = bpy.context.view_layer
for chunk in ALL:
    obs = targets[chunk]
    if not obs:
        continue
    for o in view_layer.objects:
        o.select_set(False)
    for o in obs:
        o.hide_set(False)
        o.select_set(True)
    view_layer.objects.active = obs[0]
    margin_px = 4
    with bpy.context.temp_override(active_object=obs[0], object=obs[0],
                                   selected_objects=obs, selected_editable_objects=obs):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.reveal()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, margin_method="FRACTION",
                                margin=margin_px / ATLAS[chunk], shape_method="CONCAVE")
        bpy.ops.object.mode_set(mode="OBJECT")
    # Report how full the atlas is (packed UV area / 1.0).
    import bmesh
    used = 0.0
    for o in obs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        uv = bm.loops.layers.uv["LM"]
        for f in bm.faces:
            l = f.loops
            for i in range(1, len(l) - 1):
                a, b, c = l[0][uv].uv, l[i][uv].uv, l[i + 1][uv].uv
                used += abs((b - a).cross(c - a)) / 2
        bm.free()
    print(f"UV {chunk}: {len(obs)} objects, atlas {ATLAS[chunk]}px, coverage {used:.0%}")

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "uv.blend"), copy=True, compress=True)
print("SAVED uv.blend")
