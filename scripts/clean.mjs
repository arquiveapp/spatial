import { rm } from "node:fs/promises";
// Only generated package outputs owned by this repository.
for (const path of [
  "dist",
  "packages/core/dist",
  "packages/backend-webxr/dist",
  "packages/backend-vio-lite/dist",
  "packages/renderer-three/dist",
]) {
  await rm(new URL(`../${path}/`, import.meta.url), { recursive: true, force: true });
}
