import { listAccounts, upsertDailySnapshot } from "@/db/repository";
import { getOsuUser } from "@/lib/osu/client";
import { OSU_MODES } from "@/lib/osu/modes";
import { snapshotFromUser } from "@/lib/osu/normalize";
import { zonedDateKey } from "@/lib/time";

async function main() {
  const accounts = await listAccounts();
  let updated = 0;
  const failures: Array<{ osuUserId: number; mode: string; error: string }> = [];

  for (const account of accounts) {
    for (const mode of OSU_MODES) {
      try {
        const user = await getOsuUser(account.osuUserId, mode);
        if (!user.statistics) continue;
        await upsertDailySnapshot(snapshotFromUser(
          account.id,
          mode,
          user,
          zonedDateKey(new Date(), account.timezone),
        ));
        updated += 1;
      } catch (error) {
        failures.push({
          osuUserId: account.osuUserId,
          mode,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log(JSON.stringify({ accounts: accounts.length, updated, failures }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
