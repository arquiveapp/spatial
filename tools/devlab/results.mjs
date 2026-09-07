import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const directory = join(process.cwd(), ".local/results");
let files;
try {
  files = await readdir(directory);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  files = [];
}
const records = await Promise.all(
  files
    .filter((f) => /^[a-f0-9-]+\.json$/.test(f))
    .map(async (f) => JSON.parse(await readFile(join(directory, f), "utf8"))),
);
records.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
if (!records.length)
  console.log("Nenhum resultado recebido. No celular, toque em Enviar resultado para o Mac.");
for (const record of records) {
  const r = record.report;
  console.log(
    JSON.stringify(
      {
        receipt: `SP-${r.id.slice(0, 8).toUpperCase()}`,
        receivedAt: record.receivedAt,
        kind: r.kind,
        device: r.device,
        rating: r.rating,
        observations: r.observations,
        stopReason: r.stopReason,
        fps: r.metrics?.fps,
        imuHz: r.metrics?.imuHz,
        workerP95: r.metrics?.workerMs?.p95,
        model: r.model,
        errors: r.errors,
        sourceCommit: r.build?.commit,
        serverCommit: record.serverBuild?.commit,
        file: join(directory, `${r.id}.json`),
      },
      null,
      2,
    ),
  );
}
