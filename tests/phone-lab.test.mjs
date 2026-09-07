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
    build,
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
  ])
    assert.throws(() => validateReport(value));
  assert.doesNotThrow(() =>
    validateReport({
      ...report(),
      metrics: { frames: 120, trace: [{ time: 1, translation: [0, 0, 0] }] },
    }),
  );
});
