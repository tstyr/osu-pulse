import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { put } from "@vercel/blob";

const [, , sourceArgument, jobId] = process.argv;
if (!sourceArgument || !/^[0-9a-f]{32}$/.test(jobId ?? "")) {
  throw new Error("Usage: node upload_video.mjs <video.mp4> <local-job-id>");
}

const source = resolve(sourceArgument);
const size = statSync(source).size;
if (size <= 0) throw new Error("Rendered video is empty");

function r2Configuration() {
  const rawEndpoint = process.env.R2_ENDPOINT?.trim();
  const configuredBucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!rawEndpoint || !configuredBucket || (!accessKeyId && !secretAccessKey)) return null;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must both be configured");
  }
  const endpoint = new URL(rawEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("R2_ENDPOINT must be a clean HTTPS origin");
  }
  endpoint.pathname = "/";
  return {
    endpoint: endpoint.toString(),
    bucket: configuredBucket,
    accessKeyId,
    secretAccessKey,
  };
}

function publicObjectUrl(base, key) {
  const root = new URL(base);
  if (root.protocol !== "https:" || root.username || root.password) {
    throw new Error("R2_PUBLIC_BASE_URL must be HTTPS");
  }
  root.pathname = `${root.pathname.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return root.toString();
}

async function uploadToR2(configuration) {
  const client = new S3Client({
    region: "auto",
    endpoint: configuration.endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });
  const key = `discord-renders/${jobId}.mp4`;
  const upload = new Upload({
    client,
    params: {
      Bucket: configuration.bucket,
      Key: key,
      Body: createReadStream(source),
      ContentType: "video/mp4",
      ContentDisposition: `attachment; filename="osu-render-${jobId.slice(0, 8)}.mp4"`,
    },
    queueSize: 3,
    partSize: 16 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.trim();
  const expiresIn = Math.max(300, Math.min(604_800, Number.parseInt(process.env.R2_URL_EXPIRES_SECONDS ?? "604800", 10) || 604_800));
  const url = publicBase
    ? publicObjectUrl(publicBase, key)
    : await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: configuration.bucket, Key: key }),
        { expiresIn },
      );
  return { url, size, provider: "r2" };
}

async function uploadToVercelBlob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("R2 credentials and BLOB_READ_WRITE_TOKEN are not configured");
  }
  const blob = await put(`discord-renders/${jobId}.mp4`, createReadStream(source), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "video/mp4",
    multipart: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: blob.url, size, provider: "vercel-blob" };
}

const r2 = r2Configuration();
const result = await (r2
  ? uploadToR2(r2)
  : uploadToVercelBlob());
process.stdout.write(JSON.stringify(result));
