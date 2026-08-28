import "dotenv/config";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const [, , jobId] = process.argv;
if (!/^[0-9a-f]{32}$/.test(jobId ?? "")) {
  throw new Error("Usage: node delete_r2_video.mjs <local-job-id>");
}

const rawEndpoint = process.env.R2_ENDPOINT?.trim();
const bucket = process.env.R2_BUCKET?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
if (!rawEndpoint || !bucket || !accessKeyId || !secretAccessKey) {
  process.stdout.write(JSON.stringify({ deleted: false, configured: false }));
  process.exit(0);
}

const endpoint = new URL(rawEndpoint);
if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  throw new Error("R2_ENDPOINT must be a clean HTTPS origin");
}
endpoint.pathname = "/";
const client = new S3Client({
  region: "auto",
  endpoint: endpoint.toString(),
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: { accessKeyId, secretAccessKey },
});
await client.send(new DeleteObjectCommand({
  Bucket: bucket,
  Key: `discord-renders/${jobId}.mp4`,
}));
process.stdout.write(JSON.stringify({ deleted: true, configured: true }));
