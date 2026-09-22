# Models every vehicle of Jev Roads in Blender and exports one .glb each.
#
# In an open Blender (through the Blender MCP, or the Python console), leaving the rest of the scene alone:
#
#   import sys; sys.path.insert(0, "<repo>/scripts/blender"); import make_cars
#   make_cars.live("<repo>/public/models")        # builds into the collection "Jev Roads cars" and exports
#
# Or without a window:
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/make_cars.py -- public/models
#
# A vehicle is made the way a toy car is: a lower body lofted through cross-sections that keep a crisp shoulder
# line, a separate glasshouse with bevelled edges whose windows are inset panes (what is left between two panes
# is a pillar), wheel wells cut as dark pockets, wheels turned on a lathe. Creases are kept on purpose: the toon
# look draws its ink lines where the surface turns. Up to 1100 vehicles are drawn at once, so each stays
# near two thousand triangles.
#
# Axes: +X is forward, +Z is up, -Y is the car's right, so that the exported glTF (Y up) has +X forward
# and +Z to the right, which is what the renderer expects. The renderer keeps only three things from a
# material: "paint" takes the driver's colour, "glass" its own glass, every other keeps its base colour.
# Each model carries `size` (length, width, height in metres, mirrors apart) and `lamps` (height of the
# head and tail lamps as a share of the height, and how far out they sit as a share of the width).

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "public/models")

COLOURS = {
    "paint": ((0.62, 0.11, 0.09), 0.35, 0.4),
    "glass": ((0.03, 0.045, 0.06), 0.05, 0.1),
    "rubber": ((0.02, 0.02, 0.022), 0.85, 0.0),
    "rim": ((0.6, 0.62, 0.65), 0.3, 0.9),
    "trim": ((0.03, 0.032, 0.036), 0.6, 0.2),
    "lens": ((0.85, 0.84, 0.78), 0.2, 0.3),
    "red": ((0.35, 0.03, 0.025), 0.3, 0.1),
    "plate": ((0.87, 0.85, 0.72), 0.6, 0.0),
    "cream": ((0.84, 0.8, 0.7), 0.7, 0.0),
}
ORDER = list(COLOURS)
IDX = {name: i for i, name in enumerate(ORDER)}
SHARP = math.radians(36)  # edges that turn more than this stay crisp


def materials():
    made = []
    for name, (colour, rough, metal) in COLOURS.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*colour, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        m.diffuse_color = (*colour, 1)
        made.append(m)
    return made


def curve(points, x):
    """A broken line [(x, value), ...] read at x."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, v0), (x1, v1) in zip(points, points[1:]):
        if x <= x1:
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0) if x1 > x0 else v1
    return points[-1][1]


def paint_all(bm, geom_verts, mat):
    for f in {f for v in geom_verts for f in v.link_faces}:
        f.material_index = IDX[mat]


def add_box(bm, size, at, mat, taper=1.0):
    """A box; `taper` narrows its top (a mirror housing, a bumper)."""
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(at) @ Matrix.Diagonal((*size, 1)))
    if taper != 1.0:
        for v in res["verts"]:
            if v.co.z > at[2]:
                v.co.x = at[0] + (v.co.x - at[0]) * taper
                v.co.y = at[1] + (v.co.y - at[1]) * taper
    paint_all(bm, res["verts"], mat)


def section(x, w, zb, zt, crown, square):
    """Half a cross-section mirrored: floor, sill tucked under, the widest point at the door, a shoulder, a crowned top."""
    h = zt - zb
    half = [(0, zb), (0.78 * w, zb), (0.965 * w, zb + 0.13 * h), (w, zb + 0.5 * h), (w * (0.95 + 0.03 * square), zt - 0.1 * h), (w * (0.86 + 0.06 * square), zt), (0.5 * w, zt + 0.8 * crown), (0, zt + crown)]
    return [Vector((x, y, z)) for y, z in half] + [Vector((x, -y, z)) for y, z in reversed(half[1:-1])]


def body_mesh(spec):
    L, W, H = spec["size"]
    bm = bmesh.new()
    xs = sorted({round(p[0], 4) for key in ("deck", "floor", "plan") for p in spec[key]})
    rings = []
    for x in xs:
        ring = section(x * L, curve(spec["plan"], x) * W / 2, curve(spec["floor"], x) * H, curve(spec["deck"], x) * H, spec.get("crown", 0.02) * H, spec.get("square", 0.0))
        rings.append([bm.verts.new(p) for p in ring])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bed = spec.get("bed")
    if bed:
        # A pickup's load bed: the deck between two stations, inset and sunk.
        x0, x1, depth = bed[0] * L, bed[1] * L, bed[2] * H
        bm.normal_update()
        top = [f for f in bm.faces if f.normal.z > 0.8 and x0 <= f.calc_center_median().x <= x1]
        res = bmesh.ops.inset_region(bm, faces=top, thickness=0.07, use_even_offset=True, use_boundary=True)
        floor_z = min(v.co.z for f in top for v in f.verts) - depth
        for v in {v for f in top for v in f.verts}:
            v.co.z = floor_z
        for f in top:
            f.material_index = IDX["trim"]

    mesh = bpy.data.meshes.new("tmp-body")
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def cutters_mesh(spec):
    """Wheel wells: a pocket on each side at each axle, dark inside."""
    L, W, H = spec["size"]
    r = spec["wheel"]
    bm = bmesh.new()
    for x in spec["axles"]:
        for side in (-1, 1):
            m = Matrix.Translation((x * L, side * (W / 2 - 0.12), r * 0.98)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=r * 1.17, radius2=r * 1.17, depth=0.62, matrix=m)
    for f in bm.faces:
        f.material_index = IDX["trim"]
    mesh = bpy.data.meshes.new("tmp-cutters")
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def cut(body, cutters, collection, mats):
    """The body with its wheel wells cut, as a new mesh. No operators: the modifier is read back evaluated."""
    for mesh in (body, cutters):
        for m in mats:
            mesh.materials.append(m)
    a = bpy.data.objects.new("tmp-body", body)
    b = bpy.data.objects.new("tmp-cutters", cutters)
    collection.objects.link(a)
    collection.objects.link(b)
    mod = a.modifiers.new("wells", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    solvers = [i.identifier for i in mod.bl_rna.properties["solver"].enum_items]
    mod.solver = "EXACT" if "EXACT" in solvers else solvers[0]
    mod.object = b
    bpy.context.view_layer.update()
    result = bpy.data.meshes.new_from_object(a.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    for obj in (a, b):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in (body, cutters):
        bpy.data.meshes.remove(mesh)
    return result


def cabin_mesh(spec):
    """The glasshouse: rings from the belt up, its edges bevelled, its windows inset."""
    L, W, H = spec["size"]
    c = spec["cabin"]
    rows = [(z * H, xr * L, xf * L, w * W / 2) for z, xr, xf, w in c["rows"]]
    breaks = [rows[0][1]] + [p * L for p in sorted(c.get("pillars", []))] + [rows[0][2]]
    sides = c.get("sides") or [True] * (len(breaks) - 1)
    bm = bmesh.new()
    pane = bm.faces.layers.int.new("pane")
    cache = {}

    def vert(x, y, z):
        key = (round(x, 4), round(y, 4), round(z, 4))
        if key not in cache:
            cache[key] = bm.verts.new((x, y, z))
        return cache[key]

    def face(verts, tag=0):
        unique = [v for i, v in enumerate(verts) if v not in verts[:i]]
        if len(unique) >= 3:
            f = bm.faces.new(unique)
            f[pane] = tag
            return f

    left, right = [], []
    for z, xr, xf, w in rows:
        xs = [xr] + [min(max(b, xr), xf) for b in breaks[1:-1]] + [xf]
        left.append([vert(x, w, z) for x in xs])
        right.append([vert(x, -w, z) for x in xs])
    for i in range(len(rows) - 1):
        glazed = i == 0
        for k in range(len(breaks) - 1):
            tag = 3 if glazed and sides[k] else 0
            face([left[i][k + 1], left[i][k], left[i + 1][k], left[i + 1][k + 1]], tag)
            face([right[i][k], right[i][k + 1], right[i + 1][k + 1], right[i + 1][k]], tag)
        face([left[i][-1], left[i + 1][-1], right[i + 1][-1], right[i][-1]], 1 if glazed else 0)
        face([right[i][0], right[i + 1][0], left[i + 1][0], left[i][0]], 2 if glazed and c.get("rear", True) else 0)
    face(left[-1] + list(reversed(right[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()

    flat = {}
    for f in bm.faces:
        if f[pane]:
            flat.setdefault(f[pane], []).append(f.normal.copy())
    turning = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(12)]
    bmesh.ops.bevel(bm, geom=turning, offset=c.get("bevel", 0.055), offset_type="OFFSET", segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    bm.normal_update()
    # The bevel's new faces may inherit a tag; a true pane still faces exactly where it did.
    panes = [f for f in bm.faces if f[pane] and f.calc_area() > 0.03 and any(f.normal.dot(n) > 0.9995 for n in flat[f[pane]])]
    bmesh.ops.inset_individual(bm, faces=panes, thickness=c.get("frame", 0.055), depth=-0.014, use_even_offset=True)
    for f in panes:
        f.material_index = IDX["glass"]
    mesh = bpy.data.meshes.new("tmp-cabin")
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def add_wheel(bm, x, y_outer, r, side, width):
    """Turned on a lathe: hub, dished rim, lip, side wall, tread. Open at the back, where nobody looks."""
    profile = [(0.0, -0.035, "trim"), (0.2, -0.035, "rim"), (0.6, -0.05, "rim"), (0.67, 0.0, "rubber"), (0.92, -0.012, "rubber"), (1.0, -0.06, "rubber"), (1.0, -width, None)]
    seg = 14
    rings = []
    for rho, a, _ in profile:
        if rho == 0:
            rings.append([bm.verts.new((x, y_outer + side * a, r))])
        else:
            rings.append([bm.verts.new((x + rho * r * math.cos(2 * math.pi * j / seg), y_outer + side * a, r + rho * r * math.sin(2 * math.pi * j / seg))) for j in range(seg)])
    made = []
    for i, (a, b) in enumerate(zip(rings, rings[1:])):
        for j in range(seg):
            f = bm.faces.new((a[0], b[j], b[(j + 1) % seg])) if len(a) == 1 else bm.faces.new((a[j], b[j], b[(j + 1) % seg], a[(j + 1) % seg]))
            f.material_index = IDX[profile[i][2]]
            made.append(f)
    # Wound as above, the faces look towards -Y: right for the wheels on the car's right, inside out on its left.
    # (Blender's viewport shows both sides of a face, the renderer only the front: check with backface culling on.)
    if side > 0:
        bmesh.ops.reverse_faces(bm, faces=made)


def build(name, spec, collection):
    L, W, H = spec["size"]
    r = spec["wheel"]
    mats = materials()
    body = cut(body_mesh(spec), cutters_mesh(spec), collection, mats)
    cabin = cabin_mesh(spec)

    bm = bmesh.new()
    bm.from_mesh(body)
    bm.from_mesh(cabin)
    bpy.data.meshes.remove(body)
    bpy.data.meshes.remove(cabin)

    for x in spec["axles"]:
        for side in (-1, 1):
            add_wheel(bm, x * L, side * (W / 2 - 0.035), r, side, 0.24)

    nose = max(p[0] for p in spec["deck"])
    tail = spec.get("tail", min(p[0] for p in spec["deck"]))  # a truck's body stops at the cab; the truck does not
    head, rear, out = spec["lamps"]
    nose_w = curve(spec["plan"], nose) * W / 2
    tail_w = curve(spec["plan"], tail) * W / 2
    floor_n, floor_t = curve(spec["floor"], nose) * H, curve(spec["floor"], tail) * H
    for side in (-1, 1):
        add_box(bm, (0.05, 0.36, 0.15), (nose * L - 0.005, side * out * W, head * H), "lens")
        add_box(bm, (0.05, 0.38, 0.15), (tail * L + 0.005, side * out * W, rear * H), "red")
        if "mirror" in spec:
            mx, mz, my = spec["mirror"]
            add_box(bm, (0.17, 0.12, 0.13), (mx * L, side * (my * W / 2 + 0.05), mz * H), spec.get("mirror_mat", "paint"), 0.8)
    grille = spec.get("grille", (0.5, 0.1))
    add_box(bm, (0.04, W * grille[0], H * grille[1]), (nose * L - 0.002, 0, floor_n + H * grille[1] / 2 + 0.1), "trim")
    add_box(bm, (0.07, nose_w * 1.9, 0.11), (nose * L - 0.015, 0, floor_n + 0.02), "trim")
    add_box(bm, (0.07, tail_w * 1.9, 0.11), (tail * L + 0.015, 0, floor_t + 0.02), "trim")
    add_box(bm, (0.02, 0.46, 0.11), (nose * L + 0.022, 0, floor_n + 0.03), "plate")
    add_box(bm, (0.02, 0.46, 0.11), (tail * L - 0.022, 0, floor_t + 0.17), "plate")
    for (sx, sy, sz), (px, py, pz), mat in spec.get("boxes", []):
        add_box(bm, (sx * L, sy * W, sz * H), (px * L, py * W, pz * H), mat)

    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < SHARP
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    if hasattr(mesh, "use_auto_smooth"):  # before Blender 4.1 sharp edges only count with this on
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.pi
    car = bpy.data.objects.new(name, mesh)
    collection.objects.link(car)
    car["size"] = [L, W, H]
    car["lamps"] = [head, rear, out]
    return car


# All in shares of the vehicle: x from the tail (-0.5) to the nose (0.5) of the length, widths of the half-width,
# heights of the height. `deck` is the top of the lower body, `floor` its underside, `plan` its width seen from above.
# `cabin.rows` are rings from the belt up: (height, rear end, front end, half-width). Windows are cut in the first
# row: `pillars` stand upright at those x, `sides` says which side panes are glass, rear to front.
CAR_FLOOR = [(-0.5, 0.3), (-0.485, 0.22), (-0.44, 0.16), (0.42, 0.16), (0.485, 0.21), (0.5, 0.28)]
CAR_PLAN = [(-0.5, 0.86), (-0.485, 0.95), (-0.44, 1.0), (0.38, 1.0), (0.46, 0.96), (0.5, 0.85)]
CARS = {
    "hatch": {
        "size": (3.9, 1.78, 1.47), "wheel": 0.3, "axles": (-0.31, 0.32), "lamps": (0.45, 0.5, 0.33),
        "deck": [(-0.5, 0.55), (-0.485, 0.61), (-0.46, 0.63), (0.22, 0.61), (0.3, 0.59), (0.44, 0.55), (0.485, 0.52), (0.5, 0.49)],
        "floor": CAR_FLOOR, "plan": CAR_PLAN, "mirror": (0.2, 0.64, 0.92),
        "cabin": {"rows": [(0.57, -0.47, 0.25, 0.86), (1.0, -0.36, 0.03, 0.72)], "pillars": [-0.29, -0.04]},
    },
    "saloon": {
        "size": (4.55, 1.82, 1.44), "wheel": 0.32, "axles": (-0.3, 0.31), "lamps": (0.46, 0.53, 0.34),
        "deck": [(-0.5, 0.56), (-0.485, 0.63), (-0.46, 0.66), (-0.3, 0.65), (0.2, 0.62), (0.28, 0.6), (0.44, 0.56), (0.485, 0.53), (0.5, 0.49)],
        "floor": CAR_FLOOR, "plan": CAR_PLAN, "mirror": (0.18, 0.66, 0.92),
        "cabin": {"rows": [(0.58, -0.34, 0.23, 0.86), (1.0, -0.17, 0.03, 0.72)], "pillars": [-0.2, -0.03]},
    },
    "estate": {
        "size": (4.6, 1.82, 1.5), "wheel": 0.32, "axles": (-0.3, 0.31), "lamps": (0.45, 0.52, 0.34),
        "deck": [(-0.5, 0.55), (-0.485, 0.61), (-0.46, 0.63), (0.2, 0.61), (0.28, 0.59), (0.44, 0.55), (0.485, 0.52), (0.5, 0.48)],
        "floor": CAR_FLOOR, "plan": CAR_PLAN, "mirror": (0.18, 0.64, 0.92),
        "cabin": {"rows": [(0.57, -0.485, 0.235, 0.86), (1.0, -0.42, 0.03, 0.73)], "pillars": [-0.27, -0.03]},
        "boxes": [((0.34, 0.025, 0.02), (-0.2, 0.3, 1.012), "trim"), ((0.34, 0.025, 0.02), (-0.2, -0.3, 1.012), "trim")],
    },
    "suv": {
        "size": (4.7, 1.92, 1.76), "wheel": 0.38, "axles": (-0.3, 0.31), "lamps": (0.5, 0.55, 0.35), "square": 0.6, "grille": (0.56, 0.13),
        "deck": [(-0.5, 0.57), (-0.485, 0.62), (-0.46, 0.64), (0.19, 0.63), (0.27, 0.62), (0.45, 0.6), (0.485, 0.58), (0.5, 0.55)],
        "floor": [(-0.5, 0.32), (-0.485, 0.25), (-0.44, 0.2), (0.42, 0.2), (0.485, 0.25), (0.5, 0.32)],
        "plan": [(-0.5, 0.9), (-0.485, 0.97), (-0.44, 1.0), (0.4, 1.0), (0.47, 0.97), (0.5, 0.89)], "mirror": (0.16, 0.66, 0.94),
        "cabin": {"rows": [(0.59, -0.48, 0.22, 0.88), (1.0, -0.43, 0.04, 0.76)], "pillars": [-0.26, -0.03]},
        "boxes": [((0.36, 0.025, 0.018), (-0.19, 0.31, 1.01), "trim"), ((0.36, 0.025, 0.018), (-0.19, -0.31, 1.01), "trim")],
    },
    "coupe": {
        "size": (4.3, 1.84, 1.28), "wheel": 0.33, "axles": (-0.29, 0.32), "lamps": (0.47, 0.56, 0.34), "grille": (0.45, 0.07),
        "deck": [(-0.5, 0.58), (-0.485, 0.65), (-0.45, 0.68), (-0.3, 0.68), (0.14, 0.65), (0.24, 0.62), (0.44, 0.56), (0.485, 0.52), (0.5, 0.47)],
        "floor": [(-0.5, 0.32), (-0.485, 0.22), (-0.44, 0.15), (0.42, 0.15), (0.485, 0.2), (0.5, 0.28)], "plan": CAR_PLAN, "mirror": (0.13, 0.69, 0.92),
        "cabin": {"rows": [(0.6, -0.4, 0.18, 0.85), (1.0, -0.13, -0.02, 0.68)], "pillars": [-0.14]},
    },
    "pickup": {
        "size": (5.0, 1.86, 1.72), "wheel": 0.37, "axles": (-0.29, 0.32), "lamps": (0.48, 0.5, 0.35), "square": 0.7, "grille": (0.56, 0.14),
        "deck": [(-0.5, 0.55), (-0.49, 0.58), (-0.13, 0.58), (-0.12, 0.6), (0.23, 0.6), (0.29, 0.59), (0.45, 0.57), (0.485, 0.55), (0.5, 0.52)],
        "floor": [(-0.5, 0.3), (-0.485, 0.24), (-0.44, 0.2), (0.42, 0.2), (0.485, 0.25), (0.5, 0.32)],
        "plan": [(-0.5, 0.95), (-0.49, 1.0), (0.4, 1.0), (0.47, 0.97), (0.5, 0.89)], "mirror": (0.2, 0.64, 0.94), "crown": 0.0,
        "bed": (-0.489, -0.131, 0.09),  # no deeper: the wheel wells come up to 0.8 m under it
        "cabin": {"rows": [(0.56, -0.12, 0.26, 0.88), (1.0, -0.1, 0.09, 0.76)], "pillars": [0.04]},
    },
    "van": {
        "size": (5.2, 2.0, 2.3), "wheel": 0.36, "axles": (-0.3, 0.33), "lamps": (0.33, 0.36, 0.37), "square": 1.0, "grille": (0.5, 0.07), "crown": 0.0,
        "deck": [(-0.5, 0.5), (0.4, 0.5), (0.46, 0.47), (0.49, 0.44), (0.5, 0.41)],
        "floor": [(-0.5, 0.17), (-0.49, 0.13), (0.45, 0.13), (0.49, 0.16), (0.5, 0.2)],
        "plan": [(-0.5, 0.96), (-0.49, 1.0), (0.44, 1.0), (0.485, 0.97), (0.5, 0.9)], "mirror": (0.35, 0.58, 0.98), "mirror_mat": "trim",
        "cabin": {"rows": [(0.47, -0.497, 0.41, 0.95), (0.9, -0.497, 0.3, 0.92), (1.0, -0.485, 0.27, 0.86)], "pillars": [0.13], "sides": [False, True], "rear": False, "bevel": 0.07},
    },
    "bus": {
        "size": (10.5, 2.45, 3.0), "wheel": 0.48, "axles": (-0.27, 0.3), "lamps": (0.22, 0.27, 0.38), "square": 1.0, "grille": (0.4, 0.04), "crown": 0.0,
        "deck": [(-0.5, 0.38), (0.497, 0.38), (0.5, 0.36)],
        "floor": [(-0.5, 0.14), (-0.495, 0.1), (0.495, 0.1), (0.5, 0.14)],
        "plan": [(-0.5, 0.96), (-0.495, 1.0), (0.495, 1.0), (0.5, 0.96)], "mirror": (0.485, 0.7, 1.0), "mirror_mat": "trim",
        "cabin": {"rows": [(0.35, -0.498, 0.498, 0.97), (0.82, -0.498, 0.492, 0.96), (1.0, -0.49, 0.48, 0.9)], "pillars": [-0.38, -0.26, -0.14, -0.02, 0.1, 0.22, 0.34, 0.43], "bevel": 0.09, "frame": 0.07},
        "boxes": [((0.1, 0.004, 0.62), (0.385, -0.487, 0.41), "glass"), ((0.1, 0.004, 0.62), (-0.08, -0.487, 0.41), "glass")],
    },
    "truck": {
        "size": (7.5, 2.4, 3.2), "wheel": 0.46, "axles": (-0.37, -0.22, 0.34), "lamps": (0.2, 0.2, 0.38), "tail": -0.5, "square": 1.0, "grille": (0.5, 0.09), "crown": 0.0,
        "deck": [(0.2, 0.42), (0.47, 0.42), (0.49, 0.4), (0.5, 0.37)],
        "floor": [(0.2, 0.14), (0.47, 0.14), (0.49, 0.16), (0.5, 0.2)],
        "plan": [(0.2, 0.97), (0.21, 1.0), (0.46, 1.0), (0.49, 0.98), (0.5, 0.92)], "mirror": (0.44, 0.6, 1.0), "mirror_mat": "trim",
        "cabin": {"rows": [(0.39, 0.205, 0.497, 0.96), (0.74, 0.205, 0.47, 0.94), (0.81, 0.215, 0.45, 0.88)], "pillars": [0.31], "sides": [False, True], "rear": False, "bevel": 0.07},
        "boxes": [((0.69, 1.0, 0.68), (-0.153, 0, 0.655), "cream"), ((0.72, 0.42, 0.1), (-0.14, 0, 0.245), "trim"), ((0.012, 0.92, 0.1), (-0.493, 0, 0.2), "trim")],
    },
}


def export(car, out):
    os.makedirs(out, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    car.select_set(True)
    bpy.context.view_layer.objects.active = car
    path = os.path.join(out, f"{car.name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_normals=True, export_materials="EXPORT", export_extras=True)
    return f"{car.name}: {triangles(car)} triangles, {os.path.getsize(path) // 1024} KB"


def triangles(car):
    return sum(len(p.vertices) - 2 for p in car.data.polygons)


COLLECTION = "Jev Roads cars"


def live(out=None, names=None):
    """Build in the Blender that is open, inside one collection of their own, side by side. Nothing else is touched."""
    scene = bpy.context.scene
    col = bpy.data.collections.get(COLLECTION) or bpy.data.collections.new(COLLECTION)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    report = []
    for name in list(names or CARS):
        car = build(name, CARS[name], col)
        report.append(export(car, out) if out else f"{name}: {triangles(car)} triangles")
        car.location = (0, -6 - 3.6 * list(CARS).index(name), 0)  # a row, clear of whatever stands at the origin
    return report


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, spec in CARS.items():
        print("MODEL", export(build(name, spec, bpy.context.scene.collection), OUT))


if __name__ == "__main__":
    main()
