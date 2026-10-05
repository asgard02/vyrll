/**
 * Autorise le PUT navigateur vers le bucket R2 (upload direct).
 * Usage : node --env-file=.env.local scripts/apply-r2-cors.mjs
 * Le token R2 doit avoir la permission Admin (PutBucketCors). Un token « Object Read & Write » renvoie Access Denied.
 */
import {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

const ORIGINS = [
  "https://upcut.app",
  "https://www.upcut.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME;

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME requis");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

let existing = [];
try {
  const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  existing = current.CORSRules ?? [];
} catch (err) {
  const code = err?.name || err?.Code || "";
  if (code !== "NoSuchCORSConfiguration" && err?.$metadata?.httpStatusCode !== 404) {
    console.error("GetBucketCors:", err?.message || err);
    process.exit(1);
  }
}

const kept = existing.filter((rule) => {
  const methods = rule.AllowedMethods ?? [];
  const origins = rule.AllowedOrigins ?? [];
  const isOurs = methods.includes("PUT") && origins.some((o) => ORIGINS.includes(o));
  return !isOurs;
});

const rules = [
  ...kept,
  {
    AllowedOrigins: ORIGINS,
    AllowedMethods: ["GET", "PUT", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: { CORSRules: rules },
  })
);

console.log(`CORS appliqué sur ${bucket} (${rules.length} règle(s)), PUT depuis : ${ORIGINS.join(", ")}`);
