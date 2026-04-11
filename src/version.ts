import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const _dir = dirname(fileURLToPath(import.meta.url));

let _version = "unknown";
try {
  _version = (
    JSON.parse(readFileSync(join(_dir, "../package.json"), "utf8")) as { version: string }
  ).version;
} catch {
  // package.json not found in deployment — use fallback
}

export const VERSION: string = _version;
