import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const retentionHours = Number.parseInt(process.argv[2] ?? "24", 10);
if (!Number.isInteger(retentionHours) || retentionHours < 1 || retentionHours > 8_760) {
  throw new Error("Usage: node prune_r2_videos.mjs <retention-hours>");
}

const rawEndpoint = process.env.R2_ENDPOINT?.trim();
const bucket = process.env.R2_BUCKET?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
if (!rawEndpoint || !bucket || !accessKeyId || !secretAccessKey) {
  process.stdout.write(JSON.stringify({ deletedCount: 0, deletedBytes: 0, configured: false }));
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

const cutoff = Date.now() - retentionHours * 60 * 60 * 1_000;
let continuationToken;
let deletedCount = 0;
let deletedBytes = 0;
do {
  const listed = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: "discord-renders/",
    ContinuationToken: continuationToken,
  }));
  const expired = (listed.Contents ?? []).filter((object) =>
    object.Key
    && object.LastModified
    && object.LastModified.getTime() <= cutoff,
  );
  for (let index = 0; index < expired.length; index += 1_000) {
    const chunk = expired.slice(index, index + 1_000);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Quiet: true, Objects: chunk.map((object) => ({ Key: object.Key })) },
    }));
    deletedCount += chunk.length;
    deletedBytes += chunk.reduce((total, object) => total + Math.max(0, object.Size ?? 0), 0);
  }
  continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
} while (continuationToken);

process.stdout.write(JSON.stringify({ deletedCount, deletedBytes, configured: true }));
