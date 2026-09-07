/** Detection only: no permission prompts, camera, renderer or worker allocation. */
export type Availability = "available" | "unavailable" | "unknown" | "policy-blocked";
export interface CapabilityReport {
  secureContext: boolean;
  camera: Availability;
  motion: { api: boolean; permissionRequired: boolean; policy: Availability };
  webxr: { immersiveAr: boolean | "unknown"; reason: string | null };
  worker: boolean;
  wasm: boolean;
  videoFrame: boolean;
  videoFrameCallback: boolean;
  trackProcessorMain: boolean;
  /** Worker-only APIs require a later, explicit capture experiment. */
  trackProcessorWorker: "unknown";
  support: "untested";
}
type Environment = typeof globalThis & {
  DeviceMotionEvent?: { requestPermission?: unknown };
  MediaStreamTrackProcessor?: unknown;
};
/** API presence is not camera permission, tracking quality or device support. */
export async function probe(): Promise<CapabilityReport> {
  const env = globalThis as Environment;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const doc = typeof document === "undefined" ? undefined : document;
  const policy =
    (
      doc as
        | (Document & {
            permissionsPolicy?: { allowsFeature(n: string): boolean; features?(): string[] };
            featurePolicy?: { allowsFeature(n: string): boolean; features?(): string[] };
          })
        | undefined
    )?.permissionsPolicy ??
    (
      doc as
        | (Document & {
            featurePolicy?: { allowsFeature(n: string): boolean; features?(): string[] };
          })
        | undefined
    )?.featurePolicy;
  const allowed = (name: string): Availability => {
    try {
      if (!policy || !policy.features?.().includes(name)) return "unknown";
      return policy.allowsFeature(name) ? "available" : "policy-blocked";
    } catch {
      return "unknown";
    }
  };
  const secureContext = env.isSecureContext === true;
  const cameraPolicy = allowed("camera");
  const xr = (
    nav as (Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }) | undefined
  )?.xr;
  let immersiveAr: boolean | "unknown" = false;
  let reason: string | null = null;
  if (!secureContext) reason = "insecure-context";
  else if (allowed("xr-spatial-tracking") === "policy-blocked")
    reason = "permission-policy-blocked";
  else if (!xr) reason = "api-unavailable";
  else {
    try {
      immersiveAr = await xr.isSessionSupported("immersive-ar");
    } catch {
      immersiveAr = "unknown";
      reason = "probe-rejected";
    }
  }
  return {
    secureContext,
    camera:
      !secureContext || !nav?.mediaDevices?.getUserMedia
        ? "unavailable"
        : cameraPolicy === "policy-blocked"
          ? cameraPolicy
          : "available",
    motion: {
      api: typeof env.DeviceMotionEvent !== "undefined",
      permissionRequired: typeof env.DeviceMotionEvent?.requestPermission === "function",
      policy: [allowed("accelerometer"), allowed("gyroscope")].includes("policy-blocked")
        ? "policy-blocked"
        : "unknown",
    },
    webxr: { immersiveAr, reason },
    worker: typeof Worker !== "undefined",
    wasm: typeof WebAssembly !== "undefined",
    videoFrame: typeof VideoFrame !== "undefined",
    videoFrameCallback:
      typeof HTMLVideoElement !== "undefined" &&
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function",
    trackProcessorMain: typeof env.MediaStreamTrackProcessor === "function",
    trackProcessorWorker: "unknown",
    support: "untested",
  };
}
