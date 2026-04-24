import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TARGET_DIR = path.join(ROOT_DIR, "src", "vendor", "page-bridge");

const DEFAULT_SOURCE_DIR = path.join(
  process.env.LOCALAPPDATA || "",
  "Google",
  "Chrome",
  "User Data",
  "Default",
  "Extensions",
  "gpidldaeodhacaecoikekiogjcgfhinp",
  "2.1.0_0",
  "page-bridge",
);

async function exists(dirPath) {
  try {
    const st = await stat(dirPath);
    return st.isDirectory();
  } catch (_) {
    return false;
  }
}

async function main() {
  const sourceDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SOURCE_DIR;
  if (!(await exists(sourceDir))) {
    throw new Error(`Companion page-bridge source not found: ${sourceDir}`);
  }

  await rm(TARGET_DIR, { recursive: true, force: true });
  await mkdir(TARGET_DIR, { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const jsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (jsFiles.length === 0) {
    throw new Error(`No .js files found in: ${sourceDir}`);
  }

  await Promise.all(
    jsFiles.map((fileName) =>
      cp(path.join(sourceDir, fileName), path.join(TARGET_DIR, fileName)),
    ),
  );

  console.log(`Vendored ${jsFiles.length} files to ${TARGET_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
