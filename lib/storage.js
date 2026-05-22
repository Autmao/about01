const crypto = require('crypto');

const OSS_ENV_KEYS = ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'];

function hasOssConfig() {
  return OSS_ENV_KEYS.every(key => process.env[key]);
}

function getStorageSecret() {
  return process.env.FILE_ACCESS_SECRET || process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret';
}

function safeFilename(filename) {
  const base = String(filename || 'upload')
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'upload';
}

function objectKey(filename) {
  const prefix = (process.env.OSS_UPLOAD_PREFIX || 'about-open-call').replace(/^\/+|\/+$/g, '');
  const date = new Date().toISOString().slice(0, 10);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${date}/${Date.now()}-${random}-${safeFilename(filename)}`;
}

function ossRef(bucket, key) {
  return `oss://${bucket}/${key}`;
}

function parseOssRef(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^oss:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

function signPayload(bucket, key, expires) {
  return `${bucket}\n${key}\n${expires}`;
}

function signFileAccess(bucket, key, expires) {
  return crypto
    .createHmac('sha256', getStorageSecret())
    .update(signPayload(bucket, key, expires))
    .digest('hex');
}

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyFileAccess({ bucket, key, expires, sig }) {
  const exp = Number(expires);
  if (!bucket || !key || !exp || Date.now() > exp) return false;
  return timingSafeEqual(sig, signFileAccess(bucket, key, exp));
}

function signedDownloadPath(ref, maxAgeMs = 15 * 60 * 1000) {
  const parsed = parseOssRef(ref);
  if (!parsed) return ref || '';
  const expires = Date.now() + maxAgeMs;
  const sig = signFileAccess(parsed.bucket, parsed.key, expires);
  const qs = new URLSearchParams({
    bucket: parsed.bucket,
    key: parsed.key,
    expires: String(expires),
    sig,
  });
  return `/api/upload/view?${qs.toString()}`;
}

function createOssClient(bucket = process.env.OSS_BUCKET) {
  const OSS = require('ali-oss');
  return new OSS({
    region: process.env.OSS_REGION,
    bucket,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    endpoint: process.env.OSS_ENDPOINT || undefined,
    secure: true,
  });
}

function decorateApplicationFiles(app) {
  if (!app) return app;
  return {
    ...app,
    resumeUrl: signedDownloadPath(app.resumeUrl),
    portfolioFiles: (app.portfolioFiles || []).map(file => ({
      ...file,
      url: signedDownloadPath(file.url),
    })),
  };
}

module.exports = {
  createOssClient,
  decorateApplicationFiles,
  hasOssConfig,
  objectKey,
  ossRef,
  safeFilename,
  verifyFileAccess,
};
