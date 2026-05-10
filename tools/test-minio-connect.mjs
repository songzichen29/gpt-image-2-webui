import crypto from 'crypto';
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
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function maskSecret(value) {
  if (!value) return '(empty)';
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function buildMinioClientFromEnv() {
  const serverUrl = process.env.MINIO_SERVER_URL?.trim();
  const accessKey = process.env.MINIO_ROOT_USER?.trim();
  const secretKey = process.env.MINIO_ROOT_PASSWORD?.trim();

  if (!serverUrl || !accessKey || !secretKey) {
    throw new Error('MINIO_SERVER_URL / MINIO_ROOT_USER / MINIO_ROOT_PASSWORD 缺失');
  }

  const parsedUrl = new URL(serverUrl);
  const useSSL = parsedUrl.protocol === 'https:';
  const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : useSSL ? 443 : 80;

  return {
    config: {
      serverUrl,
      endPoint: parsedUrl.hostname,
      port,
      useSSL,
      accessKey,
      secretKey,
      region: process.env.MINIO_REGION?.trim() || undefined,
      bucketName: process.env.MINIO_BUCKET_NAME?.trim() || 'gpt-image-2-webui',
    },
    client: new MinioClient({
      endPoint: parsedUrl.hostname,
      port,
      useSSL,
      accessKey,
      secretKey,
      region: process.env.MINIO_REGION?.trim() || undefined,
    }),
  };
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function printS3Error(error) {
  if (!error || typeof error !== 'object') {
    console.error(error);
    return;
  }

  const summary = {
    name: error.name,
    message: error.message,
    code: error.code,
    bucketname: error.bucketname,
    resource: error.resource,
    requestid: error.requestid,
    hostid: error.hostid,
    amzRequestid: error.amzRequestid,
    amzId2: error.amzId2,
    amzBucketRegion: error.amzBucketRegion,
    region: error.region,
  };

  console.dir(summary, { depth: 5 });
}

async function readObjectFully(stream) {
  const chunks = [];
  let totalBytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      totalBytes += buffer.length;
    }
  } catch (error) {
    error.bytesRead = totalBytes;
    throw error;
  }

  return Buffer.concat(chunks);
}

async function runStep(name, fn) {
  printHeader(name);
  try {
    const result = await fn();
    console.dir(result, { depth: 8 });
    return { ok: true, result };
  } catch (error) {
    printS3Error(error);
    return { ok: false, error };
  }
}

async function main() {
  await loadDotEnv();

  const { config, client } = buildMinioClientFromEnv();
  const bucketName = config.bucketName;
  const objectKey =
    process.env.TEST_MINIO_OBJECT_KEY?.trim() ||
    `_healthchecks/${Date.now()}-${crypto.randomUUID()}.txt`;
  const payload = Buffer.from(
    JSON.stringify(
      {
        kind: 'gpt-image-2-webui-minio-healthcheck',
        time: new Date().toISOString(),
        objectKey,
      },
      null,
      2,
    ),
    'utf8',
  );
  const payloadSha256 = crypto.createHash('sha256').update(payload).digest('hex');

  printHeader('Env');
  console.dir(
    {
      MINIO_SERVER_URL: config.serverUrl,
      MINIO_END_POINT: config.endPoint,
      MINIO_PORT: config.port,
      MINIO_USE_SSL: config.useSSL,
      MINIO_REGION: config.region || '(unset)',
      MINIO_BUCKET_NAME: bucketName,
      MINIO_ROOT_USER: config.accessKey,
      MINIO_ROOT_PASSWORD: maskSecret(config.secretKey),
      TEST_MINIO_OBJECT_KEY: objectKey,
    },
    { depth: 5 },
  );

  const bucketExistsResult = await runStep('bucketExists', async () => {
    const exists = await client.bucketExists(bucketName);
    return { exists, bucketName };
  });
  if (!bucketExistsResult.ok) return process.exitCode = 1;

  if (!bucketExistsResult.result.exists) {
    const shouldCreateBucket = process.env.TEST_MINIO_CREATE_BUCKET === 'true';
    if (!shouldCreateBucket) {
      console.error(`\nBucket ${bucketName} 不存在。若要自动创建，请设置 TEST_MINIO_CREATE_BUCKET=true`);
      return process.exitCode = 1;
    }

    const createResult = await runStep('makeBucket', async () => {
      await client.makeBucket(bucketName, config.region);
      return { bucketName, region: config.region || '(default)' };
    });
    if (!createResult.ok) return process.exitCode = 1;
  }

  const putResult = await runStep('putObject', async () => {
    await client.putObject(bucketName, objectKey, payload, undefined, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    return {
      bucketName,
      objectKey,
      payloadBytes: payload.length,
      payloadSha256,
    };
  });
  if (!putResult.ok) return process.exitCode = 1;

  const statResult = await runStep('statObject', async () => {
    const stat = await client.statObject(bucketName, objectKey);
    return {
      size: stat.size,
      etag: stat.etag,
      contentType: stat.metaData?.['content-type'] || stat.metaData?.['Content-Type'],
      lastModified: stat.lastModified,
      metaData: stat.metaData,
    };
  });
  if (!statResult.ok) return process.exitCode = 1;

  const getResult = await runStep('getObject', async () => {
    const stream = await client.getObject(bucketName, objectKey);
    const downloaded = await readObjectFully(stream);
    const downloadedSha256 = crypto.createHash('sha256').update(downloaded).digest('hex');
    return {
      downloadedBytes: downloaded.length,
      downloadedSha256,
      sha256Matches: downloadedSha256 === payloadSha256,
      preview: downloaded.toString('utf8').slice(0, 200),
    };
  });
  if (!getResult.ok) return process.exitCode = 1;

  const removeResult = await runStep('removeObject', async () => {
    await client.removeObject(bucketName, objectKey);
    return { removed: true, objectKey };
  });
  if (!removeResult.ok) return process.exitCode = 1;

  printHeader('Summary');
  console.log('MinIO 连接 / bucket / 上传 / 读取 / 删除 全部通过。');
}

main().catch((error) => {
  printHeader('Fatal');
  printS3Error(error);
  process.exitCode = 1;
});
