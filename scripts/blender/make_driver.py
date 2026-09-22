# Assembles the man at the wheel in Blender from professionally made parts and exports him as `driver.glb`.
#
# In an open Blender (through the Blender MCP, or the Python console), leaving the rest of the scene alone:
#
#   import sys; sys.path.insert(0, "<repo>/scripts/blender"); import make_driver
#   make_driver.live("<repo>/public/models")        # builds into the collection "Jev Roads driver" and exports
#
# Or without a window:
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/make_driver.py -- public/models
#
# The parts are Quaternius's Ultimate Modular Men and Women (CC0, `quaternius/`), which share one skeleton. The man
# is the Worker's head, which has the moustache, without its hard hat, on the Casual man's body, legs and feet, with
# a flat cap of our own hung on the head bone. The woman is the Casual woman's head (her own hair, no hat) on the
# Worker woman's body: `driver.glb` and `driver_f.glb`. Three shape keys are added to the head so that the face can act: `jawOpen`, `browsDown`,
# `blink`. The skeleton is exported as it is (T-pose, 2 m tall, facing +Z in glTF): the app seats him, bends his
# elbows to the wheel and curls his fingers, bone by bone.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clay_driver  # noqa: E402  the clay tools, for the cap

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "public/models")
PARTS = os.path.join(HERE, "quaternius")
COLLECTION = "Jev Roads driver"


def bring(name, collection):
    """Import one of the source characters into `collection`; returns (root object, armature, meshes by name)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PARTS, f"{name}.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        collection.objects.link(o)
    root = next(o for o in new if o.parent is None)
    arm = next(o for o in new if o.type == "ARMATURE")
    meshes = {o.name.split(".")[0]: o for o in new if o.type == "MESH"}
    return root, arm, meshes


def drop_faces(obj, material_name):
    """Take every face of one material off a mesh: the hard hat off the Worker's head."""
    mesh = obj.data
    index = next(i for i, m in enumerate(mesh.materials) if m.name.split(".")[0] == material_name)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == index], context="FACES")
    bm.to_mesh(mesh)
    bm.free()


def shape_keys(head):
    """The face acts through three shape keys. Coordinates are the mesh's own: he faces -Y, +Z is up."""
    mesh = head.data
    if not mesh.shape_keys:
        head.shape_key_add(name="Basis", from_mix=False)
    mats = {m.name.split(".")[0]: i for i, m in enumerate(mesh.materials)}
    by_material = {}
    for poly in mesh.polygons:
        for vi in poly.vertices:
            by_material.setdefault(vi, poly.material_index)
    co = [v.co.copy() for v in mesh.vertices]
    zs = [c.z for c in co]
    ys = [c.y for c in co]
    top, bottom, front, back = max(zs), min(zs), min(ys), max(ys)
    # The moustache sits just above the mouth: everything below it, in the front half of the head, is jaw.
    tache = [co[i].z for i, m in by_material.items() if m == mats.get("Moustache")]
    mouth_z = min(tache) if tache else bottom + (top - bottom) * 0.4
    hinge_y = front + (back - front) * 0.48

    def smooth(t):
        t = max(0.0, min(1.0, t))
        return t * t * (3 - 2 * t)

    jaw = head.shape_key_add(name="jawOpen", from_mix=False)
    for i, c in enumerate(co):
        if by_material.get(i) in (mats.get("Moustache"), mats.get("Eye"), mats.get("Eyebrows")):
            continue
        w = smooth((mouth_z - c.z) / 0.02) * smooth((hinge_y - c.y) / (hinge_y - front)) * smooth((c.z - bottom) / 0.05)
        if w > 0:
            jaw.data[i].co = c + Vector((0, -0.005 * w, -0.026 * w))
    brows = head.shape_key_add(name="browsDown", from_mix=False)
    for i, c in enumerate(co):
        if by_material.get(i) == mats.get("Eyebrows"):
            inner = 1 - min(1.0, abs(c.x) / 0.06)
            brows.data[i].co = c + Vector((-0.008 * math.copysign(inner, c.x), 0, -0.007 - 0.009 * inner))
    blink = head.shape_key_add(name="blink", from_mix=False)
    eyes = [i for i, m in by_material.items() if m == mats.get("Eye")]
    if eyes:
        mid = sum(co[i].z for i in eyes) / len(eyes)
        for i in eyes:
            blink.data[i].co = Vector((co[i].x, co[i].y, mid + (co[i].z - mid) * 0.05))
    return mesh.shape_keys


def cap_for(head, arm, collection):
    """A flat cap over the bare skull, in the head's frame (he faces -Y), hung on the head bone."""
    mw = head.matrix_world
    pts = [mw @ v.co for v in head.data.vertices]
    top = max(p.z for p in pts)
    front, back = min(p.y for p in pts), max(p.y for p in pts)
    cx = sum(p.x for p in pts) / len(pts)
    depth = back - front
    # The crown sits down over the hair; the peak comes forward over the brow.
    crown = Vector((cx, front + depth * 0.58, top - 0.072))
    bm = bmesh.new()
    clay_driver.ellipsoid(bm, crown, (0.147, 0.172, 0.078))
    clay_driver.ellipsoid(bm, crown + Vector((0, -0.05, 0.012)), (0.125, 0.125, 0.06))
    clay_driver.ellipsoid(bm, crown + Vector((0, -0.15, -0.032)), (0.1, 0.085, 0.014))  # the peak

    def shape(v):
        rel = v.co - crown
        if rel.z < -0.012 and rel.y > -0.115:
            v.co.z = crown.z - 0.012
        if rel.y < -0.125:
            v.co.z -= 0.45 * (-0.125 - rel.y) + 1.2 * rel.x * rel.x

    cap = clay_driver.clay(bm, collection, 0.004, 2, 2000, shape)
    for f in cap.faces:
        f.material_index = clay_driver.IDX["cap"]
    clay_driver.ellipsoid(cap, crown + Vector((0, 0.01, 0.06)), (0.012, 0.012, 0.005), seg=(10, 6), mat="cap")
    obj = clay_driver.finish("cap", cap, collection, clay_driver.materials(), colour=lambda p: clay_driver.WHITE * clay_driver.grain(p, 120, 0.1))
    # Hung on the head bone, staying exactly where it was put.
    bone = arm.pose.bones["Head"]
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = "Head"
    obj.matrix_parent_inverse = (arm.matrix_world @ bone.matrix @ Matrix.Translation((0, bone.length, 0))).inverted()
    return obj


# Who lends what: (the file with the head, its head mesh, what to take off it), (the file with the body, its parts).
PARTS_OF = {
    "m": (("Worker", "Worker_Head", "Worker_Yellow"), ("Casual_2", ("Casual2_Body", "Casual2_Legs", "Casual2_Feet"))),
    "f": (("Female_Casual", "Casual_Head", None), ("Female_Casual", ("Casual_Body", "Casual_Legs", "Casual_Feet"))),
}


def build(collection, sex="m"):
    for o in list(collection.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    (head_file, head_mesh, hat), (body_file, body_parts) = PARTS_OF[sex]
    root, arm, worker = bring(head_file, collection)
    root.name, arm.name = "driver", "driver_rig"
    _, arm2, casual = bring(body_file, collection)
    head_name = next(k for k in worker if k.endswith("Head")) if head_mesh not in worker else head_mesh
    # The other character lends the body, legs and feet; they wear the head's skeleton, which is the same skeleton.
    for part in list(worker):
        if part != head_name:
            bpy.data.objects.remove(worker[part], do_unlink=True)
    kept = []
    for part in [p for p in casual if any(p.endswith(suffix) for suffix in ("Body", "Legs", "Feet", "Pants"))]:
        obj = casual[part]
        obj.parent = arm
        for mod in obj.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
        kept.append(obj)
    doomed = {o for o in collection.objects if (o.type != "MESH" and o not in (root, arm)) or o.name.startswith("Icosphere")} | {o for o in casual.values() if o not in kept}
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    arm.data.display_type = "STICK"
    head = worker[head_name]
    if hat:
        drop_faces(head, hat)
    for o in (head, *kept):
        o.name = o.name.split("_", 1)[1].lower().replace("2", "").replace("pants", "legs")
    shape_keys(head)
    if sex == "m":
        cap_for(head, arm, collection)
    for o in collection.objects:
        if o.type == "MESH":
            for p in o.data.polygons:
                p.use_smooth = False  # the pack is faceted on purpose; it reads as drawn
    # Materials by a plain name, so that the app can find the shirt and the skin.
    for o in collection.objects:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            if slot.material and not slot.material.name.startswith("driver-"):
                base = slot.material.name.split(".")[0]
                while base.startswith("q-"):
                    base = base[2:]
                slot.material.name = "q-" + base  # Blender may still number it; the app reads the name before the dot
    for m in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(m)
    return root, arm, [o for o in collection.objects if o.type == "MESH"]


def triangles(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


def export(root, out, sex="m"):
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "driver.glb" if sex == "m" else "driver_f.glb")
    at = root.location.copy()
    root.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    stack = [root]
    while stack:
        o = stack.pop()
        o.select_set(True)
        stack += list(o.children)
    bpy.context.view_layer.objects.active = root
    settings = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_normals=True, export_materials="EXPORT", export_extras=True, export_skins=True, export_morph=True, export_animations=False)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    for key, value in (("export_rest_position_armature", True), ("export_vertex_color", "MATERIAL"), ("export_morph_normal", False)):
        if key in props:
            settings[key] = value
    bpy.ops.export_scene.gltf(**settings)
    root.location = at
    return path


def live(out=None, sex="m"):
    """Build in the Blender that is open, inside one collection of their own. Nothing else is touched."""
    scene = bpy.context.scene
    name = COLLECTION if sex == "m" else COLLECTION + " (f)"
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    root, arm, meshes = build(col, sex)
    report = f"driver {sex}: {triangles(meshes)} triangles in {len(meshes)} meshes, {len(arm.data.bones)} bones"
    if out:
        path = export(root, out, sex)
        report += f", {os.path.getsize(path) // 1024} KB"
    root.location = (-8 if sex == "m" else -9.5, 6, 0)  # stood well away from the cars
    return report


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for sex in ("m", "f"):
        root, arm, meshes = build(bpy.context.scene.collection, sex)
        print("DRIVER", export(root, OUT, sex))


if __name__ == "__main__":
    main()
