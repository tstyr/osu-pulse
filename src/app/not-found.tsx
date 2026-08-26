import { CircleOff } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto max-w-xl px-5 py-28 text-center"><CircleOff className="mx-auto size-7 text-zinc-700" /><h1 className="mt-5 text-2xl font-medium tracking-tight text-white">このプレイヤーはまだ追跡されていません</h1><p className="mt-3 text-xs leading-6 text-zinc-500">Discordで /osu link を実行すると、公開成長ページが作成されます。</p><Link href="/" className="mt-7 inline-flex rounded-xl bg-white px-5 py-3 text-xs font-semibold text-black">デモに戻る</Link></main>;
}
