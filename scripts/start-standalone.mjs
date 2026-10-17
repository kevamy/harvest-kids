// Starts the standalone build exactly as the Docker image does:
// static assets and public/ are copied next to server.js, then it is run.
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(join(standalone, "server.js"))) {
  console.error("Build standalone introuvable. Lancez d'abord `pnpm build`.");
  process.exit(1);
}

cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
}

const portIndex = process.argv.indexOf("--port");
if (portIndex !== -1) process.env.PORT = process.argv[portIndex + 1];

process.chdir(standalone);
await import(pathToFileURL(join(standalone, "server.js")).href);
