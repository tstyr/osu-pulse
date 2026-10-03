import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

const readId = (path) => existsSync(path) ? readFileSync(path, "utf8").trim() : "";
const validId = (id) => /^(?:v2|windows|arch)-[A-Za-z0-9_.-]{1,160}$/.test(id);

function writeAtomic(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${contents}\n`, { mode: 0o600 });
    flushFile(temporary);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function flushFile(path) {
  // Windows FlushFileBuffers requires a descriptor with write access.
  const descriptor = openSync(path, "r+");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

export function readSnapshot(directory) {
  const id = readId(join(directory, "osu-pulse.latest.id"));
  if (!id) return null;
  if (!validId(id)) throw new Error("Shared database snapshot ID is invalid.");
  // A missing v2 file must never fall back to an unrelated legacy snapshot.
  const path = join(directory, id.startsWith("v2-") ? `osu-pulse.${id}.dump` : "osu-pulse.latest.dump");
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error("Shared database snapshot is incomplete; restore or inspect its backup before continuing.");
  }
  return { id, path };
}

export function preparePush(directory, statePath) {
  const snapshot = readSnapshot(directory);
  if (snapshot && readId(statePath) !== snapshot.id) {
    throw new Error("Another OS has a newer database snapshot. Stop the apps and run database sync pull before pushing.");
  }
  return snapshot;
}

export function publishSnapshot(directory, statePath, temporaryPath, platform) {
  if (!/^(windows|arch)$/.test(platform)) throw new Error("Invalid snapshot platform.");
  const previous = preparePush(directory, statePath);
  if (resolve(dirname(temporaryPath)) !== resolve(directory) || !/^osu-pulse\.[A-Za-z0-9-]+\.tmp$/.test(basename(temporaryPath))) {
    throw new Error("Temporary snapshot must be inside the database backup directory.");
  }
  if (!statSync(temporaryPath).isFile() || statSync(temporaryPath).size === 0) throw new Error("Database dump is empty.");
  flushFile(temporaryPath);
  const id = `v2-${platform}-${randomUUID()}`;
  // Commit a generation first, then change a single pointer. Unplugging between
  // these steps leaves an orphan, never a mismatched dump/ID pair.
  renameSync(temporaryPath, join(directory, `osu-pulse.${id}.dump`));
  if (previous) writeAtomic(join(directory, "osu-pulse.previous.id"), previous.id);
  writeAtomic(join(directory, "osu-pulse.latest.id"), id);
  writeAtomic(statePath, id);
  const keep = new Set([id, previous?.id]);
  for (const file of readdirSync(directory)) {
    const match = /^osu-pulse\.(v2-(?:windows|arch)-[a-f0-9-]{36})\.dump$/.exec(file);
    if (!match || keep.has(match[1])) continue;
    // Cleanup cannot invalidate a successfully published generation.
    try { unlinkSync(join(directory, file)); } catch { /* Retain inaccessible older backups. */ }
  }
  return id;
}

export function markApplied(statePath, id) {
  if (!validId(id)) throw new Error("Invalid applied snapshot ID.");
  writeAtomic(statePath, id);
}

async function portListening(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (listening) => { socket.destroy(); resolvePort(listening); };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function processRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

export async function guardRestore(projectRoot, { probePort = portListening, probeProcess = processRunning } = {}) {
  const heartbeat = join(projectRoot, "work", "bot-heartbeat.json");
  const lock = join(projectRoot, "work", "bot-runtime.lock");
  // A busy or hung Bot may stop refreshing its heartbeat while retaining a
  // live DB connection. The runtime PID still blocks a destructive restore.
  const liveBotProcess = [heartbeat, lock].some((path) => {
    try {
      if (!existsSync(path)) return false;
      const owner = JSON.parse(readFileSync(path, "utf8"));
      return Number.isSafeInteger(owner.pid) && owner.pid > 0 && probeProcess(owner.pid);
    } catch { return false; }
  });
  const botRunning = liveBotProcess || (existsSync(heartbeat) && Date.now() - statSync(heartbeat).mtimeMs < 20_000);
  const ports = await Promise.all([3000, 8765].map(probePort));
  if (botRunning || ports.some(Boolean)) {
    throw new Error("Stop Bot, Web UI and Renderer before restoring the shared database.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory, statePath, argument, platform] = process.argv.slice(2);
  try {
    if (command === "prepare-push") preparePush(directory, statePath);
    else if (command === "resolve-pull") {
      const snapshot = readSnapshot(directory);
      if (snapshot) process.stdout.write(`${snapshot.id}\n${snapshot.path}\n`);
    } else if (command === "publish") console.log(publishSnapshot(directory, statePath, argument, platform));
    else if (command === "mark-applied") markApplied(statePath, argument);
    else if (command === "guard-restore") await guardRestore(directory);
    else throw new Error("Unknown shared database snapshot command.");
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  }
}
