"""Shared config + helpers for the Hollow Manor -> web pipeline.

Run every stage with Blender in background mode, e.g.
  blender -b <file> -P blender/pipeline/<stage>.py -- [args]
Never point a stage at the original file in Documents/; stages read from
blender/source or blender/work and always write to blender/work or blender/out.
"""
import os
import sys

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = os.path.join(ROOT, "source", "HollowManor_GreatHall4.blend")
WORK = os.path.join(ROOT, "work")
OUT = os.path.join(ROOT, "out")

# Static chunk -> collections whose objects belong to it (first match wins,
# checked from the object's own collection upwards). Each chunk becomes one
# mesh + one baked lightmap atlas on the web.
CHUNKS = {
    "hall_structure": ["GreatHall_Structure", "Staircase", "UF_UpperFloor", "Rooms_Adjacent"],
    "hall_props": ["Zone_Entry", "Zone_Lounge", "Zone_Library", "Zone_Music", "Zone_Reading",
                   "Zone_Dining", "Haunting", "Sims", "Lights", "GH_LIGHTING", "Bats", "Ghosts"],
    "house_exterior": ["HOUSE"],
    "grounds_terrain": ["Grounds_Terrain", "Grounds_Boards", "Weather_Trees"],
    "grounds_props": ["Gate", "Fencing", "Zone_ScrapYard", "Zone_Camp", "Zone_Garden",
                      "Zone_Graveyard", "Grounds_Props", "Faith_StoneCross_Gate"],
    "tantrik": ["Tantrik_Room"],
    "faith_gallery": ["Faith_Crucifix_Gallery"],
    "backdrop": ["Presentation"],
}
# Pseudo-chunk: animated props (rocking chair, swinging lamps...) baked in their
# rest pose, so they match the room instead of looking flat under real-time light.
MOVING = "moving"

# Atlas resolution per chunk (square). CPU baking costs ~19s per 512x512 tile at
# 32spp on this machine, so 4096 atlases (~1.4h each) are not worth it yet.
ATLAS = {
    "hall_structure": 2048, "hall_props": 2048, "house_exterior": 2048,
    "grounds_terrain": 2048, "grounds_props": 2048, "tantrik": 2048,
    "faith_gallery": 1024, "backdrop": 1024, MOVING: 2048,
}
BAKE_SAMPLES = 64
# Collections never exported as geometry (rebuilt in three.js or not needed).
DROP = ["WEATHER", "Colliders", "Cameras", "Grounds_Removed", "UF_Removed", "Webs_Removed",
        "Tantrik_Cutters", "Grounds_ScrapCar_Cutters", "PLAN", "Tantrik_FX_Events"]

# Doors the web app swings open when the visitor walks up (see web/src/scene/doors.ts).
# Exported as separate dynamic objects so they are not baked into a wall or the collider.
# The web app finds each hinge from the geometry (the edge opposite the knob).
OPENABLE = ("UF_Door_",)

# Per-object triangle cap applied by decimation in prepare.py.
TRI_CAP = 6000


def argv():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def parent_map():
    """collection name -> parent collection name."""
    pm = {}
    def walk(c):
        for ch in c.children:
            pm[ch.name] = c.name
            walk(ch)
    walk(bpy.context.scene.collection)
    return pm


def ancestry(ob, pm):
    names = []
    for c in ob.users_collection:
        n = c.name
        while n:
            names.append(n)
            n = pm.get(n)
    return names


def is_animated(ob):
    o = ob
    while o:
        if o.animation_data and (o.animation_data.action or o.animation_data.drivers):
            return True
        if o.type == "ARMATURE":
            return True
        if o.type == "MESH" and o.data.shape_keys and o.data.shape_keys.animation_data:
            return True
        o = o.parent
    return False


def material_flags(mat):
    """(emissive, transparent, volume) for a material's node tree."""
    if not mat or not mat.use_nodes or not mat.node_tree:
        return False, False, False
    nt = mat.node_tree
    types = {n.type for n in nt.nodes}
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
    volume = bool(out and out.inputs["Volume"].is_linked and not out.inputs["Surface"].is_linked)
    emissive = "EMISSION" in types
    transparent = "BSDF_TRANSPARENT" in types or mat.surface_render_method == "BLENDED"
    for n in nt.nodes:
        if n.type == "BSDF_PRINCIPLED":
            a = n.inputs["Alpha"]
            if a.is_linked or a.default_value < 0.999:
                transparent = True
            if n.inputs["Transmission Weight"].default_value > 0.3:
                transparent = True
            e = n.inputs["Emission Strength"]
            col = n.inputs["Emission Color"].default_value
            if (e.is_linked or e.default_value > 0.5) and max(col[:3]) > 0.05:
                emissive = True
    return emissive, transparent, volume


def classify(ob, pm):
    """-> ('drop'|'static'|'dynamic'|'fx', chunk_or_None, reason)"""
    anc = ancestry(ob, pm)
    if not ob.visible_get():
        return "drop", None, "hidden"
    if any(d in anc for d in DROP):
        return "drop", None, "dropped collection"
    if ob.type == "CURVES":
        return "fx", None, "hair curves (cobwebs)"
    if ob.type not in {"MESH", "CURVE", "FONT"}:
        return "drop", None, ob.type.lower()
    if ob.particle_systems:
        return "fx", None, "particle emitter"
    if ob.type == "MESH" and len(ob.data.polygons) < 10 and any(m.type == "NODES" for m in ob.modifiers):
        return "fx", None, "geometry nodes generator"
    flags = [material_flags(s.material) for s in ob.material_slots]
    # Any volume slot makes it fog/haze: baking it would turn it into a solid wall
    # (PRS_Fog also carries a leftover non-volume cutter material).
    if any(f[2] for f in flags):
        return "fx", None, "volume"
    chunk = next((ch for ch, cols in CHUNKS.items() for n in anc if n in cols), None)
    if is_animated(ob):
        return "dynamic", chunk, "animated"
    if ob.name.startswith(OPENABLE):
        return "dynamic", chunk, "openable door"
    if any(f[0] for f in flags):
        return "dynamic", chunk, "emissive"
    if any(f[1] for f in flags):
        return "dynamic", chunk, "transparent"
    if chunk is None:
        return "drop", None, "no chunk"
    return "static", chunk, ""


def has_surface(o):
    """Bevel-less curves have no faces and render as nothing in Blender either."""
    return o.type == "MESH" and len(o.data.polygons) > 0


def bakeable_moving(o):
    """Animated mesh that can carry a lightmap: opaque, not glowing, not skinned."""
    if o.get("web_kind") != "dynamic" or not has_surface(o):
        return False
    if any(m.type == "ARMATURE" for m in o.modifiers) or (o.parent and o.parent.type == "ARMATURE"):
        return False
    return not any(any(material_flags(s.material)) for s in o.material_slots)


def static_objects(chunk):
    """Objects baked into `chunk`'s atlas (static chunks, or the MOVING pseudo-chunk)."""
    if chunk == MOVING:
        return [o for o in bpy.data.objects if bakeable_moving(o)]
    return [o for o in bpy.data.objects
            if o.get("web_kind") == "static" and o.get("web_chunk") == chunk and has_surface(o)
            and not any(material_flags(s.material)[2] for s in o.material_slots)]
