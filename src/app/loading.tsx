export default function Loading() {
  return <main className="mx-auto w-full max-w-[1480px] animate-pulse px-4 py-7 sm:px-7"><div className="h-32 rounded-2xl border border-white/[0.05] bg-white/[0.025]" /><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 rounded-2xl border border-white/[0.05] bg-white/[0.025]" />)}</div><div className="mt-4 h-96 rounded-2xl border border-white/[0.05] bg-white/[0.025]" /></main>;
}
