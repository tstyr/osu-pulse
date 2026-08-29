import { redirect } from "next/navigation";

import { ControlLogo } from "@/components/control-panel/control-logo";
import { LoginForm } from "@/components/control-panel/login-form";
import { hasControlPanelSession } from "@/lib/control/auth";

export default async function LoginPage() {
  if (await hasControlPanelSession()) redirect("/dashboard");
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-[430px]">
        <div className="mb-8 flex justify-center"><ControlLogo large /></div>
        <div className="cp-panel overflow-hidden">
          <div className="border-b border-[#e2e6ec] px-7 py-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f48120]">Private control plane</p>
            <h1 className="mt-2 text-[23px] font-semibold tracking-[-0.025em]">管理コンソールへログイン</h1>
            <p className="mt-2 text-sm leading-6 text-[#697386]">レンダー、YouTube、DB、ローカルPCの状態を1か所で管理します。</p>
          </div>
          <div className="px-7 py-6"><LoginForm /></div>
        </div>
        <p className="mt-5 text-center text-[11px] leading-5 text-[#7d8795]">Discord Botの操作には影響しません。キーフレーズはサーバー側だけで照合されます。</p>
      </section>
    </main>
  );
}
