# Known limitations

- No production session, model loader, fallback viewer, renderer adapter or tracking backend
  exists yet. Workspace imports other than core/root intentionally expose no runtime API.
- No physical Android/iPhone tests or support claims. Generic OS/browser versions from the
  research brief have not been adopted as compatibility promises.
- The capture spike currently measures ImageBitmap → Worker canvas → luma WASM, or an explicitly
  reported slower main-thread canvas path. TrackProcessor and direct VideoFrame paths are pending;
  canvas output is RGBA and does not reveal the camera's native pixel format.
- The single-threaded kernels perform luma/checksum diagnostics only. They are not a VIO engine.
  No SharedArrayBuffer or cross-origin isolation is required.
- M1c is an original, unshipped direct photometric planar prototype: portrait rear-camera sensor
  mapping, assumed 65° horizontal field of view, still gravity prior, relative translation.
  It has no measured camera/IMU alignment, metric scale, visual yaw correction, robust feature
  RANSAC, patch expansion or relocalisation. Fast motion, lighting/exposure changes, rolling
  shutter, gyro drift and leaving the patch can invalidate the fit. A low residual is not accuracy.
- Blank/glossy/glass surfaces and moving objects are unvalidated and likely poor inputs.
- WebXR requires hit-test and anchors, requests DOM overlay optionally, and refuses a silent
  fixed-pose substitute. Native XR permission and actual plane/anchor behavior need phones.
- Lab resources stop on Stop, page hide, backgrounding and orientation changes. Twenty-cycle
  physical camera/GPU/Worker leak and interruption tests remain pending.
- Only structured diagnostic JSON is exported or sent to the local receiver on click. It is unreviewed and cannot automatically become
  device evidence. Camera recordings and ground truth are not captured by this implementation.
- npm scope ownership/publication and runtime integration into ARchive are out of scope.

## Phone lab extension

A three.js GLB viewer and WebXR model-placement experiment now exist in the local lab only;
public session/renderer packages remain unimplemented. The temporary HTTPS link requires the Mac,
cloudflared and internet to remain available. Model originals and received reports stay outside
Git/npm. The report button sends structured diagnostics/comments only, and never promotes support.
A successful 3D load is not iPhone world-tracking evidence. See [phone workflow](docs/mobile-lab.md).
