/**
 * Reads the version from package.json and writes it into server.json.
 * Run after bumping the version in package.json:
 *   node scripts/sync-version.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));

server.version = pkg.version;
server.packages[0].version = pkg.version;

writeFileSync(join(root, "server.json"), JSON.stringify(server, null, 2) + "\n");
console.log(`server.json synced to v${pkg.version}`);
