import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
for (const [variant, simd] of [
  ["base", 0],
  ["simd", 1],
]) {
  const { instance } = await WebAssembly.instantiate(
    await readFile(`tools/devlab/generated/luma.${variant}.wasm`),
    {},
  );
  const e = instance.exports;
  e._initialize?.();
  assert.equal(e.is_simd(), simd);
  const pixels = new Uint8Array(e.memory.buffer, e.input(), 640 * 360 * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 256;
  let expected = 0;
  for (let i = 0; i < 640 * 360; i++)
    expected += (77 * pixels[4 * i] + 150 * pixels[4 * i + 1] + 29 * pixels[4 * i + 2]) >> 8;
  assert.equal(e.process(640 * 360), expected);
  assert.equal(e.process(-1), 0);
  assert.equal(e.process(640 * 360 + 1), 0);
  console.log(`${variant}: full-frame checksum and bounds passed`);
}
