import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

await loadDotEnv();

const testStorageMode = process.env.TEST_STORAGE_MODE || 'minio';
const baseURL = process.env.TEST_OPENAI_BASE_URL || 'https://api.dwai.cloud/v1';
const apiKey =
  process.env.TEST_OPENAI_API_KEY ||
  'sk-a8f57050134d74eec1fc98c6a0ad9a12b2f40dfe4114bf59d5e0ac6aa5be9496';

process.env.OPENAI_API_BASE_URL = baseURL;
process.env.OPENAI_API_KEY = apiKey;
process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE = testStorageMode;
if (testStorageMode !== 'minio') {
  delete process.env.MINIO_SERVER_URL;
  delete process.env.MINIO_ROOT_USER;
  delete process.env.MINIO_ROOT_PASSWORD;
}

function log(title, value) {
  console.log(`\n=== ${title} ===`);
  if (typeof value === 'string') {
    console.log(value);
  } else {
    console.dir(value, { depth: 8 });
  }
}

async function importRoute(relPath) {
  const compiledPath = path.join(repoRoot, '.next', 'server', relPath.replace(/^src[\\/]/, '').replace(/\.ts$/, '.js'));
  try {
    await fs.access(compiledPath);
    const mod = await import(pathToFileURL(compiledPath).href + `?t=${Date.now()}`);
    return mod?.default?.routeModule?.userland || mod;
  } catch {}

  const fullPath = path.join(repoRoot, relPath);
  return import(pathToFileURL(fullPath).href + `?t=${Date.now()}`);
}

function createRequest(url, formData) {
  const req = new Request(url, {
    method: 'POST',
    body: formData,
    headers: {
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  req.cookies = {
    get() {
      return undefined;
    },
  };
  req.nextUrl = new URL(url);
  return req;
}

async function readResponseBody(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }
  return await res.text();
}

async function loadSampleImage() {
  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9u8AAAAASUVORK5CYII=',
    'base64',
  );
  return new File([png], 'sample.png', { type: 'image/png' });
}

async function testGenerate(imagesRoute) {
  const formData = new FormData();
  formData.set('mode', 'generate');
  formData.set('model', 'gpt-image-2');
  formData.set('prompt', '生成一只戴墨镜的猫头像');
  formData.set('n', '1');
  formData.set('size', '1024x1024');
  formData.set('quality', 'auto');
  formData.set('output_format', 'webp');
  formData.set('output_compression', '85');
  formData.set('background', 'auto');
  formData.set('moderation', 'auto');

  const request = createRequest('http://localhost:3000/api/images', formData);
  const response = await imagesRoute.POST(request);
  const body = await readResponseBody(response);

  log('Generate status', response.status);
  log('Generate content-type', response.headers.get('content-type'));
  log('Generate body', body);

  return { response, body };
}

async function testEdit(imagesRoute, sourceImage) {
  const formData = new FormData();
  formData.set('mode', 'edit');
  formData.set('model', 'gpt-image-2');
  formData.set('prompt', '把这张图片改成卡通插画风格');
  formData.set('n', '1');
  formData.set('size', '1024x1024');
  formData.set('quality', 'auto');
  formData.set('image_0', sourceImage);

  const request = createRequest('http://localhost:3000/api/images', formData);
  const response = await imagesRoute.POST(request);
  const body = await readResponseBody(response);

  log('Edit status', response.status);
  log('Edit content-type', response.headers.get('content-type'));
  log('Edit body', body);

  return { response, body };
}

async function testImageFetch(imageRoute, filename) {
  const request = new Request(`http://localhost:3000/api/image/${filename}`, { method: 'GET' });
  request.cookies = {
    get() {
      return undefined;
    },
  };
  request.nextUrl = new URL(`http://localhost:3000/api/image/${filename}`);
  const response = await imageRoute.GET(request, { params: Promise.resolve({ filename }) });
  const contentType = response.headers.get('content-type');
  const ab = await response.arrayBuffer();

  log('Image fetch status', response.status);
  log('Image fetch content-type', contentType);
  log('Image fetch bytes', ab.byteLength);

  return { response, bytes: ab.byteLength, contentType, arrayBuffer: ab };
}

async function main() {
  log('Env', {
    OPENAI_API_BASE_URL: process.env.OPENAI_API_BASE_URL,
    NEXT_PUBLIC_IMAGE_STORAGE_MODE: process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    hasMinioServer: Boolean(process.env.MINIO_SERVER_URL),
  });

  const imagesRoute = await importRoute('src/app/api/images/route.ts');
  const imageRoute = await importRoute('src/app/api/image/[filename]/route.ts');

  const generate = await testGenerate(imagesRoute);
  let generatedFilename = generate.body?.images?.[0]?.filename;

  if (!generatedFilename) {
    throw new Error('Generate did not return images[0].filename');
  }

  const fetchedGenerated = await testImageFetch(imageRoute, generatedFilename);
  const generatedBlob = new Blob([fetchedGenerated.response.status === 200 ? fetchedGenerated.arrayBuffer : new Uint8Array()], {
    type: fetchedGenerated.contentType || 'image/webp',
  });
  const editSourceFile =
    fetchedGenerated.response.status === 200 && fetchedGenerated.bytes > 0
      ? new File([generatedBlob], generatedFilename, { type: fetchedGenerated.contentType || 'image/webp' })
      : await loadSampleImage();

  const edit = await testEdit(imagesRoute, editSourceFile);
  const editedFilename = edit.body?.images?.[0]?.filename;
  if (editedFilename) {
    await testImageFetch(imageRoute, editedFilename);
  }
}

main().catch((error) => {
  console.error('\nTEST FAILED');
  console.error(error);
  process.exitCode = 1;
});
