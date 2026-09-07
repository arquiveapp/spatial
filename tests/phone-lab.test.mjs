import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createLabServer } from "../tools/devlab/server.mjs";
import { validateReport } from "../tools/devlab/reports.mjs";
function report() {
  return {
    schemaVersion: 2,
    id: randomUUID(),
    kind: "diagnostic",
    userAgent: "Node synthetic test",
    observations: "Synthetic test, no physical evidence",
    physicalEvidence: false,
    outcome: "unreviewed",
  };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "spatial-phone-"));
  await mkdir(join(root, "tools/devlab"), { recursive: true });
  await writeFile(join(root, "tools/devlab/index.html"), "<h1>Lab fixture</h1>");
  await writeFile(join(root, "apartment.glb"), "fixture");
  const token = "a".repeat(48),
    build = { commit: "a".repeat(40), dirty: false };
  const server = createLabServer({
    root,
    token,
    build: () => build,
    models: [
      {
        id: "apartment",
        name: "Fixture",
        path: join(root, "apartment.glb"),
        sha256: "hash",
        bytes: 7,
      },
    ],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ root, origin, token, build });
  } finally {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  }
}
test("phone session gates files/models; invalid links and private paths stay unavailable", async () =>
  fixture(async ({ origin, token }) => {
    assert.equal((await fetch(origin)).status, 403);
    assert.equal((await fetch(`${origin}/models/apartment.glb`)).status, 403);
    assert.equal((await fetch(`${origin}/join/nope`)).status, 403);
    const joinResponse = await fetch(`${origin}/join/${token}`, {
      redirect: "manual",
      headers: { "x-forwarded-proto": "https" },
    });
    assert.equal(joinResponse.status, 303);
    assert.match(joinResponse.headers.get("set-cookie"), /HttpOnly.*Secure/);
    assert.equal(joinResponse.headers.get("referrer-policy"), "no-referrer");
    const headers = { cookie: `spatial_lab=${token}` };
    assert.match(await (await fetch(origin, { headers })).text(), /Lab fixture/);
    assert.equal(
      await (await fetch(`${origin}/models/apartment.glb`, { headers })).text(),
      "fixture",
    );
    for (const path of [
      "/.local/lab-config.json",
      "/.env",
      "/package.json",
      "/tools/devlab/server.mjs",
      "/tools/devlab/mobile.mjs",
      "/tools/devlab/reports.mjs",
      "/api/results",
      "/models/other.glb",
      "/tools/devlab/../../.local/results",
    ])
      assert.equal((await fetch(origin + path, { headers })).status, 404);
  }));
test("explicit report POST persists once, returns a receipt and rejects CSRF/media/oversize", async () =>
  fixture(async ({ origin, token, root, build }) => {
    const headers = {
      cookie: `spatial_lab=${token}`,
      "content-type": "application/json",
      "x-spatial-report": "1",
      origin,
    };
    const payload = report();
    const send = async (body, overrides = {}) =>
      fetch(`${origin}/api/results`, {
        method: "POST",
        headers: { ...headers, ...overrides },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    assert.equal((await send(payload, { origin: "https://other.example" })).status, 403);
    assert.equal((await send(payload, { "x-spatial-report": "" })).status, 403);
    for (const invalid of ["null", "malformed", origin.replace("http:", "https:")])
      assert.equal((await send(payload, { origin: invalid })).status, 403);
    const response = await send(payload);
    assert.equal(response.status, 201);
    const receipt = await response.json();
    assert.equal(receipt.receipt, `SP-${payload.id.slice(0, 8).toUpperCase()}`);
    assert.equal((await send(payload)).status, 201);
    assert.equal((await readdir(join(root, ".local/results"))).length, 1);
    assert.equal((await send({ ...payload, observations: "changed" })).status, 400);
    const record = JSON.parse(
      await readFile(join(root, ".local/results", `${payload.id}.json`), "utf8"),
    );
    assert.deepEqual(record.report, payload);
    assert.deepEqual(record.serverBuild, build);
    assert.equal((await send({ ...report(), images: ["data:image/png;base64,AAAA"] })).status, 400);
    assert.equal((await send("x".repeat(1024 * 1024 + 1))).status, 413);
  }));
test("report validation cannot promote support, traverse files or include camera media", () => {
  for (const value of [
    { ...report(), id: "../../file" },
    { ...report(), physicalEvidence: true },
    { ...report(), outcome: "supported" },
    { ...report(), notes: ["data:image/jpeg;base64,AAAA"] },
    { ...report(), model: { password: "x" } },
    { ...report(), model: { password: 123 } },
    { ...report(), capture: { luma: [255, 128, 0] } },
    { ...report(), capture: { luma: [0, 360] } },
    { ...report(), camera: { luma: [640, 360] } },
    { ...report(), scaleMode: "fabricated" },
  ])
    assert.throws(() => validateReport(value));
  assert.doesNotThrow(() =>
    validateReport({
      ...report(),
      metrics: { frames: 120, trace: [{ time: 1, translation: [0, 0, 0] }] },
    }),
  );
});

// Synthetic shape of the Safari capture report that the old receiver rejected.
// Contains no imported device report or camera pixels.
test("Safari patch and tabletop report shapes survive authenticated HTTPS forwarding", async () =>
  fixture(async ({ origin, token, root }) => {
    const payload = {
      ...report(),
      kind: "patch",
      scaleMode: "assumed",
      capture: {
        path: "rvfc-imagebitmap-worker-canvas",
        requested: [1280, 720],
        luma: [640, 360],
        pixelFormat: "RGBA canvas readback",
        captureTimeAvailable: true,
      },
      camera: { width: 720, height: 1280, frameRate: 30, facingMode: "environment" },
      metrics: { frames: 120, trace: [{ time: 1, state: "lost", reason: "place-on-texture" }] },
    };
    const headers = {
      cookie: `spatial_lab=${token}`,
      "content-type": "application/json",
      "x-spatial-report": "1",
      "x-forwarded-proto": "https",
      origin: origin.replace("http:", "https:"),
    };
    for (const kind of ["patch", "tabletop"]) {
      const body = { ...payload, id: randomUUID(), kind };
      const response = await fetch(`${origin}/api/results`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      const receipt = await response.json();
      assert.equal(receipt.id, body.id);
      const saved = JSON.parse(
        await readFile(join(root, ".local/results", `${body.id}.json`), "utf8"),
      );
      assert.deepEqual(saved.report.capture.luma, [640, 360]);
      assert.equal(saved.report.kind, kind);
    }
  }));

test("build metadata is refreshed at page load and result receipt", async () =>
  fixture(async ({ origin, token, root, build }) => {
    const headers = { cookie: `spatial_lab=${token}` };
    const first = await (await fetch(`${origin}/lab-build.json`, { headers })).json();
    assert.equal(first.commit, build.commit);
    build.commit = "b".repeat(40);
    build.dirty = true;
    const refreshed = await (await fetch(`${origin}/lab-build.json`, { headers })).json();
    assert.equal(refreshed.commit, build.commit);
    assert.equal(refreshed.dirty, true);
    const payload = report();
    const response = await fetch(`${origin}/api/results`, {
      method: "POST",
      headers: { ...headers, origin, "content-type": "application/json", "x-spatial-report": "1" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);
    const saved = JSON.parse(
      await readFile(join(root, ".local/results", `${payload.id}.json`), "utf8"),
    );
    assert.deepEqual(saved.serverBuild, build);
  }));

test("documented report v2 envelope stays aligned with receiver kinds and fields", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../tools/devlab/result.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(schema.properties.schemaVersion.const, 2);
  for (const kind of schema.properties.kind.enum)
    assert.doesNotThrow(() =>
      validateReport({
        ...report(),
        kind,
        ...(kind === "synthetic-tabletop" ? { synthetic: true } : {}),
      }),
    );
  for (const field of Object.keys(schema.properties)) {
    if (
      [
        "schemaVersion",
        "id",
        "kind",
        "userAgent",
        "observations",
        "physicalEvidence",
        "outcome",
      ].includes(field)
    )
      continue;
    assert.doesNotThrow(() => validateReport({ ...report(), [field]: null }));
  }
  assert.throws(() => validateReport({ ...report(), kind: "unsupported" }));
});

test("synthetic tabletop replay stays explicitly labelled and cannot become a device run", () => {
  assert.doesNotThrow(() =>
    validateReport({ ...report(), kind: "synthetic-tabletop", synthetic: true }),
  );
  assert.throws(() => validateReport({ ...report(), kind: "synthetic-tabletop" }));
  assert.throws(() => validateReport({ ...report(), kind: "tabletop", synthetic: true }));
  assert.throws(() =>
    validateReport({
      ...report(),
      kind: "synthetic-tabletop",
      synthetic: true,
      physicalEvidence: true,
    }),
  );
});

test("feedback export preserves bounded runtime errors and tabletop diagnostics", async () => {
  const fake = {
    window: { addEventListener() {} },
    localStorage: { setItem() {} },
    innerWidth: 393,
    innerHeight: 852,
    devicePixelRatio: 3,
  };
  const descriptors = Object.fromEntries(
    Object.keys(fake).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  try {
    for (const [key, value] of Object.entries(fake))
      Object.defineProperty(globalThis, key, { value, configurable: true });
    const { makeReport } = await import("../tools/devlab/feedback.mjs");
    const exported = makeReport(
      {
        kind: "tabletop",
        synthetic: false,
        scaleMode: "assumed",
        errors: [{ name: "NotAllowedError", message: "Camera denied /join/abcdef" }],
        notes: ["Synthetic fixture only"],
        capture: { luma: [640, 360] },
        metrics: {
          frames: 1200,
          calibration: "estimated",
          trace: Array.from({ length: 1200 }, (_, time) => ({
            time,
            state: "tracking",
            reason: "background-tracked",
            inliers: 80,
            features: 80,
            reprojectionError: 0.0123456789,
            viewMatrix: Array(16).fill(0.1234567890123456),
            projectionMatrix: Array(16).fill(0.1234567890123456),
            anchorMatrix: Array(16).fill(0.1234567890123456),
            rotation: Array(9).fill(0.1234567890123456),
            translationOverDistance: [0.123456789, 0.123456789, 0.123456789],
          })),
        },
      },
      {
        build: { commit: "a".repeat(40), dirty: false },
        device: {},
        observations: "Fixture",
        rating: "failed",
      },
    );
    assert.deepEqual(exported.errors, [
      { type: "NotAllowedError", message: "Camera denied /join/[redacted]" },
    ]);
    assert.deepEqual(exported.notes, ["Synthetic fixture only"]);
    assert.equal(exported.metrics.calibration, "estimated");
    assert.equal(exported.metrics.trace.length, 300);
    assert.equal(exported.metrics.trace.at(-1).time, 1199);
    assert(Buffer.byteLength(JSON.stringify(exported)) < 750 * 1024);
    assert.doesNotThrow(() => validateReport(exported));
  } finally {
    for (const key of Object.keys(fake)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else delete globalThis[key];
    }
  }
});
