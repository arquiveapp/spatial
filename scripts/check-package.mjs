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
  const workspaceTarballs = [];
  for (const name of ["core", "backend-webxr", "backend-vio-lite", "renderer-three"]) {
    const [pack] = JSON.parse(
      run(
        npm,
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
        join(root, "packages", name),
      ),
    );
    assert(
      pack.files.every((f) =>
        /^(package\.json|README\.md|CHANGELOG\.md|LICENSE|dist\/[^.].*)$/.test(f.path),
      ),
      `Unexpected workspace contents: ${name}`,
    );
    for (const required of ["LICENSE", "dist/index.js", "dist/index.d.ts"])
      assert(pack.files.some((f) => f.path === required));
    workspaceTarballs.push(join(temporary, pack.filename));
  }
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
      ...workspaceTarballs,
      join(temporary, packed.filename),
    ],
    consumer,
  );

  // A browser library must also be safe to import while rendering a website on a server.
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `for (const name of ${JSON.stringify(["@arquiveapp/spatial", "@arquiveapp/spatial-core", "@arquiveapp/spatial-backend-webxr", "@arquiveapp/spatial-backend-vio-lite", "@arquiveapp/spatial-renderer-three"])}) await import(name);`,
    ],
    consumer,
  );
  await writeFile(
    join(consumer, "consumer.ts"),
    `import {probe, type CapabilityReport} from ${JSON.stringify(manifest.name)};\nconst result: Promise<CapabilityReport> = probe(); void result;\n`,
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
