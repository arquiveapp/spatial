// SPDX-License-Identifier: MIT
// Controller fault injection: these are not camera or physical-device measurements.
import test from "node:test";
import assert from "node:assert/strict";
import { TrackingSession, identity } from "../tools/devlab/patch.mjs";
import { anchorForPlane } from "../tools/devlab/tracking-math.mjs";

function fixture() {
  const session = new TrackingSession(360, 640);
  session.normal = [0, 0, 1];
  session.center = [180, 320];
  session.anchorMatrix = anchorForPlane(session.center, session.normal, session.camera);
  session.lastPose = { rotation: identity(), translationOverDistance: [0, 0, 0] };
  session.lastAccepted = 0;
  const acceptedImage = { frame: "accepted" };
  session.features.reference = acceptedImage;
  session.features.previous = acceptedImage;
  let nextHomography = identity();
  session.features.track = () => {
    session.features.previous = { frame: "candidate" };
    session.features.homography = [...nextHomography];
    session.features.failures = 0;
    const matches = [
      [100, 200],
      [260, 200],
      [260, 440],
      [100, 440],
    ].map((reference) => {
      const [x, y] = reference,
        h = nextHomography;
      const z = h[6] * x + h[7] * y + h[8];
      return {
        reference,
        current: [(h[0] * x + h[1] * y + h[2]) / z, (h[3] * x + h[4] * y + h[5]) / z],
      };
    });
    return {
      state: "tracking",
      homography: [...nextHomography],
      matches,
      inliers: 20,
      features: 20,
      reprojectionError: 0,
    };
  };
  return {
    session,
    acceptedImage,
    frame(h, timestamp) {
      nextHomography = h;
      return session.frame(new Uint8Array(0), timestamp);
    },
  };
}

test("rejected nonrigid image fit cannot become the next optical-flow reference", () => {
  const { session, acceptedImage, frame } = fixture();
  const rejected = frame([1, 0.5, 0, 0, 1, 0, 0, 0, 1], 33);
  assert.equal(rejected.reason, "non-rigid-or-ambiguous-pose");
  assert.equal(rejected.viewMatrix, undefined);
  assert.equal(session.features.previous, acceptedImage);
  assert.deepEqual(session.features.homography, identity());
  assert.equal(session.features.failures, 1);
  assert.equal(session.lastAccepted, 0);
});

test("recovery requires consecutive agreeing poses and rolls back the first candidate", () => {
  const { session, acceptedImage, frame } = fixture();
  const moved = [1, 0, 200, 0, 1, 0, 0, 0, 1];
  assert.equal(frame(moved, 33).reason, "confirming-reference");
  assert.equal(session.features.previous, acceptedImage);
  assert.deepEqual(session.features.homography, identity());
  assert.equal(frame([1, 0.5, 0, 0, 1, 0, 0, 0, 1], 66).reason, "non-rigid-or-ambiguous-pose");
  assert.equal(session.candidate, null);
  assert.equal(frame(moved, 99).reason, "confirming-reference");
  const recovered = frame(moved, 132);
  assert.equal(recovered.state, "tracking");
  assert.equal(recovered.recoveries, 1);
  assert.notEqual(session.features.previous, acceptedImage);
  assert.deepEqual(session.features.homography, moved);
});

test("repeated ambiguous 180-degree planar fits cannot overturn the accepted orientation", () => {
  const { session, acceptedImage, frame } = fixture();
  const halfTurn = [-1, 0, 360, 0, -1, 640, 0, 0, 1];
  for (const timestamp of [33, 66, 2000]) {
    const rejected = frame(halfTurn, timestamp);
    assert.equal(rejected.reason, "orientation-branch-rejected");
    assert.equal(rejected.referenceRetained, true);
    assert.equal(rejected.viewMatrix, undefined);
    assert.equal(session.features.previous, acceptedImage);
    assert.deepEqual(session.features.homography, identity());
    assert.deepEqual(session.lastPose.rotation, identity());
    assert.equal(session.candidate, null);
  }
  assert.equal(frame(identity(), 2033).reason, "confirming-reference");
  assert.equal(frame(identity(), 2066).state, "tracking");
});
