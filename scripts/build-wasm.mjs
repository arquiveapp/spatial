import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
execFileSync(process.execPath, ["tools/sbom/check.mjs"], { stdio: "inherit", timeout: 120000 });
const sourceHash = createHash("sha256")
  .update(await readFile("native/spikes/luma.cpp"))
  .digest("hex");
const config = JSON.parse(await readFile("docker/emsdk/toolchain.json", "utf8"));
if (!/^emscripten\/emsdk@sha256:[a-f0-9]{64}$/.test(config.image))
  throw Error("Immutable toolchain required");
await mkdir("tools/devlab/generated", { recursive: true });
const notices = {};
for (const [name, source] of Object.entries({
  "EMSCRIPTEN-LICENSE.txt": "/emsdk/upstream/emscripten/LICENSE",
  "MUSL-COPYRIGHT.txt": "/emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT",
  "COMPILER-RT-LICENSE.txt": "/emsdk/upstream/emscripten/system/lib/compiler-rt/LICENSE.TXT",
})) {
  const content = execFileSync(
    "docker",
    ["run", "--rm", "--network=none", "--platform", config.platform, config.image, "cat", source],
    { timeout: 30000 },
  );
  await writeFile(`tools/devlab/generated/${name}`, content);
  notices[name] = createHash("sha256").update(content).digest("hex");
}
const hashes = {};
for (const variant of ["base", "simd"]) {
  const output = `tools/devlab/generated/luma.${variant}.wasm`;
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--platform",
      config.platform,
      "-e",
      "SOURCE_DATE_EPOCH=0",
      "-v",
      `${process.cwd()}:/src`,
      "-w",
      "/src",
      config.image,
      "em++",
      "native/spikes/luma.cpp",
      "-std=c++17",
      "-O3",
      "--no-entry",
      "-sSTANDALONE_WASM=1",
      "-sFILESYSTEM=0",
      "-sINITIAL_MEMORY=4194304",
      "-sSTACK_SIZE=65536",
      "-sALLOW_MEMORY_GROWTH=0",
      '-sEXPORTED_FUNCTIONS=["_input","_output","_process","_is_simd"]',
      ...(variant === "simd" ? ["-msimd128"] : []),
      "-o",
      output,
    ],
    { stdio: "inherit", timeout: 300000 },
  );
  hashes[variant] = createHash("sha256")
    .update(await readFile(output))
    .digest("hex");
}
await writeFile(
  "tools/devlab/generated/build.json",
  JSON.stringify({ ...config, sourceHash, notices, hashes }, null, 2) + "\n",
);
console.log(hashes);
