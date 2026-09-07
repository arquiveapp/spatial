import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, extname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { MAX_REPORT_BYTES, storeReport } from "./reports.mjs";
export function readBuild(root) {
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
  };
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
};
const browserFiles = new Set([
  "index.html",
  "style.css",
  "phone.mjs",
  "lab.mjs",
  "feedback.mjs",
  "model-viewer.mjs",
  "video-rect.mjs",
  "webxr.mjs",
  "metrics.mjs",
  "worker.mjs",
  "patch.mjs",
  "tabletop.mjs",
  "tabletop-runtime.mjs",
  "tabletop-replay.mjs",
  "tracking-math.mjs",
]);
const vendor = new Set([
  "build/three.module.js",
  "build/three.core.js",
  "examples/jsm/loaders/GLTFLoader.js",
  "examples/jsm/controls/OrbitControls.js",
  "examples/jsm/utils/BufferGeometryUtils.js",
  "examples/jsm/utils/SkeletonUtils.js",
  "LICENSE",
]);
function equal(a, b) {
  return (
    typeof a === "string" &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function createLabServer({
  root,
  token = null,
  models = [],
  testerModel = "",
  resultsDirectory = join(root, ".local/results"),
  build = readBuild(root),
}) {
  const submitted = [];
  const currentBuild = () => (typeof build === "function" ? build() : build);
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=(), accelerometer=(self), gyroscope=(self), xr-spatial-tracking=(self)",
    );
    const reply = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost"),
        pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith("/join/") && req.method === "GET" && token) {
        if (!equal(pathname.slice(6), token)) {
          reply(403, { error: "Link de teste inválido ou expirado." });
          return;
        }
        const secure = req.headers["x-forwarded-proto"] === "https";
        res.setHeader(
          "Set-Cookie",
          `spatial_lab=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure ? "; Secure" : ""}`,
        );
        res.writeHead(303, { Location: "/" });
        res.end();
        return;
      }
      const cookie = (req.headers.cookie ?? "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("spatial_lab="))
        ?.slice(12);
      if (token && !equal(cookie, token)) {
        reply(403, { error: "Abra o link completo de teste enviado pelo Codex." });
        return;
      }
      if (pathname === "/api/results" && req.method === "POST") {
        const origin = req.headers.origin;
        let sameOrigin = false;
        try {
          const parsed = new URL(origin);
          const protocol = req.headers["x-forwarded-proto"] === "https" ? "https:" : "http:";
          sameOrigin = parsed.origin === `${protocol}//${req.headers.host}`;
        } catch {
          /* An absent, opaque or malformed Origin never authorizes a write. */
        }
        if (
          req.headers["x-spatial-report"] !== "1" ||
          !sameOrigin ||
          !req.headers["content-type"]?.startsWith("application/json")
        ) {
          reply(403, { error: "Invalid report origin/type" });
          return;
        }
        while (submitted.length && submitted[0] < Date.now() - 60000) submitted.shift();
        if (submitted.length >= 30) {
          reply(429, { error: "Aguarde um minuto antes de enviar novamente." });
          return;
        }
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_REPORT_BYTES) {
            reply(413, { error: "Report too large" });
            return;
          }
          chunks.push(chunk);
        }
        let report;
        try {
          report = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          reply(400, { error: "Invalid JSON" });
          return;
        }
        try {
          const result = await storeReport(resultsDirectory, report, currentBuild());
          submitted.push(Date.now());
          reply(201, result);
        } catch (error) {
          reply(400, { error: error.message });
        }
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        reply(405, { error: "Method not allowed" });
        return;
      }
      if (pathname === "/lab-build.json") {
        reply(200, {
          ...currentBuild(),
          testerModel,
          models: models.map(({ id, name, bytes, sha256 }) => ({
            id,
            name,
            bytes,
            sha256,
            url: `/models/${id}.glb`,
          })),
        });
        return;
      }
      let path;
      const model = /^\/models\/([a-z-]+)\.glb$/.exec(pathname);
      if (model) {
        path = models.find((m) => m.id === model[1])?.path;
      } else if (pathname.startsWith("/vendor/three/") && vendor.has(pathname.slice(14)))
        path = join(root, "node_modules/three", pathname.slice(14));
      else {
        const target = pathname === "/" ? "/tools/devlab/index.html" : pathname;
        if (
          (target.startsWith("/tools/devlab/") && browserFiles.has(target.slice(14))) ||
          /^\/(tools\/devlab\/generated\/(?:luma\.(?:base|simd)\.wasm|build\.json|(?:EMSCRIPTEN-LICENSE|MUSL-COPYRIGHT|COMPILER-RT-LICENSE)\.txt)|packages\/core\/dist\/index\.js)$/.test(
            target,
          )
        )
          path = resolve(root, "." + target);
      }
      if (!path) {
        reply(404, { error: "Not found" });
        return;
      }
      const info = await stat(path);
      if (!info.isFile()) {
        reply(404, { error: "Not found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Content-Length": info.size,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(path);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) reply(404, { error: "Lab resource unavailable; check local setup." });
      else res.destroy();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
export async function loadLabConfig(root) {
  try {
    return JSON.parse(await readFile(join(root, ".local/lab-config.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { models: [] };
    throw e;
  }
}
