# Windows / Arch shared storage

The removable exFAT drive stores only portable, high-volume data. Node modules,
Python virtual environments, platform binaries, temporary files, secrets, and
the live PostgreSQL data directory remain local to each operating system.

## Layout

| Data | Windows | Arch Linux |
| --- | --- | --- |
| Root | `F:\osu-pulse-shared` | `/mnt/osu-pulse/osu-pulse-shared` |
| Audio | `audio` | `audio` |
| Beatmaps | `osu/Songs` | `osu/Songs` |
| Skins | `osu/Skins` | `osu/Skins` |
| Render output | `renders/output` | `renders/output` |
| Database snapshots | `backups/database` | `backups/database` |

## Windows migration

Run from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\migrate-shared-storage.ps1
```

The migration copies data, updates `.env.local` and `renderer/.env`, and restarts
the Bot and Renderer. Original files remain available for rollback.

## Arch configuration

Mount the exFAT volume at `/mnt/osu-pulse`, then run:

```bash
bash START_ARCH.sh
```

If the desktop mounted the drive somewhere below `/run/media`, the launcher
detects the `OSU_PULSE` volume label automatically. A custom mount point can be
passed explicitly, for example `bash START_ARCH.sh /run/media/$USER/OSU_PULSE`.
The complete setup output is retained in `work/arch-setup.log`.

Double-clicking a `.sh` file is not reliable because many Linux file managers
open shell scripts as text or silently refuse files without an executable bit.
Use the terminal command above. Optionally enable direct launching with
`chmod +x START_ARCH.sh scripts/*.sh`; this may not persist on exFAT.

The USB setup also installs an Arch public-tunnel service. Its generated URL is
saved in `work/public-web-url.txt`, and Vercel's proxy origin is updated when it
changes. First-time Arch setup requires a separate `vercel login`; Windows CLI
tokens are not copied. The launcher prompts in a terminal, or use
`work/vercel-cli/node_modules/.bin/vercel login` afterward. If no project link
was provided by the USB package, run the same CLI with `link`. Logs are in
`work/vercel-proxy-sync.log`. Local Bot/Renderer remain usable before login.

Install Node.js, Python, PostgreSQL, Java, FFmpeg, danser, and the mania renderer
separately on Arch. Do not reuse Windows `node_modules`, `.venv`, `.exe` files,
or a PostgreSQL data directory across operating systems.

The shared directories are used directly, so media files do not need a second
copy at boot. The live PostgreSQL data directory remains on each OS's native
filesystem. A portable custom-format snapshot is restored before the app starts
and refreshed every five minutes while it runs. The previous snapshot and a
pre-restore local safety dump are retained for recovery. New snapshots use
immutable generation files and a latest pointer, so an interrupted write
cannot pair an old dump with a new ID. An OS that has not applied the latest
shared snapshot cannot overwrite it. Pulls validate the dump before restoring
and run in a single transaction; stop Bot, Web UI and Renderer first.

Windows remembers the USB hardware identity locally (not in GitHub). If the
drive letter disappears, the launcher can restore the registered letter without
relying on a disk number. To register a replacement USB after mounting it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-shared-device.ps1
```

Manual database synchronization is also available:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-shared-database.ps1 -Mode Push
powershell -ExecutionPolicy Bypass -File scripts\sync-shared-database.ps1 -Mode Pull
```

```bash
bash scripts/sync-shared-database.sh push
bash scripts/sync-shared-database.sh pull
```

Because Windows and Arch are dual-booted, only one side writes at a time. Do
not remove the USB drive while a snapshot is being written.

The installed Arch user services require the USB mount before startup and
restart failed workers automatically. Build the Web UI and install the Linux
runtime dependencies before starting the target for the first time.
