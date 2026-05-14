/* ===== routes/chat.js — AI 聊天接口 ===== */

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { pool, createChatSession, getChatSession, listChatSessions,
  updateChatSessionStatus, setChatSessionHumanPending, assignChatSession,
  markChatSessionRead, addChatMessage, getChatMessages } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const FEE_TYPE_LABELS = {
  per_project: '按项目', per_word: '按字数',
  per_day: '按天', negotiable: '面议',
};

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function buildSystemPrompt(job) {
  const reqs = (job.requirements || []).join('\n- ');
  const feeType = FEE_TYPE_LABELS[job.fee_type] || job.fee_type || '';
  return `你是 about编辑部的招募助手。用户正在咨询岗位相关问题，请保持简洁、友好，用中文回答。

当前咨询的岗位：「${job.title}」
岗位描述：${job.description || '暂无'}
具体要求：
- ${reqs || '暂无'}
薪酬：${job.fee || '面议'}（${feeType}）
交付物：${job.deliverables || '暂无'}
截止日期：${job.deadline || '暂无'}

规则：
1. 只回答与本岗位和 about编辑部投递流程相关的问题。
2. 能从岗位信息直接回答的问题，直接给出简洁答案，不要升级人工。
3. 不要编造岗位信息中没有的内容。
4. 如果问题涉及个人是否匹配、合同/版权/发票/付款细节、面试安排、延期、岗位负责人联系方式，或超出岗位信息范围、需要团队成员人工确认，在回复正文末尾另起一行，单独输出标记：[NEED_HUMAN]。
5. 标记只用于系统识别，不要解释这个标记。`;
}

function buildSystemPromptGeneral() {
  return `你是 about编辑部的招募助手。用户正在招募页咨询问题，请保持简洁、友好，用中文回答。

about编辑部是小红书于2021年创立的内容品牌，延续 "Inspire Lives" 理念，关注人们生活的方式。编辑部通过纸质出版物、播客、线下活动、联合创意项目等形式展开创作，长期寻找各领域创作者合作。

规则：
1. 只回答与 about编辑部招募相关的问题。
2. 能确定回答的问题直接答；如果问题涉及人工联系、个人匹配判断、具体岗位细节、合同/付款/时间安排，或需要团队成员人工确认，在回复正文末尾另起一行，单独输出标记：[NEED_HUMAN]。`;
}

function adminName(row) {
  return row?.display_name || row?.username || '';
}

async function getFallbackAdmin() {
  const { rows } = await pool.query(
    `SELECT id, display_name, username
     FROM admin_users
     ORDER BY CASE WHEN role = 'superadmin' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`
  );
  return rows[0] ? { id: rows[0].id, name: adminName(rows[0]) } : { id: '', name: '' };
}

async function getJobForChat(jobId) {
  if (!jobId) return null;
  const { rows } = await pool.query(
    `SELECT j.*, au.display_name AS owner_admin_name, au.username AS owner_admin_username
     FROM jobs j
     LEFT JOIN admin_users au ON au.id = j.owner_admin_id
     WHERE j.id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

async function resolveAssignee(session) {
  if (session.assignedAdminId) {
    return { id: session.assignedAdminId, name: session.assignedAdminName || '' };
  }
  const job = await getJobForChat(session.jobId);
  if (job?.owner_admin_id) {
    return {
      id: job.owner_admin_id,
      name: job.owner_admin_name || job.owner_admin_username || '',
    };
  }
  return getFallbackAdmin();
}

function inferHumanNeed(content, replyText, job) {
  const text = `${content || ''}\n${replyText || ''}`;
  const checks = [
    { re: /人工|真人|工作人员|编辑|负责.*人|联系|微信|电话|邮箱|加一下|拉群|沟通/i, reason: '用户请求人工联系' },
    { re: /合同|发票|版权|署名|付款|打款|结算|税|保密/i, reason: '涉及合同、版权或结算细节' },
    { re: /延期|延长|截止.*过|来得及|时间.*协调|面试|多久回复|进度|什么时候通知/i, reason: '涉及时间或流程确认' },
    { re: /我.*(可以|适合|能投|能不能|行吗)|作品.*(够|符合|可以吗)|简历.*(够|适合)/i, reason: '需要人工判断个人匹配度' },
    { re: /无法确认|需要.*确认|建议.*联系|请.*工作人员|NEED_HUMAN/i, reason: 'AI 判断需要人工确认' },
  ];
  const feeIsUnclear = job && (!job.fee || job.fee_type === 'negotiable' || /面议|待定|协商/.test(job.fee));
  if (/薪酬|稿费|预算|报价|费用|多少钱/.test(content || '') && feeIsUnclear) {
    return { needHuman: true, reason: '薪酬需要人工确认' };
  }
  for (const item of checks) {
    if (item.re.test(text)) return { needHuman: true, reason: item.reason };
  }
  return { needHuman: false, reason: '' };
}

function cleanHumanMarker(text) {
  return String(text || '').replace(/\s*\[NEED_HUMAN\]\s*/gi, '').trim();
}

function withHumanNotice(reply, assigneeName) {
  const notice = assigneeName
    ? `我已把这个问题同步给负责同事${assigneeName}，稍后会由编辑部人工补充回复。`
    : '我已把这个问题同步给编辑部，稍后会由团队成员人工补充回复。';
  if (!reply) return notice;
  if (/同步给|人工|编辑部.*回复|工作人员/.test(reply)) return reply;
  return `${reply}\n\n${notice}`;
}

function publicSession(session) {
  return {
    id: session.id,
    status: session.status,
    jobId: session.jobId,
    jobTitle: session.jobTitle,
  };
}

/* ─── 公开接口 ─────────────────────────────────── */

/* POST /api/chat/session */
router.post('/session', async (req, res) => {
  try {
    const { jobId, visitorId, email = '' } = req.body;
    if (!visitorId) return res.status(400).json({ error: 'visitorId required' });

    // 复用当天同一 visitorId + jobId 未关闭的 session
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const existing = await pool.query(
      `SELECT * FROM chat_sessions
       WHERE visitor_id = $1
         AND (job_id = $2 OR ($2::text IS NULL AND job_id IS NULL))
         AND status != 'resolved'
         AND created_at > $3
       ORDER BY created_at DESC LIMIT 1`,
      [visitorId, jobId || null, cutoff]
    );

    let session;
    if (existing.rows[0]) {
      session = { id: existing.rows[0].id, jobId: existing.rows[0].job_id,
        jobTitle: existing.rows[0].job_title, status: existing.rows[0].status,
        assignedAdminId: existing.rows[0].assigned_admin_id || '',
        assignedAdminName: existing.rows[0].assigned_admin_name || '' };
    } else {
      // 读取岗位标题与发布人，用于后续人工介入分配
      let jobTitle = '';
      let assignedAdminId = '';
      let assignedAdminName = '';
      if (jobId) {
        const job = await getJobForChat(jobId);
        jobTitle = job?.title || '';
        assignedAdminId = job?.owner_admin_id || '';
        assignedAdminName = job?.owner_admin_name || job?.owner_admin_username || '';
      }
      if (!assignedAdminId) {
        const fallback = await getFallbackAdmin();
        assignedAdminId = fallback.id;
        assignedAdminName = fallback.name;
      }
      session = await createChatSession({ jobId, jobTitle, visitorId, email, assignedAdminId, assignedAdminName });
    }

    const messages = await getChatMessages(session.id);
    res.json({ sessionId: session.id, status: session.status, messages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/chat/session/:id/messages */
router.get('/session/:id/messages', async (req, res) => {
  try {
    const session = await getChatSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (req.query.visitorId && req.query.visitorId !== session.visitorId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const messages = await getChatMessages(req.params.id);
    res.json({ session: publicSession(session), messages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/chat/message */
router.post('/message', async (req, res) => {
  try {
    const { sessionId, content } = req.body;
    if (!sessionId || !content?.trim()) return res.status(400).json({ error: 'sessionId and content required' });

    const session = await getChatSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // 存用户消息
    await addChatMessage({ sessionId, role: 'user', content: content.trim() });

    if (session.status === 'pending_human' || session.status === 'human_active') {
      const assignee = await resolveAssignee(session);
      await setChatSessionHumanPending(sessionId, {
        assignedAdminId: assignee.id,
        assignedAdminName: assignee.name,
        reason: '用户追加消息，等待人工回复',
      });
      const reply = assignee.name
        ? `收到，我已把新消息同步给负责同事${assignee.name}，请稍等人工回复。`
        : '收到，我已把新消息同步给编辑部，请稍等人工回复。';
      await addChatMessage({ sessionId, role: 'assistant', content: reply });
      return res.json({ reply, needHuman: true, status: 'pending_human', sessionId });
    }

    // 获取历史消息（最多20条，避免超 token）
    const history = await getChatMessages(sessionId);
    const recent = history.slice(-20);

    // 构建 AI messages（人工回复按 assistant 角色纳入上下文）
    const aiMessages = recent
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'human_agent')
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

    // 构建 system prompt
    let systemPrompt;
    let chatJob = null;
    if (session.jobId) {
      chatJob = await getJobForChat(session.jobId);
      systemPrompt = chatJob ? buildSystemPrompt(chatJob) : buildSystemPromptGeneral();
    } else {
      systemPrompt = buildSystemPromptGeneral();
    }

    // 调用 Claude
    const client = getClient();
    let replyText = '';
    let aiUnavailable = !client;

    if (client) {
      try {
        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: systemPrompt,
          messages: aiMessages,
        });
        replyText = response.content[0]?.text || '';
      } catch (err) {
        console.error('[chat] anthropic error:', err.message);
        aiUnavailable = true;
      }
    }
    if (!replyText) {
      replyText = '这个问题需要编辑部同事确认后回复。';
    }

    // 检测是否需要人工介入
    const inferred = inferHumanNeed(content, replyText, chatJob);
    const needHuman = aiUnavailable || inferred.needHuman;
    let cleanReply = cleanHumanMarker(replyText);

    if (needHuman) {
      const assignee = await resolveAssignee(session);
      await setChatSessionHumanPending(sessionId, {
        assignedAdminId: assignee.id,
        assignedAdminName: assignee.name,
        reason: aiUnavailable ? 'AI 暂不可用，转人工处理' : inferred.reason,
      });
      cleanReply = withHumanNotice(cleanReply, assignee.name);
    }

    // 存 AI 回复
    await addChatMessage({ sessionId, role: 'assistant', content: cleanReply });

    res.json({ reply: cleanReply, needHuman, status: needHuman ? 'pending_human' : 'bot', sessionId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── 管理员接口 ────────────────────────────────── */

/* GET /api/chat/sessions */
router.get('/sessions', requireAdmin, async (req, res) => {
  try {
    const { status, scope = 'mine', unread } = req.query;
    const sessions = await listChatSessions({
      status,
      assignedAdminId: scope === 'mine' ? req.adminUser.id : '',
      unread: unread === '1' || unread === 'true',
    });

    // 为每个 session 附加最后一条消息预览
    const result = await Promise.all(sessions.map(async s => {
      const { rows } = await pool.query(
        'SELECT content, role FROM chat_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1',
        [s.id]
      );
      return { ...s, lastMessage: rows[0]?.content?.slice(0, 80) || '', lastRole: rows[0]?.role || '' };
    }));

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/chat/sessions/:id/messages */
router.get('/sessions/:id/messages', requireAdmin, async (req, res) => {
  try {
    const session = await getChatSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (session.assignedAdminId === req.adminUser.id || (!session.assignedAdminId && req.adminUser.role === 'superadmin')) {
      await markChatSessionRead(req.params.id);
    }
    const refreshedSession = await getChatSession(req.params.id);
    const messages = await getChatMessages(req.params.id);
    res.json({ session: refreshedSession || session, messages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/chat/sessions/:id/reply */
router.post('/sessions/:id/reply', requireAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    const session = await getChatSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    const actorName = req.adminUser.displayName || req.adminUser.username || '';
    if (!session.assignedAdminId) {
      await assignChatSession(req.params.id, {
        assignedAdminId: req.adminUser.id,
        assignedAdminName: actorName,
      });
    }
    const msg = await addChatMessage({
      sessionId: req.params.id,
      role: 'human_agent',
      content: content.trim(),
      authorAdminId: req.adminUser.id,
      authorAdminName: actorName,
    });
    res.json({ message: msg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/chat/sessions/:id/assign */
router.patch('/sessions/:id/assign', requireAdmin, async (req, res) => {
  try {
    const { adminUserId } = req.body;
    if (!adminUserId) return res.status(400).json({ error: 'adminUserId required' });
    if (req.adminUser.role !== 'superadmin' && adminUserId !== req.adminUser.id) {
      return res.status(403).json({ error: 'Only superadmin can assign to other members' });
    }
    const { rows } = await pool.query('SELECT id, display_name, username FROM admin_users WHERE id = $1', [adminUserId]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'Admin user not found' });
    const session = await assignChatSession(req.params.id, {
      assignedAdminId: target.id,
      assignedAdminName: adminName(target),
    });
    res.json(session);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/chat/sessions/:id/status */
router.patch('/sessions/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['bot', 'pending_human', 'human_active', 'resolved'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    await updateChatSessionStatus(req.params.id, status);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
