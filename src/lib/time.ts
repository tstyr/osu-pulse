export function zonedDateKey(date = new Date(), timeZone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parseDurationInput(value: number, unit: "minutes" | "hours" | "days") {
  const multipliers = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
  } as const;

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Duration must be greater than zero");
  }

  return value * multipliers[unit];
}

export function formatRelativeDuration(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間`;
  return `${Math.round(hours / 24)}日`;
}
