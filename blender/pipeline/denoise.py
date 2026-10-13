"""Denoise a baked lightmap with Blender's OIDN compositor node, then write the
web texture with the source scene's colour management applied.

  blender -b --factory-startup -P denoise.py -- <chunk>

Reads out/bake/<chunk>.exr + <chunk>.view.json, writes out/bake/<chunk>_lm.png.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import OUT, argv

chunk = argv()[0]
d = os.path.join(OUT, "bake")
img = bpy.data.images.load(os.path.join(d, f"{chunk}.exr"))
with open(os.path.join(d, f"{chunk}.view.json")) as f:
    view = json.load(f)
w, h = img.size

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.resolution_percentage = 100
scene.render.use_compositing = True
scene.display_settings.display_device = view["display"]
vs = scene.view_settings
vs.view_transform = view["view_transform"]
vs.look = view["look"]
vs.exposure = view["exposure"]
vs.gamma = view["gamma"]
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

tree = bpy.data.node_groups.new("WEB_Denoise", "CompositorNodeTree")
scene.compositing_node_group = tree
n_img = tree.nodes.new("CompositorNodeImage")
n_img.image = img
n_dn = tree.nodes.new("CompositorNodeDenoise")
tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
n_out = tree.nodes.new("NodeGroupOutput")
tree.links.new(n_img.outputs["Image"], n_dn.inputs["Image"])
tree.links.new(n_dn.outputs["Image"], n_out.inputs[0])

bpy.ops.render.render()
res = bpy.data.images["Render Result"]
s = scene.render.image_settings
s.file_format = "PNG"
s.color_mode = "RGB"
s.color_depth = "8"
dst = os.path.join(d, f"{chunk}_lm.png")
res.save_render(dst, scene=scene)  # applies the view transform -> display sRGB
print("DENOISED", dst, w, h, vs.view_transform, vs.look)
