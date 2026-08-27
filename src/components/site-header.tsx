import { Bot, Code2, Search } from "lucide-react";
import Link from "next/link";

import { Brand } from "./brand";

export function SiteHeader() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const inviteUrl = clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=274914853952&scope=bot%20applications.commands`
    : "#setup";

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.065] bg-[#0c0c12]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-5 px-4 sm:px-7">
        <Brand />
        <div className="hidden h-5 w-px bg-white/[0.08] sm:block" />
        <form action="/player" className="group relative hidden w-full max-w-[360px] md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600 transition group-focus-within:text-pink-300" />
          <input
            name="q"
            required
            aria-label="osu! player search"
            placeholder="プレイヤーを検索"
            className="h-9 w-full rounded-lg border border-white/[0.07] bg-white/[0.035] pl-9 pr-3 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-pink-300/30 focus:bg-white/[0.05]"
          />
        </form>
        <nav className="ml-auto flex items-center gap-1.5">
          <Link
            href="/docs"
            className="hidden rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-white sm:block"
          >
            セットアップ
          </Link>
          <a
            href="https://github.com/tstyr/osu-pulse"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="grid size-9 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/[0.05] hover:text-white"
          >
            <Code2 className="size-4" />
          </a>
          <a
            href={inviteUrl}
            className="ml-1 inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-xs font-semibold text-[#101017] transition hover:bg-pink-100"
          >
            <Bot className="size-3.5" />
            Botを追加
          </a>
        </nav>
      </div>
    </header>
  );
}
