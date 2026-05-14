/* ===== DB.JS — PostgreSQL (pg) 数据层 ===== */

const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// 阻止 pg 把 DATE 列自动转为 JS Date 对象（会引入 UTC 时差导致日期偏移一天）
// OID 1082 = DATE，直接返回原始字符串如 "2026-05-01"
types.setTypeParser(1082, val => val);

// Vercel Postgres 注入 POSTGRES_URL，Railway/本地用 DATABASE_URL
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/* ===== 辅助函数 ===== */
function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
function now() { return new Date().toISOString(); }

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isPastDeadline(deadline) {
  if (!deadline) return false;
  return String(deadline).slice(0, 10) < todayInShanghai();
}

async function closeExpiredJobs() {
  const ts = now();
  await pool.query(
    `UPDATE jobs
     SET status = 'closed', updated_at = $1
     WHERE status = 'open'
       AND deadline IS NOT NULL
       AND deadline < $2::date`,
    [ts, todayInShanghai()]
  );
}

/* ===== 建表 ===== */
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      description TEXT,
      requirements JSONB DEFAULT '[]',
      deliverables TEXT,
      fee TEXT,
      fee_type TEXT DEFAULT 'per_project',
      deadline DATE,
      slots INTEGER DEFAULT 1,
      tags JSONB DEFAULT '[]',
      cover_color TEXT DEFAULT '#E8DDD0',
      application_count INTEGER DEFAULT 0,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      job_title TEXT,
      job_category TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      wechat TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      portfolio_note TEXT DEFAULT '',
      portfolio_links JSONB DEFAULT '[]',
      resume_url TEXT DEFAULT '',
      portfolio_files JSONB DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      status_history JSONB DEFAULT '[]',
      admin_note TEXT DEFAULT '',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS collaborators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      wechat TEXT DEFAULT '',
      categories JSONB DEFAULT '[]',
      bio TEXT DEFAULT '',
      portfolio_links JSONB DEFAULT '[]',
      cooperation_history JSONB DEFAULT '[]',
      rating INTEGER DEFAULT 0,
      internal_tags JSONB DEFAULT '[]',
      internal_note TEXT DEFAULT '',
      source_app_id TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT,
      recipient_email TEXT,
      recipient_name TEXT,
      subject TEXT,
      body TEXT,
      related_app_id TEXT,
      related_job_id TEXT,
      status TEXT DEFAULT 'unread',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS member_notes (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      note TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(admin_user_id, app_id)
    );

    CREATE TABLE IF NOT EXISTS member_preferences (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE UNIQUE,
      preferences JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS applicant_otps (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      job_title TEXT,
      visitor_id TEXT,
      email TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'bot',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS phone_otps (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 为已存在的表补充新列（幂等）
  await pool.query(`
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_url TEXT DEFAULT '';
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS portfolio_files JSONB DEFAULT '[]';
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
  `);

  // 确保超级管理员账号始终存在且密码正确（每次冷启动同步）
  if (process.env.ADMIN_PASSWORD) {
    try {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      const id = genId('usr');
      const ts = now();
      await pool.query(
        `INSERT INTO admin_users (id, username, display_name, role, password_hash, created_at, updated_at)
         VALUES ($1, '18610292109', '江舟', 'superadmin', $2, $3, $3)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = $2, display_name = '江舟', role = 'superadmin', updated_at = $3`,
        [id, hash, ts]
      );
      console.log('[db] superadmin account synced');
    } catch (e) {
      console.error('[db] superadmin sync error:', e.message);
    }
  }
}

/* ===== 行映射：数据库 snake_case → JS camelCase ===== */
function mapJob(r) {
  if (!r) return null;
  return {
    id: r.id, title: r.title, category: r.category, status: r.status,
    description: r.description,
    requirements: r.requirements || [],
    deliverables: r.deliverables, fee: r.fee, feeType: r.fee_type,
    deadline: r.deadline ? String(r.deadline).slice(0, 10) : null,
    slots: r.slots, tags: r.tags || [], coverColor: r.cover_color,
    applicationCount: r.application_count,
    publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapApp(r) {
  if (!r) return null;
  return {
    id: r.id, jobId: r.job_id, jobTitle: r.job_title, jobCategory: r.job_category,
    name: r.name, email: r.email, phone: r.phone, wechat: r.wechat,
    bio: r.bio, portfolioNote: r.portfolio_note,
    portfolioLinks: r.portfolio_links || [],
    resumeUrl: r.resume_url || '',
    portfolioFiles: r.portfolio_files || [],
    status: r.status,
    statusHistory: r.status_history || [],
    adminNote: r.admin_note,
    submittedAt: r.submitted_at, updatedAt: r.updated_at,
  };
}

function mapCollab(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, email: r.email, phone: r.phone, wechat: r.wechat,
    categories: r.categories || [],
    bio: r.bio,
    portfolioLinks: r.portfolio_links || [],
    cooperationHistory: r.cooperation_history || [],
    rating: r.rating,
    internalTags: r.internal_tags || [],
    internalNote: r.internal_note,
    sourceAppId: r.source_app_id,
    addedAt: r.added_at, updatedAt: r.updated_at,
  };
}

/* ===== SEED 演示数据 ===== */
async function seedDemoData() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM jobs');
  if (parseInt(rows[0].count) > 0) return { skipped: true };

  const ts = now();

  const demoJobs = [
    {
      title: '城市切面专题摄影师',
      category: 'photography', status: 'open',
      description: '我们正在筹备2026春季刊「城市切面」专题，寻找有独特视角的城市人文摄影师，与编辑团队共同完成一组深度城市影像叙事。\n\n拍摄主题围绕"城市里正在消失的日常"展开，期待摄影师能够提供真实、有温度、有叙事感的影像，而非单纯的美学图片。',
      requirements: ['具备商业或杂志摄影经验，有完整作品集', '熟悉城市人文类拍摄，有自己的视角和风格', '能独立完成后期精修，熟悉Lightroom/PS', '沟通顺畅，能配合编辑方向调整'],
      deliverables: '15张精修JPG图 + RAW源文件，一周内交付',
      fee: '3000–6000', feeType: 'per_project',
      deadline: '2026-05-20', slots: 2,
      tags: ['摄影', '城市', '人文', '春季刊'], coverColor: '#E8DDD0',
    },
    {
      title: '生活方式专栏撰稿人',
      category: 'writing', status: 'open',
      description: '为夏季刊「慢活」专栏招募长期撰稿人，专栏聚焦当代年轻人如何在高密度城市生活中找到自己的节奏与仪式感。\n\n我们希望稿件有观点、有细节、有个人视角，不要"鸡汤"，不要流水账。',
      requirements: ['有媒体或自媒体写作经验，文字有质感', '了解当代生活方式内容趋势', '能长期稳定供稿，按时交稿'],
      deliverables: '每月2篇，每篇2000–3000字',
      fee: '800–1500', feeType: 'per_word',
      deadline: '2026-05-31', slots: 3,
      tags: ['撰稿', '生活方式', '长期合作', '夏季刊'], coverColor: '#D0DDE8',
    },
    {
      title: '品牌六周年书展活动策划',
      category: 'planning', status: 'open',
      description: '品牌成立六周年，计划在6月举办一场小型读者书展活动，面向300人以内的受邀读者群体。活动强调品牌调性，追求质感与话题性。\n\n需要策划方提交完整方案，包括活动主题、空间设计方向、嘉宾环节策划，以及执行跟进。',
      requirements: ['有文化、艺术或品牌活动策划执行经验', '熟悉小众文化品牌的调性与受众', '能独立完成从方案到执行的全流程'],
      deliverables: '完整活动方案PPT + 执行跟进到活动结束',
      fee: '面议', feeType: 'negotiable',
      deadline: '2026-04-30', slots: 1,
      tags: ['策划', '活动', '书展', '品牌'], coverColor: '#D8E8D0',
    },
    {
      title: '专题报道采访记者',
      category: 'interview', status: 'open',
      description: '秋季刊「手工的回潮」专题，需要2位采访记者完成共6组人物采访，对象包括独立手工品牌创始人、数字工匠、手工教育从业者等。',
      requirements: ['有杂志/深度报道采访经验', '能独立完成从联系采访对象到完稿的全流程', '对手工、创作类话题有真实兴趣'],
      deliverables: '每组采访2000字成稿，含受访者确认',
      fee: '1200–2000', feeType: 'per_project',
      deadline: '2026-06-15', slots: 2,
      tags: ['采访', '人物', '秋季刊', '手工'], coverColor: '#E8E0D0',
    },
    {
      title: '内容编辑（季刊兼职）',
      category: 'editing', status: 'draft',
      description: '招募兼职内容编辑，协助主编进行稿件审读、结构调整和文字润色。每季度参与1-2个专题。',
      requirements: ['有出版、媒体或内容平台编辑经验', '能准确把握品牌文字风格'],
      deliverables: '每季度协助完成4-6篇稿件的编辑工作',
      fee: '200–400', feeType: 'per_word',
      deadline: '2026-05-10', slots: 1,
      tags: ['编辑', '长期合作', '季刊'], coverColor: '#D8D0E8',
    },
  ];

  const insertedJobs = [];
  for (const j of demoJobs) {
    const id = genId('job');
    await pool.query(
      `INSERT INTO jobs (id,title,category,status,description,requirements,deliverables,
        fee,fee_type,deadline,slots,tags,cover_color,application_count,published_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, j.title, j.category, j.status, j.description,
       JSON.stringify(j.requirements), j.deliverables,
       j.fee, j.feeType, j.deadline, j.slots, JSON.stringify(j.tags), j.coverColor,
       0, j.status === 'open' ? ts : null, ts, ts]
    );
    insertedJobs.push({ id, ...j });
  }

  const openJobs = insertedJobs.filter(j => j.status === 'open');
  if (openJobs.length >= 2) {
    const demoApps = [
      { jobId: openJobs[0].id, name: '李明远', email: 'liming@example.com', phone: '13812345678',
        wechat: 'liming_photo', bio: '专注城市纪实摄影7年，曾与多家媒体和品牌合作，作品曾入选上海摄影节。',
        portfolioLinks: [{ label: 'Behance主页', url: 'https://behance.net/example' }], status: 'read' },
      { jobId: openJobs[0].id, name: '陈晓雨', email: 'chenxiaoyu@example.com', phone: '13987654321',
        wechat: 'cxy_photo', bio: '自由摄影师，主攻商业和杂志摄影，有完整后期流程。',
        portfolioLinks: [{ label: 'Instagram', url: 'https://instagram.com/example' }], status: 'pending' },
      { jobId: openJobs[1].id, name: '王思远', email: 'wangsiyuan@example.com', phone: '13600000001',
        wechat: '', bio: '曾在《生活周刊》担任生活方式栏目编辑3年，现为独立撰稿人。',
        portfolioLinks: [{ label: '公众号文章集', url: 'https://mp.weixin.qq.com/example' }], status: 'pending' },
    ];

    for (const a of demoApps) {
      const job = insertedJobs.find(j => j.id === a.jobId);
      const id = genId('app');
      const history = JSON.stringify([{ from: null, to: 'pending', at: ts, note: '' }]);
      await pool.query(
        `INSERT INTO applications (id,job_id,job_title,job_category,name,email,phone,wechat,
          bio,portfolio_note,portfolio_links,status,status_history,admin_note,submitted_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, a.jobId, job?.title || '', job?.category || '',
         a.name, a.email, a.phone, a.wechat,
         a.bio, '', JSON.stringify(a.portfolioLinks),
         a.status, history, '', ts, ts]
      );
      if (job) {
        await pool.query(
          'UPDATE jobs SET application_count = application_count + 1, updated_at = $1 WHERE id = $2',
          [ts, a.jobId]
        );
      }
    }
  }

  return { seeded: true };
}

/* ===== 行映射：admin_users ===== */
function mapAdminUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    role: r.role, createdAt: r.created_at, updatedAt: r.updated_at,
    // password_hash 不对外暴露
  };
}

/* ===== admin_users CRUD ===== */
async function getAdminUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
  return rows[0] || null;
}
async function getAdminUserById(id) {
  const { rows } = await pool.query('SELECT * FROM admin_users WHERE id = $1', [id]);
  return rows[0] || null;
}
async function listAdminUsers() {
  const { rows } = await pool.query('SELECT * FROM admin_users ORDER BY created_at ASC');
  return rows.map(mapAdminUser);
}
async function createAdminUser({ username, displayName, role = 'member', passwordHash }) {
  const id = genId('usr');
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO admin_users (id, username, display_name, role, password_hash, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, username, displayName || username, role, passwordHash, ts, ts]
  );
  return mapAdminUser(rows[0]);
}
async function deleteAdminUser(id) {
  const { rowCount } = await pool.query('DELETE FROM admin_users WHERE id = $1', [id]);
  return rowCount > 0;
}
async function updateAdminUserPassword(id, passwordHash) {
  const ts = now();
  await pool.query(
    'UPDATE admin_users SET password_hash = $1, updated_at = $2 WHERE id = $3',
    [passwordHash, ts, id]
  );
}

/* ===== member_notes CRUD ===== */
async function getMemberNote(adminUserId, appId) {
  const { rows } = await pool.query(
    'SELECT note FROM member_notes WHERE admin_user_id = $1 AND app_id = $2',
    [adminUserId, appId]
  );
  return { note: rows[0]?.note || '' };
}
async function getAllMemberNotesByAppId(appId) {
  const { rows } = await pool.query(
    `SELECT mn.note, mn.updated_at, au.display_name, au.id as admin_user_id
     FROM member_notes mn
     JOIN admin_users au ON au.id = mn.admin_user_id
     WHERE mn.app_id = $1 AND mn.note != ''
     ORDER BY mn.updated_at DESC`,
    [appId]
  );
  return rows.map(r => ({
    adminUserId: r.admin_user_id,
    displayName: r.display_name,
    note: r.note,
    updatedAt: r.updated_at,
  }));
}
async function upsertMemberNote(adminUserId, appId, note) {
  const id = genId('note');
  const ts = now();
  await pool.query(
    `INSERT INTO member_notes (id, admin_user_id, app_id, note, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (admin_user_id, app_id) DO UPDATE SET note = $4, updated_at = $5`,
    [id, adminUserId, appId, note, ts]
  );
}

/* ===== member_preferences CRUD ===== */
async function getMemberPreferences(adminUserId) {
  const { rows } = await pool.query(
    'SELECT preferences FROM member_preferences WHERE admin_user_id = $1',
    [adminUserId]
  );
  return rows[0]?.preferences || {};
}
async function upsertMemberPreferences(adminUserId, preferences) {
  const id = genId('pref');
  const ts = now();
  await pool.query(
    `INSERT INTO member_preferences (id, admin_user_id, preferences, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (admin_user_id) DO UPDATE SET preferences = $3, updated_at = $4`,
    [id, adminUserId, JSON.stringify(preferences), ts]
  );
}

/* ===== chat_sessions + chat_messages ===== */
function mapSession(r) {
  if (!r) return null;
  return { id: r.id, jobId: r.job_id, jobTitle: r.job_title, visitorId: r.visitor_id,
    email: r.email, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}
function mapMessage(r) {
  if (!r) return null;
  return { id: r.id, sessionId: r.session_id, role: r.role, content: r.content, createdAt: r.created_at };
}
async function createChatSession({ jobId, jobTitle, visitorId, email = '' }) {
  const id = genId('cs');
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO chat_sessions (id, job_id, job_title, visitor_id, email, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'bot',$6,$6) RETURNING *`,
    [id, jobId || null, jobTitle || '', visitorId || '', email, ts]
  );
  return mapSession(rows[0]);
}
async function getChatSession(id) {
  const { rows } = await pool.query('SELECT * FROM chat_sessions WHERE id = $1', [id]);
  return rows[0] ? mapSession(rows[0]) : null;
}
async function listChatSessions({ status } = {}) {
  let q = 'SELECT * FROM chat_sessions WHERE 1=1';
  const params = [];
  if (status && status !== 'all') { params.push(status); q += ` AND status = $${params.length}`; }
  q += ' ORDER BY updated_at DESC';
  const { rows } = await pool.query(q, params);
  return rows.map(mapSession);
}
async function updateChatSessionStatus(id, status) {
  const ts = now();
  await pool.query('UPDATE chat_sessions SET status=$1, updated_at=$2 WHERE id=$3', [status, ts, id]);
}
async function addChatMessage({ sessionId, role, content }) {
  const id = genId('cm');
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, sessionId, role, content, ts]
  );
  await pool.query('UPDATE chat_sessions SET updated_at=$1 WHERE id=$2', [ts, sessionId]);
  return mapMessage(rows[0]);
}
async function getChatMessages(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM chat_messages WHERE session_id=$1 ORDER BY created_at ASC',
    [sessionId]
  );
  return rows.map(mapMessage);
}

/* ===== users ===== */
function mapUser(r) {
  if (!r) return null;
  return { id: r.id, phone: r.phone, name: r.name || '', email: r.email || '',
    createdAt: r.created_at, updatedAt: r.updated_at };
}
async function getUserByPhone(phone) {
  const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
  return rows[0] ? mapUser(rows[0]) : null;
}
async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}
async function createUser({ phone, name = '', email = '' }) {
  const id = genId('u');
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO users (id, phone, name, email, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
    [id, phone, name, email, ts]
  );
  return mapUser(rows[0]);
}
async function updateUser(id, { name, email }) {
  const ts = now();
  const sets = [];
  const params = [];
  if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
  if (email !== undefined) { params.push(email); sets.push(`email = $${params.length}`); }
  if (!sets.length) return getUserById(id);
  params.push(ts); sets.push(`updated_at = $${params.length}`);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return mapUser(rows[0]);
}

/* ===== phone_otps ===== */
async function createPhoneOtp(phone) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const id = genId('potp');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await pool.query('DELETE FROM phone_otps WHERE phone = $1 AND used = FALSE', [phone]);
  await pool.query(
    `INSERT INTO phone_otps (id, phone, code, expires_at, used, created_at)
     VALUES ($1,$2,$3,$4,FALSE,NOW())`,
    [id, phone, code, expiresAt]
  );
  return code;
}
async function verifyPhoneOtp(phone, code) {
  const { rows } = await pool.query(
    `SELECT * FROM phone_otps
     WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, code]
  );
  if (!rows[0]) return false;
  await pool.query('UPDATE phone_otps SET used = TRUE WHERE id = $1', [rows[0].id]);
  return true;
}

/* ===== applicant_otps ===== */
async function createOtp(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const id = genId('otp');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5分钟
  // 先删除该邮箱旧的未使用验证码
  await pool.query('DELETE FROM applicant_otps WHERE email = $1 AND used = FALSE', [email]);
  await pool.query(
    `INSERT INTO applicant_otps (id, email, code, expires_at, used, created_at)
     VALUES ($1, $2, $3, $4, FALSE, NOW())`,
    [id, email.toLowerCase().trim(), code, expiresAt]
  );
  return code;
}
async function verifyOtp(email, code) {
  const { rows } = await pool.query(
    `SELECT * FROM applicant_otps
     WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email.toLowerCase().trim(), code]
  );
  if (!rows[0]) return false;
  await pool.query('UPDATE applicant_otps SET used = TRUE WHERE id = $1', [rows[0].id]);
  return true;
}

/* ===== 懒初始化（serverless 冷启动安全）===== */
let _dbReady = false;
async function ensureDB() {
  if (_dbReady) return;
  await initDB();
  _dbReady = true;
}

module.exports = {
  pool, genId, now, initDB, ensureDB, seedDemoData,
  todayInShanghai, isPastDeadline, closeExpiredJobs,
  mapJob, mapApp, mapCollab, mapAdminUser,
  getAdminUserByUsername, getAdminUserById, listAdminUsers,
  createAdminUser, deleteAdminUser, updateAdminUserPassword,
  getMemberNote, upsertMemberNote,
  getMemberPreferences, upsertMemberPreferences,
  createOtp, verifyOtp,
  mapSession, mapMessage,
  createChatSession, getChatSession, listChatSessions,
  updateChatSessionStatus, addChatMessage, getChatMessages,
  mapUser, getUserByPhone, getUserById, createUser, updateUser,
  createPhoneOtp, verifyPhoneOtp,
  getAllMemberNotesByAppId,
};
