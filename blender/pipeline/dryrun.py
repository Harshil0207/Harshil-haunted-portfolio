"""Print how every object would be classified, without changing anything."""
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import classify, parent_map

pm = parent_map()
dg = bpy.context.evaluated_depsgraph_get()
summary = collections.defaultdict(lambda: [0, 0])
reasons = collections.Counter()
unassigned = []
for ob in bpy.data.objects:
    kind, chunk, why = classify(ob, pm)
    tris = 0
    if ob.type == "MESH" and kind != "drop":
        tris = sum(len(p.vertices) - 2 for p in ob.evaluated_get(dg).data.polygons)
    key = f"{kind}:{chunk}"
    summary[key][0] += 1
    summary[key][1] += tris
    reasons[f"{kind}/{why}"] += 1
    if kind == "drop" and why == "no chunk":
        unassigned.append(ob.name)
for k, (n, t) in sorted(summary.items()):
    print(f"CLS {k:32s} objs={n:5d} tris={t}")
print("REASONS", dict(reasons))
print("UNASSIGNED", unassigned[:60])
