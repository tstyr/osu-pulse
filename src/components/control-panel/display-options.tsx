"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PageScaleControls, UiPreferenceControls, useUiPreferences } from "./ui-preferences";
import styles from "./console.module.css";

export function DisplayOptions() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { locale } = useUiPreferences();
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [open]);

  return <div ref={root} className={styles.displayOptions}>
    <button ref={trigger} type="button" className={styles.displayTrigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      <SlidersHorizontal aria-hidden="true" />{locale === "ja" ? "表示" : "Display"}
    </button>
    <div id={id} className={`${styles.displayControls} ${open ? styles.displayOpen : ""}`}>
      <PageScaleControls /><UiPreferenceControls />
    </div>
  </div>;
}
