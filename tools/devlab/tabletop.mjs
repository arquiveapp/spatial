// Private-fixture browser tabletop experiment. No native handoff or public backend API.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  ResourceScope,
  captureSize,
  trackedPoseValid,
  normalizedTap,
  startVideoPlayback,
  waitUntilAbortedOrSettled,
} from "./tabletop-runtime.mjs";
import { containedRect } from "./video-rect.mjs";
import { stats } from "./metrics.mjs";

function disposeModel(object) {
  const resources = new Set(),
    images = new Set();
  object?.traverse((node) => {
    if (node.geometry) resources.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : node.material
        ? [node.material]
        : []) {
      resources.add(material);
      for (const value of Object.values(material))
        if (value?.isTexture) {
          resources.add(value);
          if (value.source?.data?.close) images.add(value.source.data);
        }
    }
  });
  for (const resource of resources) resource.dispose();
  for (const image of images) image.close();
}

export async function startTabletop({
  container,
  model,
  wasmUrl,
  signal,
  syntheticSource,
  onStatus = () => {},
  onReport = () => {},
}) {
  const scope = new ResourceScope(),
    abort = new AbortController();
  const started = performance.now();
  const report = {
    kind: syntheticSource ? "synthetic-tabletop" : "tabletop",
    synthetic: !!syntheticSource,
    startedAt: new Date().toISOString(),
    physicalEvidence: false,
    outcome: "unreviewed",
    scaleMode: "assumed",
    calibration: "estimated-fov-65deg-long-edge",
    assumedPlaneDistanceMeters: 0.65,
    model: { id: model.id, name: model.name, sha256: model.sha256 },
    notes: [],
    errors: [],
    trace: [],
    frames: 0,
    droppedFrames: 0,
    placements: 0,
    motionSamples: 0,
    stateFrames: {},
    tracking: { state: "starting" },
  };
  let stream,
    worker,
    renderer,
    root,
    video,
    callback = null,
    rvfc = false;
  let frameTimer,
    busy = false,
    loaded,
    lastTracking = 0,
    lastState = "",
    lastReason = "";
  let loadMs = null,
    scale = 1,
    rotation = 0,
    ended = false;
  const engineTimes = [],
    roundTrips = [],
    samples = [];
  const snapshot = () => ({
    kind: report.kind,
    synthetic: report.synthetic,
    startedAt: report.startedAt,
    ...(report.endedAt ? { endedAt: report.endedAt, stopReason: report.stopReason } : {}),
    physicalEvidence: false,
    outcome: "unreviewed",
    scaleMode: "assumed",
    model: { ...report.model, loadMs },
    camera: report.camera ? { ...report.camera } : null,
    capture: report.capture,
    wasm: report.wasm,
    motionPermission: report.motionPermission,
    tracking: { ...report.tracking },
    notes: [...report.notes],
    errors: [...report.errors],
    metrics: {
      durationMs: performance.now() - started,
      scale,
      rotationRadians: rotation,
      calibration: report.calibration,
      renderSmoothingSeconds: 0.045,
      heldPoseMaxMs: 120,
      assumedPlaneDistanceMeters: report.assumedPlaneDistanceMeters,
      frames: report.frames,
      droppedFrames: report.droppedFrames,
      placements: report.placements,
      motionSamples: report.motionSamples,
      stateFrames: { ...report.stateFrames },
      engineMs: stats(engineTimes),
      roundTripMs: stats(roundTrips),
      trace: report.trace.map((t) => ({ ...t })),
    },
  });
  const status = (state, message, reason = "") => {
    report.tracking = { ...report.tracking, state, reason };
    if (state === lastState && reason === lastReason) return;
    lastState = state;
    lastReason = reason;
    onStatus({ state, message, reason });
  };
  function dispose(reason = "Teste encerrado pelo usuário") {
    if (scope.disposed) return;
    ended = true;
    report.endedAt = new Date().toISOString();
    report.stopReason = reason;
    scope.dispose();
    status("stopped", reason);
    onReport(snapshot());
  }
  function fail(error) {
    if (scope.disposed) return;
    const message = error?.message ?? String(error);
    report.errors.push({ name: error?.name ?? "Error", message });
    dispose(message);
  }
  scope.own(() => abort.abort());
  if (syntheticSource?.dispose) scope.own(() => syntheticSource.dispose());
  if (signal?.aborted) {
    dispose("Abertura cancelada");
    throw new DOMException("Abertura cancelada", "AbortError");
  }
  const cancel = () => dispose("Abertura ou teste cancelado");
  signal?.addEventListener("abort", cancel, { once: true });
  scope.own(() => signal?.removeEventListener("abort", cancel));
  // Both permission requests execute in the original button activation, before any await.
  let motionPromise, cameraPromise;
  try {
    motionPromise = syntheticSource
      ? Promise.resolve("synthetic-source")
      : typeof globalThis.DeviceMotionEvent?.requestPermission === "function"
        ? globalThis.DeviceMotionEvent.requestPermission()
        : Promise.resolve("not-required");
  } catch (error) {
    motionPromise = Promise.reject(error);
  }
  try {
    cameraPromise = syntheticSource
      ? Promise.resolve(syntheticSource.stream)
      : navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
  } catch (error) {
    cameraPromise = Promise.reject(error);
  }
  cameraPromise.then(
    (camera) => {
      stream = camera;
      scope.own(() => camera.getTracks().forEach((track) => track.stop()));
    },
    () => {},
  );
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: abort.signal });
  listen(window, "pagehide", () => dispose("Página fechada; reabra o teste"));
  listen(document, "visibilitychange", () => {
    if (document.hidden) dispose("Teste pausado ao sair do Safari; reabra");
  });
  listen(window, "orientationchange", () =>
    dispose("Orientação mudou; reabra o teste nessa posição"),
  );
  if (screen.orientation)
    listen(screen.orientation, "change", () => dispose("Orientação mudou; reabra o teste"));
  status("starting", "Permita câmera e movimento para colocar o apartamento na mesa.");
  const alive = () => {
    if (scope.disposed) throw new DOMException("Teste cancelado", "AbortError");
  };
  try {
    const [cameraResult, motionResult] = await waitUntilAbortedOrSettled(
      Promise.allSettled([cameraPromise, motionPromise]),
      abort.signal,
    );
    alive();
    report.motionPermission =
      motionResult.status === "fulfilled" ? motionResult.value : motionResult.reason?.name;
    if (motionResult.status === "rejected" || motionResult.value === "denied")
      throw Error(
        "Movimento não permitido. No Safari, permita movimento e orientação e reabra o teste.",
      );
    if (cameraResult.status === "rejected") throw cameraResult.reason;
    const stage = document.createElement("div");
    stage.className = "tabletop-stage";
    stage.style.cssText =
      "position:relative;width:100%;height:100%;min-height:400px;background:#171b18;overflow:hidden;touch-action:none";
    container.appendChild(stage);
    scope.own(() => stage.remove());
    video = document.createElement("video");
    video.className = "tabletop-video";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("aria-label", "Câmera da mesa");
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain";
    stage.appendChild(video);
    scope.own(() => {
      video.pause();
      video.srcObject = null;
    });
    video.srcObject = stream;
    await startVideoPlayback(video, abort.signal);
    alive();
    if (!syntheticSource && video.videoWidth > video.videoHeight)
      throw Error("Segure o iPhone na vertical e reabra o teste de mesa.");
    const [width, height] = captureSize(video.videoWidth, video.videoHeight);
    const settings = stream.getVideoTracks()[0].getSettings();
    report.camera = {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      facingMode: settings.facingMode,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
    report.capture = {
      path:
        typeof createImageBitmap === "function"
          ? "imagebitmap-worker-canvas"
          : "main-canvas-worker",
      luma: [width, height],
      pixelFormat: "RGBA canvas readback",
      captureTimeAvailable: false,
      frameClock: "requestVideoFrameCallback delivery",
      motionClock: "devicemotion handler delivery",
      cameraImuCalibrated: false,
    };
    if (settings.facingMode === "user")
      throw Error("Selecione a câmera traseira e reabra o teste.");
    listen(stream.getVideoTracks()[0], "ended", () =>
      dispose("A câmera foi interrompida; reabra o teste"),
    );
    listen(video, "resize", () => {
      if (
        video.videoWidth !== report.camera.videoWidth ||
        video.videoHeight !== report.camera.videoHeight
      )
        dispose("Dimensões da câmera mudaram; reabra o teste");
    });
    const scene = new THREE.Scene(),
      camera = new THREE.Camera();
    const targetCamera = new THREE.Matrix4(),
      smoothPosition = new THREE.Vector3(),
      smoothRotation = new THREE.Quaternion(),
      targetPosition = new THREE.Vector3(),
      targetRotation = new THREE.Quaternion(),
      unitScale = new THREE.Vector3(1, 1, 1);
    let lastPoseUpdate = 0;
    camera.matrixAutoUpdate = false;
    root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.visible = false;
    scene.add(root);
    const adjustments = new THREE.Group();
    root.add(adjustments);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x778877, 2.2));
    const light = new THREE.DirectionalLight(0xfff5e6, 2.8);
    light.position.set(1, 3, 2);
    scene.add(light);
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    scope.own(() => {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.className = "tabletop-canvas";
    renderer.domElement.setAttribute("aria-label", "Apartamento ancorado na região da mesa");
    renderer.domElement.style.cssText = "position:absolute;pointer-events:none";
    stage.appendChild(renderer.domElement);
    const reticle = document.createElement("div");
    reticle.className = "tabletop-reticle";
    reticle.textContent = "+";
    reticle.setAttribute("aria-hidden", "true");
    reticle.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:36px sans-serif;color:white;text-shadow:0 1px 3px black;pointer-events:none";
    stage.appendChild(reticle);
    const resize = () => {
      if (scope.disposed) return;
      const bounds = stage.getBoundingClientRect();
      const rect = containedRect(bounds, video.videoWidth, video.videoHeight);
      renderer.setSize(rect.width, rect.height);
      renderer.domElement.style.left = `${rect.left - bounds.left}px`;
      renderer.domElement.style.top = `${rect.top - bounds.top}px`;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    scope.own(() => observer.disconnect());
    resize();
    listen(renderer.domElement, "webglcontextlost", (event) => {
      event.preventDefault();
      fail(Error("A memória gráfica foi interrompida; reabra o teste."));
    });
    const modelPromise = (async () => {
      const response = await fetch(model.url, { signal: abort.signal });
      if (!response.ok)
        throw Error(`Não foi possível carregar o apartamento (HTTP ${response.status}).`);
      const bytes = await response.arrayBuffer();
      alive();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      alive();
      if (hash !== model.sha256) throw Error("Modelo mudou; atualize a página do laboratório.");
      const data = new DataView(bytes);
      if (
        bytes.byteLength < 20 ||
        data.getUint32(0, true) !== 0x46546c67 ||
        data.getUint32(4, true) !== 2 ||
        data.getUint32(12, true) > bytes.byteLength - 20
      )
        throw Error("Modelo GLB inválido.");
      const json = JSON.parse(
        new TextDecoder().decode(new Uint8Array(bytes, 20, data.getUint32(12, true))),
      );
      if ([...(json.buffers ?? []), ...(json.images ?? [])].some((entry) => entry.uri))
        throw Error("O modelo deve ser autocontido.");
      const gltf = await new GLTFLoader().parseAsync(bytes, "");
      loaded = gltf.scene;
      scope.own(() => disposeModel(loaded));
      alive();
      const box = new THREE.Box3().setFromObject(loaded),
        size = box.getSize(new THREE.Vector3()),
        center = box.getCenter(new THREE.Vector3());
      const edge = Math.max(size.x, size.y, size.z);
      if (!(edge > 0 && Number.isFinite(edge))) throw Error("Modelo sem dimensões válidas.");
      const normalized = new THREE.Group();
      const factor = 0.3 / edge;
      normalized.add(loaded);
      normalized.scale.setScalar(factor);
      normalized.position.set(-center.x * factor, -box.min.y * factor, -center.z * factor);
      adjustments.add(normalized);
      loadMs = performance.now() - started;
      report.model.maquetteLongestEdgeAssumedMeters = 0.3;
    })();
    modelPromise.catch(() => {});
    worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
    scope.own(() => worker.terminate());
    const workerPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Rastreamento não iniciou. Reabra o teste.")),
        15000,
      );
      scope.own(() => {
        clearTimeout(timer);
        reject(new DOMException("Teste cancelado", "AbortError"));
      });
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(Error(event.message));
      };
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timer);
          report.wasm = data;
          resolve();
        } else if (data.type === "error") {
          clearTimeout(timer);
          reject(Error(data.message));
        }
      };
      worker.postMessage({
        type: "init",
        width,
        height,
        wasmUrl: wasmUrl ?? new URL("./generated/luma.base.wasm", import.meta.url).href,
      });
    });
    await Promise.all([modelPromise, workerPromise]);
    alive();
    // Warm the real materials before accepting placement. A first-visible-frame
    // shader/texture upload otherwise blocks motion delivery and invalidates the pose.
    status("starting", "Preparando os materiais do apartamento…");
    root.visible = true;
    await waitUntilAbortedOrSettled(renderer.compileAsync(scene, camera), abort.signal);
    alive();
    const textures = new Set();
    loaded.traverse((node) => {
      for (const material of Array.isArray(node.material)
        ? node.material
        : node.material
          ? [node.material]
          : [])
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    });
    for (const texture of textures) renderer.initTexture(texture);
    root.visible = false;
    const motionHandler = (event) => {
      const rate = event.rotationRate,
        gravity = event.accelerationIncludingGravity;
      const valid = rate && [rate.alpha, rate.beta, rate.gamma].every(Number.isFinite);
      if (samples.length < 64)
        samples.push({
          time: performance.now(),
          rate: valid ? { alpha: rate.alpha, beta: rate.beta, gamma: rate.gamma } : null,
          gravity: gravity ? { x: gravity.x, y: gravity.y, z: gravity.z } : null,
        });
      if (valid) report.motionSamples++;
    };
    if (syntheticSource) scope.own(syntheticSource.subscribeMotion(motionHandler));
    else listen(window, "devicemotion", motionHandler);
    worker.onerror = (event) => fail(Error(`Rastreamento interrompido: ${event.message}`));
    worker.onmessage = ({ data }) => {
      if (scope.disposed) return;
      if (data.type === "error") {
        fail(Error(data.message));
        return;
      }
      if (data.type !== "frame") return;
      busy = false;
      clearTimeout(frameTimer);
      report.frames++;
      if (engineTimes.length < 18000) {
        engineTimes.push(data.ms);
        roundTrips.push(performance.now() - data.sent);
      }
      const tracking = data.tracking;
      if (!tracking) return;
      report.tracking = tracking;
      report.stateFrames[tracking.state] = (report.stateFrames[tracking.state] ?? 0) + 1;
      const traceTime = performance.now() - started,
        previousTrace = report.trace.at(-1);
      if (
        !previousTrace ||
        traceTime - previousTrace.time >= 200 ||
        previousTrace.state !== tracking.state ||
        previousTrace.reason !== tracking.reason
      ) {
        report.trace.push({ time: traceTime, ...tracking });
        if (report.trace.length > 300) report.trace.shift();
      }
      if (trackedPoseValid(tracking)) {
        root.matrix.fromArray(tracking.anchorMatrix);
        targetCamera.fromArray(tracking.viewMatrix).invert();
        targetCamera.decompose(targetPosition, targetRotation, unitScale);
        const now = performance.now(),
          alpha = !root.visible || !lastPoseUpdate ? 1 : 1 - Math.exp(-(now - lastPoseUpdate) / 45);
        smoothPosition.lerp(targetPosition, alpha);
        smoothRotation.slerp(targetRotation, alpha);
        camera.matrixWorld.compose(smoothPosition, smoothRotation, unitScale);
        camera.matrix.copy(camera.matrixWorld);
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        lastPoseUpdate = now;
        camera.projectionMatrix.fromArray(tracking.projectionMatrix);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        root.visible = true;
        reticle.hidden = true;
        lastTracking = performance.now();
        status(
          "tracking",
          "Apartamento na mesa. Mova devagar e mantenha a região escolhida visível.",
        );
      } else {
        // A bounded display hold bridges one rejected frame; it is never a measured pose.
        root.visible = root.visible && performance.now() - lastTracking <= 120;
        reticle.hidden = root.visible;
        const recovering = tracking.state === "recovering" || tracking.state === "lost";
        const messages = {
          "insufficient-distributed-texture":
            "Poucos detalhes nessa região. Toque perto de manchas ou bordas da mesa.",
          "waiting-for-sensors": "Segure o celular firme enquanto recebo o movimento.",
          "sensor-permission-or-data-unavailable":
            "Não recebi movimento. Confira a permissão no Safari e tente novamente.",
          "point-down-at-table": "Incline o celular para baixo, apontando para a mesa.",
          "hold-still": "Segure o celular parado por um instante.",
        };
        status(
          tracking.state ?? "scanning",
          messages[tracking.reason] ??
            (recovering
              ? "Recuperando a mesma região. Tire a mão da frente e volte a apontar para a mesa."
              : "Aponte para a mesa e toque numa região com detalhes para colocar."),
          tracking.reason,
        );
      }
    };
    listen(stage, "click", (event) => {
      const point = normalizedTap(
        event.clientX,
        event.clientY,
        containedRect(stage.getBoundingClientRect(), video.videoWidth, video.videoHeight),
      );
      if (!point) return;
      root.visible = false;
      reticle.hidden = false;
      worker.postMessage({ type: "place", point });
      report.placements++;
      status("placing", "Segure firme enquanto reconheço essa região da mesa.");
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("Captura de imagem indisponível neste navegador.");
    rvfc = typeof video.requestVideoFrameCallback === "function";
    report.capture.scheduler = rvfc ? "requestVideoFrameCallback" : "requestAnimationFrame";
    let previousTime = -1,
      lastCameraFrame = performance.now();
    const schedule = () => {
      if (!scope.disposed)
        callback = rvfc ? video.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
    };
    const frame = async (_now, meta) => {
      if (scope.disposed) return;
      schedule();
      if (video.currentTime === previousTime) return;
      previousTime = video.currentTime;
      lastCameraFrame = performance.now();
      if (busy) {
        report.droppedFrames++;
        return;
      }
      busy = true;
      const sent = performance.now();
      if (Number.isFinite(meta?.captureTime)) report.capture.captureTimeAvailable = true;
      report.capture.lastMediaTimeSeconds = meta?.mediaTime ?? video.currentTime;
      report.capture.lastCaptureTimeMs = meta?.captureTime ?? null;
      frameTimer = setTimeout(
        () => fail(Error("A câmera ou o rastreamento parou de responder; reabra o teste.")),
        5000,
      );
      try {
        if (samples.length) worker.postMessage({ type: "motion", samples: samples.splice(0) });
        if (typeof createImageBitmap === "function") {
          const bitmap = await createImageBitmap(video);
          if (scope.disposed) {
            bitmap.close();
            return;
          }
          try {
            worker.postMessage({ type: "frame", bitmap, sent, patch: true }, [bitmap]);
          } catch (error) {
            bitmap.close();
            throw error;
          }
        } else {
          context.drawImage(video, 0, 0, width, height);
          const rgba = context.getImageData(0, 0, width, height).data.buffer;
          worker.postMessage({ type: "frame", rgba, sent, patch: true }, [rgba]);
        }
      } catch (error) {
        fail(error);
      }
    };
    scope.own(() => {
      clearTimeout(frameTimer);
      if (callback !== null) {
        if (rvfc) video.cancelVideoFrameCallback(callback);
        else cancelAnimationFrame(callback);
      }
      canvas.width = 0;
      canvas.height = 0;
    });
    renderer.setAnimationLoop(() => {
      if (scope.disposed) return;
      if (
        root.visible &&
        performance.now() - lastTracking > (lastState === "tracking" ? 250 : 120)
      ) {
        root.visible = false;
        reticle.hidden = false;
        status("recovering", "Recuperando a mesma região. Mantenha a mesa visível.", "stale-pose");
      }
      adjustments.scale.setScalar(scale);
      adjustments.rotation.y = rotation;
      renderer.render(scene, camera);
    });
    // rVFC can cease entirely when a camera stalls; do not keep showing a frozen placement.
    const watchdog = setInterval(() => {
      if (!scope.disposed && performance.now() - lastCameraFrame > 5000)
        fail(Error("A câmera não entregou quadros. Reabra o teste."));
    }, 1000);
    scope.own(() => clearInterval(watchdog));
    schedule();
    status("scanning", "Toque numa região com textura da mesa. Evite vidro e superfícies lisas.");
    return {
      dispose,
      snapshot,
      reposition() {
        if (scope.disposed) return;
        root.visible = false;
        reticle.hidden = false;
        worker.postMessage({ type: "reset" });
        status("scanning", "Toque na mesa para escolher uma nova posição.");
      },
      setScale(value) {
        if (Number.isFinite(value)) scale = Math.max(0.3, Math.min(3, value));
      },
      setRotation(value) {
        if (Number.isFinite(value)) rotation = value;
      },
    };
  } catch (error) {
    if (!ended) fail(error);
    throw error;
  }
}
