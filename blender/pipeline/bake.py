"""Stage 3: bake one chunk's lighting into its LM atlas.

  blender -b work/uv.blend -P bake.py -- <chunk> [samples] [size]

Writes out/bake/<chunk>.exr (linear, raw) and <chunk>.view.json (the scene's
colour management, applied by denoise.py). The .blend is not saved.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import ATLAS, BAKE_SAMPLES, OUT, argv, static_objects

args = argv()
chunk = args[0]
samples = int(args[1]) if len(args) > 1 else BAKE_SAMPLES
size = int(args[2]) if len(args) > 2 else ATLAS[chunk]

scene = bpy.context.scene
try:
    scene.render.engine = "CYCLES"
except TypeError as e:
    sys.exit(f"Cycles unavailable: {e}")
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.use_denoising = False
scene.render.threads_mode = "AUTO"
bake = scene.render.bake
bake.target = "IMAGE_TEXTURES"
bake.margin = 8
bake.margin_type = "EXTEND"
bake.use_clear = True
bake.use_pass_direct = bake.use_pass_indirect = True
bake.use_pass_diffuse = bake.use_pass_emit = bake.use_pass_transmission = True
bake.use_pass_glossy = False  # view-dependent; wrong once the camera orbits

obs = static_objects(chunk)
assert obs, f"no objects to bake in chunk {chunk}"

# Moving things must not leave frozen shadows in the bake (except when they are
# themselves the bake target: the MOVING pseudo-chunk, baked in rest pose).
targets = set(obs)
for o in bpy.data.objects:
    if o.get("web_kind") in {"dynamic", "rig"} and o not in targets:
        o.hide_render = True
img = bpy.data.images.new(f"LM_{chunk}", size, size, alpha=False, float_buffer=True)  # linear

mats = {s.material for o in obs for s in o.material_slots if s.material}
for m in mats:
    nt = m.node_tree
    n = nt.nodes.new("ShaderNodeTexImage")
    n.name = n.label = "WEB_BAKE"
    n.image = img
    for other in nt.nodes:
        other.select = False
    n.select = True
    nt.nodes.active = n

view_layer = bpy.context.view_layer
for o in view_layer.objects:
    o.select_set(False)
for o in obs:
    o.select_set(True)
view_layer.objects.active = obs[0]

t = time.time()
print(f"BAKE {chunk}: {len(obs)} objects, {len(mats)} materials, {size}px, {samples} spp")
with bpy.context.temp_override(active_object=obs[0], object=obs[0],
                               selected_objects=obs, selected_editable_objects=obs):
    bpy.ops.object.bake(type="COMBINED")
print(f"BAKED {chunk} in {time.time() - t:.0f}s")

d = os.path.join(OUT, "bake")
os.makedirs(d, exist_ok=True)
img.filepath_raw = os.path.join(d, f"{chunk}.exr")
img.file_format = "OPEN_EXR"
img.save()
vs = scene.view_settings
with open(os.path.join(d, f"{chunk}.view.json"), "w") as f:
    json.dump({"view_transform": vs.view_transform, "look": vs.look, "exposure": vs.exposure,
               "gamma": vs.gamma, "display": scene.display_settings.display_device}, f)
print("WROTE", d, chunk)
