import { Activity } from "lucide-react";
import Link from "next/link";

export function ControlLogo({ large = false }: { large?: boolean }) {
  return (
    <Link href="/dashboard" className="inline-flex items-center gap-3" aria-label="osu! Pulse Control">
      <span className={`${large ? "size-11" : "size-9"} grid place-items-center rounded-lg bg-[#f48120] text-white shadow-sm`}>
        <Activity className={large ? "size-6" : "size-5"} strokeWidth={2.2} />
      </span>
      <span>
        <span className={`${large ? "text-lg" : "text-[15px]"} block font-semibold tracking-[-0.025em] text-[#171a1f]`}>osu! Pulse</span>
        <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#7b8492]">Control</span>
      </span>
    </Link>
  );
}
