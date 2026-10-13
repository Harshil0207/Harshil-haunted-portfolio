"""Stage 1: source.blend -> work/prepared.blend

- deletes hidden / dropped objects (lights are kept: they are needed for baking)
- records FX objects (cobwebs, volumes, emitters) to out/fx.json, then removes them
- static: single-user mesh, modifiers applied, decimated to TRI_CAP
- tags every kept object with web_kind / web_chunk custom props
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import OUT, SOURCE, TRI_CAP, WORK, classify, material_flags, parent_map

assert os.path.normcase(bpy.data.filepath) == os.path.normcase(SOURCE), bpy.data.filepath
scene = bpy.context.scene
scene.frame_set(1)
pm = parent_map()

plan = {ob.name: classify(ob, pm) for ob in bpy.data.objects}
mismatch = [o.name for o in bpy.data.objects if o.visible_get() == o.hide_render and o.type not in {"CAMERA", "EMPTY"}]
print("NOTE viewport/render visibility differs on", len(mismatch), mismatch[:15])


def world_bounds(ob):
    from mathutils import Vector
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return [list(map(min, *pts)), list(map(max, *pts))]


# ---- freeze animated / driven lights ---------------------------------------------
# Candle and torch flicker is driven by rig objects that get deleted below; a
# driver whose target is gone evaluates to 0, so those lights would bake dark.
# Bake each one's average strength + colour into plain values first.
anim_lights = [o for o in bpy.data.objects if o.type == "LIGHT" and (
    o.animation_data or o.data.animation_data)]
sums = {o.name: [0.0, [0.0, 0.0, 0.0]] for o in anim_lights}
frames = range(scene.frame_start, scene.frame_start + 48, 2)
for fr in frames:
    scene.frame_set(fr)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in anim_lights:
        ev = o.evaluated_get(dg).data
        sums[o.name][0] += ev.energy
        for i in range(3):
            sums[o.name][1][i] += ev.color[i]
scene.frame_set(1)
for o in anim_lights:
    e, c = sums[o.name]
    o.data.animation_data_clear()
    o.data.energy = e / len(frames)
    o.data.color = [v / len(frames) for v in c]
print("FROZE", len(anim_lights), "animated lights at their average strength")

# ---- FX: record what three.js needs to rebuild them, then delete -------------
fx = {"cobwebs": [], "volumes": [], "emitters": []}
dg = bpy.context.evaluated_depsgraph_get()
for name, (kind, chunk, why) in plan.items():
    ob = bpy.data.objects[name]
    if kind != "fx":
        continue
    if ob.type == "CURVES":
        strands = []
        for c in ob.data.curves:
            pts = [list(ob.matrix_world @ p.position) for p in c.points]
            strands.append([[round(v, 4) for v in p] for p in pts])
        fx["cobwebs"].append({"name": name, "strands": strands})
    elif why == "volume":
        mat = next(s.material for s in ob.material_slots if material_flags(s.material)[2])
        vol = next(n for n in mat.node_tree.nodes if n.type == "PRINCIPLED_VOLUME")
        fx["volumes"].append({"name": name, "bounds": world_bounds(ob),
                              "color": list(vol.inputs["Color"].default_value)[:3],
                              "density": vol.inputs["Density"].default_value})
    else:
        ps = ob.particle_systems[0].settings if ob.particle_systems else None
        fx["emitters"].append({"name": name, "bounds": world_bounds(ob),
                               "count": ps.count if ps else 0})
# Visible lights -> glow sprites on the web (suns light the sky, not a point).
yup = lambda v: [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]
fx["lights"] = [
    {"name": o.name, "type": o.data.type, "position": yup(o.matrix_world.translation),
     "color": [round(c, 3) for c in o.data.color], "energy": round(o.data.energy, 2),
     "flicker": o.name in sums}
    for o in bpy.data.objects
    if o.type == "LIGHT" and o.data.type != "SUN" and o.visible_get() and not o.hide_render and o.data.energy > 0
]
# Weather: where the storm happens (rebuilt as shaders on the web).
def bounds_of(prefix):
    obs = [o for o in bpy.data.objects if o.name.startswith(prefix) and o.type == "MESH"]
    if not obs:
        return None
    from mathutils import Vector
    pts = [yup(o.matrix_world @ Vector(c)) for o in obs for c in o.bound_box]
    return [[min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]]
fx["weather"] = {"clouds": bounds_of("WX_Cloud"), "bolts": bounds_of("WX_Bolt"),
                 "groundFog": bounds_of("WX_GroundFog") or bounds_of("PRS_Fog")}

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "fx.json"), "w") as f:
    json.dump(fx, f)
print("FX", {k: len(v) for k, v in fx.items()})

# ---- realise Geometry Nodes instances (fence posts/sections, picket fences...) --
# new_from_object() only returns an object's own geometry, not the instances its
# nodes scatter, so each instance becomes a real static object here - before the
# (usually hidden) source objects are deleted below.
dg = bpy.context.evaluated_depsgraph_get()
found = []  # collect first: creating data while iterating invalidates the iterator
for inst in dg.object_instances:
    if inst.is_instance and inst.parent and inst.object.type == "MESH":
        owner = inst.parent.original.name
        if plan.get(owner, ("drop",))[0] == "static":
            found.append((owner, inst.object.original.name, inst.matrix_world.copy()))
base_meshes = {}
for src_name in {s for _, s, _ in found}:
    src = bpy.data.objects[src_name]
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.materials.clear()
    for s in src.material_slots:
        me.materials.append(s.material)
    base_meshes[src_name] = me
realised = {}
for owner_name, src_name, matrix in found:
    owner = bpy.data.objects[owner_name]
    n = realised.get(owner_name, 0)
    realised[owner_name] = n + 1
    new = bpy.data.objects.new(f"{owner_name}__{src_name}_{n:03d}", base_meshes[src_name].copy())
    new.matrix_world = matrix
    for c in owner.users_collection:
        c.objects.link(new)
    plan[new.name] = ("static", plan[owner_name][1], "realised instance")
print("REALISED", len(found), "instances", realised)

# ---- delete --------------------------------------------------------------------
keep_lights = {o.name for o in bpy.data.objects if o.type == "LIGHT" and not o.hide_render}
doomed = [bpy.data.objects[n] for n, (k, _, _) in plan.items()
          if k in {"drop", "fx"} and n not in keep_lights]
# Keep parents of dynamic objects (armatures/empties drive the animation).
needed = set()
for n, (k, _, _) in plan.items():
    if k == "dynamic":
        o = bpy.data.objects[n].parent
        while o:
            needed.add(o.name)
            o = o.parent
doomed = [o for o in doomed if o.name not in needed]
print("DELETE", len(doomed), "objects")
bpy.data.batch_remove(doomed)
for _ in range(3):
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

# Static meshes that parent animated objects (candle -> flame, clock -> pendulum):
# hand the children to a stand-in empty at the same world transform, so the mesh
# can be joined into its baked chunk while the children keep animating.
rigged = 0
for n in sorted(needed):
    ob = bpy.data.objects.get(n)
    if not ob or plan[n][0] != "static":
        continue
    rig = bpy.data.objects.new("RIG_" + n, None)
    for c in ob.users_collection:
        c.objects.link(rig)
    rig.matrix_world = ob.matrix_world.copy()
    if plan[n][1]:
        rig["web_chunk"] = plan[n][1]
    for ch in list(ob.children):
        pinv = ch.matrix_parent_inverse.copy()
        ch.parent = rig
        ch.matrix_parent_inverse = pinv
    plan[rig.name] = ("dynamic", plan[n][1], "rig")
    needed.discard(n)
    needed.add(rig.name)
    rigged += 1
print("RIGGED", rigged, "static parents")

# ---- tag + realise static geometry --------------------------------------------
dg = bpy.context.evaluated_depsgraph_get()
before = after = 0
for ob in list(bpy.data.objects):
    kind, chunk, why = plan.get(ob.name, ("drop", None, ""))
    if ob.type == "LIGHT":
        ob["web_kind"] = "light"
        continue
    ob["web_kind"] = kind if ob.name not in needed or kind == "dynamic" else "rig"
    if chunk:
        ob["web_chunk"] = chunk
    if kind != "static":
        continue
    # Bake modifiers into a fresh single-user mesh; object-linked materials move onto the mesh.
    mats = [s.material for s in ob.material_slots]
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    if ob.type != "MESH":
        new = bpy.data.objects.new(ob.name, me)
        new.matrix_world = ob.matrix_world
        for c in ob.users_collection:
            c.objects.link(new)
        for k in ("web_kind", "web_chunk"):
            new[k] = ob[k]
        bpy.data.objects.remove(ob)
        ob = new
    else:
        ob.modifiers.clear()
        ob.shape_key_clear() if ob.data.shape_keys else None
        ob.data = me
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    for s in ob.material_slots:
        s.link = "DATA"
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    before += tris
    if tris > TRI_CAP:
        ratio = max(TRI_CAP / tris, 0.12)
        mod = ob.modifiers.new("web_decimate", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        dg.update()
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        ob.modifiers.clear()
        ob.data = me2
        tris2 = sum(len(p.vertices) - 2 for p in me2.polygons)
        print(f"DECIMATE {ob.name}: {tris} -> {tris2}")
        tris = tris2
    after += tris
print("STATIC TRIS", before, "->", after)

for _ in range(3):
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
os.makedirs(WORK, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "prepared.blend"), copy=True, compress=True)
print("SAVED prepared.blend")
