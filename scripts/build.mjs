import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
// Core declarations must exist for workspace package resolution on a fresh checkout.
if (process.argv.includes("--noEmit")) {
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "packages/core/tsconfig.json"],
    { stdio: "inherit", timeout: 120000 },
  );
}
const names = ["core", "backend-webxr", "backend-vio-lite", "renderer-three"];
for (const path of [...names.map((n) => `packages/${n}`), "."]) {
  if (!process.argv.includes("--noEmit"))
    await rm(`${path}/dist`, { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      `${path}/tsconfig.json`,
      ...(process.argv.includes("--noEmit") ? ["--noEmit"] : []),
    ],
    { stdio: "inherit", timeout: 120000 },
  );
}
