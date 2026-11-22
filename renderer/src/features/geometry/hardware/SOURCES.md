# W7-X hardware geometry

The 70 superconducting coils use the seven Fourier centreline families published in [SIMSOPT W7-X.dat](https://github.com/hiddenSymmetries/simsopt/blob/4dc3a3a300fc1212ff373cb7ebb0d403113bd63b/src/simsopt/configs/W7-X.dat). Five toroidal rotations and stellarator symmetry give 50 nonplanar and 20 planar coils. Blender sweeps an illustrative 48 mm radius along each centreline for display.

The translucent plasma vessel comes from the 41 toroidal contours of the ORNL Fusion library's [vessel.part](https://github.com/ORNL-Fusion/util-library/blob/7293bf08b39c5891152ee63f19a5f766b94977e6/matlab/bfield_library_jdl/W7X/vessel.part). The overlay samples these contours every 3.6 degrees during one field period and repeats them through five periods. It shares the VMEC plot's right-handed toroidal frame in metres. The hardware is a fixed geometric reference.

Run build_hardware.py using Blender's Python module (bpy 4.2.22 LTS) with local copies of the two source files as positional arguments. The generator checks both SHA-256 hashes. Browser playback uses the bundled mesh.

The Blender-built central coil support approximates the published five-sided, 10 m diameter, 2.5 m high structure. Flanges and webs are schematic. [Engineering description](https://pure.mpg.de/pubman/item/item_2141105_1/component/file_2141104/Chauvin_Designing.pdf)

## Third-party notices

SIMSOPT data, Copyright (c) 2023 Simsopt contributors.
ORNL Fusion bfield_library_jdl data, Copyright 2019 Jeremy D. Lore.

Both datasets are supplied under the MIT License, reproduced below.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
