/**
 * md-ops-api: HTTP API to browse/read/write markdown under allowlisted roots.
 * Bun + TypeScript.
 */

import { fetchHandler } from "./handler";
import { requireRuntimeConfig, serverBinding } from "./config";

const { host: HOST, port: PORT } = serverBinding();

// Refuse to start with an empty, unsafe, missing, unreadable, or unwritable allowlist.
requireRuntimeConfig();

const defaultExport = {
  fetch: fetchHandler,
  port: PORT,
  hostname: HOST,
};

export default defaultExport;

console.log(`md-ops-api listening on ${HOST}:${PORT}`);
