import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const lavalinkDirectory = path.dirname(fileURLToPath(import.meta.url));
const jarPath = path.join(lavalinkDirectory, "runtime", "Lavalink.jar");
const password = process.env.LAVALINK_PASSWORD;

if (!password) {
  console.error("[ERROR] LAVALINK_PASSWORD is missing in .env.local.");
  process.exit(1);
}

const child = spawn("java", ["-Xmx1G", "-jar", jarPath], {
  cwd: lavalinkDirectory,
  env: {
    ...process.env,
    LAVALINK_SERVER_PASSWORD: password,
  },
  stdio: "inherit",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error("[ERROR] Lavalink could not be started:", error.message);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
