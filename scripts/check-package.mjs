import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "spatial-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });

try {
  // Build happens before this check. Test the actual tarball, not a workspace link.
  const [packed] = JSON.parse(
    run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], root),
  );
  const paths = packed.files.map((file) => file.path);
  for (const required of [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    assert(paths.includes(required), `Missing published file: ${required}`);
  }
  for (const path of paths) {
    assert(
      /^(?:package\.json|README\.md|CHANGELOG\.md|LICENSE|dist\/[^.].*)$/.test(path),
      `Unexpected published file: ${path}`,
    );
  }

  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      join(temporary, packed.filename),
    ],
    consumer,
  );

  // A browser library must also be safe to import while rendering a website on a server.
  run(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(manifest.name)});`],
    consumer,
  );
  await writeFile(
    join(consumer, "consumer.ts"),
    `import * as spatial from ${JSON.stringify(manifest.name)};\nvoid spatial;\n`,
  );

  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  for (const [module, moduleResolution] of [
    ["NodeNext", "NodeNext"],
    ["ESNext", "Bundler"],
  ]) {
    run(
      process.execPath,
      [
        tsc,
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        module,
        "--moduleResolution",
        moduleResolution,
        "consumer.ts",
      ],
      consumer,
    );
  }
  console.log(
    `Package verified: ${manifest.name}; ${paths.length} files; ESM import and both TypeScript resolution modes passed.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
