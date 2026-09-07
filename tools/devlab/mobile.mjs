// Optional local testing transport; never part of the distributable library.
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLabServer, loadLabConfig, readBuild } from "./server.mjs";
const root = process.cwd(),
  directory = join(root, ".local"),
  config = await loadLabConfig(root),
  build = readBuild(root);
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = randomBytes(24).toString("hex");
const server = createLabServer({
  root,
  token,
  models: config.models,
  testerModel: config.testerModel,
  build: () => readBuild(root),
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
const empty = join(directory, "tunnel-empty.yml");
await writeFile(empty, "# Isolated quick tunnel; do not load user-managed tunnel settings.\n", {
  mode: 0o600,
});
const child = spawn(
  "cloudflared",
  [
    "tunnel",
    "--config",
    empty,
    "--no-autoupdate",
    "--url",
    `http://127.0.0.1:${port}`,
    "--protocol",
    "http2",
    "--metrics",
    "127.0.0.1:0",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let published = false,
  buffer = "",
  closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  clearTimeout(startup);
  child.kill("SIGTERM");
  server.close();
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    process.exit(0);
  }, 2000);
  timer.unref();
};
const startup = setTimeout(() => {
  console.error("HTTPS tunnel did not become ready within 60 seconds.");
  stop();
  process.exitCode = 1;
}, 60000);
child.on("error", (error) => {
  console.error(`Cannot start cloudflared: ${error.message}`);
  stop();
  process.exitCode = 1;
});
child.on("exit", (code) => {
  if (!closing) {
    console.error(`Tunnel exited (${code}); mobile URL is offline.`);
    stop();
    process.exitCode = 1;
  }
});
const observe = async (chunk) => {
  buffer = (buffer + chunk.toString()).slice(-24000);
  const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!published && match) {
    published = true;
    clearTimeout(startup);
    const origin = match[0],
      url = `${origin}/join/${token}`;
    await writeFile(
      join(directory, "mobile-session.json"),
      JSON.stringify(
        {
          pid: process.pid,
          tunnelPid: child.pid,
          port,
          origin,
          url,
          build,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await writeFile(join(directory, "phone-url.txt"), url + "\n", { mode: 0o600 });
    console.log(
      `Phone URL: ${url}\nKeep this process and the Mac awake while testing. Reports save in .local/results. Stop with Ctrl+C.`,
    );
    if (process.platform === "darwin") {
      try {
        execFileSync(
          "swift",
          [
            "tools/devlab/qr.swift",
            join(directory, "phone-url.txt"),
            join(directory, "phone-qr.png"),
          ],
          { stdio: "ignore", timeout: 30000 },
        );
        console.log("QR code: .local/phone-qr.png");
      } catch {
        console.log("QR generation unavailable; use the phone URL.");
      }
    }
  }
};
child.stdout.on("data", (chunk) => {
  void observe(chunk).catch((error) => console.error(error.message));
});
child.stderr.on("data", (chunk) => {
  void observe(chunk).catch((error) => console.error(error.message));
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
