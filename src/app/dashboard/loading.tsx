export default function DashboardLoading() {
  return <section role="status" aria-live="polite" aria-busy="true" className="cp-panel p-6">
    <p className="text-sm font-semibold">画面を読み込んでいます…</p>
    <p className="mt-2 text-xs text-[#6f7a8c]">データを準備中です。ほかのページにも移動できます。</p>
    <div aria-hidden="true" className="mt-6 grid animate-pulse gap-4 sm:grid-cols-3">
      {[0, 1, 2].map((key) => <div key={key} className="h-24 rounded-lg bg-slate-100" />)}
    </div>
  </section>;
}
