# Second tabletop recording review — 2026-09-07

User-reported device: iPhone 16, Safari, portrait. The exact iOS/Safari build and the loaded
commit are not established by the recording; the page footer shows the temporary tunnel host
and the loaded build label is not legible. The user reports the experience is unusable after the
first repair round. The recording is a failure report, not a passed physical gate. The original
video stays outside Git/npm; only derived observations are recorded here.

## Observed sequence

The 19.4-second, 1180×2556, 60 fps screen recording was inspected at 4 and 10 frames per second.
The size control reads **3.0×** throughout. The scene is a parquet floor with a wall, a bucket
and a bag, not an isolated matte table.

| Interval (s) | Visible                                                        | Interpretation                                                     |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0.0–2.0      | Apartment fills the camera rectangle; floor visible at corners | Tracking; the 3× model at the assumed 0.65 m covers the whole view |
| 2.25–4.0     | Floor, bucket, wall base, centre cross, "Recuperando…"         | Camera tilted up/away; tapped floor region no longer in view       |
| 4.25–7.25    | Apartment visible again                                        | Region returned; reference reacquired                              |
| 7.5–9.0      | Floor, then a hand crossing the view, "Recuperando…"           | Loss, then occlusion                                               |
| 9.25         | Apartment visible for one sampled frame                        | Brief acceptance                                                   |
| 9.5–10.25    | Floor, "Recuperando…"                                          | Loss immediately after recovery                                    |
| 10.5–11.75   | Apartment visible                                              | Tracking                                                           |
| 12.0–13.0    | Floor, "Recuperando…"                                          | Loss                                                               |
| 13.25–18.25  | Apartment visible                                              | Tracking until the user opens Control Centre to stop               |

Every hidden interval shows the camera pointed at a different part of the room (wall base,
bucket, bag) than a downward view of the floor. Every reappearance follows the camera returning
toward the floor. Because the 3× model covers the entire camera rectangle while visible, the
recording cannot show whether the apartment stayed on the same floor spot; it only shows when
the tracker had a pose.

## Confirmed causes (source at `ca0e4ad` plus independent numerical review)

1. **No plane expansion.** Features were selected once inside a region of about 72% × 50% of the
   image around the tap and never added. Tracking survived until roughly 63% of that region left
   the view, then reported `insufficient-background-consensus` until the same region returned.
   Looking up to see a 0.9 m tall model standing on the floor guarantees this loss.
2. **No motion prediction.** Optical flow was seeded from the last accepted homography. Its
   capture range at 360×640 is about 16–18 px per processed frame, roughly 55–60°/s of hand
   rotation at 30 fps and half that when the Worker drops alternate frames.
3. **Confirmation and rollback made one dropped frame hard to recover from.** After any failure the
   next good pose was held for confirmation while the optical-flow reference rolled back to a
   stale image; at ≥1.5° of rotation per frame the reference was never reacquired in simulation.
4. **Hide/show presentation.** A pose gap longer than 120 ms hid the model and re-showed it with
   no continuity, so every short loss became a visible blink and coaching text.
5. **Conventions are correct.** Gravity → plane normal → anchor, the CV → WebGL conversion, the
   homography direction and the rigid pose extraction reproduce synthetic ground truth for the
   anchor, on-plane points and off-plane points to numerical precision. The 3.0× size is a user
   setting; it is not tracker-induced scale collapse.

## Unresolved hypotheses

- Exact camera intrinsics of the 1280×720 iPhone 16 stream; the assumed 65° long-edge field of
  view is unmeasured. Simulation shows rigid-pose rejection rising with viewpoint change when the
  assumed focal length is off by about 6%.
- Camera-to-motion delivery offset and the correctness of the assumed device→camera gyro axes
  on this phone. Both are now measured and reported by the lab rather than assumed.
- Whether the brief re-losses right after recovery (9.25→9.5 s) were geometric gate rejections or
  a second visual failure. No trace was sent for this run.

The user did not send the diagnostic JSON for this run; the latest received report at the time
was a desktop synthetic replay. The repaired lab records loss intervals, recovery jumps, gyro
consistency and stationary jitter so the next run can answer these questions.
