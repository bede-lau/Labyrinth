"""Rebuild the offline W7-X display mesh with Blender 4.2's Python module (bpy).

Download the two pinned source files listed in SOURCES.md first and pass the
SIMSOPT W7-X.dat and ORNL vessel.part paths as arguments, in that order.
Native machine coordinates are metres, right handed, with vertical Z.
"""

import base64
import csv
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy

COIL_HASH = "7c17c0c589026915414676fe47c10cd0aefa581c23dccbb390b08f8b73580de6"
VESSEL_HASH = "864272f7575e32e97bd24a875caa24dc84f3f312e2a4f3ce12266dcd516de415"


def checked_source(path, expected):
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"Unexpected source checksum: {path}")
    return data.decode().splitlines()


def encode(components, fmt):
    return base64.b64encode(struct.pack(f"<{len(components)}{fmt}", *components)).decode()


def mesh_buffers(mesh):
    # Millimetre precision keeps the web asset small. All vertices fit in int16.
    coordinates = [round(1000 * x) for vertex in mesh.vertices for x in vertex.co]
    mesh.calc_loop_triangles()
    triangles = [index for face in mesh.loop_triangles for index in face.vertices]
    return encode(coordinates, "h"), encode(triangles, "H")


def coil_mesh(rows, coil):
    # SIMSOPT stores one row per harmonic, and sin/cos pairs for x, y, z.
    coefficients = [row[6 * coil:6 * (coil + 1)] for row in rows]
    curve = bpy.data.curves.new(f"W7-X coil {coil + 1}", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.048  # Display cross-section in m, independent of the centreline.
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    samples = 120
    spline.points.add(samples - 1)
    for i, point in enumerate(spline.points):
        u = math.tau * i / samples
        point.co = (*[
            sum(row[2 * axis] * math.sin(n * u) + row[2 * axis + 1] * math.cos(n * u)
                for n, row in enumerate(coefficients))
            for axis in range(3)
        ], 1)
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new(curve.name, curve)
    bpy.context.collection.objects.link(obj)
    obj_eval = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    buffers = mesh_buffers(obj_eval.to_mesh())
    obj_eval.to_mesh_clear()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.curves.remove(curve)
    return buffers


def vessel_mesh(lines):
    n_phi, n_poloidal, periods = map(int, lines[1].split()[:3])
    assert (n_phi, n_poloidal, periods) == (41, 73, 5)
    vertices, quads = [], []
    # Sample every other contour / point, dropping each duplicated closure point.
    count = (n_poloidal - 1) // 2
    for j in range(0, n_phi, 2):
        start = 2 + j * (n_poloidal + 1)
        phi = math.radians(float(lines[start]))
        for i in range(0, n_poloidal - 1, 2):
            r, z = (float(x) / 100 for x in lines[start + 1 + i].split()[:2])
            vertices.append((r * math.cos(phi), r * math.sin(phi), z))
        if j:
            base = (j // 2 - 1) * count
            for i in range(count):
                a, b = base + i, base + (i + 1) % count
                quads.append((a, a + count, b + count, b))
    mesh = bpy.data.meshes.new("W7-X vacuum vessel, one field period")
    mesh.from_pydata(vertices, [], quads)
    buffers = mesh_buffers(mesh)
    bpy.data.meshes.remove(mesh)
    return buffers


def support_module():
    """One schematic pentagonal box-girder side, repeated in the five field periods."""
    vertices, faces = [], []
    def beam(x, y, z, dx, dy, dz):
        start = len(vertices)
        for k in range(8):
            vertices.append((x + dx * ((k & 1) - 0.5),
                             y + dy * (((k >> 1) & 1) - 0.5),
                             z + dz * (((k >> 2) & 1) - 0.5)))
        for indices in [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4),
                        (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]:
            faces.append([start + i for i in indices])
    radius = 5.0
    length = 2 * radius * math.sin(math.pi / 5)
    x = radius * math.cos(math.pi / 5)
    for z in (-1.16, 1.16):
        beam(x, 0, z, 0.32, length, 0.18)
    for fraction in (-0.48, -0.25, 0, 0.25, 0.48):
        beam(x, length * fraction, 0, 0.24, 0.16, 2.32)
    mesh = bpy.data.meshes.new("Central coil support, schematic module")
    mesh.from_pydata(vertices, [], faces)
    result = mesh_buffers(mesh)
    bpy.data.meshes.remove(mesh)
    return result


def main():
    coil_rows = [list(map(float, row)) for row in csv.reader(checked_source(sys.argv[1], COIL_HASH))]
    meshes = [coil_mesh(coil_rows, i) for i in range(7)]
    assert all(index == meshes[0][1] for _, index in meshes)
    vessel, vessel_index = vessel_mesh(checked_source(sys.argv[2], VESSEL_HASH))
    support, support_index = support_module()
    asset = {
        "supportPositionMM": support,
        "supportTriangles": support_index,
        "coilPositionMM": [vertices for vertices, _ in meshes],
        "coilTriangles": meshes[0][1],
        "vesselPositionMM": vessel,
        "vesselTriangles": vessel_index,
    }
    Path(__file__).with_name("w7x-hardware.json").write_text(json.dumps(asset, indent=2) + "\n")


if __name__ == "__main__":
    main()
