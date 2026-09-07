import { createLabServer, loadLabConfig, readBuild } from "./server.mjs";
const root = process.cwd(),
  build = readBuild(root),
  config = await loadLabConfig(root);
const server = createLabServer({
  root,
  build,
  models: config.models,
  testerModel: config.testerModel,
});
server.listen(Number(process.env.SPATIAL_LAB_PORT ?? 4178), "127.0.0.1", () =>
  console.log(
    `Spatial device lab: http://127.0.0.1:${server.address().port} (${build.commit}${build.dirty ? " dirty" : ""})`,
  ),
);
