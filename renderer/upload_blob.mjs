import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";

import { put } from "@vercel/blob";

const [, , sourceArgument, jobId] = process.argv;
if (!sourceArgument || !/^[0-9a-f-]{36}$/.test(jobId ?? "")) {
  throw new Error("Usage: node upload_blob.mjs <video.mp4> <cloud-job-uuid>");
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
}

const source = resolve(sourceArgument);
const size = statSync(source).size;
if (size <= 0) throw new Error("Rendered video is empty");

const blob = await put(`renders/${jobId}.mp4`, createReadStream(source), {
  access: "public",
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType: "video/mp4",
  multipart: true,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});

process.stdout.write(JSON.stringify({ url: blob.url, size }));
