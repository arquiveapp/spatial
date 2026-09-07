// First-party lab experiment only. Not the public renderer-three adapter (M2 is gated).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { stats } from "./metrics.mjs";
function disposeModel(object) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    images = new Set();
  object?.traverse((n) => {
    if (n.geometry) geometries.add(n.geometry);
    for (const material of Array.isArray(n.material)
      ? n.material
      : n.material
        ? [n.material]
        : []) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value?.isTexture) {
          textures.add(value);
          if (value.source?.data?.close) images.add(value.source.data);
        }
    }
  });
  for (const g of geometries) g.dispose();
  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
  for (const image of images) image.close();
}
export async function createModelView({ container, model, signal, onEvent = () => {} }) {
  const started = performance.now(),
    frameTimes = [];
  let disposed = false,
    controls,
    loaded,
    renderer,
    session,
    hitSource,
    anchor,
    viewerSpace,
    lastHit,
    placing = false,
    placeRequested = false,
    previousFrame = null,
    rendered = 0;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeeeae2);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.set(-0.55, 0.65, 0.65);
  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88949c, 2.5));
  const light = new THREE.DirectionalLight(0xfff5e7, 3);
  light.position.set(1, 2, 1);
  scene.add(light);
  const controller = new AbortController();
  const abort = () => dispose();
  signal.addEventListener("abort", abort, { once: true });
  function clearXR() {
    hitSource?.cancel();
    hitSource = null;
    anchor?.delete();
    anchor = null;
    lastHit = null;
    viewerSpace = null;
    placeRequested = false;
    placing = false;
    container.classList.remove("immersive");
    if (controls) controls.enabled = true;
    root.matrixAutoUpdate = true;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.visible = true;
    scene.background = new THREE.Color(0xeeeae2);
    session = null;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    signal.removeEventListener("abort", abort);
    observer?.disconnect();
    renderer?.setAnimationLoop(null);
    controls?.dispose();
    const current = session;
    clearXR();
    void current?.end().catch(() => {});
    disposeModel(loaded);
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  }
  let observer;
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    onEvent("loading", { name: model.name, bytes: model.bytes });
    const response = await fetch(model.url, { signal: controller.signal });
    if (!response.ok) throw Error(`Modelo indisponível (HTTP ${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (disposed) throw new DOMException("Cancelled", "AbortError");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== model.sha256)
      throw Error("O arquivo mudou desde a preparação. Atualize o laboratório.");
    const data = new DataView(bytes);
    if (data.getUint32(0, true) !== 0x46546c67 || data.getUint32(4, true) !== 2)
      throw Error("GLB 2.0 inválido.");
    const json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(bytes, 20, data.getUint32(12, true))),
    );
    if ([...(json.buffers ?? []), ...(json.images ?? [])].some((x) => x.uri))
      throw Error("Este laboratório aceita apenas GLBs autocontidos.");
    const gltf = await new GLTFLoader().parseAsync(bytes, "");
    loaded = gltf.scene;
    if (disposed) {
      disposeModel(loaded);
      throw new DOMException("Cancelled", "AbortError");
    }
    const bounds = new THREE.Box3().setFromObject(loaded),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    const edge = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(edge) || edge <= 0) throw Error("Modelo sem dimensões válidas.");
    const scale = 0.6 / edge;
    const normalized = new THREE.Group();
    normalized.add(loaded);
    normalized.scale.setScalar(scale);
    normalized.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    root.add(normalized);
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local");
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Apartamento 3D interativo; arraste para girar e use dois dedos para zoom",
    );
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, size.y * scale * 0.35, 0);
    controls.enableDamping = true;
    controls.minDistance = 0.35;
    controls.maxDistance = 2.4;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    const resize = () => {
      if (disposed || session) return;
      const width = container.clientWidth,
        height = Math.max(container.clientHeight, 300);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    renderer.domElement.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        if (!disposed) {
          onEvent("error", { message: "Contexto gráfico perdido. Reabra o apartamento." });
          dispose();
        }
      },
      { signal: controller.signal },
    );
    const readStats = () => ({
      id: model.id,
      name: model.name,
      sha256: hash,
      bytes: bytes.byteLength,
      loadMs: performance.now() - started,
      frames: rendered,
      frameIntervalsMs: stats(frameTimes),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      maquetteLongestEdgeMeters: 0.6,
      mode: session ? "model-webxr" : "viewer-3d",
    });
    const loadMs = performance.now() - started;
    renderer.setAnimationLoop((time, frame) => {
      if (disposed) return;
      if (previousFrame !== null && frameTimes.length < 18000)
        frameTimes.push(time - previousFrame);
      previousFrame = time;
      if (frame && session && hitSource) {
        const space = renderer.xr.getReferenceSpace();
        const hit = frame.getHitTestResults(hitSource).find((h) => {
          const p = h.getPose(space);
          return p && p.transform.matrix[5] > 0.85;
        });
        lastHit = hit ?? null;
        if (placeRequested && !placing && hit) {
          placeRequested = false;
          placing = true;
          hit
            .createAnchor()
            .then((next) => {
              if (disposed || !session) {
                next.delete();
                return;
              }
              anchor?.delete();
              anchor = next;
              onEvent("placed", { scaleMode: "metric", maquetteLongestEdgeMeters: 0.6 });
            })
            .catch((e) => onEvent("error", { message: `Falha ao ancorar: ${e.name}` }))
            .finally(() => {
              placing = false;
            });
        }
        const pose = anchor ? frame.getPose(anchor.anchorSpace, space) : hit?.getPose(space);
        root.visible = !!pose;
        root.matrixAutoUpdate = false;
        if (pose) root.matrix.fromArray(pose.transform.matrix);
        if (rendered % 60 === 0)
          onEvent("xr-tracking", {
            state: anchor ? (pose ? "placed" : "lost") : hit ? "ready-to-place" : "scanning",
          });
      } else controls.update();
      renderer.render(scene, camera);
      rendered++;
      if (rendered === 2) onEvent("ready", { ...readStats(), loadMs });
    });
    return {
      snapshot: () => ({ ...readStats(), loadMs }),
      dispose,
      place: () => {
        placeRequested = true;
      },
      async startAR(overlay) {
        if (disposed || session) throw Error("Reabra o modelo antes de iniciar AR.");
        if (!navigator.xr) throw Error("WebXR indisponível. O modo 3D permanece disponível.");
        // The request happens directly inside the caller's click activation.
        const pending = navigator.xr.requestSession("immersive-ar", {
          requiredFeatures: ["hit-test", "anchors"],
          optionalFeatures: ["dom-overlay"],
          domOverlay: { root: overlay },
        });
        const xr = await pending;
        if (disposed) {
          await xr.end();
          throw new DOMException("Cancelled", "AbortError");
        }
        session = xr;
        try {
          xr.addEventListener(
            "end",
            () => {
              if (session === xr) {
                clearXR();
                resize();
                onEvent("xr-ended", {});
              }
            },
            { once: true },
          );
          controls.enabled = false;
          scene.background = null;
          root.visible = false;
          container.classList.add("immersive");
          await renderer.xr.setSession(xr);
          if (disposed || session !== xr) throw new DOMException("Cancelled", "AbortError");
          viewerSpace = await xr.requestReferenceSpace("viewer");
          const source = await xr.requestHitTestSource({
            space: viewerSpace,
            entityTypes: ["plane"],
          });
          if (disposed || session !== xr) {
            source.cancel();
            throw new DOMException("Cancelled", "AbortError");
          }
          hitSource = source;
          xr.addEventListener(
            "select",
            () => {
              placeRequested = true;
            },
            { signal: controller.signal },
          );
          onEvent("xr-started", {
            anchors: true,
            hitTest: true,
            domOverlay: xr.domOverlayState?.type ?? null,
          });
        } catch (error) {
          if (session === xr) clearXR();
          await xr.end().catch(() => {});
          throw error;
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
