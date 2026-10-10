import { Activity } from "lucide-react";
import Link from "next/link";
import styles from "./console.module.css";

export function ControlLogo({ large = false }: { large?: boolean }) {
  return (
    <Link href="/dashboard" prefetch={false} className={`${styles.logo} ${large ? styles.largeLogo : ""}`} aria-label="osu! Pulse Control">
      <span className={styles.logoMark} aria-hidden="true">
        <Activity />
      </span>
      <span>
        <span className={styles.logoName}>osu! Pulse</span>
        <span className={styles.logoSubtitle}>管理コンソール</span>
      </span>
    </Link>
  );
}
