/* ===== DB.JS — PostgreSQL (pg) 数据层 ===== */

const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// 阻止 pg 把 DATE 列自动转为 JS Date 对象（会引入 UTC 时差导致日期偏移一天）
// OID 1082 = DATE，直接返回原始字符串如 "2026-05-01"
types.setTypeParser(1082, val => val);

// 阿里云 SAE / 本地开发使用 DATABASE_URL；POSTGRES_URL 仅作为旧环境兼容。
const rawConnectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

function envFlag(name) {
  return String(process.env[name] || '').trim().toLowerCase();
}

function isSslDisabled() {
  const disabledValues = new Set(['false', '0', 'no', 'off', 'disable', 'disabled']);
  return disabledValues.has(envFlag('DB_SSL')) ||
    disabledValues.has(envFlag('DATABASE_SSL')) ||
    envFlag('PGSSLMODE') === 'disable';
}

function isSslEnabled() {
  const enabledValues = new Set(['true', '1', 'yes', 'on', 'require', 'prefer', 'verify-ca', 'verify-full']);
  return enabledValues.has(envFlag('DB_SSL')) ||
    enabledValues.has(envFlag('DATABASE_SSL')) ||
    enabledValues.has(envFlag('PGSSLMODE')) ||
    /sslmode=(require|prefer|verify-ca|verify-full)/i.test(rawConnectionString || '');
}

function normalizeConnectionString(connectionString) {
  if (!connectionString || !isSslDisabled()) return connectionString;

  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslcert');
    url.searchParams.delete('sslkey');
    url.searchParams.delete('sslrootcert');
    url.searchParams.set('sslmode', 'disable');
    return url.toString();
  } catch {
    return connectionString;
  }
}

const pool = new Pool({
  connectionString: normalizeConnectionString(rawConnectionString),
  ssl: isSslDisabled() ? false : (isSslEnabled() ? { rejectUnauthorized: false } : false),
  connectionTimeoutMillis: 8000,
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
      department TEXT DEFAULT '',
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
      owner_admin_id TEXT DEFAULT '',
      display_order BIGINT DEFAULT 0,
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
      notification_email TEXT DEFAULT '',
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
      assigned_admin_id TEXT DEFAULT '',
      assigned_admin_name TEXT DEFAULT '',
      human_reason TEXT DEFAULT '',
      unread_admin BOOLEAN NOT NULL DEFAULT FALSE,
      human_requested_at TIMESTAMPTZ,
      last_user_at TIMESTAMPTZ,
      last_human_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      author_admin_id TEXT DEFAULT '',
      author_admin_name TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS seed_runs (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 为已存在的表补充新列（幂等）
  await pool.query(`
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_url TEXT DEFAULT '';
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS portfolio_files JSONB DEFAULT '[]';
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS notification_email TEXT DEFAULT '';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS department TEXT DEFAULT '';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS owner_admin_id TEXT DEFAULT '';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS display_order BIGINT;
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS assigned_admin_id TEXT DEFAULT '';
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS assigned_admin_name TEXT DEFAULT '';
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS human_reason TEXT DEFAULT '';
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS unread_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS human_requested_at TIMESTAMPTZ;
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS last_user_at TIMESTAMPTZ;
    ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS last_human_at TIMESTAMPTZ;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS author_admin_id TEXT DEFAULT '';
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS author_admin_name TEXT DEFAULT '';
  `);

  await pool.query(`
    UPDATE jobs
    SET display_order = (-EXTRACT(EPOCH FROM created_at) * 1000)::BIGINT
    WHERE display_order IS NULL OR display_order = 0;
    ALTER TABLE jobs ALTER COLUMN display_order SET DEFAULT 0;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS admin_users_notification_email_unique
    ON admin_users (LOWER(notification_email))
    WHERE COALESCE(notification_email, '') <> '';

    CREATE INDEX IF NOT EXISTS jobs_status_created_at_idx
    ON jobs (status, created_at DESC);

    CREATE INDEX IF NOT EXISTS jobs_display_order_idx
    ON jobs (display_order ASC, created_at DESC);

    CREATE INDEX IF NOT EXISTS applications_submitted_at_idx
    ON applications (submitted_at DESC);

    CREATE INDEX IF NOT EXISTS applications_job_status_idx
    ON applications (job_id, status);

    CREATE INDEX IF NOT EXISTS applications_lower_email_idx
    ON applications (LOWER(email));
  `);

  // 确保超级管理员账号始终存在且密码正确（每次冷启动同步）
  if (process.env.ADMIN_PASSWORD) {
    try {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      const notificationEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
      const id = genId('usr');
      const ts = now();
      await pool.query(
        `INSERT INTO admin_users (id, username, display_name, notification_email, role, password_hash, created_at, updated_at)
         VALUES ($1, '18610292109', '江舟', $2, 'superadmin', $3, $4, $4)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = $3,
               display_name = '江舟',
               notification_email = CASE WHEN $2 <> '' THEN $2 ELSE admin_users.notification_email END,
               role = 'superadmin',
               updated_at = $4`,
        [id, notificationEmail, hash, ts]
      );
      console.log('[db] superadmin account synced');
    } catch (e) {
      console.error('[db] superadmin sync error:', e.message);
    }
  }

  try {
    const { rows: admins } = await pool.query(
      `SELECT id, display_name, username
       FROM admin_users
       ORDER BY CASE WHEN role = 'superadmin' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`
    );
    const fallback = admins[0];
    if (fallback) {
      const fallbackName = fallback.display_name || fallback.username || '';
      await pool.query(
        `UPDATE jobs
         SET owner_admin_id = $1
         WHERE owner_admin_id IS NULL OR owner_admin_id = ''`,
        [fallback.id]
      );
      await pool.query(
        `UPDATE chat_sessions
         SET assigned_admin_id = $1,
             assigned_admin_name = $2
         WHERE status IN ('pending_human', 'human_active')
           AND (assigned_admin_id IS NULL OR assigned_admin_id = '')`,
        [fallback.id, fallbackName]
      );
    }
  } catch (e) {
    console.error('[db] chat owner backfill error:', e.message);
  }

  try {
    await seedEditorialReserveJobs();
  } catch (e) {
    console.error('[db] editorial reserve jobs seed error:', e.message);
  }
}

/* ===== 行映射：数据库 snake_case → JS camelCase ===== */
function mapJob(r) {
  if (!r) return null;
  return {
    id: r.id, title: r.title, category: r.category, status: r.status,
    department: r.department || '',
    description: r.description,
    requirements: r.requirements || [],
    deliverables: r.deliverables, fee: r.fee, feeType: r.fee_type,
    deadline: r.deadline ? String(r.deadline).slice(0, 10) : null,
    slots: r.slots, tags: r.tags || [], coverColor: r.cover_color,
    displayOrder: r.display_order !== undefined && r.display_order !== null ? Number(r.display_order) : 0,
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
    const displayOrder = -Date.now() - insertedJobs.length;
    await pool.query(
      `INSERT INTO jobs (id,title,category,status,description,requirements,deliverables,
        fee,fee_type,deadline,slots,tags,cover_color,display_order,application_count,published_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, j.title, j.category, j.status, j.description,
       JSON.stringify(j.requirements), j.deliverables,
       j.fee, j.feeType, j.deadline, j.slots, JSON.stringify(j.tags), j.coverColor, displayOrder,
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

async function seedEditorialReserveJobs() {
  const seedKey = 'editorial_reserve_jobs_2026_05_18';
  const { rows: existingRuns } = await pool.query('SELECT key FROM seed_runs WHERE key = $1', [seedKey]);
  if (existingRuns[0]) return { skipped: true };

  const ownerNames = ['江舟', '毛毛', '宇野', '快银'];
  const { rows: owners } = await pool.query(
    `SELECT id, display_name, username
     FROM admin_users
     WHERE display_name = ANY($1) OR username = ANY($1)`,
    [ownerNames]
  );
  const ownerByName = new Map();
  for (const owner of owners) {
    if (owner.display_name) ownerByName.set(owner.display_name, owner.id);
    if (owner.username) ownerByName.set(owner.username, owner.id);
  }

  const ts = now();
  const jobs = [
    {
      id: 'job_about12_layout_design_2026',
      title: 'about12「手工再流行」书籍排版设计师',
      department: 'about出版物',
      category: 'design',
      ownerName: '江舟',
      description: [
        '参与 about12「手工再流行」杂志书的整体排版设计，与编辑、视觉和图片团队共同完成从版式方向到印前文件的完整设计工作。',
        '根据每篇稿件的内容气质、图片素材与栏目结构，建立清晰、有节奏的版面系统，让阅读在信息密度与留白之间保持舒展。',
        '围绕“手工再流行”这一主题，探索手作、材料、工具、工艺痕迹在纸面上的视觉表达，而不是简单套用模板。',
        '配合编辑部完成目录、卷首、专题页、人物专访、图文页、信息页等不同页面类型的设计延展。',
        '需要在既有 about 出版物气质之上，加入更具触感、更接近材料现场的细节处理，让整本书有统一但不僵硬的节奏。',
        '项目周期中需要多轮沟通与修订，能理解编辑意图，也能主动提出版式和阅读体验上的优化建议。',
      ],
      requirements: [
        '有书籍、杂志、画册、品牌出版物或长篇内容排版经验，熟悉纸质阅读的节奏与限制。',
        '能熟练使用 InDesign、Illustrator、Photoshop，了解印刷出血、网格、字号层级、图片精度、导出规范等基础流程。',
        '对日杂、独立出版物、文化类书籍设计有审美判断，不追求过度装饰，更重视内容气质和版面秩序。',
        '能够根据文字量和图片条件建立稳定版式系统，同时在重点页面做出适度变化。',
        '对字体、行距、留白、图片裁切和跨页关系敏感，能处理较复杂的图文混排。',
        '沟通清楚、交付稳定，能按阶段提交可讨论的设计稿，而不是最后一次性给出成稿。',
        '有印前经验、熟悉纸张或装帧工艺者优先。',
      ],
      deliverables: [
        '整本杂志书的排版设计文件与可审阅 PDF。',
        '关键页面的版式方向提案与样张。',
        '根据编辑部反馈完成多轮修改与终稿整理。',
        '可交付印厂的打包文件、字体/图片链接整理与印前 PDF。',
      ],
      fee: '面议',
      feeType: 'per_project',
      deadline: '2026-06-30',
      slots: 1,
      tags: ['about12', '手工再流行', '书籍设计', '排版设计'],
      displayOrder: -1779113000000,
    },
    {
      id: 'job_about12_interview_photographer_2026',
      title: 'about12「手工再流行」专访摄影师',
      department: 'about出版物',
      category: 'photo_video',
      ownerName: '毛毛',
      description: [
        '参与 about12「手工再流行」杂志书的内文专访拍摄，围绕手工艺人、创作者、品牌主理人或相关从业者完成具有现场感的人物影像。',
        '拍摄重点不只是人物肖像，也包括工作台、工具、材料、半成品、空间细节，以及能体现手作过程和生活状态的环境画面。',
        '需要与编辑共同理解采访对象的故事线，在有限时间内形成一组可用于杂志内文叙事的图片。',
        '影像风格希望自然、克制、真实，有观察感，避免过度摆拍和商业棚拍感。',
        '项目可能涉及多位受访者与不同城市/空间，需要根据每次采访条件灵活制定拍摄方案。',
        '后期需要保持出版物统一调性，色彩和颗粒感可以有个人风格，但不能牺牲内容辨识度。',
      ],
      requirements: [
        '有人物专访、纪实、人文、生活方式或杂志拍摄经验，并能提供完整作品集。',
        '能在自然光、工作室、店铺、家庭或手作空间等复杂环境中独立完成拍摄。',
        '理解采访拍摄的节奏，能够在不打断沟通的情况下捕捉人物状态和关键细节。',
        '对手工、材料、器物、生活方式内容有兴趣，能主动观察并提炼可拍摄的视觉线索。',
        '能完成基础选片、调色和精修，交付文件命名清晰、分类明确。',
        '沟通礼貌，现场协调能力好，能与受访者、编辑、造型或其他协作方配合。',
        '可接受外地短途拍摄或多点位拍摄者优先。',
      ],
      deliverables: [
        '每位受访者一组可用于杂志内文的精选成片。',
        '人物肖像、工作环境、工具材料、过程细节等不同类型图片。',
        '精修 JPG 与原始 RAW 文件。',
        '拍摄后按编辑部要求完成补选、补修和文件整理。',
      ],
      fee: '2000-5000元/组',
      feeType: 'per_project',
      deadline: '2026-06-25',
      slots: 2,
      tags: ['about12', '手工再流行', '专访摄影', '人物拍摄'],
      displayOrder: -1779112999000,
    },
    {
      id: 'job_hotwater_podcast_producer_2026',
      title: 'about热水频道播客制作人',
      department: 'about热水频道',
      category: 'podcast',
      ownerName: '宇野',
      description: [
        '参与 about热水频道播客内容的选题策划、主持沟通和单集制作，让频道保持清晰的内容方向和稳定的更新节奏。',
        '围绕生活方式、文化观察、创作现场、人物故事和当下议题，提出适合声音媒介展开的选题。',
        '根据选题完成资料搜集、嘉宾沟通、提纲撰写、录制流程设计和现场控场。',
        '需要理解 about 的编辑气质：轻松但不松散，有生活感，也有观点和结构。',
        '可参与主持或协助主持，根据单集内容判断对谈节奏、追问方向和信息密度。',
        '与剪辑、设计、运营协作，完成标题、shownotes、单集简介、重点摘录等上线素材。',
      ],
      requirements: [
        '有播客、音频节目、视频访谈、内容策划或媒体采编经验。',
        '对声音内容有判断，知道什么话题适合聊、怎么聊，以及一集节目怎样从开头走到结尾。',
        '具备资料搜集和提纲写作能力，能把松散想法整理成可录制的结构。',
        '有一定主持或采访意识，能倾听、追问、控制节奏，也能处理嘉宾临场表达。',
        '熟悉播客制作基本流程，了解录制、剪辑、审听、上线和分发的协作节点。',
        '文字能力好，能完成单集标题、简介、shownotes 和传播文案。',
        '对生活方式、青年文化、艺术出版、城市空间或创作职业有长期兴趣者优先。',
      ],
      deliverables: [
        '阶段性选题方案与单集策划案。',
        '录制提纲、嘉宾沟通信息与现场流程。',
        '单集成片制作跟进，包括审听意见和修改反馈。',
        '上线所需标题、简介、shownotes 与传播摘要。',
      ],
      fee: '面议',
      feeType: 'co_creation',
      deadline: '2026-06-20',
      slots: 1,
      tags: ['about热水频道', '播客', '选题策划', '主持制作'],
      displayOrder: -1779112998000,
    },
    {
      id: 'job_ccc_naturalist_event_planner_2026',
      title: '「博物学家的1㎡」线下活动策划执行',
      department: 'about/CCC',
      category: 'planning',
      ownerName: '快银',
      description: [
        '参与 about10《我也是博物学家》延展项目「博物学家的1㎡」全国 10 城线下活动策划与执行。',
        '项目希望把“博物学”从书页带到真实城市现场，让参与者在一平方米的观察范围里重新发现植物、昆虫、石头、气味、光线和日常环境。',
        '需要根据不同城市的空间条件，策划适合落地的活动形式，例如观察工作坊、城市漫游、小型展陈、共创记录、分享会或亲子参与环节。',
        '与编辑部、城市合作方、场地方、嘉宾和执行供应商协作，形成可复制但又能因地制宜的活动方案。',
        '活动整体气质需要轻巧、有知识感、有参与感，避免传统路演式流程，更接近一次城市里的共同观察。',
        '项目跨度较长，需要在多城执行中持续整理经验、优化流程和沉淀复盘。',
      ],
      requirements: [
        '有线下活动策划、展览公共项目、品牌活动、城市文化项目或工作坊执行经验。',
        '能独立完成活动方案、流程表、物料清单、人员分工、预算初表和执行排期。',
        '具备现场统筹能力，能处理嘉宾、场地、物料、报名、动线、安全和突发情况。',
        '对自然观察、博物学、城市漫游、亲子教育、公共文化或地方社区项目有兴趣。',
        '审美和文字能力在线，能把知识型内容转译成普通参与者愿意靠近的体验。',
        '沟通耐心，执行细致，能和不同城市的合作方保持稳定同步。',
        '可接受阶段性出差或远程协调多地项目者优先。',
      ],
      deliverables: [
        '全国 10 城活动的整体策划框架与单城落地方案。',
        '活动流程、执行排期、物料清单、人员分工和预算建议。',
        '现场执行统筹、活动复盘和下一站优化建议。',
        '配合完成活动介绍、报名页文案和现场记录素材整理。',
      ],
      fee: '面议',
      feeType: 'per_project',
      deadline: '2026-06-30',
      slots: 2,
      tags: ['about/CCC', '我也是博物学家', '博物学家的1㎡', '线下活动'],
      displayOrder: -1779112997000,
    },
  ];

  for (const job of jobs) {
    await pool.query(
      `INSERT INTO jobs (id,title,category,department,status,description,requirements,deliverables,
        fee,fee_type,deadline,slots,tags,cover_color,owner_admin_id,display_order,application_count,published_at,created_at,updated_at)
       SELECT $1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,NULL,$16,$16
       WHERE NOT EXISTS (
         SELECT 1 FROM jobs WHERE id = $1 OR title = $2
       )`,
      [
        job.id, job.title, job.category, job.department,
        job.description.join('\n'),
        JSON.stringify(job.requirements),
        job.deliverables.join('\n'),
        job.fee, job.feeType, job.deadline, job.slots,
        JSON.stringify(job.tags),
        departmentCoverColor(job.department),
        ownerByName.get(job.ownerName) || job.ownerName,
        job.displayOrder,
        ts,
      ]
    );
  }

  await pool.query(
    `INSERT INTO seed_runs (key, applied_at)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [seedKey, ts]
  );
  return { seeded: true };
}

function departmentCoverColor(department) {
  const map = {
    'about出版物': '#C9D4BE',
    'about热水频道': '#DDB37C',
    'about/CCC': '#B8C9DD',
  };
  return map[department] || '#E8DDD0';
}

/* ===== 行映射：admin_users ===== */
function mapAdminUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    notificationEmail: r.notification_email || '',
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
async function createAdminUser({ username, displayName, notificationEmail = '', role = 'member', passwordHash }) {
  const id = genId('usr');
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO admin_users (id, username, display_name, notification_email, role, password_hash, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, username, displayName || username, notificationEmail.toLowerCase().trim(), role, passwordHash, ts, ts]
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
async function updateAdminUserNotificationEmail(id, notificationEmail) {
  const ts = now();
  const { rows } = await pool.query(
    `UPDATE admin_users
     SET notification_email = $1, updated_at = $2
     WHERE id = $3
     RETURNING *`,
    [notificationEmail.toLowerCase().trim(), ts, id]
  );
  return rows[0] ? mapAdminUser(rows[0]) : null;
}
async function updateAdminUserRole(id, role) {
  const ts = now();
  const { rows } = await pool.query(
    `UPDATE admin_users
     SET role = $1, updated_at = $2
     WHERE id = $3
     RETURNING *`,
    [role, ts, id]
  );
  return rows[0] ? mapAdminUser(rows[0]) : null;
}

/* ===== member_notes CRUD ===== */
async function getMemberNote(adminUserId, appId) {
  const { rows } = await pool.query(
    'SELECT note, updated_at FROM member_notes WHERE admin_user_id = $1 AND app_id = $2',
    [adminUserId, appId]
  );
  return { note: rows[0]?.note || '', updatedAt: rows[0]?.updated_at || null };
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
    email: r.email, status: r.status,
    assignedAdminId: r.assigned_admin_id || '',
    assignedAdminName: r.assigned_admin_name || '',
    humanReason: r.human_reason || '',
    unreadAdmin: !!r.unread_admin,
    humanRequestedAt: r.human_requested_at,
    lastUserAt: r.last_user_at,
    lastHumanAt: r.last_human_at,
    createdAt: r.created_at, updatedAt: r.updated_at };
}
function mapMessage(r) {
  if (!r) return null;
  return { id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
    authorAdminId: r.author_admin_id || '',
    authorAdminName: r.author_admin_name || '',
    createdAt: r.created_at };
}
async function createChatSession({ jobId, jobTitle, visitorId, email = '', assignedAdminId = '', assignedAdminName = '' }) {
  const id = genId('cs');
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO chat_sessions
       (id, job_id, job_title, visitor_id, email, status, assigned_admin_id, assigned_admin_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'bot',$6,$7,$8,$8) RETURNING *`,
    [id, jobId || null, jobTitle || '', visitorId || '', email, assignedAdminId || '', assignedAdminName || '', ts]
  );
  return mapSession(rows[0]);
}
async function getChatSession(id) {
  const { rows } = await pool.query('SELECT * FROM chat_sessions WHERE id = $1', [id]);
  return rows[0] ? mapSession(rows[0]) : null;
}
async function listChatSessions({ status, assignedAdminId, unread } = {}) {
  let q = 'SELECT * FROM chat_sessions WHERE 1=1';
  const params = [];
  if (status && status !== 'all') { params.push(status); q += ` AND status = $${params.length}`; }
  if (assignedAdminId) {
    params.push(assignedAdminId);
    q += ` AND assigned_admin_id = $${params.length}`;
  }
  if (unread) q += ' AND unread_admin = TRUE';
  q += ' ORDER BY updated_at DESC';
  const { rows } = await pool.query(q, params);
  return rows.map(mapSession);
}
async function updateChatSessionStatus(id, status) {
  const ts = now();
  const clearUnread = status === 'resolved';
  await pool.query(
    `UPDATE chat_sessions
     SET status = $1,
         unread_admin = CASE WHEN $4::boolean THEN FALSE ELSE unread_admin END,
         updated_at = $2
     WHERE id = $3`,
    [status, ts, id, clearUnread]
  );
}
async function setChatSessionHumanPending(id, { assignedAdminId = '', assignedAdminName = '', reason = '' } = {}) {
  const ts = now();
  const { rows } = await pool.query(
    `UPDATE chat_sessions
     SET status = 'pending_human',
         assigned_admin_id = COALESCE(NULLIF($2, ''), assigned_admin_id, ''),
         assigned_admin_name = COALESCE(NULLIF($3, ''), assigned_admin_name, ''),
         human_reason = COALESCE(NULLIF($4, ''), human_reason, ''),
         unread_admin = TRUE,
         human_requested_at = COALESCE(human_requested_at, $5),
         updated_at = $5
     WHERE id = $1
     RETURNING *`,
    [id, assignedAdminId || '', assignedAdminName || '', reason || '', ts]
  );
  return mapSession(rows[0]);
}
async function assignChatSession(id, { assignedAdminId = '', assignedAdminName = '' } = {}) {
  const ts = now();
  const { rows } = await pool.query(
    `UPDATE chat_sessions
     SET assigned_admin_id = $2,
         assigned_admin_name = $3,
         unread_admin = TRUE,
         updated_at = $4
     WHERE id = $1
     RETURNING *`,
    [id, assignedAdminId || '', assignedAdminName || '', ts]
  );
  return mapSession(rows[0]);
}
async function markChatSessionRead(id) {
  await pool.query('UPDATE chat_sessions SET unread_admin = FALSE WHERE id = $1', [id]);
}
async function addChatMessage({ sessionId, role, content, authorAdminId = '', authorAdminName = '' }) {
  const id = genId('cm');
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO chat_messages
       (id, session_id, role, content, author_admin_id, author_admin_name, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, sessionId, role, content, authorAdminId || '', authorAdminName || '', ts]
  );
  if (role === 'user') {
    await pool.query(
      `UPDATE chat_sessions
       SET last_user_at = $1,
           unread_admin = CASE WHEN status IN ('pending_human', 'human_active') THEN TRUE ELSE unread_admin END,
           updated_at = $1
       WHERE id = $2`,
      [ts, sessionId]
    );
  } else if (role === 'human_agent') {
    await pool.query(
      `UPDATE chat_sessions
       SET status = 'human_active',
           last_human_at = $1,
           unread_admin = FALSE,
           updated_at = $1
       WHERE id = $2`,
      [ts, sessionId]
    );
  } else {
    await pool.query('UPDATE chat_sessions SET updated_at=$1 WHERE id=$2', [ts, sessionId]);
  }
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
  createAdminUser, deleteAdminUser, updateAdminUserPassword, updateAdminUserNotificationEmail,
  updateAdminUserRole,
  getMemberNote, upsertMemberNote,
  getMemberPreferences, upsertMemberPreferences,
  createOtp, verifyOtp,
  mapSession, mapMessage,
  createChatSession, getChatSession, listChatSessions,
  updateChatSessionStatus, setChatSessionHumanPending, assignChatSession,
  markChatSessionRead, addChatMessage, getChatMessages,
  mapUser, getUserByPhone, getUserById, createUser, updateUser,
  createPhoneOtp, verifyPhoneOtp,
  getAllMemberNotesByAppId,
};
