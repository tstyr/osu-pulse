export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatRank(value: number | null | undefined) {
  if (!value) return "Unranked";
  return `#${formatNumber(value)}`;
}

export function formatAccuracy(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatScoreAccuracy(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatSigned(value: number, suffix = "") {
  if (value === 0) return `±0${suffix}`;
  return `${value > 0 ? "+" : ""}${formatNumber(value, 0)}${suffix}`;
}
