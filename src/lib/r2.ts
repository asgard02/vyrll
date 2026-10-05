import { S3Client, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

export function isR2Configured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
}

function getR2Client(): S3Client | null {
  if (!isR2Configured()) return null;
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    // Checksums par défaut cassent le PUT navigateur (header x-amz-checksum absent).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** PUT signé vers R2. Le navigateur envoie le fichier sans passer par Next. */
export async function presignUploadPut(opts: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<string | null> {
  const client = getR2Client();
  if (!client || !R2_BUCKET_NAME) return null;
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: opts.key,
    ContentType: opts.contentType,
  });
  return getSignedUrl(client, command, { expiresIn: opts.expiresIn ?? 30 * 60 });
}

export async function deleteR2Clips(storageFolder: string): Promise<void> {
  const client = getR2Client();
  if (!client || !R2_BUCKET_NAME) return;

  const { Contents } = await client.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `${storageFolder}/`,
    })
  );

  if (!Contents?.length) return;

  const objects = Contents.filter((o) => o.Key).map(({ Key }) => ({ Key }));

  await client.send(
    new DeleteObjectsCommand({
      Bucket: R2_BUCKET_NAME,
      Delete: { Objects: objects },
    })
  );
}
