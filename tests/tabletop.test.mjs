import test from "node:test";
import assert from "node:assert/strict";
import {
  ResourceScope,
  captureSize,
  trackedPoseValid,
  normalizedTap,
  startVideoPlayback,
  waitUntilAbortedOrSettled,
} from "../tools/devlab/tabletop-runtime.mjs";

test("tabletop lifecycle releases all owned resources once through 20 open/close cycles, including late camera/model fulfillment", async () => {
  const released = { track: 0, worker: 0, gpu: 0, listener: 0, lateModel: 0, lateCamera: 0 };
  for (let cycle = 0; cycle < 20; cycle++) {
    const scope = new ResourceScope();
    for (const kind of ["track", "worker", "gpu", "listener"]) scope.own(() => released[kind]++);
    const late = Promise.resolve().then(() => {
      scope.own(() => released.lateModel++);
      scope.own(() => released.lateCamera++);
    });
    scope.dispose();
    scope.dispose();
    await late;
    assert.equal(scope.cleanups.length, 0);
  }
  for (const count of Object.values(released)) assert.equal(count, 20);
});

test("cleanup failure never prevents releasing the camera and worker", () => {
  const scope = new ResourceScope();
  let stopped = 0;
  scope.own(() => stopped++);
  scope.own(() => {
    throw Error("lost GPU");
  });
  scope.own(() => stopped++);
  scope.dispose();
  assert.equal(stopped, 2);
});

test("capture preserves portrait and landscape aspect ratios at the tracker budget", () => {
  assert.deepEqual(captureSize(720, 1280), [360, 640]);
  assert.deepEqual(captureSize(1280, 720), [640, 360]);
  const fourThree = captureSize(480, 640);
  assert.ok(fourThree[0] * fourThree[1] <= 640 * 360);
  assert.ok(Math.abs(fourThree[0] / fourThree[1] - 0.75) < 0.002);
  assert.throws(() => captureSize(0, 0));
});

test("overlay refuses missing, lost or nonfinite pose matrices", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const pose = {
    state: "tracking",
    viewMatrix: identity,
    projectionMatrix: identity,
    anchorMatrix: identity,
  };
  assert.equal(trackedPoseValid(pose), true);
  assert.equal(trackedPoseValid({ ...pose, state: "lost" }), false);
  assert.equal(trackedPoseValid({ ...pose, viewMatrix: undefined }), false);
  assert.equal(trackedPoseValid({ ...pose, anchorMatrix: [...identity.slice(0, 15), NaN] }), false);
});

test("table tap excludes letterbox bars and keeps portrait placement coordinates", () => {
  const rect = { left: 20, top: 100, width: 300, height: 500 };
  assert.deepEqual(normalizedTap(170, 350, rect), [0.5, 0.5]);
  assert.equal(normalizedTap(170, 50, rect), null);
  assert.equal(normalizedTap(10, 350, rect), null);
  assert.equal(normalizedTap(400, 350, rect), null);
});

class FakeVideo extends EventTarget {
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  play() {
    return Promise.resolve();
  }
  ready() {
    this.readyState = 2;
    this.videoWidth = 360;
    this.videoHeight = 640;
    this.dispatchEvent(new Event("loadeddata"));
  }
}
test("video startup waits for playback and actual image dimensions", async () => {
  const video = new FakeVideo();
  const controller = new AbortController();
  let done = false;
  const pending = startVideoPlayback(video, controller.signal, 1000).then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  video.ready();
  await pending;
  assert.equal(done, true);
});
test("stalled video playback times out and cancellation settles immediately", async () => {
  const video = new FakeVideo();
  video.play = () => new Promise(() => {});
  await assert.rejects(
    startVideoPlayback(video, new AbortController().signal, 5),
    /não entregou imagem/,
  );
  const controller = new AbortController();
  const pending = startVideoPlayback(video, controller.signal, 1000);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
test("late playback rejection after cancellation is handled", async () => {
  const video = new FakeVideo();
  let rejectPlay;
  video.play = () =>
    new Promise((_resolve, reject) => {
      rejectPlay = reject;
    });
  const controller = new AbortController();
  const pending = startVideoPlayback(video, controller.signal, 1000);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  rejectPlay(Error("late camera rejection"));
  await new Promise((resolve) => setImmediate(resolve));
});
test("Stop settles permission wait while late permission rejection stays handled", async () => {
  const controller = new AbortController();
  let rejectPermission;
  const permission = new Promise((_resolve, reject) => {
    rejectPermission = reject;
  });
  const pending = waitUntilAbortedOrSettled(permission, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  rejectPermission(Error("permission dismissed later"));
  await new Promise((resolve) => setImmediate(resolve));
});
