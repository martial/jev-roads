# Models the trees of Jev Roads in Blender and exports one .glb per species.
#
# In an open Blender (through the Blender MCP, or the Python console), leaving the rest of the scene alone:
#
#   import sys; sys.path.insert(0, "<repo>/scripts/blender"); import make_trees
#   make_trees.live("<repo>/public/models/trees")   # builds into the collection "Jev Roads trees" and exports
#
# Or without a window:
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/make_trees.py -- public/models/trees
#
# Eight species, each recognisable by its outline alone, because an outline is what the toon look draws: the plane
# tree of every French avenue, the umbrella pine, the cypress, the palm, the olive, the round lime of town squares,
# the poplar, the fir. A crown is a few lumpy balls, smooth within and creased where they meet; a few hundred
# triangles a tree, since a town has thousands. Two materials: "bark" keeps its colour, "leaf" takes each tree's
# own green in the renderer. The origin is at the foot of the trunk; `height` travels with the model.
#
# Axes: +Z is up here, so that the exported glTF has +Y up.

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "public/models/trees")

COLOURS = {"bark": (0.2, 0.15, 0.11), "leaf": (0.12, 0.26, 0.08)}
BARK, LEAF = 0, 1


def materials(bark, leaf):
    made = []
    for name, colour in (("bark", bark), ("leaf", leaf)):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*colour, 1)
        bsdf.inputs["Roughness"].default_value = 0.95
        m.diffuse_color = (*colour, 1)
        made.append(m)
    return made


def lump(bm, at, size, seed, rough=0.22, detail=1):
    """A ball of foliage: an icosphere pushed in and out by noise, so that no two are the same ball."""
    res = bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=1.0)
    for v in res["verts"]:
        n = noise.noise(v.co * 1.7 + Vector((seed * 3.1, seed * 1.7, seed * 0.9)))
        v.co *= 1 + n * rough
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(at)
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = LEAF
        f.smooth = True


def limb(bm, points, radii, sides=6, mat=BARK):
    """A trunk or a bough: rings along a line that may bend, tapering."""
    rings = []
    for i, (p, r) in enumerate(zip(points, radii)):
        p = Vector(p)
        ahead = (Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(i - 1, 0)])).normalized()
        side = ahead.cross(Vector((0, 1, 0)))
        if side.length < 0.1:
            side = ahead.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(ahead)
        rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / sides) + up * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)])
    made = []
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            made.append(bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k])))
    made.append(bm.faces.new(rings[-1]))
    for f in made:
        f.material_index = mat
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=made)
    return made


def frond(bm, root, direction, length, droop, width):
    """A palm leaf: a strip that rises, arches and hangs, with a back so that it can be seen from underneath."""
    d = Vector((direction[0], direction[1], 0)).normalized()
    side = Vector((-d.y, d.x, 0))
    steps = 5
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        p = Vector(root) + d * (length * t) + Vector((0, 0, length * (0.34 * math.sin(t * math.pi * 0.9) - droop * t * t)))
        w = width * math.sin(max(0.06, t) * math.pi) ** 0.6 * (1 - t * 0.35)
        # Folded along the rib, like a roof: that is what gives a frond its shadowed side.
        rib = p + Vector((0, 0, w * 0.35))
        left.append((bm.verts.new(p + side * w), bm.verts.new(rib)))
        right.append((bm.verts.new(rib), bm.verts.new(p - side * w)))
    for strip in (left, right):
        for a, b in zip(strip, strip[1:]):
            top = bm.faces.new((a[0], a[1], b[1], b[0]))
            under = bm.faces.new((bm.verts.new(b[0].co), bm.verts.new(b[1].co), bm.verts.new(a[1].co), bm.verts.new(a[0].co)))
            for f in (top, under):
                f.material_index = LEAF
                f.smooth = False


def plane(bm, rnd):
    limb(bm, [(0, 0, 0), (0.05, 0, 2.2), (0, 0.05, 4.6), (0, 0, 6.2)], [0.42, 0.34, 0.3, 0.2], 7)
    for a, lean, top in ((0.4, 2.3, 8.4), (2.5, 2.6, 8.9), (4.5, 2.1, 8.2)):
        limb(bm, [(0, 0, 4.4), (math.cos(a) * lean * 0.55, math.sin(a) * lean * 0.55, 6.4), (math.cos(a) * lean, math.sin(a) * lean, top)], [0.22, 0.16, 0.08], 5)
    lump(bm, (0, 0, 9.6), (3.4, 3.4, 2.6), 1)
    for i, (a, out, z, s) in enumerate(((0.4, 3.0, 8.3, 2.6), (2.5, 3.3, 8.8, 2.8), (4.5, 2.8, 8.0, 2.5), (1.5, 1.6, 11.2, 2.3))):
        lump(bm, (math.cos(a) * out, math.sin(a) * out, z), (s, s, s * 0.78), i + 2)


def umbrella_pine(bm, rnd):
    limb(bm, [(0, 0, 0), (0.25, 0.05, 3.2), (0.7, 0.1, 6.4), (0.9, 0.1, 8.6)], [0.36, 0.3, 0.24, 0.16], 7)
    for a, lean in ((0.3, 2.6), (2.2, 2.9), (4.2, 2.5)):
        limb(bm, [(0.8, 0.1, 7.4), (0.9 + math.cos(a) * lean * 0.6, 0.1 + math.sin(a) * lean * 0.6, 8.9), (0.9 + math.cos(a) * lean, 0.1 + math.sin(a) * lean, 9.5)], [0.15, 0.1, 0.05], 5)
    # The parasol: wide, flat, and flatter underneath.
    lump(bm, (0.9, 0.1, 10.0), (4.6, 4.4, 1.35), 11, 0.16)
    for i, (a, out) in enumerate(((0.5, 2.9), (2.6, 3.1), (4.4, 2.7))):
        lump(bm, (0.9 + math.cos(a) * out, 0.1 + math.sin(a) * out, 9.9 + i * 0.12), (2.5, 2.4, 1.0), 12 + i, 0.18)


def cypress(bm, rnd):
    limb(bm, [(0, 0, 0), (0, 0, 1.4)], [0.2, 0.17], 6)
    # A flame: rings that swell, then close to a point, a little off true.
    rings = []
    profile = [(0.9, 0.55), (1.6, 1.0), (3.5, 1.25), (6.5, 1.12), (9.5, 0.8), (11.6, 0.42), (12.8, 0.04)]
    sides = 9
    for i, (z, r) in enumerate(profile):
        rings.append([bm.verts.new((math.cos(2 * math.pi * k / sides + i * 0.35) * r * (1 + 0.13 * math.sin(k * 2.3 + i)), math.sin(2 * math.pi * k / sides + i * 0.35) * r * (1 + 0.13 * math.cos(k * 1.7 + i)), z)) for k in range(sides)])
    faces = [bm.faces.new(list(reversed(rings[0])))]
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            faces.append(bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k])))
    for f in faces:
        f.material_index = LEAF
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def palm(bm, rnd):
    pts = [(0, 0, 0), (0.18, 0, 1.8), (0.5, 0.05, 3.8), (0.95, 0.1, 5.8), (1.3, 0.1, 7.4)]
    limb(bm, pts, [0.34, 0.26, 0.23, 0.22, 0.25], 7)
    top = (1.3, 0.1, 7.35)
    for i in range(9):
        a = 2 * math.pi * i / 9 + 0.2
        frond(bm, top, (math.cos(a), math.sin(a)), 4.3 + (i % 3) * 0.4, 0.36 + (i % 2) * 0.16, 0.78)
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.7
        frond(bm, (top[0], top[1], top[2] + 0.1), (math.cos(a), math.sin(a)), 3.0, 0.03, 0.6)


def olive(bm, rnd):
    limb(bm, [(0, 0, 0), (0.12, 0.05, 0.9), (-0.1, 0.1, 1.7)], [0.34, 0.27, 0.2], 6)
    for a, lean, top in ((0.6, 1.3, 2.9), (3.4, 1.5, 3.1)):
        limb(bm, [(-0.05, 0.08, 1.5), (math.cos(a) * lean * 0.6, math.sin(a) * lean * 0.6, 2.3), (math.cos(a) * lean, math.sin(a) * lean, top)], [0.17, 0.11, 0.05], 5)
    for i, (a, out, z, s) in enumerate(((0.6, 1.3, 3.2, 1.7), (3.4, 1.5, 3.4, 1.85), (2.0, 0.3, 4.1, 1.6))):
        lump(bm, (math.cos(a) * out, math.sin(a) * out, z), (s, s, s * 0.72), 21 + i, 0.26)


def lime(bm, rnd):
    limb(bm, [(0, 0, 0), (0, 0, 2.2), (0, 0, 4.0)], [0.3, 0.25, 0.18], 7)
    lump(bm, (0, 0, 6.2), (3.0, 3.0, 3.0), 31, 0.14, 2)
    lump(bm, (0.5, 0.3, 8.3), (1.9, 1.9, 1.6), 32, 0.16)


def poplar(bm, rnd):
    limb(bm, [(0, 0, 0), (0, 0, 2.4)], [0.3, 0.24], 6)
    # One column, not a stack: each mass sits well inside the one below, and the last comes to a point.
    for i, (z, r, tall) in enumerate(((4.6, 1.7, 3.2), (7.4, 1.6, 3.4), (10.2, 1.35, 3.3), (12.8, 0.95, 2.9), (14.9, 0.5, 1.9))):
        lump(bm, (0.1 * math.sin(i * 2.1), 0.1 * math.cos(i * 1.3), z), (r, r, tall), 41 + i, 0.12)


def fir(bm, rnd):
    limb(bm, [(0, 0, 0), (0, 0, 2.0)], [0.26, 0.2], 6)
    sides = 8
    for i, (z0, z1, r) in enumerate(((1.4, 5.2, 2.6), (3.9, 7.6, 2.05), (6.4, 9.8, 1.5), (8.6, 11.8, 0.95))):
        tip = bm.verts.new((0, 0, z1))
        ring = [bm.verts.new((math.cos(2 * math.pi * k / sides + i * 0.4) * r * (1 + 0.14 * (k % 2)), math.sin(2 * math.pi * k / sides + i * 0.4) * r * (1 + 0.14 * (k % 2)), z0 - 0.35 * (k % 2))) for k in range(sides)]
        faces = [bm.faces.new((ring[k], ring[(k + 1) % sides], tip)) for k in range(sides)] + [bm.faces.new(list(reversed(ring)))]
        for f in faces:
            f.material_index = LEAF
            f.smooth = False
        bmesh.ops.recalc_face_normals(bm, faces=faces)


# name: (how it is made, bark, leaf)
TREES = {
    "plane": (plane, (0.55, 0.5, 0.4), (0.2, 0.36, 0.1)),
    "umbrella_pine": (umbrella_pine, (0.3, 0.19, 0.13), (0.08, 0.22, 0.09)),
    "cypress": (cypress, (0.24, 0.17, 0.12), (0.05, 0.15, 0.08)),
    "palm": (palm, (0.34, 0.27, 0.2), (0.16, 0.33, 0.1)),
    "olive": (olive, (0.3, 0.26, 0.22), (0.3, 0.37, 0.27)),
    "lime": (lime, (0.24, 0.18, 0.13), (0.17, 0.35, 0.09)),
    "poplar": (poplar, (0.36, 0.33, 0.27), (0.2, 0.38, 0.12)),
    "fir": (fir, (0.2, 0.14, 0.1), (0.05, 0.19, 0.1)),
}


def build(name, collection):
    make, bark, leaf = TREES[name]
    bm = bmesh.new()
    make(bm, random.Random(name))
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    height = max(v.co.z for v in bm.verts)
    bm.free()
    for m in materials(bark, leaf):
        mesh.materials.append(m)
    tree = bpy.data.objects.new(name, mesh)
    collection.objects.link(tree)
    tree["height"] = round(height, 2)
    return tree


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export(tree, out):
    os.makedirs(out, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    tree.select_set(True)
    bpy.context.view_layer.objects.active = tree
    path = os.path.join(out, f"{tree.name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_normals=True, export_materials="EXPORT", export_extras=True)
    return f"{tree.name}: {triangles(tree)} triangles, {tree['height']} m, {os.path.getsize(path) // 1024} KB"


COLLECTION = "Jev Roads trees"


def live(out=None, names=None):
    """Build in the Blender that is open, inside one collection of their own, in a row. Nothing else is touched."""
    scene = bpy.context.scene
    col = bpy.data.collections.get(COLLECTION) or bpy.data.collections.new(COLLECTION)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    report = []
    for name in list(names or TREES):
        tree = build(name, col)
        report.append(export(tree, out) if out else f"{name}: {triangles(tree)} triangles, {tree['height']} m")
        tree.location = (14 + 10 * list(TREES).index(name), 14, 0)  # a row, clear of the cars
    for m in [m for m in bpy.data.materials if m.users == 0 and m.name.split(".")[0] in COLOURS]:
        bpy.data.materials.remove(m)
    return report


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name in TREES:
        print("TREE", export(build(name, bpy.context.scene.collection), OUT))


if __name__ == "__main__":
    main()
