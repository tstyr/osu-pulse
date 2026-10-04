import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const bashPath = process.platform === "win32"
  ? ["C:/Program Files/Git/usr/bin/bash.exe", "C:/Program Files/Git/bin/bash.exe"].find(existsSync)
  : ["/usr/bin/bash", "/bin/bash"].find(existsSync);
const fixtures = [];
const toBashPath = (value) => process.platform === "win32"
  ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/u, (_, letter) => `/${letter.toLowerCase()}`)
  : value;

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "osu-arch-launcher-"));
  fixtures.push(root);
  const project = path.join(root, "USB project with spaces");
  const bin = path.join(root, "mock-bin");
  const calls = path.join(root, "calls");
  const home = path.join(root, "fixture-home");
  const state = path.join(root, "fixture-state");
  const data = path.join(root, "fixture-data");
  for (const directory of [path.join(project, "scripts"), bin, calls, home, state, data]) {
    mkdirSync(directory, { recursive: true });
  }
  const launcher = path.join(project, "scripts", "arch-launcher.sh");
  writeFileSync(launcher, readFileSync(path.join(import.meta.dirname, "arch-launcher.sh"), "utf8").replaceAll("\r\n", "\n"));
  const mock = (command, body) => writeFileSync(path.join(bin, command), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
  const record = (command) => `printf '%s\\0' "$@" >> "$OSU_ARCH_TEST_CALLS/${command}"`;

  mock("uname", "printf 'Linux\\n'");
  mock("systemctl", `${record("systemctl")}\nprintf '\\n' >> "$OSU_ARCH_TEST_CALLS/systemctl"`);
  // Every command with potential external effects is intercepted, including
  // terminal emulators and notifications that may be installed on CI Linux.
  for (const command of ["sudo", "pacman", "zenity", "kdialog", "notify-send"]) {
    mock(command, `${record(command)}\nexit 91`);
  }
  for (const terminal of ["xdg-terminal-exec", "konsole", "gnome-terminal", "xfce4-terminal", "kitty", "alacritty", "foot", "xterm", "x-terminal-emulator"]) {
    mock(terminal, `${record(terminal)}\nexit 92`);
  }
  writeFileSync(path.join(project, "scripts", "setup-usb-arch.sh"), `#!/usr/bin/env bash\nprintf 'unexpected installer\\n' > "$OSU_ARCH_TEST_CALLS/installer"\nexit 93\n`, { mode: 0o755 });
  const utilityPath = process.platform === "win32"
    ? toBashPath("C:/Program Files/Git/usr/bin")
    : "/usr/bin:/bin";
  const env = {
    ...process.env,
    PATH: `${toBashPath(bin)}:${utilityPath}`,
    HOME: toBashPath(home),
    XDG_STATE_HOME: toBashPath(state),
    XDG_DATA_HOME: toBashPath(data),
    DISPLAY: "",
    WAYLAND_DISPLAY: "",
    OSU_ARCH_TEST_CALLS: toBashPath(calls),
    MSYS2_ARG_CONV_EXCL: "*",
  };
  const run = (args, environment = {}) => spawnSync(bashPath, [toBashPath(launcher), ...args], {
    env: { ...env, ...environment }, encoding: "utf8", stdio: "pipe", timeout: 8000,
  });
  const observed = (command) => existsSync(path.join(calls, command)) ? readFileSync(path.join(calls, command), "utf8") : "";
  const log = () => readFileSync(path.join(state, "osu-pulse", "arch-launcher.log"), "utf8");
  const assertNoInstallation = () => {
    for (const command of ["installer", "sudo", "pacman"]) expect(observed(command)).toBe("");
  };
  return { root, project, launcher, data, mock, record, run, observed, log, assertNoInstallation };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.runIf(Boolean(bashPath))("Arch launcher", () => {
  it("prints help without starting services, opening terminals, or installing", () => {
    const f = fixture();
    const result = f.run(["--help"], { DISPLAY: ":fixture" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--start|--setup");
    expect(f.observed("systemctl")).toBe("");
    expect(f.observed("xdg-terminal-exec")).toBe("");
    f.assertNoInstallation();
  });

  it("rejects noninteractive setup with a persistent explanation", () => {
    const f = fixture();
    const result = f.run(["--setup"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("interactive terminal");
    expect(f.log()).toContain("Setup needs an interactive terminal");
    expect(f.log()).toContain("Launcher exited with code 1");
    expect(f.observed("systemctl")).toBe("");
    f.assertNoInstallation();
  });

  it("starts existing services and shows status without reinstalling", () => {
    const f = fixture();
    const result = f.run(["--start"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(f.observed("systemctl").split("\n").filter(Boolean)).toEqual([
      "--user\0start\0osu-pulse.target\0",
      "--user\0--no-pager\0status\0osu-pulse-bot.service\0osu-pulse-renderer.service\0osu-pulse-web.service\0osu-pulse-lavalink.service\0",
    ]);
    expect(result.stdout).toContain("No dependency reinstall or rebuild");
    expect(f.log()).toContain("http://localhost:3000");
    f.assertNoInstallation();
  });

  it("uses fast start by default when an installed build and target exist", () => {
    const f = fixture();
    mkdirSync(path.join(f.data, "osu-pulse", ".next"), { recursive: true });
    writeFileSync(path.join(f.data, "osu-pulse", ".next", "BUILD_ID"), "fixture-build");
    const result = f.run([]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(f.observed("systemctl")).toContain("--user\0cat\0osu-pulse.target\0");
    expect(f.observed("systemctl")).toContain("--user\0start\0osu-pulse.target\0");
    f.assertNoInstallation();
  });

  it("opens a fallback terminal and forwards spaced paths and arguments verbatim", () => {
    const f = fixture();
    f.mock("xdg-terminal-exec", `${f.record("xdg-terminal-exec")}\nexit 42`);
    f.mock("konsole", `${f.record("konsole")}\nexit 0`);
    const args = ["--setup", "argument with spaces", "$literal; not shell syntax", "日本語"];
    const result = f.run(args, { WAYLAND_DISPLAY: "fixture-wayland" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const childArgs = ["bash", toBashPath(f.launcher), "--in-terminal", ...args];
    expect(f.observed("xdg-terminal-exec").split("\0").slice(0, -1)).toEqual(childArgs);
    expect(f.observed("konsole").split("\0").slice(0, -1)).toEqual(["--separate", "-e", ...childArgs]);
    expect(f.log()).toContain("Could not launch xdg-terminal-exec");
    expect(f.observed("systemctl")).toBe("");
    f.assertNoInstallation();
  });

  it("does not reopen a terminal after an emulator forwards --in-terminal", () => {
    const f = fixture();
    const result = f.run(["--in-terminal", "--start"], { DISPLAY: ":fixture" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(f.observed("xdg-terminal-exec")).toBe("");
    expect(f.observed("konsole")).toBe("");
    expect(f.observed("systemctl")).toContain("start\0osu-pulse.target\0");
    f.assertNoInstallation();
  });

  it("does not retry setup in another terminal after the launched child fails", () => {
    const f = fixture();
    f.mock("xdg-terminal-exec", `${f.record("xdg-terminal-exec")}\nprintf 'fixture child\\n' > "$OSU_PULSE_ARCH_LAUNCH_SIGNAL"\nexit 7`);
    f.mock("konsole", `${f.record("konsole")}\nexit 0`);
    const result = f.run(["--setup"], { DISPLAY: ":fixture" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(7);
    expect(f.observed("xdg-terminal-exec")).toContain("--in-terminal\0--setup\0");
    expect(f.observed("konsole")).toBe("");
    expect(f.observed("systemctl")).toBe("");
    f.assertNoInstallation();
  });

  it("shows and logs an actionable error when no GUI terminal can be opened", () => {
    const f = fixture();
    const result = f.run(["--setup"], { DISPLAY: ":fixture" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(f.log()).toContain("No usable terminal emulator was found");
    expect(f.observed("zenity")).toContain("bash ./START_OSU_PULSE_ARCH.sh");
    expect(f.observed("systemctl")).toBe("");
    f.assertNoInstallation();
  });
});
