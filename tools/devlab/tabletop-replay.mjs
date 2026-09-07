// Original deterministic lab fixture. No physical camera, device tracking or support evidence.
export function createSyntheticSource() {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const texture = document.createElement("canvas");
  texture.width = 800;
  texture.height = 1360;
  const context = canvas.getContext("2d"),
    paint = texture.getContext("2d");
  if (!context || !paint || typeof canvas.captureStream !== "function")
    throw Error("Reprodução sintética indisponível neste navegador.");
  let seed = 12345;
  for (let y = 0; y < texture.height; y += 12)
    for (let x = 0; x < texture.width; x += 12) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 70 + (seed % 140);
      paint.fillStyle = `rgb(${value},${value},${value})`;
      paint.fillRect(x, y, 12, 12);
    }
  let frame,
    disposed = false;
  const start = performance.now();
  function draw() {
    if (disposed) return;
    const t = (performance.now() - start) / 1000;
    context.drawImage(texture, -40 + 18 * Math.sin(t / 3), -40 + 12 * Math.cos(t / 4));
    // Periodic exposure drift and two seconds of complete occlusion exercise the
    // same camera/Worker/render recovery path, explicitly marked as synthetic.
    const occluded = t % 12 >= 8 && t % 12 < 10;
    context.fillStyle = `rgba(255,255,255,${0.1 + 0.09 * Math.sin(t / 4)})`;
    context.fillRect(0, 0, 720, 1280);
    if (occluded) {
      context.fillStyle = "#898989";
      context.fillRect(0, 80, 720, 1200);
    }
    context.fillStyle = "#162c22";
    context.fillRect(0, 0, 720, 80);
    context.fillStyle = "white";
    context.font = "bold 24px system-ui";
    context.fillText(occluded ? "SIMULAÇÃO · OBSTRUÇÃO" : "SIMULAÇÃO · SEM CÂMERA REAL", 25, 48);
    stream?.getVideoTracks()[0]?.requestFrame?.();
  }
  const stream = canvas.captureStream(0),
    timers = new Set();
  draw();
  frame = setInterval(draw, 33);
  return {
    stream,
    label: "synthetic-portrait-translation-exposure-occlusion",
    subscribeMotion(handler) {
      const send = () =>
        handler({
          rotationRate: { alpha: 0, beta: 0, gamma: 0 },
          accelerationIncludingGravity: { x: 0, y: 0, z: -9.81 },
        });
      send();
      const timer = setInterval(send, 16);
      timers.add(timer);
      return () => {
        clearInterval(timer);
        timers.delete(timer);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(frame);
      for (const timer of timers) clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
