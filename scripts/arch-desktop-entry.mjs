import path from "node:path";
import { fileURLToPath } from "node:url";

// Exec has two escaping layers: desktop string escapes, then argument quoting.
// Field codes are expanded afterwards, so a literal percent must also be doubled.
// https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html
export function quoteExecArgument(argument) {
  if (typeof argument !== "string" || /[\x00-\x1f\x7f]/u.test(argument)) {
    throw new Error("Desktop launcher arguments must be strings without control characters.");
  }
  const quoted = argument
    .replaceAll("%", "%%")
    .replace(/[\\"$`]/gu, (character) => `\\${character}`)
    .replaceAll("\\", "\\\\");
  return `"${quoted}"`;
}

// %k may be a filename or file URI. Decode only local file URIs, one byte at a
// time, and use the result as an argument, never as shell source. Bash is already
// available on Arch before Node/Python or any application dependencies exist.
const portableCommand = [
  "set -Eeuo pipefail;",
  "fail() { printf '%s\\n' \"$1\" >&2; if [[ -t 0 ]]; then read -r -p 'Press Enter to close...' _ || true; fi; exit 1; };",
  "entry=${1:-};",
  "[[ -n \"$entry\" ]] || fail 'Cannot locate this desktop shortcut. Run bash ./START_OSU_PULSE_ARCH.sh in the USB folder.';",
  "encoded=0;",
  "case \"$entry\" in file:///*) entry=${entry#file://}; encoded=1;; file://localhost/*) entry=${entry#file://localhost}; encoded=1;; file:*) fail 'Only local file desktop shortcuts are supported.';; esac;",
  "if (( encoded )); then",
  "decoded=;",
  "while [[ -n \"$entry\" ]]; do",
  "if [[ ${entry:0:1} == '%' ]]; then",
  "hex=${entry:1:2};",
  "[[ ${#hex} == 2 && $hex == [[:xdigit:]][[:xdigit:]] && $hex != 00 ]] || fail 'Invalid file URI in desktop shortcut.';",
  "printf -v byte '%b' \"\\\\x$hex\";",
  "decoded+=\"$byte\"; entry=${entry:3};",
  "else decoded+=\"${entry:0:1}\"; entry=${entry:1}; fi;",
  "done; entry=$decoded;",
  "fi;",
  "[[ \"$entry\" != *$'\\n'* && \"$entry\" != *$'\\r'* ]] || fail 'Invalid desktop shortcut path.';",
  "usb_root=$(cd -- \"$(dirname -- \"$entry\")\" && pwd -P);",
  "launcher=$usb_root/START_OSU_PULSE_ARCH.sh;",
  "[[ -f \"$launcher\" ]] || fail 'USB launcher missing. Run bash ./START_OSU_PULSE_ARCH.sh in the USB folder.';",
  "exec /usr/bin/env bash \"$launcher\";",
].join(" ");

function desktopEntry({ name, comment, exec }) {
  return [
    "[Desktop Entry]",
    "Version=1.0",
    "Type=Application",
    `Name=${name}`,
    `Comment=${comment}`,
    `Exec=${exec}`,
    "TryExec=/usr/bin/env",
    "Icon=applications-games",
    "Terminal=true",
    "StartupNotify=false",
    "Categories=Utility;Game;",
    "Keywords=osu;Discord;Bot;",
    "",
  ].join("\n");
}

export function portableDesktopEntry() {
  return desktopEntry({
    name: "osu! Pulse USB Launcher",
    comment: "Start osu! Pulse, or set it up on first use. Run in a terminal.",
    // %k must be unquoted: quoted field-code expansion is undefined by the spec.
    exec: `/usr/bin/env bash -c ${quoteExecArgument(portableCommand)} osu-pulse-usb %k`,
  });
}

export function nativeDesktopEntry(launcherPath, mode = "--start") {
  if (typeof launcherPath !== "string" || !path.posix.isAbsolute(launcherPath)) {
    throw new Error("The Arch launcher path must be an absolute Linux path.");
  }
  if (mode !== "--start" && mode !== "--setup") {
    throw new Error("Desktop launcher mode must be --start or --setup.");
  }
  return desktopEntry({
    name: mode === "--start" ? "osu! Pulse" : "osu! Pulse Setup / Update",
    comment: mode === "--start"
      ? "Start the local Discord Bot, renderer, music server and Web UI."
      : "Update the Arch application and configure automatic startup from USB.",
    exec: `/usr/bin/env bash ${quoteExecArgument(launcherPath)} ${mode}`,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , command, launcherPath, mode] = process.argv;
    if (command === "usb") {
      process.stdout.write(portableDesktopEntry());
    } else if (command === "native") {
      process.stdout.write(nativeDesktopEntry(launcherPath, mode));
    } else {
      throw new Error("Usage: node scripts/arch-desktop-entry.mjs usb | native /absolute/arch-launcher.sh [--start|--setup]");
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
