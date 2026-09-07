# Initial phone feedback — 2026-09-07

Derived from the user-supplied diagnostic export and their explicit observations. The raw JSON
was read from a transient macOS shared-pasteboard attachment; it disappeared before it could be
retained. This note preserves the inspected measurements, not a claim of a retained replay file.
No camera imagery or private model bytes are included.

- Tester identifies an iPhone 16 using Safari. UA reports iOS 18_7 and Safari 27.0; these are
  unverified UA strings, not independently confirmed system/browser build numbers.
- Export loaded base commit `26a983d` with `dirty: true`. It is preliminary evidence, not a
  reproducible clean-commit acceptance run.
- Camera: 720×1280 portrait, 30 fps; old capture processing: 640×360 (aspect was distorted).
- Duration: 26.822 seconds; 800 processed frames; 29.826 fps; 5 dropped frames/bursts;
  1.864 bursts per 10 seconds. Worker p95 9 ms, round trip p95 14 ms.
- Motion permission granted; 1,440 gyro samples, reported 53.687 Hz; interval standard
  deviation 50.011 ms. This is not a measured camera/IMU calibration.
- 400 exported pose samples: 178 tracking, 107 photometric-error, 82 waiting for placement,
  33 gyro-unavailable-or-stale. No independent ground truth, drift or jitter acceptance proof.
- User says the 3D viewer worked, but tabletop placement did not. The old patch page drew a
  diagnostic cross only; it had no model integration for the iPhone path.
- Report submission failed because the server rejected its own scaleMode field and numeric
  luma dimensions. Regression coverage uses a faithful synthetic fixture; the vanished original
  was not resent after the fix.

G1/G2/G3/G4 remain unpassed. One short preliminary capture on one phone cannot satisfy the
multi-device/duration/clean-build gates. The new integrated tabletop flow still needs a fresh
physical test after source and rendered synthetic checks.
