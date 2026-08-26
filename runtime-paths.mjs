import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const projectDirectory = dirname(fileURLToPath(import.meta.url));
