# Discord unified menu

All slash functions are accessible through `/pulse`. The existing message context
menu **osu!リザルトをレンダリング** remains available. Legacy handlers and command
definitions are retained internally as the menu's input schema, not registered
as separate slash commands.

## Permissions

- General menu: osu!, rivals, render, music, tools, verification and own tickets.
- Server administration: requires Manage Server or Administrator in that guild.
  Permission is checked again on every interaction, including final execution.
- System operations: only the Discord application owner/team owner or explicit
  `CONTROL_PANEL_DISCORD_ADMIN_IDS`. Guild administrators are not automatically
  system operators. Storage inspection does not delete files.

Menus are private, bound to user/guild/channel, and expire after one hour of
inactivity. A revision nonce prevents old buttons from executing an operation
twice. Restarted/expired panels offer an **open my menu** button. Music/render
result controls retain their existing independent handlers and original
visibility, so long-lived public playback/progress panels keep updating.

## Inputs

Select a category, function, then each input field. Choices, users, channels and
roles use native selectors. Text/numbers use modals. Audio/replay attachments
use Discord's native file-upload modal (requires an up-to-date Discord client).
Optional inputs can be reset to unspecified. Render **account** fetches the
latest linked plays and displays PP/rank in the choices. Delete/stop/unlink
operations require a confirmation button.

## Added analysis

521 stability, 522 first/last half of session, 523 practice candidates based on
repeat attempts with identical mods, 526 first recorded milestones, 527 JST
35-day play calendar, 528 per-map/mod bests, 529 last-two-session comparison,
544 storage/cleanup candidates and 546 worker health.

Results explicitly distinguish stored history from lifetime history. Missing
PP is not counted as zero in averages. Miss judgement counts/FC are not inferred
from incomplete data. First/last performance is not a diagnosis of fatigue.
R2 usage and USB-only volume usage are marked unknown when not measured.

## Registration and rollout

1. Test, deploy menu source, and verify the Bot is ready.
2. `npm run bot:register -- --unify-all --dry-run`
3. `npm run bot:register -- --unify-all`

The unified rollout backs up current global and guild registrations under
ignored `work/command-registration/`, registers `/pulse` globally and clears
legacy guild overrides. Unknown command names abort the change. If any write
fails, it attempts to restore every attempted target. Never paste the bot token
or commit production env files. Global commands may require closing/reopening
Discord's command picker to refresh.
