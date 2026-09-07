import { rm } from "node:fs/promises";

// Only remove this repository's generated build output.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
