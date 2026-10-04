import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nativeDesktopEntry, portableDesktopEntry, quoteExecArgument } from "./arch-desktop-entry.mjs";

// A small independent decoder for the two Desktop Entry escaping layers and
// one-pass field expansion. It deliberately does not execute shell syntax.
function decodeExec(entry, desktopLocation = "") {
  const line = entry.split("\n").find((value) => value.startsWith("Exec="));
  if (!line) throw new Error("Missing Exec");
  const value = line.slice(5).replace(/\\([sntr\\])/gu, (_, escaped) => ({
    s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\",
  })[escaped]);
  const tokens = [];
  let token = "";
  let quoted = false;
  let started = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"') {
      quoted = !quoted;
      started = true;
    } else if (character === "\\" && quoted) {
      const next = value[++index];
      if (!'"$`\\'.includes(next)) throw new Error("Invalid Exec quote escape");
      token += next;
      started = true;
    } else if (character === " " && !quoted) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else {
      token += character;
      started = true;
    }
  }
  if (quoted) throw new Error("Unclosed Exec quote");
  if (started) tokens.push(token);
  return tokens.map((argument) => argument.replace(/%(.)/gu, (_, code) => {
    if (code === "%") return "%";
    if (code === "k") return desktopLocation;
    throw new Error(`Unexpected field code: %${code}`);
  }));
}

const bashPath = process.platform === "win32"
  ? ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"].find(existsSync)
  : "/usr/bin/bash";
const bashAvailable = Boolean(bashPath && existsSync(bashPath));
function toBashPath(windowsPath) {
  return process.platform === "win32"
    ? windowsPath.replaceAll("\\", "/").replace(/^([A-Za-z]):/u, (_, letter) => `/${letter.toLowerCase()}`)
    : windowsPath;
}

describe("Arch desktop entry quoting", () => {
  it("escapes desktop strings, Exec quotes, and literal field-code characters", () => {
    for (const value of ["", "space path", 'quote\"', "back\\slash", "$HOME", "`whoami`", "100% %k %f", "$(touch nope); & ' [x]"]) {
      expect(decodeExec(`[Desktop Entry]\nExec=${quoteExecArgument(value)}\n`)).toEqual([value]);
    }
    expect(quoteExecArgument("\\")).toBe('"\\\\\\\\"');
    expect(quoteExecArgument("$")).toBe('"\\\\$"');
    expect(() => quoteExecArgument("bad\nline")).toThrow(/control/u);
  });

  it("uses a terminal and keeps %k outside quotes", () => {
    const entry = portableDesktopEntry();
    expect(entry).toContain("Terminal=true\n");
    expect(entry).toContain(" osu-pulse-usb %k\n");
    const args = decodeExec(entry, "/USB path/launcher.desktop");
    expect(args.slice(0, 3)).toEqual(["/usr/bin/env", "bash", "-c"]);
    expect(args.slice(4)).toEqual(["osu-pulse-usb", "/USB path/launcher.desktop"]);
  });

  it("creates distinct fast-start and setup launchers without shell interpretation", () => {
    const launcher = '/home/user/a %k $HOME `x` \\ quote" (test)/arch-launcher.sh';
    expect(decodeExec(nativeDesktopEntry(launcher))).toEqual(["/usr/bin/env", "bash", launcher, "--start"]);
    expect(decodeExec(nativeDesktopEntry(launcher, "--setup"))).toEqual(["/usr/bin/env", "bash", launcher, "--setup"]);
    expect(() => nativeDesktopEntry("relative/path")).toThrow(/absolute/u);
    expect(() => nativeDesktopEntry("C:\\windows\\file")).toThrow(/absolute/u);
    expect(() => nativeDesktopEntry("/valid/path", "--invalid")).toThrow(/mode/u);
  });

  it.runIf(bashAvailable)("round-trips local filenames and file URIs through Bash without interpolation", () => {
    const testRoot = mkdtempSync(path.join(os.tmpdir(), "osu-desktop-"));
    try {
      // Windows cannot create names containing quotes, asterisks or backticks in
      // every environment. Test their native Exec round-trip above instead.
      const directory = path.join(testRoot, "USB space 100% %k $literal $(echo NOT_RUN) &; 日本語");
      mkdirSync(directory);
      const desktop = path.join(directory, "START.desktop");
      const output = path.join(testRoot, "observed.txt");
      const launcher = "#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' \"${BASH_SOURCE[0]}\" \"$#\" > \"$OSU_DESKTOP_TEST_OUTPUT\"\n";
      writeFileSync(path.join(directory, "START_OSU_PULSE_ARCH.sh"), launcher, "utf8");
      const local = toBashPath(desktop);
      const fileUri = `file://${local.split("/").map(encodeURIComponent).join("/")}`;
      const localhostUri = fileUri.replace("file:///", "file://localhost/");
      for (const location of [local, fileUri, localhostUri, "START.desktop"]) {
        const args = decodeExec(portableDesktopEntry(), location);
        execFileSync(bashPath, args.slice(2), {
          env: { ...process.env, OSU_DESKTOP_TEST_OUTPUT: toBashPath(output), MSYS2_ARG_CONV_EXCL: "*" },
          cwd: directory,
          encoding: "utf8",
        });
        const result = readFileSync(output, "utf8").trimEnd().split("\n");
        // Git Bash may represent the same Windows temp folder as /tmp or /c/.
        const actualPath = process.platform === "win32"
          ? execFileSync(bashPath, ["-c", 'cygpath -m "$1"', "osu-path", result[0]], {
            encoding: "utf8", env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" },
          }).trimEnd()
          : result[0];
        expect(realpathSync(actualPath)).toBe(realpathSync(path.join(directory, "START_OSU_PULSE_ARCH.sh")));
        expect(result[1]).toBe("0");
      }
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it.runIf(bashAvailable)("rejects remote file URIs, invalid escapes, and NUL paths", () => {
    for (const [location, errorMessage] of [
      ["file://remote-host/tmp/START.desktop", "Only local file desktop shortcuts"],
      ["file:///tmp/bad%zz.desktop", "Invalid file URI"],
      ["file:///tmp/bad%00.desktop", "Invalid file URI"],
      ["file:///tmp/bad%", "Invalid file URI"],
      ["file:///tmp/bad%0", "Invalid file URI"],
      ["file:///tmp/bad%0a.desktop", "Invalid desktop shortcut path"],
      ["", "Cannot locate this desktop shortcut"],
    ]) {
      const args = decodeExec(portableDesktopEntry(), location);
      let failure;
      try {
        execFileSync(bashPath, args.slice(2), { stdio: "pipe", env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } });
      } catch (error) {
        failure = error;
      }
      expect(failure?.status).toBe(1);
      expect(failure?.stderr.toString("utf8")).toContain(errorMessage);
    }
  });

  it("prints USB and native entries through the CLI", () => {
    const script = path.join(import.meta.dirname, "arch-desktop-entry.mjs");
    expect(execFileSync(process.execPath, [script, "usb"], { encoding: "utf8" })).toBe(portableDesktopEntry());
    expect(execFileSync(process.execPath, [script, "native", "/home/user/arch-launcher.sh", "--setup"], { encoding: "utf8" }))
      .toBe(nativeDesktopEntry("/home/user/arch-launcher.sh", "--setup"));
  });
});
