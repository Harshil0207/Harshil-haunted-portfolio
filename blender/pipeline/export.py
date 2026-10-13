"""Stage 4: work/uv.blend + out/bake/*_lm.png -> out/glb/*.glb

- each static chunk is joined into one mesh with only the LM UVs and a single
  material whose base colour is the baked lightmap (rendered unlit on the web)
- dynamic objects (+ their rigs) go to dynamic.glb with their animation and
  procedural materials flattened to plain colours
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import CHUNKS, MOVING, OUT, argv, static_objects

only = set(argv())
glb_dir = os.path.join(OUT, "glb")
os.makedirs(glb_dir, exist_ok=True)
view_layer = bpy.context.view_layer


def select(obs):
    for o in view_layer.objects:
        o.select_set(False)
    for o in obs:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    view_layer.objects.active = obs[0]


def export(path, obs, animations):
    select(obs)
    with bpy.context.temp_override(active_object=obs[0], selected_objects=obs):
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True,
            export_apply=False, export_yup=True, export_extras=True,
            export_texcoords=True, export_normals=animations is not None,  # chunks are unlit
            export_materials="EXPORT", export_image_format="AUTO",
            export_animations=animations is not None,
            **(animations or {}))
    print("EXPORTED", os.path.basename(path), f"{os.path.getsize(path) / 1e6:.1f} MB")


def use_lightmap(obs, chunk):
    """Give objects a single unlit-on-the-web material showing their baked atlas."""
    png = os.path.join(OUT, "bake", f"{chunk}_lm.png")
    mat = bpy.data.materials.new(f"LM_{chunk}")
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(png)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    for ob in obs:
        me = ob.data
        for l in [l for l in me.uv_layers if l.name != "LM"]:
            me.uv_layers.remove(l)
        me.uv_layers["LM"].name = "UVMap"
        me.materials.clear()
        me.materials.append(mat)
        for p in me.polygons:
            p.material_index = 0
    return mat


# ---- static chunks ---------------------------------------------------------------
# Partial runs (e.g. one re-baked chunk) update the existing manifest in place.
mpath = os.path.join(glb_dir, "manifest.json")
manifest = {"chunks": []}
if only and os.path.exists(mpath):
    with open(mpath) as f:
        manifest = json.load(f)
manifest["chunks"] = [c for c in manifest["chunks"] if c["name"] not in only]
for chunk in CHUNKS:
    if only and chunk not in only:
        continue
    png = os.path.join(OUT, "bake", f"{chunk}_lm.png")
    obs = static_objects(chunk)
    if not obs or not os.path.exists(png):
        print("SKIP", chunk, "(no objects or no bake)")
        continue
    select(obs)
    with bpy.context.temp_override(active_object=obs[0], object=obs[0],
                                   selected_objects=obs, selected_editable_objects=obs):
        bpy.ops.object.join()
    ob = view_layer.objects.active
    ob.name = ob.data.name = f"CHUNK_{chunk}"
    me = ob.data
    for a in [a for a in me.attributes if a.name.startswith(("Col", "color", "Attribute"))]:
        me.attributes.remove(a)
    use_lightmap([ob], chunk)
    ob["web_chunk"] = chunk
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    path = os.path.join(glb_dir, f"{chunk}.glb")
    export(path, [ob], None)
    pts = [ob.matrix_world @ v.co for v in me.vertices]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    yup = lambda v: [round(v[0], 2), round(v[2], 2), round(-v[1], 2)]
    manifest["chunks"].append({"name": chunk, "file": f"{chunk}.glb", "tris": tris,
                               "bounds": [yup(lo), yup(hi)]})


# ---- dynamic ----------------------------------------------------------------------
def flatten(mat):
    """Turn a procedural material into something glTF can carry."""
    if not mat or not mat.node_tree or mat.get("web_flat") or mat.name.startswith("LM_"):
        return
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    emis = next((n for n in nt.nodes if n.type == "EMISSION"), None)
    if bsdf is None:
        col = emis.inputs["Color"].default_value[:] if emis else (0.5, 0.5, 0.5, 1)
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = col
        if emis:
            bsdf.inputs["Emission Color"].default_value = col
            bsdf.inputs["Emission Strength"].default_value = 4.0
        nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    for name in ("Base Color", "Emission Color"):
        sock = bsdf.inputs[name]
        if sock.is_linked:
            src = sock.links[0].from_node
            if src.type == "VALTORGB":
                els = src.color_ramp.elements
                avg = [sum(e.color[i] for e in els) / len(els) for i in range(4)]
                sock.default_value = avg
            nt.links.remove(sock.links[0])
    for name in ("Roughness", "Metallic", "Alpha", "Emission Strength", "Normal"):
        sock = bsdf.inputs.get(name)
        if sock and sock.is_linked:
            nt.links.remove(sock.links[0])
    mat["web_flat"] = True


if not only or "dynamic" in only:
    dyn = [o for o in bpy.data.objects if o.get("web_kind") in {"dynamic", "rig"}]
    baked = static_objects(MOVING)
    if baked and os.path.exists(os.path.join(OUT, "bake", f"{MOVING}_lm.png")):
        use_lightmap(baked, MOVING)
        print("MOVING", len(baked), "animated props use their baked lightmap")
    for o in dyn:
        for s in getattr(o, "material_slots", []):
            flatten(s.material)
    scene = bpy.context.scene
    print("DYNAMIC", len(dyn), "objects; frames", scene.frame_start, scene.frame_end)
    export(os.path.join(glb_dir, "dynamic.glb"), dyn, dict(
        export_animation_mode="ACTIONS", export_frame_range=False,
        export_optimize_animation_size=True, export_skins=True, export_morph=True,
        export_bake_animation=False, export_anim_single_armature=False))
    manifest["dynamic"] = "dynamic.glb"

manifest["chunks"].sort(key=lambda c: list(CHUNKS).index(c["name"]))
with open(mpath, "w") as f:
    json.dump(manifest, f, indent=1)
print("DONE")
