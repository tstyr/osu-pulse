import { del } from "@vercel/blob";

const [, , url] = process.argv;
if (!url) throw new Error("Usage: node delete_blob.mjs <public-blob-url>");
const parsed = new URL(url);
if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".public.blob.vercel-storage.com")) {
  throw new Error("Refusing to delete a non-public Vercel Blob URL");
}
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
process.stdout.write("deleted");
