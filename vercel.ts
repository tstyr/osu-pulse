import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      path: "/api/cron/daily-digest",
      schedule: "0 12 * * *",
    },
    {
      path: "/api/cron/render-cleanup",
      schedule: "15 15 * * *",
    },
  ],
};
