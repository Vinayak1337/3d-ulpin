import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { settings } from "./config";
import { AppError } from "./errors";

let client: S3Client | undefined;
function s3() {
  client ??= new S3Client({
    endpoint: settings.s3Endpoint,
    region: settings.s3Region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.s3AccessKey,
      secretAccessKey: settings.s3SecretKey,
    },
  });
  return client;
}
export function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}
export async function checkStorage() {
  await s3().send(new HeadBucketCommand({ Bucket: settings.s3Bucket }));
}
export async function ensureBucket() {
  try {
    await checkStorage();
  } catch (error) {
    const code = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (code !== 404) throw error;
    await s3().send(new CreateBucketCommand({ Bucket: settings.s3Bucket }));
  }
}
export async function readObject(key: string): Promise<Uint8Array> {
  const result = await s3().send(
    new GetObjectCommand({ Bucket: settings.s3Bucket, Key: key }),
  );
  if (!result.Body)
    throw new AppError(
      503,
      "SOURCE_UNAVAILABLE",
      "The stored original is unavailable.",
    );
  return result.Body.transformToByteArray();
}
export async function putOriginal(
  key: string,
  bytes: Uint8Array,
  mimeType: string,
) {
  await s3().send(
    new PutObjectCommand({
      Bucket: settings.s3Bucket,
      Key: key,
      Body: bytes,
      ContentType: mimeType,
      IfNoneMatch: "*",
      Metadata: { sha256: sha256(bytes) },
    }),
  );
  const stored = await readObject(key);
  if (stored.length !== bytes.length || sha256(stored) !== sha256(bytes)) {
    throw new AppError(
      422,
      "UPLOAD_INTEGRITY",
      "The uploaded bytes could not be verified. Retry the upload.",
    );
  }
}
export async function removeOrphan(key: string) {
  await s3().send(
    new DeleteObjectCommand({ Bucket: settings.s3Bucket, Key: key }),
  );
}
