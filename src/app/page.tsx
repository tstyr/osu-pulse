import { redirect } from "next/navigation";

import { ControlLogo } from "@/components/control-panel/control-logo";
import { LoginForm } from "@/components/control-panel/login-form";
import { hasControlPanelSession } from "@/lib/control/auth";
import { discordOAuthConfigured } from "@/lib/control/discord-oauth";
import styles from "@/components/control-panel/console.module.css";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ oauth?: string }> }) {
  if (await hasControlPanelSession()) redirect("/dashboard");
  const oauth = (await searchParams).oauth;
  const oauthError = oauth === "denied"
    ? "Discord認証に失敗したか、このサーバーの管理権限がありません。"
    : oauth === "not-configured"
      ? "Discord OAuthのClient Secretが未設定です。"
      : oauth === "cancelled"
        ? "Discord認証をキャンセルしました。"
        : null;
  return (
    <main className={styles.login}>
      <section className={styles.loginSection}>
        <div className={styles.loginBrand}><ControlLogo large /></div>
        <div className={styles.loginPanel}>
          <div className={styles.loginIntro}>
            <h1>管理画面にログイン</h1>
            <p>プレイヤーの記録、レンダー、音楽。<br />いつもの環境を、ここから管理できます。</p>
          </div>
          <div className={styles.loginForm}><LoginForm discordEnabled={discordOAuthConfigured()} oauthError={oauthError} /></div>
        </div>
        <p className={styles.loginFootnote}>この画面は管理者専用です。<br />Discord Botは、ログインせずにそのまま使えます。</p>
      </section>
    </main>
  );
}
