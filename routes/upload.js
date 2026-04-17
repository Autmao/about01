/* ===== routes/upload.js — 文件上传到 Vercel Blob ===== */

const express = require('express');
const router = express.Router();
const { put } = require('@vercel/blob');

// 限制：仅允许 PDF、Word、常见图片格式
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

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
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }

    // 上传到 Vercel Blob
    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: type,
    });

    res.json({ url: blob.url });
  } catch (e) {
    console.error('[upload]', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
