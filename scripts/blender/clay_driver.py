# Models the man at the wheel in Blender and exports him as `driver.glb`: named parts, so that the app can still
# move what moves.
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
# He is made the way a stop-motion puppet is: lumps of clay pressed together (spheres and sausages), then fused into one
# smooth skin by a voxel remesh, smoothed, and only then cut where he must move. Nothing is a ball stuck onto a ball.
# Skin, hair, stubble and the flush on his nose are painted into the vertices; the shirt and cap are left white so that
# the app can dress him. What comes out:
#
#   head            rigid, turns; under it: jaw (hinged), moustache, brow_l, brow_r, eye_l, eye_r, lid_l, lid_r, cap, teeth
#   body            rigid, with collar, buttons, belt, seatbelt and shoes; leans a little
#   arm_r, arm_l    an armature each, bones `upper` and `fore`, with one skinned mesh: the app bends them at the elbow
#   hand_r_grip, hand_r_open, hand_r_point, and the same for the left: swapped as he holds the wheel, waves or points
#
# Axes: +X is where he faces, +Z is up, +Y is his left, so that the exported glTF (Y up) has +X forward and +Z to his right,
# as the cockpit has it. He sits on his own midline with the car's floor at Z = 0. Each arm runs along +Z from its shoulder
# (its origin), each hand along +Z from its wrist with the palm towards -X; the app points them where they go.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "public/models")

# Colours are painted into the vertices (linear). The material only says what a thing is; "shirt" and "cap" stay white.
SKIN = Vector((0.58, 0.32, 0.2))
FLUSH = Vector((0.62, 0.2, 0.13))
STUBBLE = Vector((0.4, 0.25, 0.19))
HAIR = Vector((0.2, 0.19, 0.18))
WHISKERS = Vector((0.11, 0.1, 0.09))
WHITE = Vector((1, 1, 1))
MATERIALS = {"skin": 0.75, "shirt": 0.9, "trousers": 0.95, "shoes": 0.45, "belt": 0.6, "seatbelt": 0.85, "cap": 1.0, "hair": 0.95, "whiskers": 0.95, "white": 0.35, "iris": 0.4, "black": 0.3, "mouth": 0.7, "steel": 0.25}
IDX = {name: i for i, name in enumerate(MATERIALS)}
PAINT = {"trousers": (0.03, 0.035, 0.045), "shoes": (0.02, 0.016, 0.012), "belt": (0.05, 0.03, 0.02), "seatbelt": (0.06, 0.06, 0.065), "hair": HAIR, "whiskers": WHISKERS, "white": (0.9, 0.88, 0.8), "iris": (0.16, 0.24, 0.16), "black": (0.01, 0.008, 0.006), "mouth": (0.09, 0.01, 0.012), "steel": (0.6, 0.6, 0.62)}

# Where things are: the head's centre, where it turns from, where the jaw hinges, the mouth, the eyes.
HEAD = Vector((0.03, 0.0, 1.225))
NECK = Vector((0.0, 0.0, 1.11))
HINGE = Vector((HEAD.x - 0.025, 0.0, HEAD.z - 0.03))
MOUTH_Z = HEAD.z - 0.055
EYE = Vector((HEAD.x + 0.088, 0.041, HEAD.z + 0.02))
UPPER, FORE = 0.30, 0.28

COLLECTION = "Jev Roads driver"


# --- Clay ------------------------------------------------------------------------------------------------------------


def ellipsoid(bm, at, radii, seg=(18, 12), mat=None):
    res = bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(at)) @ Matrix.Diagonal((*radii, 1)), verts=res["verts"])
    if mat is not None:
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = IDX[mat]
    return res["verts"]


def sausage(bm, a, b, ra, rb, sides=12):
    """A tapered tube with a ball at each end: a limb, a finger, a neck."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    if axis.length < 1e-6:
        return
    rot = axis.to_track_quat("Z", "Y").to_matrix()
    rings = []
    for t, r in ((0.0, ra), (0.5, (ra + rb) / 2), (1.0, rb)):
        centre = a + axis * t
        rings.append([bm.verts.new(centre + rot @ Vector((math.cos(2 * math.pi * k / sides) * r, math.sin(2 * math.pi * k / sides) * r, 0))) for k in range(sides)])
    faces = []
    for p, q in zip(rings, rings[1:]):
        for k in range(sides):
            faces.append(bm.faces.new((p[k], p[(k + 1) % sides], q[(k + 1) % sides], q[k])))
    faces.append(bm.faces.new(list(reversed(rings[0]))))
    faces.append(bm.faces.new(rings[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    ellipsoid(bm, a, (ra, ra, ra), seg=(12, 8))
    ellipsoid(bm, b, (rb, rb, rb), seg=(12, 8))


def ribbon(bm, points, width, thick, outward):
    """A flat strap along `points`, lying on a surface whose normal `outward(p)` gives: a seatbelt."""
    top, bottom = [], []
    for i, p in enumerate(points):
        p = Vector(p)
        ahead = (Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(i - 1, 0)])).normalized()
        n = Vector(outward(p)).normalized()
        side = ahead.cross(n).normalized()
        top.append((bm.verts.new(p + side * width / 2 + n * thick), bm.verts.new(p - side * width / 2 + n * thick)))
        bottom.append((bm.verts.new(p + side * width / 2), bm.verts.new(p - side * width / 2)))
    faces = []
    for (a0, a1), (b0, b1), (c0, c1), (d0, d1) in zip(top, top[1:], bottom, bottom[1:]):
        faces.append(bm.faces.new((a0, a1, b1, b0)))
        faces.append(bm.faces.new((c1, c0, d0, d1)))
        faces.append(bm.faces.new((a0, b0, d0, c0)))
        faces.append(bm.faces.new((a1, c1, d1, b1)))
    faces.append(bm.faces.new((top[0][1], top[0][0], bottom[0][0], bottom[0][1])))
    faces.append(bm.faces.new((top[-1][0], top[-1][1], bottom[-1][1], bottom[-1][0])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def evaluated(obj):
    bpy.context.view_layer.update()
    return bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))


def clay(bm, collection, voxel, smooth=2, tris=None, sculpt=None):
    """Lumps into one skin: voxel remesh, smooth, sculpt (push points about), then thin out to a budget of triangles."""
    mesh = bpy.data.meshes.new("tmp-clay")
    bm.to_mesh(mesh)
    bm.free()
    tmp = bpy.data.objects.new("tmp-clay", mesh)
    collection.objects.link(tmp)
    r = tmp.modifiers.new("remesh", "REMESH")
    r.mode = "VOXEL"
    r.voxel_size = voxel
    r.use_smooth_shade = True
    s = tmp.modifiers.new("smooth", "SMOOTH")
    s.factor = 0.55
    s.iterations = smooth
    mid = evaluated(tmp)
    if sculpt:
        for v in mid.vertices:
            sculpt(v)
    tmp.modifiers.clear()
    tmp.data = mid
    bpy.data.meshes.remove(mesh)
    if tris and len(mid.polygons) * 2 > tris:
        d = tmp.modifiers.new("thin", "DECIMATE")
        d.ratio = tris / (2 * len(mid.polygons))
        d.use_collapse_triangulate = True
    final = evaluated(tmp)
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.meshes.remove(mid)
    out = bmesh.new()
    out.from_mesh(final)
    bpy.data.meshes.remove(final)
    for f in out.faces:
        f.smooth = True
    return out


def bump(v, at, sigma, amount, along=None):
    """Push a vertex out (or in) around a point: a socket, a brow, the hollow of an ear."""
    d = v.co - Vector(at)
    w = math.exp(-(d.length_squared / (2 * sigma * sigma)))
    if w < 0.02:
        return
    direction = Vector(along).normalized() if along else d.normalized()
    v.co += direction * (amount * w)


# --- Materials and paint ---------------------------------------------------------------------------------------------


def materials():
    made = []
    for name, rough in MATERIALS.items():
        m = bpy.data.materials.get(f"driver-{name}") or bpy.data.materials.new(f"driver-{name}")
        m.use_nodes = True
        nodes, links = m.node_tree.nodes, m.node_tree.links
        bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
        # The colour lives in the vertices; the material is a name, a roughness, and (steel) a shine.
        vc = next((n for n in nodes if n.type == "VERTEX_COLOR"), None) or nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = 0.9 if name == "steel" else 0.0
        m.diffuse_color = (*PAINT.get(name, SKIN if name == "skin" else (0.8, 0.8, 0.8)), 1)
        made.append(m)
    return made


def grain(p, scale=40.0, amount=0.05):
    return 1 + amount * noise.noise(Vector(p) * scale)


def skin_colour(p):
    """A face that has been in the sun for thirty years: flushed nose, cheeks and ears, blue-grey where he shaves."""
    p = Vector(p)
    c = SKIN.copy()
    flush = 0.0
    for at, sigma in ((HEAD + Vector((0.13, 0, -0.015)), 0.03), (HEAD + Vector((0.07, 0.07, -0.02)), 0.035), (HEAD + Vector((0.07, -0.07, -0.02)), 0.035), (HEAD + Vector((0, 0.1, 0)), 0.03), (HEAD + Vector((0, -0.1, 0)), 0.03)):
        flush = max(flush, math.exp(-((p - at).length_squared / (2 * sigma * sigma))))
    c = c.lerp(FLUSH, flush * 0.75)
    # Stubble: the jaw and the upper lip, in front of the ears and below the cheekbones.
    below = HEAD.z - 0.03
    if p.z < below and p.x > HEAD.x - 0.02 and p.z > HEAD.z - 0.14:
        t = min(1.0, (below - p.z) / 0.03)
        c = c.lerp(STUBBLE, 0.7 * t * (0.7 + 0.3 * noise.noise(p * 90)))
    # Bags under the eyes.
    for side in (-1, 1):
        at = Vector((EYE.x + 0.004, EYE.y * side, EYE.z - 0.022))
        c = c.lerp(STUBBLE, 0.45 * math.exp(-((p - at).length_squared / (2 * 0.012 * 0.012))))
    return c * grain(p)


def flat(name):
    """The colour of a thing that is one colour."""
    c = Vector(PAINT[name])
    return lambda p: c * grain(p, 60, 0.08)


def cloth(p):
    return WHITE * grain(p, 70, 0.07)


# --- Making objects out of clay --------------------------------------------------------------------------------------


def finish(name, bm, collection, mats, origin=(0, 0, 0), parent=None, colour=None, by_material=None):
    """A bmesh becomes an object whose origin is where it turns, coloured vertex by vertex, by what it is."""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    origin = Vector(origin)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    # A vertex takes the colour of what it belongs to: the first face that has it.
    owner = {}
    for poly in mesh.polygons:
        for vi in poly.vertices:
            owner.setdefault(vi, poly.material_index)
    attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(mesh.vertices):
        painter = (by_material or {}).get(owner.get(i), colour or skin_colour)
        attr.data[i].color = (*painter(v.co), 1.0)
    for v in mesh.vertices:
        v.co -= origin
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = origin if parent is None else origin - Vector(parent.location)
    if parent is not None:
        obj.parent = parent
    return obj


def head_parts(collection, mats):
    # --- The lump: cranium, brow, cheeks, jaw, chin, jowls, nose, ears, and the neck it sits on ---
    bm = bmesh.new()
    C = HEAD
    ellipsoid(bm, C + Vector((-0.012, 0, 0.018)), (0.1, 0.098, 0.106))
    ellipsoid(bm, C + Vector((-0.045, 0, 0.005)), (0.075, 0.088, 0.09))
    ellipsoid(bm, C + Vector((0.07, 0, 0.048)), (0.05, 0.078, 0.032))  # brow
    for side in (-1, 1):
        ellipsoid(bm, C + Vector((0.052, side * 0.06, -0.018)), (0.048, 0.042, 0.046))  # cheek
        ellipsoid(bm, C + Vector((0.015, side * 0.062, -0.07)), (0.062, 0.036, 0.05))  # jaw
        ellipsoid(bm, C + Vector((0.055, side * 0.066, -0.076)), (0.032, 0.028, 0.028))  # jowl
        ellipsoid(bm, C + Vector((-0.004, side * 0.1, 0.0)), (0.013, 0.011, 0.036))  # ear
        ellipsoid(bm, C + Vector((0.002, side * 0.099, -0.03)), (0.012, 0.009, 0.013))  # lobe
        ellipsoid(bm, C + Vector((0.114, side * 0.021, -0.032)), (0.018, 0.016, 0.014))  # nostril
    ellipsoid(bm, C + Vector((0.08, 0, -0.096)), (0.036, 0.042, 0.03))  # chin
    ellipsoid(bm, C + Vector((0.092, 0, -0.045)), (0.036, 0.05, 0.032))  # upper lip
    ellipsoid(bm, C + Vector((0.098, 0, 0.018)), (0.022, 0.017, 0.032))  # bridge of the nose
    ellipsoid(bm, C + Vector((0.13, 0, -0.014)), (0.032, 0.03, 0.028))  # its tip
    ellipsoid(bm, C + Vector((0.04, 0, -0.118)), (0.055, 0.062, 0.028))  # a second chin
    sausage(bm, C + Vector((-0.02, 0, -0.08)), NECK + Vector((0, 0, -0.03)), 0.058, 0.06)

    def sculpt(v):
        for side in (-1, 1):
            eye = Vector((EYE.x, EYE.y * side, EYE.z))
            bump(v, eye, 0.017, -0.013, (-1, 0, 0))  # sockets
            bump(v, eye + Vector((0.008, 0.004 * side, 0.026)), 0.016, 0.005, (1, 0, 0.3))  # the ridge of the brow
            bump(v, C + Vector((-0.002, side * 0.108, 0.002)), 0.012, -0.007, (0, -side, 0))  # the hollow of the ear
            bump(v, C + Vector((0.1, side * 0.045, -0.06)), 0.014, -0.004, (-1, 0, 0))  # the fold beside the nose

    skull = clay(bm, collection, 0.0035, 2, 7000, sculpt)

    # --- Cut: the jaw hinges under the ears; the nape behind the hinge stays with the skull ---
    front, hinge = Vector((C.x + 0.11, 0, MOUTH_Z)), Vector((HINGE.x, 0, HINGE.z))
    along = (hinge - front).normalized()
    normal = Vector((-along.z, 0, along.x))
    if normal.z < 0:
        normal = -normal
    lower = skull.copy()
    res = bmesh.ops.bisect_plane(skull, geom=skull.verts[:] + skull.edges[:] + skull.faces[:], dist=1e-5, plane_co=front, plane_no=normal, clear_outer=False, clear_inner=True)
    roof = bmesh.ops.contextual_create(skull, geom=[e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)])["faces"]
    res = bmesh.ops.bisect_plane(lower, geom=lower.verts[:] + lower.edges[:] + lower.faces[:], dist=1e-5, plane_co=front, plane_no=normal, clear_outer=True, clear_inner=False)
    floor = bmesh.ops.contextual_create(lower, geom=[e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)])["faces"]
    for f in roof + floor:
        f.material_index = IDX["mouth"]
        f.smooth = False
    # The nape: whatever of the lower part lies behind the hinge goes back to the skull.
    bmesh.ops.bisect_plane(lower, geom=lower.verts[:] + lower.edges[:] + lower.faces[:], dist=1e-5, plane_co=hinge, plane_no=Vector((1, 0, 0)), clear_outer=False, clear_inner=False)
    nape = lower.copy()
    bmesh.ops.delete(nape, geom=[f for f in nape.faces if f.calc_center_median().x >= hinge.x - 1e-4], context="FACES")
    bmesh.ops.delete(lower, geom=[f for f in lower.faces if f.calc_center_median().x < hinge.x - 1e-4], context="FACES")
    tmpm = bpy.data.meshes.new("tmp-nape")
    nape.to_mesh(tmpm)
    nape.free()
    skull.from_mesh(tmpm)
    bpy.data.meshes.remove(tmpm)
    # Both new openings are closed with skin: the jaw's back is inside the head, the skull's front is under the jaw.
    for part in (skull, lower):
        rim = [e for e in part.edges if e.is_boundary]
        if rim:
            for f in bmesh.ops.contextual_create(part, geom=rim)["faces"]:
                f.material_index = IDX["skin"]
                f.smooth = False
    bmesh.ops.recalc_face_normals(skull, faces=skull.faces)
    bmesh.ops.recalc_face_normals(lower, faces=lower.faces)

    # --- On the skull: hair where the cap does not reach, then the head is an object ---
    for f in skull.faces:
        if f.material_index == IDX["mouth"]:
            continue
        rel = f.calc_center_median() - C
        ear = abs(rel.y) > 0.088 and -0.045 < rel.z < 0.04 and -0.03 < rel.x < 0.02
        fringe = (rel.x < -0.02 or abs(rel.y) > 0.078) and -0.02 < rel.z < 0.075 and not ear and rel.x < 0.035
        burns = abs(rel.y) > 0.09 and 0.0 < rel.x < 0.03 and -0.05 < rel.z < -0.02
        f.material_index = IDX["hair"] if fringe or burns else IDX["skin"]
    head = finish("head", skull, collection, mats, NECK, by_material={IDX["hair"]: lambda p: HAIR * grain(p, 80, 0.12), IDX["mouth"]: flat("mouth")})

    # --- The jaw, with a lower lip on it ---
    for f in lower.faces:
        if f.material_index != IDX["mouth"]:
            f.material_index = IDX["skin"]
    ellipsoid(lower, Vector((C.x + 0.1, 0, MOUTH_Z - 0.009)), (0.011, 0.028, 0.007), seg=(14, 8), mat="skin")
    jaw = finish("jaw", lower, collection, mats, HINGE, parent=head, colour=lambda p: skin_colour(p).lerp(FLUSH, 0.5 if abs(p.z - (MOUTH_Z - 0.009)) < 0.008 and p.x > C.x + 0.09 else 0), by_material={IDX["mouth"]: flat("mouth")})

    # --- Teeth: a white ridge under the roof of the mouth, seen when it opens ---
    bm = bmesh.new()
    ellipsoid(bm, Vector((C.x + 0.088, 0, MOUTH_Z + 0.004)), (0.02, 0.03, 0.0045), seg=(16, 8), mat="white")
    finish("teeth", bm, collection, mats, NECK, parent=head, colour=flat("white"))

    # --- Eyes: a ball, an iris, a pupil; and a heavy upper lid that blinks ---
    for side, tag in ((1, "l"), (-1, "r")):
        eye = Vector((EYE.x, EYE.y * side, EYE.z))
        bm = bmesh.new()
        ellipsoid(bm, eye, (0.0165, 0.0165, 0.0165), seg=(20, 14), mat="white")
        ellipsoid(bm, eye + Vector((0.0125, 0, 0)), (0.0045, 0.0088, 0.0088), seg=(16, 10), mat="iris")
        ellipsoid(bm, eye + Vector((0.0158, 0, 0)), (0.0025, 0.0045, 0.0045), seg=(12, 8), mat="black")
        finish(f"eye_{tag}", bm, collection, mats, eye, parent=head, colour=flat("white"), by_material={IDX["iris"]: flat("iris"), IDX["black"]: flat("black")})
        bm = bmesh.new()
        ellipsoid(bm, eye, (0.0195, 0.0195, 0.0195), seg=(24, 16), mat="skin")
        # Only the upper front of the shell is lid: the rest is cut away. It hangs down to just above the pupil.
        doomed = [f for f in bm.faces if (f.calc_center_median() - eye).z < 0.0035 or (f.calc_center_median() - eye).x < -0.004]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        rim = [e for e in bm.edges if e.is_boundary]
        thick = bmesh.ops.extrude_edge_only(bm, edges=rim)
        bmesh.ops.scale(bm, vec=(0.9, 0.9, 0.9), space=Matrix.Translation(-eye), verts=[g for g in thick["geom"] if isinstance(g, bmesh.types.BMVert)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            f.material_index = IDX["skin"]
            f.smooth = True
        finish(f"lid_{tag}", bm, collection, mats, eye, parent=head, colour=lambda p: skin_colour(p) * 0.92)

    # --- Brows and moustache: bushy, and with a mind of their own ---
    for side, tag in ((1, "l"), (-1, "r")):
        bm = bmesh.new()
        base = Vector((EYE.x + 0.006, EYE.y * side, EYE.z + 0.03))
        for i in range(7):
            t = i / 6
            at = base + Vector((-0.004 * abs(t - 0.4), (t - 0.45) * 0.058 * side, 0.006 * math.sin(t * math.pi) - 0.006 * t))
            ellipsoid(bm, at, (0.0075, 0.0085, 0.0058 + 0.003 * math.sin(t * math.pi)), seg=(10, 8))
        brow = clay(bm, collection, 0.0018, 1, 500)
        for f in brow.faces:
            f.material_index = IDX["whiskers"]
        finish(f"brow_{tag}", brow, collection, mats, base, parent=head, colour=lambda p: WHISKERS.lerp(HAIR, 0.5 * max(0.0, noise.noise(p * 300))))
    bm = bmesh.new()
    for side in (-1, 1):
        for i in range(9):
            t = i / 8
            at = Vector((C.x + 0.132 - 0.05 * t * t, side * (0.004 + t * 0.07), MOUTH_Z + 0.01 - 0.008 * t - 0.03 * t * t * t))
            ellipsoid(bm, at, (0.017 - 0.006 * t, 0.014, 0.016 - 0.007 * t), seg=(10, 8))
    tache = clay(bm, collection, 0.002, 1, 1400)
    for f in tache.faces:
        f.material_index = IDX["whiskers"]
    finish("moustache", tache, collection, mats, Vector((C.x + 0.12, 0, MOUTH_Z + 0.008)), parent=head, colour=lambda p: WHISKERS.lerp(HAIR, 0.6 * max(0.0, noise.noise(p * 260))))

    # --- The cap: a soft crown pulled forward over a stiff peak ---
    bm = bmesh.new()
    crown = C + Vector((0.004, 0, 0.078))
    ellipsoid(bm, crown, (0.122, 0.11, 0.062))
    ellipsoid(bm, crown + Vector((0.035, 0, 0.01)), (0.095, 0.095, 0.05))
    ellipsoid(bm, crown + Vector((0.1, 0, -0.026)), (0.078, 0.088, 0.013))  # the peak

    def shape(v):
        rel = v.co - crown
        if rel.z < -0.012 and rel.x < 0.08:
            v.co.z = crown.z - 0.012  # the crown sits on the head, not through it
        if rel.x > 0.09:
            v.co.z -= 0.35 * (rel.x - 0.09) + 1.4 * rel.y * rel.y  # the peak curves down and out

    cap = clay(bm, collection, 0.003, 2, 2200, shape)
    for f in cap.faces:
        f.material_index = IDX["cap"]
    ellipsoid(cap, crown + Vector((-0.01, 0, 0.06)), (0.011, 0.011, 0.005), seg=(10, 6), mat="cap")
    finish("cap", cap, collection, mats, NECK, parent=head, colour=lambda p: WHITE * grain(p, 120, 0.1))
    return head


def body_part(collection, mats):
    """Sitting into the seat: a belly over the belt, shoulders rounded, thighs out to the pedals."""
    bm = bmesh.new()
    ellipsoid(bm, (0.03, 0, 0.53), (0.16, 0.19, 0.1))  # seat of the trousers
    ellipsoid(bm, (0.1, 0, 0.665), (0.195, 0.205, 0.15))  # belly
    ellipsoid(bm, (0.035, 0, 0.86), (0.15, 0.2, 0.13))  # chest
    ellipsoid(bm, (-0.01, 0, 0.98), (0.12, 0.235, 0.075))  # across the shoulders
    for side in (-1, 1):
        ellipsoid(bm, (-0.01, side * 0.21, 0.985), (0.062, 0.058, 0.06))  # the ball of the shoulder
        sausage(bm, (0.05, side * 0.1, 0.5), (0.44, side * 0.125, 0.5), 0.088, 0.072)  # thigh
        ellipsoid(bm, (0.46, side * 0.125, 0.49), (0.07, 0.07, 0.068))  # knee
        sausage(bm, (0.47, side * 0.125, 0.47), (0.6, side * 0.13, 0.1), 0.062, 0.05)  # shin
    sausage(bm, (0.0, 0, 1.0), (0.02, 0, 1.135), 0.062, 0.054)  # neck

    def sculpt(v):
        # The belly rests on the belt and hangs over it a little; the collarbones show.
        bump(v, (0.27, 0, 0.6), 0.05, 0.012, (1, 0, -0.3))
        for side in (-1, 1):
            bump(v, (0.1, side * 0.08, 1.03), 0.03, -0.004, (-1, 0, 0))

    body = clay(bm, collection, 0.007, 3, 5200, sculpt)

    def belt_z(x):
        return 0.57 - max(0.0, x - 0.02) * 0.32

    for f in body.faces:
        c = f.calc_center_median()
        if c.z > 1.03 and math.hypot(c.x - 0.01, c.y) < 0.08:
            f.material_index = IDX["skin"]
        elif c.x > 0.36 or c.z < belt_z(c.x) - 0.015:
            f.material_index = IDX["trousers"]
        elif c.z < belt_z(c.x) + 0.017 and c.x < 0.34:
            f.material_index = IDX["belt"]
        else:
            f.material_index = IDX["shirt"]

    # --- Collar, placket and buttons: thin things the clay would swallow ---
    for side in (-1, 1):
        flap = [body.verts.new(p) for p in ((0.064, side * 0.006, 1.062), (0.118, side * 0.072, 0.988), (0.05, side * 0.108, 1.06), (0.014, side * 0.06, 1.106))]
        faces = [body.faces.new(flap if side > 0 else list(reversed(flap)))]
        ext = bmesh.ops.extrude_face_region(body, geom=faces)
        bmesh.ops.translate(body, verts=[g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)], vec=(0.012, 0, 0.008))
        for f in {f for v in flap for f in v.link_faces} | {g for g in ext["geom"] if isinstance(g, bmesh.types.BMFace)}:
            f.material_index = IDX["shirt"]
            f.smooth = False
    for x, z in ((0.144, 0.985), (0.189, 0.9), (0.249, 0.805), (0.289, 0.7)):
        ellipsoid(body, (x, 0, z), (0.005, 0.011, 0.011), seg=(10, 6), mat="white")
    # --- The seatbelt: over the left shoulder, across the belly, to the buckle at the right hip ---
    torso_c, torso_r = Vector((0.06, 0, 0.76)), Vector((0.215, 0.215, 0.29))

    def on_torso(p):
        rel = Vector(p) - torso_c
        e = Vector((rel.x / torso_r.x, rel.y / torso_r.y, rel.z / torso_r.z)).normalized()
        return torso_c + Vector((e.x * torso_r.x, e.y * torso_r.y, e.z * torso_r.z)) * 1.03

    def outward(p):
        rel = Vector(p) - torso_c
        return Vector((rel.x / torso_r.x**2, rel.y / torso_r.y**2, rel.z / torso_r.z**2))

    strap = [on_torso(Vector((0.0, 0.17, 1.05)).lerp(Vector((0.18, -0.2, 0.56)), i / 16)) for i in range(17)]
    for f in ribbon(body, strap, 0.047, 0.0045, outward):
        f.material_index = IDX["seatbelt"]
        f.smooth = False
    ellipsoid(body, (0.17, -0.205, 0.55), (0.02, 0.012, 0.028), seg=(10, 8), mat="steel")

    # --- Shoes, the right one on the accelerator, both a size too shiny ---
    shoes = bmesh.new()
    for side in (-1, 1):
        ellipsoid(shoes, (0.66, side * 0.13, 0.045), (0.1, 0.048, 0.042))
        ellipsoid(shoes, (0.6, side * 0.13, 0.05), (0.06, 0.05, 0.05))
    shoes = clay(shoes, collection, 0.006, 2, 900)
    for f in shoes.faces:
        f.material_index = IDX["shoes"]
    tmpm = bpy.data.meshes.new("tmp-shoes")
    shoes.to_mesh(tmpm)
    shoes.free()
    body.from_mesh(tmpm)
    bpy.data.meshes.remove(tmpm)

    return finish("body", body, collection, mats, by_material={IDX["shirt"]: cloth, IDX["trousers"]: flat("trousers"), IDX["belt"]: flat("belt"), IDX["seatbelt"]: flat("seatbelt"), IDX["shoes"]: flat("shoes"), IDX["white"]: flat("white"), IDX["steel"]: flat("steel")})


def arm_part(collection, mats, side, tag):
    """One arm along +Z from the shoulder, skinned to two bones so that the elbow bends without a seam."""
    bm = bmesh.new()
    ellipsoid(bm, (0, 0, 0.0), (0.054, 0.054, 0.056))
    sausage(bm, (0, 0, 0.0), (0, 0, UPPER), 0.052, 0.044)
    ellipsoid(bm, (0, 0, UPPER), (0.047, 0.047, 0.05))
    sausage(bm, (0, 0, UPPER), (0, 0, UPPER + 0.09), 0.046, 0.05)  # the forearm swells below the elbow
    sausage(bm, (0, 0, UPPER + 0.09), (0, 0, UPPER + FORE), 0.05, 0.035)
    arm = clay(bm, collection, 0.0045, 2, 1500)
    for f in arm.faces:
        f.material_index = IDX["skin"]
    if side < 0:
        bmesh.ops.scale(arm, vec=(1, -1, 1), verts=arm.verts[:])
        bmesh.ops.reverse_faces(arm, faces=arm.faces[:])
    mesh_obj = finish(f"arm_{tag}_mesh", arm, collection, mats, colour=lambda p: SKIN * grain(p, 50, 0.06))
    # A short sleeve, loose, with a hem: its own skin, so that the hem is an edge and not a line painted across triangles.
    bm = bmesh.new()
    sausage(bm, (0, 0, -0.03), (0, 0, 0.12), 0.063, 0.059)
    ellipsoid(bm, (0, 0, 0.122), (0.061, 0.061, 0.012))
    sleeve = clay(bm, collection, 0.004, 2, 700)
    for f in sleeve.faces:
        f.material_index = IDX["shirt"]
    if side < 0:
        bmesh.ops.scale(sleeve, vec=(1, -1, 1), verts=sleeve.verts[:])
        bmesh.ops.reverse_faces(sleeve, faces=sleeve.faces[:])
    sleeve_obj = finish(f"arm_{tag}_sleeve", sleeve, collection, mats, colour=cloth)
    # Weights: all upper until near the elbow, all forearm past it, a hand's breadth of blend between. The sleeve is all upper.
    for obj, blend in ((mesh_obj, True), (sleeve_obj, False)):
        upper = obj.vertex_groups.new(name="upper")
        fore = obj.vertex_groups.new(name="fore")
        for v in obj.data.vertices:
            t = min(1.0, max(0.0, (v.co.z - (UPPER - 0.035)) / 0.07)) if blend else 0.0
            t = t * t * (3 - 2 * t)
            upper.add([v.index], 1 - t, "REPLACE")
            fore.add([v.index], t, "REPLACE")
    # The bones.
    old = bpy.data.objects.get(f"arm_{tag}")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    data = bpy.data.armatures.new(f"arm_{tag}")
    rig = bpy.data.objects.new(f"arm_{tag}", data)
    collection.objects.link(rig)
    # Bones can only be added in edit mode, and edit mode wants the armature active in the view layer.
    view = bpy.context.view_layer
    was = view.objects.active
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    view.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    b1 = data.edit_bones.new("upper")
    b1.head, b1.tail = (0, 0, 0), (0, 0, UPPER)
    b2 = data.edit_bones.new("fore")
    b2.head, b2.tail = (0, 0, UPPER), (0, 0, UPPER + FORE)
    b2.parent = b1
    b2.use_connect = True
    bpy.ops.object.mode_set(mode="OBJECT")
    view.objects.active = was
    rig["upper"] = UPPER
    rig["fore"] = FORE
    for obj in (mesh_obj, sleeve_obj):
        obj.parent = rig
        obj.modifiers.new("skin", "ARMATURE").object = rig
    return rig, mesh_obj, sleeve_obj


def hand_part(collection, mats, side, tag, pose):
    """A hand at the wrist, fingers along +Z, palm towards -X, thumb towards +Y on the right hand: mirrored for the left."""
    bm = bmesh.new()
    ellipsoid(bm, (0, 0, 0.012), (0.03, 0.03, 0.03))  # the wrist
    ellipsoid(bm, (0.002, 0, 0.05), (0.018, 0.043, 0.048))  # the palm
    curled = ((-0.3, 1.0), (-0.85, 0.55), (-1.0, -0.15))
    straight = ((-0.05, 1.0), (-0.15, 1.0), (-0.28, 0.96))
    for i, y in enumerate((-0.032, -0.011, 0.011, 0.033)):  # little finger to index
        length = (0.85, 0.98, 1.06, 0.98)[i]
        segs = straight if pose == "open" or (pose == "point" and i == 3) else curled
        at = Vector((0.0, y * (1.1 if pose == "open" else 1.0), 0.09))
        r = 0.0095
        for j, (dx, dz) in enumerate(segs):
            d = Vector((dx, 0.06 * (y / 0.033) if pose == "open" else 0.0, dz)).normalized() * (0.031, 0.027, 0.022)[j] * length
            sausage(bm, at, at + d, r, r * 0.9, 10)
            ellipsoid(bm, at, (r * 1.1, r * 1.1, r * 1.1), seg=(10, 8))  # the knuckle
            at = at + d
            r *= 0.9
    thumb = {"grip": ((-0.3, 0.75, 0.6), (-0.9, 0.35, 0.35)), "open": ((-0.1, 0.9, 0.5), (-0.2, 0.85, 0.5)), "point": ((-0.35, 0.6, 0.72), (-0.95, 0.1, 0.3))}[pose]
    at = Vector((-0.006, 0.04, 0.03))
    for j, d in enumerate(thumb):
        d = Vector(d).normalized() * (0.036, 0.03)[j]
        sausage(bm, at, at + d, 0.012, 0.0105, 10)
        at = at + d

    def sculpt(v):
        bump(v, (0.012, 0, 0.075), 0.02, 0.003, (1, 0, 0))  # knuckles of the back of the hand

    hand = clay(bm, collection, 0.0022, 2, 1500, sculpt)
    for f in hand.faces:
        f.material_index = IDX["skin"]
    if side < 0:
        bmesh.ops.scale(hand, vec=(1, -1, 1), verts=hand.verts[:])
        bmesh.ops.reverse_faces(hand, faces=hand.faces[:])
    return finish(f"hand_{tag}_{pose}", hand, collection, mats, colour=lambda p: SKIN.lerp(FLUSH, 0.35 * max(0.0, min(1.0, (p.z - 0.07) / 0.05)) if p.x > 0.005 else 0) * grain(p, 60, 0.06))


# --- All of him ------------------------------------------------------------------------------------------------------


def triangles(objs):
    return sum(len(p.vertices) - 2 for o in objs if o.type == "MESH" for p in o.data.polygons)


def build(collection):
    mats = materials()
    head = head_parts(collection, mats)
    parts = [head, *head.children, body_part(collection, mats)]
    for side, tag in ((-1, "r"), (1, "l")):
        rig, mesh, sleeve = arm_part(collection, mats, side, tag)
        parts += [rig, mesh, sleeve]
        for pose in ("grip", "open", "point"):
            parts.append(hand_part(collection, mats, side, tag, pose))
    for m in [m for m in bpy.data.meshes if m.users == 0 and (m.name.startswith("tmp") or m.name.split(".")[0] in {o.name for o in parts})]:
        bpy.data.meshes.remove(m)
    return parts


def export(parts, out):
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "driver.glb")
    bpy.ops.object.select_all(action="DESELECT")
    kept = {}
    for o in parts:
        if o.parent is None and o.name not in ("body", "head"):
            kept[o] = (o.location.copy(), o.rotation_euler.copy())
            o.location = (0, 0, 0)  # hands and arms travel at their own origin; where they sit is the app's business
            o.rotation_euler = (0, 0, 0)
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    settings = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_normals=True, export_materials="EXPORT", export_extras=True, export_skins=True, export_animations=False)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    for key, value in (("export_rest_position_armature", True), ("export_vertex_color", "MATERIAL"), ("export_all_vertex_colors", False)):
        if key in props:
            settings[key] = value
    bpy.ops.export_scene.gltf(**settings)
    for o, (at, rot) in kept.items():
        o.location, o.rotation_euler = at, rot
    return f"driver: {triangles(parts)} triangles in {len(parts)} parts, {os.path.getsize(path) // 1024} KB"


def pose(parts, offset):
    """Laid out to be looked at: him in his seat, arms bent to a wheel, the hands in a row at his feet."""
    for o in parts:
        if o.parent is None:
            o.location = Vector(o.location) + offset
    for i, o in enumerate(p for p in parts if p.name.startswith("hand_")):
        o.location = offset + Vector((0.6, -0.36 + 0.12 * i, 0.0))
        o.rotation_euler = (0, math.radians(-90), 0)
    for tag, y in (("r", -0.215), ("l", 0.215)):
        rig = bpy.data.objects[f"arm_{tag}"]
        rig.location = offset + Vector((-0.01, y, 0.985))
        rig.rotation_euler = (0, math.radians(118), 0)  # the upper arm hangs forward and down...
        rig.pose.bones["fore"].rotation_mode = "XYZ"
        rig.pose.bones["fore"].rotation_euler = (0, math.radians(-62), 0)  # ...and the forearm comes up to the wheel


def live(out=None):
    """Build in the Blender that is open, inside one collection of his own. Nothing else is touched."""
    scene = bpy.context.scene
    col = bpy.data.collections.get(COLLECTION) or bpy.data.collections.new(COLLECTION)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    parts = build(col)
    report = export(parts, out) if out else f"driver: {triangles(parts)} triangles in {len(parts)} parts"
    pose(parts, Vector((-8, 6, 0)))
    return report


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    print("DRIVER", export(build(bpy.context.scene.collection), OUT))


if __name__ == "__main__":
    main()
