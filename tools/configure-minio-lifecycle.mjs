import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as MinioClient } from 'minio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function loadDotEnv() {
  const envPath = path.join(repoRoot, '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

function getEnv(name, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function parseRetentionDays() {
  const raw = getEnv('MINIO_IMAGE_RETENTION_DAYS', '1');
  const days = Number.parseInt(raw, 10);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error('MINIO_IMAGE_RETENTION_DAYS must be a positive integer.');
  }
  return days;
}

function createClient() {
  const serverUrl = getEnv('MINIO_INTERNAL_SERVER_URL') || getEnv('MINIO_SERVER_URL');
  if (!serverUrl) throw new Error('MINIO_SERVER_URL is required.');
  if (!getEnv('MINIO_ROOT_USER') || !getEnv('MINIO_ROOT_PASSWORD')) {
    throw new Error('MINIO_ROOT_USER / MINIO_ROOT_PASSWORD are required.');
  }

  const parsedUrl = new URL(serverUrl);
  const useSSL = parsedUrl.protocol === 'https:';
  const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : useSSL ? 443 : 80;

  return new MinioClient({
    endPoint: parsedUrl.hostname,
    port,
    useSSL,
    accessKey: getEnv('MINIO_ROOT_USER'),
    secretKey: getEnv('MINIO_ROOT_PASSWORD'),
    region: getEnv('MINIO_REGION') || undefined,
  });
}

async function main() {
  await loadDotEnv();

  const bucketName = getEnv('MINIO_BUCKET_NAME', 'gpt-image-2-webui');
  const retentionDays = parseRetentionDays();
  const client = createClient();

  const exists = await client.bucketExists(bucketName);
  if (!exists) {
    throw new Error(`Bucket does not exist: ${bucketName}`);
  }

  const lifecycle = {
    Rule: [
      {
        ID: `expire-image2-objects-after-${retentionDays}-day${retentionDays === 1 ? '' : 's'}`,
        Status: 'Enabled',
        Filter: { Prefix: '' },
        Expiration: { Days: retentionDays },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      },
    ],
  };

  await client.setBucketLifecycle(bucketName, lifecycle);
  const appliedLifecycle = await client.getBucketLifecycle(bucketName);

  console.log(
    JSON.stringify(
      {
        bucketName,
        retentionDays,
        appliedLifecycle,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
