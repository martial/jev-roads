# Trims the Quaternius characters in public/models/people to the animations the app plays (Walk, Idle_Neutral,
# Wave), out of the two dozen each carries: the file shrinks to a fifth. Pure Python, no Blender needed.
#   python3 scripts/trim-people.py public/models/people/*.glb
import json, struct, sys

KEEP = {"Walk", "Idle_Neutral", "Wave"}

def trim(path):
    data = open(path, "rb").read()
    assert data[:4] == b"glTF"
    jlen = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + jlen])
    boff = 20 + jlen
    blen = struct.unpack("<I", data[boff:boff + 4])[0]
    bin_ = data[boff + 8:boff + 8 + blen]
    j["animations"] = [a for a in j.get("animations", []) if a.get("name") in KEEP]
    # Which accessors are still referred to by anything: meshes, skins, the kept animations.
    used = set()
    for m in j.get("meshes", []):
        for p in m["primitives"]:
            used.update(p["attributes"].values())
            if "indices" in p: used.add(p["indices"])
            for t in p.get("targets", []): used.update(t.values())
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: used.add(s["inverseBindMatrices"])
    for a in j["animations"]:
        for smp in a["samplers"]:
            used.add(smp["input"]); used.add(smp["output"])
    old_acc = j["accessors"]
    acc_map = {}
    new_acc = []
    for i, acc in enumerate(old_acc):
        if i in used:
            acc_map[i] = len(new_acc); new_acc.append(acc)
    views_used = {acc["bufferView"] for acc in new_acc if "bufferView" in acc}
    for img in j.get("images", []):
        if "bufferView" in img: views_used.add(img["bufferView"])
    old_views = j["bufferViews"]
    view_map, new_views, out = {}, [], bytearray()
    for i, v in enumerate(old_views):
        if i not in views_used: continue
        start = v.get("byteOffset", 0); chunk = bin_[start:start + v["byteLength"]]
        while len(out) % 4: out.append(0)
        nv = dict(v); nv["byteOffset"] = len(out); out += chunk
        view_map[i] = len(new_views); new_views.append(nv)
    for acc in new_acc:
        if "bufferView" in acc: acc["bufferView"] = view_map[acc["bufferView"]]
    for img in j.get("images", []):
        if "bufferView" in img: img["bufferView"] = view_map[img["bufferView"]]
    def remap(x): return acc_map[x]
    for m in j.get("meshes", []):
        for p in m["primitives"]:
            p["attributes"] = {k: remap(v) for k, v in p["attributes"].items()}
            if "indices" in p: p["indices"] = remap(p["indices"])
            p["targets"] = [{k: remap(v) for k, v in t.items()} for t in p.get("targets", [])] or p.get("targets")
            if not p.get("targets"): p.pop("targets", None)
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: s["inverseBindMatrices"] = remap(s["inverseBindMatrices"])
    for a in j["animations"]:
        for smp in a["samplers"]:
            smp["input"] = remap(smp["input"]); smp["output"] = remap(smp["output"])
    j["accessors"] = new_acc; j["bufferViews"] = new_views
    j["buffers"] = [{"byteLength": len(out)}]
    while len(out) % 4: out.append(0)
    jb = json.dumps(j, separators=(",", ":")).encode()
    while len(jb) % 4: jb += b" "
    total = 12 + 8 + len(jb) + 8 + len(out)
    with open(path, "wb") as f:
        f.write(b"glTF" + struct.pack("<II", 2, total) + struct.pack("<I", len(jb)) + b"JSON" + jb + struct.pack("<I", len(out)) + b"BIN\0" + bytes(out))
    return f"{path.split('/')[-1]}: {len(data) // 1024} KB -> {total // 1024} KB, animations {[a['name'] for a in j['animations']]}"

for p in sys.argv[1:]:
    print(trim(p))
