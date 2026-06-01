/* ===== routes/upload.js — 文件上传到 Vercel Blob / Aliyun OSS ===== */

const express = require('express');
const router = express.Router();
const {
  createOssClient, hasOssConfig, objectKey, ossRef, safeFilename, verifyFileAccess,
} = require('../lib/storage');

// 限制：仅允许 PDF、Word、常见图片格式
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

async function uploadToOss(filename, buffer, type) {
  const client = createOssClient();
  const key = objectKey(filename);
  await client.put(key, buffer, {
    mime: type,
    headers: {
      'Content-Type': type,
    },
  });
  return { url: ossRef(process.env.OSS_BUCKET, key), provider: 'oss', key };
}

async function uploadToVercelBlob(filename, buffer, type) {
  const { put } = require('@vercel/blob');
  const blob = await put(safeFilename(filename), buffer, {
    access: 'public',
    contentType: type,
  });
  return { url: blob.url, provider: 'vercel-blob' };
}

async function uploadFile(filename, buffer, type) {
  if (process.env.STORAGE_PROVIDER === 'oss' || hasOssConfig()) {
    return uploadToOss(filename, buffer, type);
  }
  return uploadToVercelBlob(filename, buffer, type);
}

router.get('/view', async (req, res) => {
  try {
    const { bucket, key, expires, sig } = req.query;
    if (!verifyFileAccess({ bucket, key, expires, sig })) {
      return res.status(403).send('File link expired');
    }
    const client = createOssClient(bucket);
    const url = client.signatureUrl(key, { expires: 60 });
    res.redirect(url);
  } catch (e) {
    console.error('[upload:view]', e.message);
    res.status(500).send('File unavailable');
  }
});

/* POST /api/upload
   Content-Type: application/octet-stream
   Query params: filename, type (MIME type)
   Body: raw file bytes
*/
router.post('/', async (req, res) => {
  try {
    const { filename, type } = req.query;

    if (!filename || !type) {
      return res.status(400).json({ error: 'filename and type query params required' });
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }

    // 读取 body（raw bytes）
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (buffer.length > MAX_SIZE) {
      return res.status(400).json({ error: 'File too large (max 50MB)' });
    }

    const uploaded = await uploadFile(filename, buffer, type);
    res.json(uploaded);
  } catch (e) {
    console.error('[upload]', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
