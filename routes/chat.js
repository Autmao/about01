/* ===== routes/chat.js — AI 聊天接口 ===== */

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { pool, createChatSession, getChatSession, listChatSessions,
  updateChatSessionStatus, addChatMessage, getChatMessages } = require('../db');
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
2. 如果问题超出岗位信息范围、需要团队成员人工确认，在回复正文末尾另起一行，单独输出标记：[NEED_HUMAN]
3. 不要编造岗位信息中没有的内容。`;
}

function buildSystemPromptGeneral() {
  return `你是 about编辑部的招募助手。用户正在招募页咨询问题，请保持简洁、友好，用中文回答。

about编辑部是小红书于2021年创立的内容品牌，延续 "Inspire Lives" 理念，关注人们生活的方式。编辑部通过纸质出版物、播客、线下活动、联合创意项目等形式展开创作，长期寻找各领域创作者合作。

规则：
1. 只回答与 about编辑部招募相关的问题。
2. 如果问题需要团队成员人工确认，在回复正文末尾另起一行，单独输出标记：[NEED_HUMAN]`;
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
        jobTitle: existing.rows[0].job_title, status: existing.rows[0].status };
    } else {
      // 读取岗位标题
      let jobTitle = '';
      if (jobId) {
        const { rows } = await pool.query('SELECT title FROM jobs WHERE id=$1', [jobId]);
        jobTitle = rows[0]?.title || '';
      }
      session = await createChatSession({ jobId, jobTitle, visitorId, email });
    }

    const messages = await getChatMessages(session.id);
    res.json({ sessionId: session.id, messages });
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

    // 获取历史消息（最多20条，避免超 token）
    const history = await getChatMessages(sessionId);
    const recent = history.slice(-20);

    // 构建 AI messages（只含 user/assistant，去掉 human_agent）
    const aiMessages = recent
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    // 构建 system prompt
    let systemPrompt;
    if (session.jobId) {
      const { rows } = await pool.query('SELECT * FROM jobs WHERE id=$1', [session.jobId]);
      systemPrompt = rows[0] ? buildSystemPrompt(rows[0]) : buildSystemPromptGeneral();
    } else {
      systemPrompt = buildSystemPromptGeneral();
    }

    // 调用 Claude
    const client = getClient();
    let replyText = '抱歉，AI 助手暂时不可用，请稍后再试或联系编辑部。';

    if (client) {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: aiMessages,
      });
      replyText = response.content[0]?.text || replyText;
    }

    // 检测是否需要人工介入
    const needHuman = /\[NEED_HUMAN\]/i.test(replyText);
    const cleanReply = replyText.replace(/\s*\[NEED_HUMAN\]\s*/gi, '').trim();

    if (needHuman && session.status === 'bot') {
      await updateChatSessionStatus(sessionId, 'pending_human');
    }

    // 存 AI 回复
    await addChatMessage({ sessionId, role: 'assistant', content: cleanReply });

    res.json({ reply: cleanReply, needHuman, sessionId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── 管理员接口 ────────────────────────────────── */

/* GET /api/chat/sessions */
router.get('/sessions', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const sessions = await listChatSessions({ status });

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
    const messages = await getChatMessages(req.params.id);
    res.json({ session, messages });
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
    const msg = await addChatMessage({ sessionId: req.params.id, role: 'human_agent', content: content.trim() });
    await updateChatSessionStatus(req.params.id, 'resolved');
    res.json({ message: msg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/chat/sessions/:id/status */
router.patch('/sessions/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['bot', 'pending_human', 'resolved'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    await updateChatSessionStatus(req.params.id, status);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
