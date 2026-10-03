import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const lavalinkDirectory = path.dirname(fileURLToPath(import.meta.url));
const jarPath = path.join(lavalinkDirectory, "runtime", "Lavalink.jar");
const password = process.env.LAVALINK_PASSWORD;
const logsDirectory = path.join(lavalinkDirectory, "logs");
mkdirSync(logsDirectory, { recursive: true });
const logStream = createWriteStream(path.join(logsDirectory, "lavalink.log"), { flags: "a", encoding: "utf8" });

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
  stdio: ["inherit", "pipe", "pipe"],
  windowsHide: false,
});

child.stdout?.on("data", (chunk) => { process.stdout.write(chunk); logStream.write(chunk); });
child.stderr?.on("data", (chunk) => { process.stderr.write(chunk); logStream.write(chunk); });

child.once("error", (error) => {
  console.error("[ERROR] Lavalink could not be started:", error.message);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  logStream.end();
  process.exitCode = code ?? 1;
});
