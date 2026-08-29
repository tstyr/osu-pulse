export default function Loading() {
  return <main className="mx-auto w-full max-w-[1500px] animate-pulse px-4 py-8 sm:px-7"><div className="h-16 w-64 rounded-lg bg-[#e6e9ed]" /><div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 rounded-lg border border-[#dfe3e8] bg-white" />)}</div><div className="mt-5 h-96 rounded-lg border border-[#dfe3e8] bg-white" /></main>;
}
