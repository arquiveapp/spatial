// Original bare WebXR spike; no polyfill, native viewer or third-party renderer.
// Specs: https://www.w3.org/TR/webxr/ and https://www.w3.org/TR/webxr-hit-test-1/
export async function startXR(canvas, overlay, signal, onState, onFrame) {
  if (!navigator.xr) throw Error("WebXR API unavailable; no fallback was started.");
  // Keep requestSession in the initiating user activation, before any await.
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test", "anchors"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: overlay },
  });
  let gl,
    program,
    buffer,
    hitSource,
    anchor,
    raf,
    ending = false,
    placing = false,
    requestPlacement = false;
  const select = () => {
    requestPlacement = true;
  };
  const cleanup = () => {
    if (ending) return;
    ending = true;
    signal.removeEventListener("abort", stop);
    session.removeEventListener("select", select);
    session.removeEventListener("end", ended);
    canvas.removeEventListener("webglcontextlost", contextLost);
    if (raf !== undefined) session.cancelAnimationFrame(raf);
    hitSource?.cancel();
    anchor?.delete();
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    canvas.classList.remove("xr-running");
  };
  const ended = () => {
    cleanup();
    onState("XR session ended");
  };
  const stop = () => {
    cleanup();
    void session.end().catch(() => {});
  };
  const contextLost = (e) => {
    e.preventDefault();
    stop();
    onState("WebGL context lost; restart required");
  };
  signal.addEventListener("abort", stop, { once: true });
  session.addEventListener("end", ended, { once: true });
  if (signal.aborted) {
    stop();
    throw Error("Experiment cancelled");
  }
  try {
    gl = canvas.getContext("webgl2", { xrCompatible: true, alpha: true });
    if (!gl) throw Error("WebGL2 unavailable");
    canvas.addEventListener("webglcontextlost", contextLost);
    await gl.makeXRCompatible();
    if (signal.aborted) throw Error("Experiment cancelled");
    const layer = new XRWebGLLayer(session, gl, { alpha: true });
    session.updateRenderState({ baseLayer: layer });
    const space = await session.requestReferenceSpace("local");
    const viewer = await session.requestReferenceSpace("viewer");
    hitSource = await session.requestHitTestSource({ space: viewer, entityTypes: ["plane"] });
    if (signal.aborted) {
      hitSource.cancel();
      throw Error("Experiment cancelled");
    }
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw Error(log);
      }
      return s;
    };
    program = gl.createProgram();
    const shaders = [];
    try {
      shaders.push(
        shader(
          gl.VERTEX_SHADER,
          `#version 300 es
in vec3 position;uniform mat4 projection;uniform mat4 view;uniform mat4 model;void main(){gl_Position=projection*view*model*vec4(position*.08+vec3(0.,.08,0.),1.);}`,
        ),
      );
      shaders.push(
        shader(
          gl.FRAGMENT_SHADER,
          `#version 300 es
precision mediump float;out vec4 color;void main(){color=vec4(.75,.95,.6,1.);}`,
        ),
      );
      for (const s of shaders) gl.attachShader(program, s);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(program));
    } finally {
      for (const s of shaders) gl.deleteShader(s);
    }
    const corners = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ];
    const faces = [
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0,
      3, 7, 0, 7, 4,
    ];
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(faces.flatMap((i) => corners[i])),
      gl.STATIC_DRAW,
    );
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(
      ["projection", "view", "model"].map((n) => [n, gl.getUniformLocation(program, n)]),
    );
    session.addEventListener("select", select);
    canvas.classList.add("xr-running");
    onState(
      `Scanning; tap a horizontal plane to anchor a 16 cm cube. DOM overlay: ${session.domOverlayState?.type ?? "unavailable"}`,
    );
    const frame = (time, f) => {
      if (ending) return;
      raf = session.requestAnimationFrame(frame);
      const pose = f.getViewerPose(space);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!pose) {
        onFrame({ time, state: "lost" });
        return;
      }
      const hit = f.getHitTestResults(hitSource).find((h) => {
        const p = h.getPose(space);
        return p && p.transform.matrix[5] > 0.85;
      });
      if (requestPlacement && !placing && hit) {
        requestPlacement = false;
        placing = true;
        hit
          .createAnchor()
          .then((next) => {
            if (ending) {
              next.delete();
              return;
            }
            anchor?.delete();
            anchor = next;
            onState("Placed. Tap a new horizontal point to reposition.");
          })
          .catch((e) => onState(`Anchor failed: ${e.name}`))
          .finally(() => {
            placing = false;
          });
      }
      const model = anchor ? f.getPose(anchor.anchorSpace, space) : hit?.getPose(space);
      onFrame({
        time,
        state: anchor ? (model ? "placed" : "lost") : hit ? "ready-to-place" : "scanning",
        matrix: model ? Array.from(model.transform.matrix) : null,
      });
      if (!model) return;
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.model, false, model.transform.matrix);
      for (const v of pose.views) {
        const viewport = layer.getViewport(v);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        gl.uniformMatrix4fv(uniforms.projection, false, v.projectionMatrix);
        gl.uniformMatrix4fv(uniforms.view, false, v.transform.inverse.matrix);
        gl.drawArrays(gl.TRIANGLES, 0, faces.length);
      }
    };
    raf = session.requestAnimationFrame(frame);
    return {
      stop,
      features: { anchors: true, hitTest: true, domOverlay: session.domOverlayState?.type ?? null },
    };
  } catch (error) {
    stop();
    throw error;
  }
}
