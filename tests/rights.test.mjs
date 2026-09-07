import test from "node:test";
import assert from "node:assert/strict";
import { audit } from "../tools/sbom/check.mjs";
const p = {
  version: "1",
  license: "MIT",
  integrity: "hash",
  resolved: "https://example.org",
  dev: true,
};
const row = {
  path: "node_modules/x",
  ...p,
  source: p.resolved,
  distribution: "development-only",
  files: [{}],
};
const review = { components: [row], native: [] };
test("rights fail closed on prohibited, unknown, changed and runtime components", () => {
  for (const patch of [
    { license: "GPL-3.0" },
    { license: undefined },
    { version: "2" },
    { integrity: "tampered" },
    { dev: false },
    { hasInstallScript: true },
  ]) {
    assert.throws(() => audit({ packages: { "node_modules/x": { ...p, ...patch } } }, review));
  }
  assert.equal(audit({ packages: { "node_modules/x": p } }, review), 1);
  assert.throws(() => audit({ packages: { "node_modules/x": p } }, { ...review, components: [] }));
});
