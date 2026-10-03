import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const connectionString: string = databaseUrl;

async function main() {
  const sql = postgres(connectionString, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 2,
    prepare: false,
  });

  try {
  const [summary] = await sql<{
    database_size: string;
    accounts: number;
    scores: number;
    daily_snapshots: number;
    profile_snapshots: number;
    render_jobs: number;
    migrations: number;
  }[]>`
    select
      pg_size_pretty(pg_database_size(current_database())) as database_size,
      (select count(*)::int from accounts) as accounts,
      (select count(*)::int from score_events) as scores,
      (select count(*)::int from daily_snapshots) as daily_snapshots,
      (select count(*)::int from profile_snapshots) as profile_snapshots,
      (select count(*)::int from cloud_render_jobs) as render_jobs,
      (select count(*)::int from drizzle.__drizzle_migrations) as migrations
  `;
  const [integrity] = await sql<{
    orphan_discord_links: number;
    orphan_scores: number;
    orphan_daily_snapshots: number;
    orphan_profile_snapshots: number;
    invalid_score_accuracy: number;
    invalid_snapshot_accuracy: number;
  }[]>`
    select
      (select count(*)::int from discord_account_links child left join accounts parent on parent.id = child.account_id where parent.id is null) as orphan_discord_links,
      (select count(*)::int from score_events child left join accounts parent on parent.id = child.account_id where parent.id is null) as orphan_scores,
      (select count(*)::int from daily_snapshots child left join accounts parent on parent.id = child.account_id where parent.id is null) as orphan_daily_snapshots,
      (select count(*)::int from profile_snapshots child left join accounts parent on parent.id = child.account_id where parent.id is null) as orphan_profile_snapshots,
      (select count(*)::int from score_events where accuracy < 0 or accuracy > 1) as invalid_score_accuracy,
      (select count(*)::int from daily_snapshots where accuracy < 0 or accuracy > 100) as invalid_snapshot_accuracy
  `;

  const problems = Object.entries(integrity).filter(([, count]) => count > 0);
  console.log(JSON.stringify({ ok: problems.length === 0, summary, integrity }, null, 2));
    if (problems.length) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
