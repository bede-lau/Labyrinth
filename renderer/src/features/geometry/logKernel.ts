import type { TubeField } from './tubeResponse';

// The bundled DOM declarations include WebGPU interfaces but omit these runtime namespaces.
declare const GPUBufferUsage: Readonly<
  Record<'STORAGE' | 'UNIFORM' | 'COPY_DST' | 'COPY_SRC' | 'MAP_READ', GPUBufferUsageFlags>
>;
declare const GPUMapMode: { readonly READ: GPUMapModeFlags };

// Each workgroup owns one complete local tube. Each invocation handles a
// strided subset of its samples. Padding permits unequal tube lengths.
const program = `
  @group(0) @binding(0) var<storage,read> samples: array<vec4f>;
  @group(0) @binding(1) var<uniform> drive: array<vec4f, 2>;
  @group(0) @binding(2) var<storage,read_write> result: array<vec2f>;
  @compute @workgroup_size(64)
  fn calculate(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) i: u32) {
    let stride = arrayLength(&result) / 2u;
    for (var j=i; j<stride; j+=64u) {
      let k = group.x*stride+j;
      let change = dot(samples[2u*k],drive[0]) + samples[2u*k+1u].y * drive[1].x;
      result[k] = vec2f(samples[2u*k+1u].x*(1.0+change),change);
    }
  }`;

export async function openLogKernel(tubes: readonly TubeField[]) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  try {
    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: program }), entryPoint: 'calculate' },
    });
    const stride = Math.max(...tubes.map((t) => t.weights.length));
    const data = new Float32Array(2 * stride * 8);
    tubes.forEach(({ tube, weights }, lane) =>
      weights.forEach((w, i) => {
        const start = 8 * (lane * stride + i);
        data.set(w.slice(0, 4), start);
        data[start + 5] = w[4] ?? 0;
        data[start + 4] = tube.samples[i]!.bmag;
      }),
    );
    const buffer = (size: number, usage: GPUBufferUsageFlags) => device.createBuffer({ size, usage });
    const input = buffer(data.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(input, 0, data);
    const coil = buffer(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const size = 2 * stride * 8;
    const output = buffer(size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const staging = buffer(size, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [input, coil, output].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    return {
      dispose: () => device.destroy(),
      async read(drive: Float32Array<ArrayBuffer>) {
        const currents = new Float32Array(8);
        currents.set(drive);
        device.queue.writeBuffer(coil, 0, currents);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(2);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, staging, 0, size);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        try {
          const values = new Float32Array(staging.getMappedRange());
          return tubes.map((t, k) => {
            const rows = t.tube.samples;
            let index = 0;
            for (let i = 1; i < rows.length; i++) {
              if (Math.abs(values[2 * (k * stride + i) + 1]!) > Math.abs(values[2 * (k * stride + index) + 1]!))
                index = i;
            }
            return { index, field: values[2 * (k * stride + index)]!, change: values[2 * (k * stride + index) + 1]! };
          });
        } finally {
          staging.unmap();
        }
      },
    };
  } catch (error) {
    device.destroy();
    throw error;
  }
}
