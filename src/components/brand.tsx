import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-3" aria-label="osu pulse home">
      <span className="relative grid size-9 place-items-center rounded-full border border-pink-300/25 bg-pink-400/10 shadow-[0_0_34px_rgba(255,102,170,.12)]">
        <span className="size-3.5 rounded-full border-2 border-pink-300 transition-transform group-hover:scale-110" />
        <span className="absolute size-6 rounded-full border border-pink-300/25" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-white">
        osu<span className="text-pink-300">pulse</span>
      </span>
    </Link>
  );
}
