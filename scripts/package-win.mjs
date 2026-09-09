import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.realpath(os.tmpdir());
// OneDrive can lock Electron's unpack directory during its atomic rename.
// Build in a newly created local temporary folder, then copy final artifacts.
const stage = await fs.mkdtemp(path.join(tempRoot, "lumina-live-package-"));
const cli = path.join(root, "node_modules/electron-builder/out/cli/cli.js");
console.log("Packaging workspace: " + stage);
const code = await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      cli,
      "--win",
      "portable",
      "--x64",
      "--publish",
      "never",
      "--config.directories.output=" + stage,
    ],
    { cwd: root, windowsHide: true, stdio: "inherit" },
  );
  child.on("error", reject);
  child.on("exit", resolve);
});
if (code !== 0)
  throw Error(`Packaging failed (${code}); diagnostics retained at ${stage}`);
const files = await fs.readdir(stage);
const executable = files.find((name) =>
  /^Lumina-Live-.*-x64-portable\.exe$/.test(name),
);
if (!executable) throw Error("Portable executable missing");
await fs.mkdir(path.join(root, "release"), { recursive: true });
await fs.copyFile(
  path.join(stage, executable),
  path.join(root, "release", executable),
);
await fs.copyFile(
  path.join(stage, executable),
  path.join(root, "Lumina-Live.exe"),
);
console.log("Portable ready: " + path.join(root, "Lumina-Live.exe"));
const resolved = await fs.realpath(stage);
if (
  path.dirname(resolved) !== tempRoot ||
  !path.basename(resolved).startsWith("lumina-live-package-")
)
  throw Error("Temporary cleanup scope mismatch");
await fs.rm(resolved, { recursive: true, force: true });
