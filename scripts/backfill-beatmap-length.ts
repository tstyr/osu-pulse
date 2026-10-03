import { getPlayerScoreHistory, insertScoreEvent, listAccounts } from "@/db/repository";
import { getOsuScore } from "@/lib/osu/client";
import { OSU_MODES } from "@/lib/osu/modes";
import { normalizeScore } from "@/lib/osu/normalize";
import { importRecentScores } from "@/services/osu-sync";

async function main() {
  const requestedOsuId = process.argv[2] ? Number(process.argv[2]) : null;
  const accounts = (await listAccounts()).filter((account) => requestedOsuId === null || account.osuUserId === requestedOsuId);

  if (!accounts.length) throw new Error("対象の登録プレイヤーが見つかりません。");

  for (const account of accounts) {
    const results = await Promise.allSettled(OSU_MODES.map((mode) => importRecentScores(account, mode, false)));
    const failures = results.filter((result) => result.status === "rejected");
    console.log(`[beatmap-length] ${account.username}: ${OSU_MODES.length - failures.length}/${OSU_MODES.length} modes refreshed`);

    for (const mode of OSU_MODES) {
      const history = await getPlayerScoreHistory(account.id, mode);
      const missing = history.filter((score) => score.starRating === null || score.beatmapLengthSeconds === null || score.bpm === null);
      let updated = 0;
      for (let index = 0; index < missing.length; index += 4) {
        const batch = missing.slice(index, index + 4);
        const batchResults = await Promise.allSettled(batch.map(async (stored) => {
          const score = await getOsuScore(stored.osuScoreId, undefined, mode);
          await insertScoreEvent(normalizeScore(account.id, mode, score));
        }));
        updated += batchResults.filter((result) => result.status === "fulfilled").length;
      }
      if (missing.length) console.log(`[score-metadata] ${account.username}/${mode}: ${updated}/${missing.length} updated`);
    }
  }
}

void main();
