import { probe } from "/packages/core/dist/index.js";
import { getLabReport, stopLab } from "./lab.mjs";
import {
  recordEvent,
  restoreDraft,
  makeReport,
  submitReport,
  downloadReport,
} from "./feedback.mjs";
const $ = (id) => document.getElementById(id);
let view = null,
  viewController = null,
  current = null,
  modelReady = false,
  pendingReport = null,
  pendingSubmission = null,
  build = null,
  capabilities = null;
const status = (text) => {
  $("phone-status").textContent = text;
};
function disposeView() {
  viewController?.abort();
  viewController = null;
  view?.dispose();
  view = null;
  modelReady = false;
  $("model-ar").disabled = true;
  $("model-stop").disabled = true;
  $("xr-place").hidden = true;
}
function snapshot() {
  if (view && current)
    current = { ...current, model: view.snapshot(), endedAt: new Date().toISOString() };
  return current ?? getLabReport();
}
function updateDraft() {
  if (!build) return null;
  const report = makeReport(snapshot(), {
    build,
    device: {
      model: $("device").value.trim() || "não informado",
      osBuild: $("os").value.trim() || "não informado",
      browserBuild: $("browser").value.trim() || "não informado",
    },
    observations: $("notes").value,
    rating: $("rating").value,
    id: pendingReport?.id,
  });
  pendingReport = report;
  return report;
}
window.addEventListener("spatial-lab-start", (e) => {
  if (view && current) current.model = view.snapshot();
  disposeView();
  current = null;
  pendingReport = null;
  pendingSubmission = null;
  recordEvent("start", e.detail);
});
window.addEventListener("spatial-lab-status", (e) => recordEvent("status", e.detail));
window.addEventListener("spatial-lab-finished", (e) => {
  current = e.detail;
  pendingReport = null;
  updateDraft();
  $("feedback").hidden = false;
  status("Teste encerrado. Conta o que aconteceu e envia o resultado abaixo.");
});
window.addEventListener("pagehide", () => {
  updateDraft();
  disposeView();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && view) {
    updateDraft();
    disposeView();
    status("Visualização pausada ao sair do Safari. Toque em Abrir apartamento para retomar.");
  }
});
$("model-open").onclick = async () => {
  stopLab();
  disposeView();
  pendingReport = null;
  pendingSubmission = null;
  const model = build.models.find((m) => m.id === $("model-choice").value) ?? build.models[0];
  if (!model) {
    status("Nenhum GLB foi configurado neste laboratório.");
    return;
  }
  const controller = new AbortController();
  viewController = controller;
  current = {
    kind: "viewer-3d",
    startedAt: new Date().toISOString(),
    capabilities,
    model: { id: model.id, name: model.name, sha256: model.sha256 },
  };
  $("model-open").disabled = true;
  $("model-stop").disabled = false;
  $("model-surface").classList.add("opened");
  status("Carregando o apartamento…");
  recordEvent("model-open", { id: model.id });
  try {
    const { createModelView } = await import("./model-viewer.mjs");
    if (controller.signal.aborted) return;
    const next = await createModelView({
      container: $("model-surface"),
      model,
      signal: controller.signal,
      onEvent: (type, detail) => {
        if (controller.signal.aborted) return;
        recordEvent(type, detail);
        if (type === "ready") {
          modelReady = true;
          current.model = detail;
          status(
            "Apartamento aberto. Arraste para girar; use dois dedos para aproximar. Este é o modo 3D, sem AR.",
          );
          $("model-ar").disabled = capabilities?.webxr.immersiveAr !== true;
          updateDraft();
        } else if (type === "error") {
          current.stopReason = detail.message;
          status(detail.message);
          updateDraft();
        } else if (type === "xr-started") {
          current.kind = "model-webxr";
          current.features = detail;
          $("xr-place").hidden = false;
          status("Aponte para uma mesa. Quando a maquete aparecer, toque em Colocar aqui.");
        } else if (type === "placed")
          status("Maquete ancorada. Mova o celular devagar ao redor da mesa.");
        else if (type === "xr-ended") {
          current.endedAt = new Date().toISOString();
          updateDraft();
          $("xr-place").hidden = true;
          status("AR encerrada. Envie o resultado abaixo.");
        }
      },
    });
    if (controller.signal.aborted) {
      next.dispose();
      return;
    }
    view = next;
  } catch (error) {
    if (!controller.signal.aborted) {
      recordEvent("model-error", { message: error.message });
      current.stopReason = error.message;
      status(`Não consegui abrir o modelo: ${error.message}`);
      updateDraft();
      disposeView();
    }
  } finally {
    if (!viewController || viewController === controller) $("model-open").disabled = false;
  }
};
$("model-stop").onclick = () => {
  snapshot();
  disposeView();
  $("model-open").disabled = false;
  updateDraft();
  status("Visualização encerrada. Tu já pode enviar o resultado.");
};
$("model-ar").onclick = async () => {
  if (!view || !modelReady) return;
  $("model-ar").disabled = true;
  try {
    await view.startAR($("overlay"));
  } catch (error) {
    recordEvent("xr-error", { message: error.message });
    current.stopReason = error.message;
    status(`AR não iniciou: ${error.message}`);
    updateDraft();
    $("model-ar").disabled = capabilities?.webxr.immersiveAr !== true;
  }
};
$("xr-place").onclick = () => view?.place();
$("send").onclick = async () => {
  if (!build) return;
  const report = pendingSubmission ?? updateDraft();
  pendingSubmission = report;
  $("send").disabled = true;
  $("receipt").textContent = "Enviando apenas medições e teu comentário para o Mac…";
  try {
    const result = await submitReport(report);
    $("receipt").textContent =
      `Recebido no Mac: ${result.receipt}. Pode dizer “enviei ${result.receipt}” no Codex.`;
    pendingReport = null;
    pendingSubmission = null;
    recordEvent("report-saved", { receipt: result.receipt });
  } catch (error) {
    $("receipt").textContent =
      `Não foi possível enviar: ${error.message}. O rascunho ficou neste Safari; use Baixar JSON se o Mac estiver offline.`;
  } finally {
    $("send").disabled = false;
  }
};
$("export").onclick = () => {
  const report = updateDraft();
  if (report) downloadReport(report);
};
$("restore").onclick = () => {
  const draft = restoreDraft();
  if (!draft) {
    status("Nenhum rascunho salvo.");
    return;
  }
  current = draft;
  pendingReport = draft;
  $("notes").value = draft.observations ?? "";
  $("rating").value = draft.rating ?? "not-sure";
  for (const [key, id] of [
    ["model", "device"],
    ["osBuild", "os"],
    ["browserBuild", "browser"],
  ])
    $(id).value = draft.device?.[key] ?? "";
  status("Rascunho recuperado. Revise e envie o resultado.");
};
for (const id of ["notes", "rating", "device", "os", "browser"])
  $(id).addEventListener("change", () => {
    pendingReport = null;
    pendingSubmission = null;
    updateDraft();
  });
try {
  const response = await fetch("/lab-build.json");
  if (!response.ok)
    throw Error("O link expirou. Abra novamente o link completo enviado pelo Codex.");
  build = await response.json();
  capabilities = await probe();
  $("build-label").textContent =
    `Mac conectado · versão ${build.commit.slice(0, 7)}${build.dirty ? " em teste" : ""}`;
  $("model-choice").replaceChildren(
    ...build.models.map((m) => {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = `${m.name} · ${(m.bytes / 1048576).toFixed(1)} MB`;
      return option;
    }),
  );
  $("model-open").disabled = !build.models.length;
  $("device").value =
    build.testerModel ?? (/iPhone/.test(navigator.userAgent) ? "iPhone (informe o modelo)" : "");
  const os = /OS ([\d_]+)/.exec(navigator.userAgent)?.[1];
  if (os) $("os").value = `iOS ${os.replaceAll("_", ".")}`;
  const safari = /Version\/([\d.]+).*Safari/.exec(navigator.userAgent)?.[1];
  if (safari) $("browser").value = `Safari ${safari}`;
  $("ar-note").textContent =
    capabilities.webxr.immersiveAr === true
      ? "WebXR detectado: após abrir o modelo, tu pode experimentar a colocação na mesa."
      : "Este navegador não oferece WebXR imersivo. Aqui tu pode testar o apartamento 3D e, abaixo, câmera e rastreamento experimental.";
  $("send").disabled = false;
  $("export").disabled = false;
  recordEvent("opened", { secureContext: isSecureContext, capabilities });
  if (restoreDraft()) $("restore").hidden = false;
  status("Comece abrindo o apartamento. Depois teste a câmera e envie o que aconteceu.");
} catch (error) {
  status(error.message);
  recordEvent("startup-error", { message: error.message });
}
