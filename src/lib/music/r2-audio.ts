import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  type CORSRule,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const acceptedExtensions = new Set([".flac", ".wav", ".mp3", ".m4a"]);
const stagingPrefix = "music-staging/";
const corsReady = new Set<string>();
let lifecycleReady = false;

function configuration() {
  const endpoint = process.env.R2_ENDPOINT?.trim().replace(/\/$/, "");
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("R2の接続情報が不足しています。Web UIの設定からR2 Endpoint・Bucket・Access Key・Secret Keyを設定してください。");
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

function client() {
  const config = configuration();
  return {
    bucket: config.bucket,
    client: new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
}

export function assertR2AudioObjectKey(value: string) {
  if (!value.startsWith(stagingPrefix) || value.includes("..") || !acceptedExtensions.has(extname(value).toLowerCase())) {
    throw new Error("R2音源キーが正しくありません。");
  }
  return value;
}

function musicCorsRule(origins: string[]): CORSRule {
  return {
    ID: "osu-pulse-music-upload",
    AllowedOrigins: origins,
    AllowedMethods: ["PUT"],
    AllowedHeaders: ["Content-Type"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3_600,
  };
}

export async function ensureR2MusicUploadCors(origin: string) {
  if (corsReady.has(origin) && lifecycleReady) return;
  const { client: r2, bucket } = client();
  let existing: CORSRule[] = [];
  try {
    existing = (await r2.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? [];
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (!/NoSuchCors|NoSuchCORSConfiguration/i.test(name)) throw error;
  }
  const previousOrigins = existing
    .filter((entry) => entry.ID?.startsWith("osu-pulse-music-"))
    .flatMap((entry) => entry.AllowedOrigins ?? [])
    .filter((value) => value !== "*");
  const rule = musicCorsRule([...new Set([...previousOrigins, origin])]);
  const unchanged = existing.some((entry) => entry.ID === rule.ID
    && entry.AllowedOrigins?.includes(origin)
    && entry.AllowedMethods?.includes("PUT")
    && entry.AllowedHeaders?.some((header) => header.toLowerCase() === "content-type"));
  if (!unchanged) {
    await r2.send(new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: [...existing.filter((entry) => !entry.ID?.startsWith("osu-pulse-music-")), rule] },
    }));
  }
  corsReady.add(origin);
  if (!lifecycleReady) {
    const lifecycleId = "osu-pulse-music-staging-expiry";
    let rules: LifecycleRule[] = [];
    try {
      rules = (await r2.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))).Rules ?? [];
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (!/NoSuchLifecycle/i.test(name)) throw error;
    }
    const configured = rules.some((rule) => rule.ID === lifecycleId && rule.Status === "Enabled");
    if (!configured) {
      await r2.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            ...rules.filter((rule) => rule.ID !== lifecycleId),
            { ID: lifecycleId, Status: "Enabled", Filter: { Prefix: stagingPrefix }, Expiration: { Days: 1 } },
          ],
        },
      }));
    }
    lifecycleReady = true;
  }
}

export async function createR2AudioUpload(input: { fileName: string; contentType: string }) {
  const extension = extname(input.fileName).toLowerCase();
  if (!acceptedExtensions.has(extension)) throw new Error("対応形式は FLAC / WAV / MP3 / M4A です。");
  const { client: r2, bucket } = client();
  const now = new Date();
  const objectKey = `${stagingPrefix}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${extension}`;
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: input.contentType,
  }), { expiresIn: 15 * 60 });
  return { objectKey, uploadUrl };
}

export async function createR2AudioTransferUrls(objectKey: string) {
  const key = assertR2AudioObjectKey(objectKey);
  const { client: r2, bucket } = client();
  const [downloadUrl, deleteUrl] = await Promise.all([
    getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 2 * 60 * 60 }),
    getSignedUrl(r2, new DeleteObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 2 * 60 * 60 }),
  ]);
  return { downloadUrl, deleteUrl };
}
