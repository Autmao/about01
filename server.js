/* ===== SERVER.JS — Express 入口 ===== */

const express = require('express');
const path = require('path');
const { ensureDB, initDB, seedDemoData } = require('./db');
const { router: authRouter } = require('./routes/auth');
const { requireAdmin, requireSuperAdmin } = require('./middleware/auth');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    ok: true,
    service: 'about-open-call',
    storage: process.env.STORAGE_PROVIDER || (process.env.OSS_BUCKET ? 'oss' : 'unconfigured'),
    time: new Date().toISOString(),
  });
});

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// 解析 JSON 请求体
app.use(express.json());

// 阻止项目源码、配置和部署文件被静态托管到公网。
app.use((req, res, next) => {
  const rawPath = decodeURIComponent((req.path || '').split('?')[0]);
  const isPublicAsset = rawPath === '/' ||
    rawPath.endsWith('.html') ||
    rawPath.startsWith('/assets/') ||
    rawPath.startsWith('/admin/');
  if (isPublicAsset) return next();

  const blocked = [
    '/server.js', '/db.js', '/package.json', '/package-lock.json',
    '/Dockerfile', '/.env', '/.env.example',
  ];
  const blockedPrefixes = ['/routes/', '/lib/', '/middleware/', '/docs/'];
  if (blocked.includes(rawPath) || blockedPrefixes.some(prefix => rawPath.startsWith(prefix))) {
    return res.status(404).send('Not found');
  }
  next();
});

// 托管静态文件。静态页面不能等待数据库，否则数据库连接慢时首页会一直转圈。
app.use(express.static(path.join(__dirname)));

// SPA fallback
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});
app.get('/admin/:page', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', req.params.page));
});

// 懒初始化 DB（仅 API 请求需要）
app.use('/api', async (req, res, next) => {
  try { await ensureDB(); next(); }
  catch (e) { console.error('DB init failed:', e.message); res.status(503).json({ error: 'Database unavailable' }); }
});

// 认证接口（公开，无需 token）
app.use('/api/admin', authRouter);

// 成员私有备注 & 筛选偏好（需登录）
app.use('/api/admin/notes',       requireAdmin,      require('./routes/member-notes'));
app.use('/api/admin/preferences', requireAdmin,      require('./routes/member-prefs'));

// 账号管理（仅 superadmin）
app.use('/api/admin-users',       requireSuperAdmin, require('./routes/admin-users'));

// 投递者注册/登录（手机号 OTP，公开）
app.use('/api/users', require('./routes/users'));

// 投递者登录 & 查询（公开）
app.use('/api/applicant', require('./routes/applicant'));

// AI 聊天（公开发消息 + 管理员查询，路由内部区分权限）
app.use('/api/chat', require('./routes/chat'));

// 文件上传（公开，投递者使用）
app.use('/api/upload', require('./routes/upload'));

// ── 路由挂载 ────────────────────────────────────────────────────
app.use('/api/jobs',          require('./routes/jobs'));          // 内部区分公开/后台
app.use('/api/applications',  require('./routes/applications'));  // 内部区分
app.use('/api/collaborators', requireAdmin, require('./routes/collaborators'));
app.use('/api',               requireAdmin, require('./routes/stats'));

// 导出 app（供测试或外部 Node 容器入口复用）
module.exports = app;

// 本地/容器运行：直接执行时启动 HTTP 服务器
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  about编辑部 Open Call 招募平台`);
    console.log(`  前台: http://localhost:${PORT}`);
    console.log(`  后台: http://localhost:${PORT}/admin/`);
    console.log(`  Health: http://localhost:${PORT}/health\n`);
  });

  initDB()
    .then(() => {
      if (!isProd) seedDemoData().catch(() => {});
    })
    .catch(err => {
      console.error('DB 初始化失败，业务接口会在数据库恢复后重试:', err.message || err);
    });
}
