/* ===== SERVER.JS — Express 入口 ===== */

const express = require('express');
const path = require('path');
const { ensureDB, initDB, seedDemoData } = require('./db');
const { router: authRouter } = require('./routes/auth');
const { requireAdmin } = require('./middleware/auth');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// 解析 JSON 请求体
app.use(express.json());

// 懒初始化 DB（serverless 冷启动时自动建表）
app.use(async (req, res, next) => {
  try { await ensureDB(); next(); }
  catch (e) { console.error('DB init failed:', e.message); res.status(503).json({ error: 'Database unavailable' }); }
});

// 认证接口（公开，无需 token）
app.use('/api/admin', authRouter);

// 文件上传（公开，投递者使用）
app.use('/api/upload', require('./routes/upload'));

// ── 路由挂载 ────────────────────────────────────────────────────
app.use('/api/jobs',          require('./routes/jobs'));          // 内部区分公开/后台
app.use('/api/applications',  require('./routes/applications'));  // 内部区分
app.use('/api/collaborators', requireAdmin, require('./routes/collaborators'));
app.use('/api',               requireAdmin, require('./routes/stats'));

// 托管静态文件（本地开发用；Vercel 生产环境由 CDN 托管）
app.use(express.static(path.join(__dirname)));

// SPA fallback
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});
app.get('/admin/:page', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', req.params.page));
});

// 导出 app（供 Vercel serverless 函数使用）
module.exports = app;

// 本地开发：直接执行时启动 HTTP 服务器
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initDB()
    .then(() => {
      if (!isProd) seedDemoData().catch(() => {});
      app.listen(PORT, () => {
        console.log(`\n  杂志书工作室派单平台`);
        console.log(`  前台: http://localhost:${PORT}`);
        console.log(`  后台: http://localhost:${PORT}/admin/`);
        console.log(`  API:  http://localhost:${PORT}/api/stats\n`);
      });
    })
    .catch(err => { console.error('启动失败:', err.message || err); process.exit(1); });
}
