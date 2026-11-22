"""Build the reference-image-inspired tokamak overlay with Blender's bpy module.
Dimensions are display proportions. The comparison assembly is independent of W7-X.
"""
import json
from math import cos, sin, tau, pi
from pathlib import Path

import bpy

from build_hardware import mesh_buffers


def revolved(name, profile, sweep=tau, start=0, sides=72):
    vertices = []
    faces = []
    closed = sweep == tau
    for i in range(sides if closed else sides + 1):
        angle = start + sweep*i/sides
        vertices.extend((r*cos(angle), r*sin(angle), z) for r, z in profile)
    n = len(profile)
    for i in range(sides):
        j = (i + 1) % (len(vertices)//n)
        for k in range(n):
            l = (k+1) % n
            faces.append((i*n+k, j*n+k, j*n+l, i*n+l))
    if not closed:
        faces.extend((tuple(reversed(range(n))), tuple(sides*n+k for k in range(n))))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    coords, triangles = mesh_buffers(mesh)
    bpy.data.meshes.remove(mesh)
    return {"name": name, "coords": coords, "triangles": triangles}


def conductor(name, points, radius):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points)-1)
    for p, coords in zip(spline.points, points):
        p.co = (*coords, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    coords, indices = mesh_buffers(evaluated.to_mesh())
    evaluated.to_mesh_clear()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.curves.remove(curve)
    return {"name": name, "coords": coords, "triangles": indices}


def main():
    parts = []
    def add(mesh, material, transforms):
        parts.append(dict(mesh, material=material, instances=transforms))

    modules = [(0, 0, (k-2.5)*0.68, 0) for k in range(6)]
    add(revolved("Inner sleeve", [(0.45,-2.05),(0.53,-2.05),(0.53,2.05),(0.45,2.05)]),
        "steel", [(0,0,0,0)])
    # The open side of each jacket exposes the winding pack beneath it.
    jacket = [(0.69,-0.27),(0.79,-0.27),(0.82,-0.24),(0.82,0.24),(0.79,0.27),(0.69,0.27)]
    add(revolved("Segmented insulation jacket", jacket, 1.42*pi, -0.07*pi), "jacket", modules)
    turns = 9
    points = [(0.655*cos(tau*turns*i/576), 0.655*sin(tau*turns*i/576), -0.27+0.54*i/576) for i in range(577)]
    add(conductor("Exposed helical winding", points, 0.032), "copper", modules)
    add(revolved("Intermodule compression ring", [(0.48,-0.033),(0.82,-0.033),(0.84,0),(0.82,0.033),(0.48,0.033)]),
        "steel", [(0,0,(k-3)*0.68,0) for k in range(7)])
    cap = [(0.43,-0.11),(0.91,-0.11),(0.98,-0.07),(0.98,0.07),(0.91,0.11),(0.43,0.11)]
    add(revolved("End flange", cap), "collar", [(0,0,z,0) for z in (-2.14,2.14)])
    posts = [(0.866*cos(tau*k/8),0.866*sin(tau*k/8),0,tau*k/8) for k in range(8)]
    add(revolved("Axial tie rod",[(0.015,-2.18),(0.047,-2.18),(0.047,2.18),(0.015,2.18)],sides=16), "steel", posts)
    add(revolved("Hex head", [(0.018,-0.055),(0.088,-0.055),(0.09,0.03),(0.077,0.055),(0.018,0.055)],sides=6),
        "fastener", [(x,y,z,a) for x,y,_,a in posts for z in (-2.30,2.30)])
    for sign in (-1,1):
        points = [(0.61,0,sign*2.03),(0.68,0,sign*2.28),(0.74,0,sign*2.42),
                  (0.86,0,sign*2.47),(1.14,0,sign*2.47)]
        add(conductor("Bent terminal lead",points,0.066),"copper",[(0,0,0,0),(0,0,0,pi)])
    Path(__file__).with_name("solenoid.json").write_text(json.dumps(parts,separators=(",",":"))+"\n")


if __name__ == "__main__":
    main()
