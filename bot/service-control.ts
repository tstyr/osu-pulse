import { spawn } from "node:child_process";
import path from "node:path";

import { claimPendingServiceControlCommands, completeServiceControlCommand, type LocalServiceName } from "@/db/service-control-repository";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function restartArguments(service: LocalServiceName) {
  const script = path.join(process.cwd(), "scripts", "restart-local-service.ps1");
  return [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-Service", service,
    "-CurrentProcessId", String(process.pid),
  ];
}

function dispatchBotRestart() {
  if (process.platform !== "win32") return runSystemdRestart("bot");
  const script = path.join(process.cwd(), "scripts", "start-bot-replacement.ps1");
  return new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-PreviousProcessId", String(process.pid)], { cwd: process.cwd(), stdio: "ignore", windowsHide: true, detached: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

function runSystemdRestart(service: LocalServiceName) {
  return new Promise<void>((resolve, reject) => {
    // --no-block lets the Bot finish recording the command before systemd
    // replaces its own process. Unit names come only from the validated enum.
    const child = spawn("systemctl", ["--user", "--no-block", "restart", `osu-pulse-${service}.service`], { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(errorText.trim() || `systemctl exited with code ${code}`)));
  });
}

function runRestart(service: Exclude<LocalServiceName, "bot">) {
  if (process.platform !== "win32") return runSystemdRestart(service);
  return new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", restartArguments(service), { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let errorText = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => { errorText += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(errorText.trim() || `PowerShell exited with code ${code}`)));
  });
}

async function poll() {
  if (running) return;
  running = true;
  try {
    const commands = await claimPendingServiceControlCommands();
    for (const command of commands) {
      try {
        if (command.action !== "restart" || !["bot", "renderer", "lavalink"].includes(command.service)) {
          throw new Error("未対応のサービス操作です。");
        }
        if (command.service === "bot") {
          await completeServiceControlCommand(command.id);
          await dispatchBotRestart();
          console.log("[services] restart dispatched: bot");
          if (process.platform === "win32") setTimeout(() => process.kill(process.pid, "SIGTERM"), 250).unref();
          return;
        }
        await runRestart(command.service as "renderer" | "lavalink");
        await completeServiceControlCommand(command.id);
        console.log(`[services] restart completed: ${command.service}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await completeServiceControlCommand(command.id, detail).catch(() => undefined);
        console.error(`[services] restart failed: ${detail}`);
      }
    }
  } finally { running = false; }
}

export function startServiceControlDispatcher() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void poll().catch((error) => console.error("[services] dispatcher failed:", error)), 2_000);
  timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
