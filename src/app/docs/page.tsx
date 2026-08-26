import { Bot, Database, Disc3, ExternalLink, KeyRound, ServerCog } from "lucide-react";

const steps = [
  { icon: Bot, title: "Discord Application", body: "Developer PortalでBotを作成し、TokenとApplication IDを環境変数へ追加します。", code: "DISCORD_TOKEN / DISCORD_CLIENT_ID" },
  { icon: KeyRound, title: "osu! OAuth client", body: "osu!アカウント設定のOAuthセクションでClient Credentialsを作成します。", code: "OSU_CLIENT_ID / OSU_CLIENT_SECRET" },
  { icon: Database, title: "Neon Postgres", body: "Vercel MarketplaceのNeonはすでに接続済み。migrationを1回実行します。", code: "npm run db:migrate" },
  { icon: ServerCog, title: "Gateway worker", body: "音声とリアルタイム監視のため、常駐Node.jsワーカーを起動します。", code: "npm run bot:start" },
  { icon: Disc3, title: "Lavalink v4", body: "同梱のCompose構成で音楽ノードを起動します。", code: "docker compose -f lavalink/compose.yml up -d" },
];

export default function DocsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-16 sm:py-24">
      <div className="max-w-2xl"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-pink-300">deployment guide</p><h1 className="mt-4 text-4xl font-medium tracking-[-0.055em] text-white">最初のリザルト通知まで、5ステップ。</h1><p className="mt-4 text-sm leading-7 text-zinc-500">WebはVercel、データはNeon、Gatewayと音楽は常駐ワーカーへ分離しています。</p></div>
      <div className="mt-10 grid gap-3">
        {steps.map((step, index) => <section key={step.title} className="surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6"><span className="grid size-10 shrink-0 place-items-center rounded-xl border border-pink-300/10 bg-pink-300/[0.055] text-pink-300"><step.icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[9px] text-zinc-700">0{index + 1}</span><h2 className="text-sm font-medium text-white">{step.title}</h2></div><p className="mt-2 text-xs leading-5 text-zinc-500">{step.body}</p></div><code className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 font-mono text-[10px] text-zinc-400">{step.code}</code></section>)}
      </div>
      <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-semibold text-black">Discord Developer Portal <ExternalLink className="size-3.5" /></a>
    </main>
  );
}
