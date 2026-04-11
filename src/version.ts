import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const _dir = dirname(fileURLToPath(import.meta.url));
export const VERSION: string = (
  JSON.parse(readFileSync(join(_dir, "../package.json"), "utf8")) as { version: string }
).version;
