import { CircleOff } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center px-5"><div className="text-center"><CircleOff className="mx-auto size-7 text-[#7d8795]" /><h1 className="mt-4 text-xl font-semibold">ページが見つかりません</h1><p className="mt-2 text-sm text-[#778294]">既存の公開ページは管理コンソールへ置き換えられました。</p><Link href="/dashboard" className="cp-button-primary mt-6">管理画面へ戻る</Link></div></main>;
}
