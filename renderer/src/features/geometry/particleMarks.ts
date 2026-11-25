import type { ParticleTracks } from './particleTracks';
import { particleColours } from './particleTracks';

const digits = ['010110010010111','111001111100111','111001111001111','101101111001001','111100111001111'];
type Three = typeof import('three');

function markerTexture(T: Three, index: number) {
  const size = 48;
  const pixels = new Uint8Array(size * size * 4);
  const colour = new T.Color(particleColours[index]).convertLinearToSRGB();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - 23.5, y - 23.5);
      const col = Math.floor((x - 15) / 6), row = Math.floor((41 - y) / 7);
      const digit = col >= 0 && col < 3 && row >= 0 && row < 5 && digits[index]![row*3+col] === '1';
      const rgb = digit || radius > 20 ? [16,30,40] : [colour.r*255,colour.g*255,colour.b*255];
      pixels.set([...rgb, 255 * Math.min(1, Math.max(0, 23.5-radius))], 4*(y*size+x));
    }
  }
  const texture = new T.DataTexture(pixels,size,size);
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function particleMarks(T: Three, tracks: ParticleTracks) {
  const group = new T.Group();
  group.name = 'Plasma tracers';
  const marks = tracks.read().map((row, i) => {
    const buffer = (count: number) => {
      const geom = new T.BufferGeometry();
      const attr = new T.Float32BufferAttribute(new Float32Array(count*3),3);
      geom.setAttribute('position',attr.setUsage(T.DynamicDrawUsage));
      return geom;
    };
    const head = new T.Points(buffer(1), new T.PointsMaterial({
      map: markerTexture(T,i), size: 19, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false,
    }));
    head.material.addEventListener('dispose', () => head.material.map?.dispose());
    const trail = new T.Points(buffer(row.trail.length), new T.PointsMaterial({
      color: particleColours[i], size: 5, sizeAttenuation: false, opacity: 0.86, transparent: true, depthTest: false, depthWrite: false,
    }));
    trail.material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n if (distance(gl_PointCoord,vec2(0.5))>0.5) discard;');
    };
    head.name = 'P'+row.id;
    head.frustumCulled = trail.frustumCulled = false;
    head.renderOrder = 10;
    trail.renderOrder = 9;
    group.add(trail,head);
    return {head,trail};
  });
  return {group, update(followed?: number | null) {
    tracks.read().forEach((row,i) => {
      const {head,trail} = marks[i]!;
      head.visible = trail.visible = followed == null || followed === row.id;
      const pos = head.geometry.getAttribute('position');
      pos.setXYZ(0,...row.position);
      pos.needsUpdate = true;
      const tail = trail.geometry.getAttribute('position');
      row.trail.forEach((point,k) => tail.setXYZ(k,...point));
      tail.needsUpdate = true;
    });
  }};
}
