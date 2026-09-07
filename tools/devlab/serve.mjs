import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, extname } from "node:path";
const root = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/lab-build.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ commit, dirty }));
      return;
    }
    const target = pathname === "/" ? "/tools/devlab/index.html" : pathname;
    if (
      !/^\/(tools\/devlab\/(?:[a-z-]+\.(?:mjs|html|css)|generated\/(?:luma\.(?:base|simd)\.wasm|build\.json|(?:EMSCRIPTEN-LICENSE|MUSL-COPYRIGHT|COMPILER-RT-LICENSE)\.txt))|packages\/core\/dist\/index\.js)$/.test(
        target,
      )
    ) {
      res.writeHead(404).end();
      return;
    }
    const path = resolve(root, "." + target);
    const body = await readFile(path);
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found; build the lab assets first.");
  }
});
server.listen(Number(process.env.SPATIAL_LAB_PORT ?? 4178), "127.0.0.1", () =>
  console.log(
    `Spatial device lab: http://127.0.0.1:${server.address().port} (${commit}${dirty ? " dirty" : ""})`,
  ),
);
