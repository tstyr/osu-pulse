"use client";

import { Download, Languages, Maximize2, Moon, Sun, ZoomIn, ZoomOut } from "lucide-react";
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";

export type UiLocale = "ja" | "en";
export type UiTheme = "light" | "dark";
export type UiScale = 0.6 | 0.7 | 0.8 | 0.9 | 1;

const UI_SCALES: UiScale[] = [0.6, 0.7, 0.8, 0.9, 1];

function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Session-only preferences still work when browser storage is unavailable. */ }
}

const PreferencesContext = createContext<{
  locale: UiLocale;
  theme: UiTheme;
  scale: UiScale;
  wideMode: boolean;
  setLocale: (locale: UiLocale) => void;
  setTheme: (theme: UiTheme) => void;
  setScale: (scale: UiScale) => void;
  setWideMode: (enabled: boolean) => void;
} | null>(null);

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>("ja");
  const [theme, setThemeState] = useState<UiTheme>("light");
  const [scale, setScaleState] = useState<UiScale>(1);
  const [wideMode, setWideModeState] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedLocale = readPreference("osu-pulse-locale");
      const savedTheme = readPreference("osu-pulse-theme");
      const savedScale = Number(readPreference("osu-pulse-scale"));
      const savedWideMode = readPreference("osu-pulse-wide-mode");
      if (savedLocale === "en") setLocaleState("en");
      if (savedTheme === "dark") setThemeState("dark");
      if (UI_SCALES.includes(savedScale as UiScale)) setScaleState(savedScale as UiScale);
      if (savedWideMode === "true") setWideModeState(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
  }, [locale, theme]);
  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;
    if (wideMode) {
      const fitScale = Math.max(0.2, Math.min(1, window.screen.width / 1280));
      viewport.content = `width=1280, initial-scale=${fitScale}, minimum-scale=0.2, maximum-scale=5, user-scalable=yes`;
      document.documentElement.dataset.wideMode = "true";
    } else {
      viewport.content = "width=device-width, initial-scale=1, viewport-fit=cover";
      delete document.documentElement.dataset.wideMode;
    }
  }, [wideMode]);
  const setLocale = (value: UiLocale) => { savePreference("osu-pulse-locale", value); setLocaleState(value); };
  const setTheme = (value: UiTheme) => { savePreference("osu-pulse-theme", value); document.documentElement.dataset.theme = value; setThemeState(value); };
  const setScale = (value: UiScale) => { savePreference("osu-pulse-scale", String(value)); setScaleState(value); };
  const setWideMode = (value: boolean) => { savePreference("osu-pulse-wide-mode", String(value)); setWideModeState(value); };
  return <PreferencesContext.Provider value={{ locale, theme, scale, wideMode, setLocale, setTheme, setScale, setWideMode }}>{children}</PreferencesContext.Provider>;
}

export function useUiPreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("useUiPreferences must be used inside UiPreferencesProvider");
  return value;
}

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function UiPreferenceControls() {
  const { locale, theme, setLocale, setTheme } = useUiPreferences();
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  return <div className="flex items-center gap-1.5">
    {installPrompt ? <button type="button" title={locale === "ja" ? "アプリとしてインストール" : "Install app"} onClick={() => { void installPrompt.prompt(); void installPrompt.userChoice.finally(() => setInstallPrompt(null)); }} className="grid size-8 place-items-center rounded-md border border-[#d8dde5] bg-white text-[#586477] hover:bg-[#f4f6f8]"><Download className="size-3.5" /></button> : null}
    <button type="button" title={locale === "ja" ? "表示言語" : "Language"} onClick={() => setLocale(locale === "ja" ? "en" : "ja")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d8dde5] bg-white px-2 text-[10px] font-semibold text-[#586477] hover:bg-[#f4f6f8]"><Languages className="size-3.5" />{locale === "ja" ? "JA" : "EN"}</button>
    <button type="button" title={locale === "ja" ? "テーマ切替" : "Toggle theme"} onClick={() => setTheme(theme === "light" ? "dark" : "light")} className="grid size-8 place-items-center rounded-md border border-[#d8dde5] bg-white text-[#586477] hover:bg-[#f4f6f8]">{theme === "light" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}</button>
  </div>;
}

export function PageScaleControls({ inverse = false }: { inverse?: boolean }) {
  const { scale, wideMode, setScale, setWideMode } = useUiPreferences();
  const index = UI_SCALES.indexOf(scale);
  const buttonClass = inverse
    ? "border-white/25 bg-white/10 text-white hover:bg-white/20 disabled:opacity-35"
    : "border-[#d8dde5] bg-white text-[#586477] hover:bg-[#f4f6f8] disabled:opacity-35";
  return <div className="flex items-center gap-1.5"><div className="inline-flex h-8 items-center overflow-hidden rounded-md" aria-label="ページ表示倍率">
    <button type="button" title="表示を縮小" aria-label="表示を縮小" disabled={wideMode || index === 0} onClick={() => setScale(UI_SCALES[Math.max(0, index - 1)])} className={`grid h-8 w-8 place-items-center border ${buttonClass}`}><ZoomOut className="size-3.5" /></button>
    <button type="button" title="100%に戻す" disabled={wideMode} onClick={() => setScale(1)} className={`h-8 min-w-12 border-y px-2 font-mono text-[9px] font-semibold ${buttonClass}`}>{Math.round(scale * 100)}%</button>
    <button type="button" title="表示を拡大" aria-label="表示を拡大" disabled={wideMode || index === UI_SCALES.length - 1} onClick={() => setScale(UI_SCALES[Math.min(UI_SCALES.length - 1, index + 1)])} className={`grid h-8 w-8 place-items-center border ${buttonClass}`}><ZoomIn className="size-3.5" /></button>
  </div><button type="button" title="小さい画面でPC幅を全体表示" aria-label="広域表示" aria-pressed={wideMode} onClick={() => setWideMode(!wideMode)} className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[9px] font-semibold transition ${wideMode ? inverse ? "border-white bg-white text-[#26303d]" : "border-[#8eb5e8] bg-[#eaf2fc] text-[#0051c3]" : buttonClass}`}><Maximize2 className="size-3.5" />広域</button>
  </div>;
}

export function PageScaleSurface({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { scale, wideMode } = useUiPreferences();
  const effectiveScale = wideMode ? 1 : scale;
  const style = {
    zoom: effectiveScale,
    width: `${100 / effectiveScale}%`,
    minHeight: `${100 / effectiveScale}vh`,
  } as CSSProperties;
  return <div className={className} style={style}>{children}</div>;
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, []);
  return null;
}
