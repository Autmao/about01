/* ===== routes/chat.js — AI 聊天接口 ===== */

const express = require('express');
const router = express.Router();
const { pool, createChatSession, getChatSession, listChatSessions,
  updateChatSessionStatus, setChatSessionHumanPending, assignChatSession,
  markChatSessionRead, addChatMessage, getChatMessages, genId, now } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { sendHumanChatNotificationEmail } = require('../lib/mailer');

const AI_USER_MESSAGE_LIMIT = 3;
const AI_RETURN_NOTICE_LEGACY = '人工暂时搬砖中，AI助手继续服务。';
const AI_RETURN_NOTICE = '人工暂时搬砖中，招募助手继续服务。';
const AI_LIMIT_GUIDANCE = `本轮咨询的 3 条额度已经用完啦。

我先把本轮信息收束到这里。建议你根据上面的回复核对岗位要求、整理投递材料，再决定是否提交申请。`;

const FEE_TYPE_LABELS = {
  per_project: '按项目', per_word: '按字数',
  per_day: '按天', co_creation: '共创', negotiable: '面议',
};

function getDeepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  };
}

async function createAiReply({ systemPrompt, messages }) {
  const config = getDeepSeekConfig();
  if (!config) {
    const err = new Error('DEEPSEEK_API_KEY not set');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DeepSeek request failed: ${response.status} ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function aiErrorDetail(error) {
  const cause = error?.cause || {};
  return [
    error?.message,
    cause.code ? `code=${cause.code}` : '',
    cause.hostname ? `host=${cause.hostname}` : '',
    cause.address ? `address=${cause.address}` : '',
    cause.port ? `port=${cause.port}` : '',
    cause.syscall ? `syscall=${cause.syscall}` : '',
  ].filter(Boolean).join(' ');
}

function buildSystemPrompt(job) {
  const reqs = (job.requirements || []).join('\n- ');
  const feeType = FEE_TYPE_LABELS[job.fee_type] || job.fee_type || '';
  return `你是 about编辑部招募助手。用户正在咨询 about编辑部的岗位相关问题，请保持简洁、友好，用中文回答。

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
4. 如果用户询问“我是否适合/作品够不够/能不能投”，先用岗位要求给出自查清单和建议，不要直接升级人工。
5. 如果岗位信息没有明确写，先说明“当前岗位信息里没有明确写”，再给出基于已知信息的投递建议；不要因为信息缺失就升级。
6. 回答格式必须清晰自然：用两到四个短段落回答，每段之间空一行；不要固定用“结论：”“依据：”“下一步：”开头。
7. 不要在正文中主动提示用户转人工、找工作人员、加微信、电话或邮件联系。
8. 只有在问题确实涉及特殊审批（延期、错过截止、单独联系、合同/付款/版权的个人具体确认），或用户明确要求真人/工作人员回复时，才在回复正文末尾另起一行，单独输出标记：[NEED_HUMAN]。
9. 如果触发上面的确认场景，正文只说“这个点需要进一步确认”，不要解释后台流转方式。
10. 不要使用 Markdown 符号；不要用星号、短横线、长横线、加粗符号或项目符号。需要分点时，用自然短句或中文序号。
11. 用户本轮最多只能向招募助手连续提问 3 条，请尽量在当前回复中完整解答，不要引导用户反复追问。
12. 标记只用于系统识别，不要解释这个标记。`;
}

function buildSystemPromptGeneral() {
  return `你是 about编辑部招募助手。用户正在 about编辑部招募页咨询问题，请保持简洁、友好，用中文回答。

about编辑部是小红书于2021年创立的内容品牌，延续 "Inspire Lives" 理念，关注人们生活的方式。编辑部通过纸质出版物、播客、线下活动、联合创意项目等形式展开创作，长期寻找各领域创作者合作。

规则：
1. 只回答与 about编辑部招募相关的问题。
2. 能确定回答的问题直接答；如果用户询问“是否适合/能不能投”，先给出自查清单和建议，不要直接升级人工。
3. 如果没有明确资料，先说明“当前招募信息里没有明确写”，再给出基于已知信息的投递建议；不要因为信息缺失就升级。
4. 回答格式必须清晰自然：用两到四个短段落回答，每段之间空一行；不要固定用“结论：”“依据：”“下一步：”开头。
5. 不要在正文中主动提示用户转人工、找工作人员、加微信、电话或邮件联系。
6. 只有在问题确实涉及特殊审批、单独联系、合同/付款/版权的个人具体确认，或用户明确要求真人/工作人员回复时，才在回复正文末尾另起一行，单独输出标记：[NEED_HUMAN]。
7. 如果触发上面的确认场景，正文只说“这个点需要进一步确认”，不要解释后台流转方式。
8. 不要使用 Markdown 符号；不要用星号、短横线、长横线、加粗符号或项目符号。需要分点时，用自然短句或中文序号。
9. 用户本轮最多只能向招募助手连续提问 3 条，请尽量在当前回复中完整解答。`;
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

async function getAdminForNotification(adminUserId) {
  if (adminUserId) {
    const { rows } = await pool.query(
      'SELECT id, username, display_name, notification_email FROM admin_users WHERE id = $1',
      [adminUserId]
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await pool.query(
    `SELECT id, username, display_name, notification_email
     FROM admin_users
     WHERE COALESCE(notification_email, '') <> ''
     ORDER BY CASE WHEN role = 'superadmin' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function getJobForChat(jobId) {
  if (!jobId) return null;
  const { rows } = await pool.query(
    `SELECT j.*, COALESCE(au.display_name, NULLIF(j.owner_admin_id, '')) AS owner_admin_name, au.username AS owner_admin_username
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
  const userText = content || '';
  const aiText = replyText || '';
  const text = `${userText}\n${aiText}`;
  const checks = [
    { re: /转人工|人工回复|真人|工作人员回复|联系.*(编辑部|负责人|工作人员)|加微信|电话沟通|邮件联系|拉群|有人.*回复/i, reason: '用户明确请求人工联系', target: userText },
    { re: /延期|延长|错过截止|截止.*过|补交|晚交|特殊申请|破例|单独沟通/i, reason: '涉及特殊时间或流程审批' },
    { re: /(我的|具体|这次|本次).*(合同|发票|版权|署名|付款|打款|结算|税|保密)|合同.*怎么签|什么时候.*打款|能否.*开发票/i, reason: '涉及合同、版权或结算的个人具体确认' },
    { re: /NEED_HUMAN|无法确认|不能确认|无法判断|不确定|需要(编辑部|工作人员|负责人).*确认|需要进一步确认/i, reason: 'AI 判断需要进一步确认', target: aiText },
  ];
  const feeIsUnclear = job && (!job.fee || job.fee_type === 'negotiable' || /面议|待定|协商/.test(job.fee));
  if (/转人工|人工|真人|工作人员/.test(userText) && /薪酬|稿费|预算|报价|费用|多少钱/.test(userText) && feeIsUnclear) {
    return { needHuman: true, reason: '薪酬需要人工确认' };
  }
  for (const item of checks) {
    if (item.re.test(item.target || text)) return { needHuman: true, reason: item.reason };
  }
  return { needHuman: false, reason: '' };
}

function cleanHumanMarker(text) {
  return String(text || '').replace(/\s*\[NEED_HUMAN\]\s*/gi, '').trim();
}

function tidyAssistantReply(text) {
  let value = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!value) return '';

  value = value
    .replace(/\*\*/g, '')
    .replace(/(^|\n)\s*[-*•—]+\s*/g, '$1')
    .replace(/^(结论|依据|下一步)[:：]\s*/g, '')
    .replace(/([。！？；])\s*(?=(建议|需要注意|你可以这样做|补充说明|如果|若|另外|同时)[:：])/g, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n');

  if (!value.includes('\n') && value.length > 120) {
    const sentences = value.match(/[^。！？]+[。！？]?/g) || [value];
    const groups = [];
    let current = '';
    for (const sentence of sentences) {
      const next = current ? current + sentence : sentence;
      if (current && next.length > 80) {
        groups.push(current);
        current = sentence;
      } else {
        current = next;
      }
    }
    if (current) groups.push(current);
    value = groups.join('\n\n');
  }

  return value.trim();
}

function withHumanNotice(reply) {
  const notice = '这个问题需要进一步确认。收到回复后，你可以继续补充。';
  if (!reply) return notice;
  if (/进一步确认|收到回复后/.test(reply)) return reply;
  return `${reply}\n\n${notice}`;
}

function withLimitNotice(reply) {
  const notice = `本轮咨询已达到 ${AI_USER_MESSAGE_LIMIT} 条，我先帮你把能确认的信息收束在这里。建议你根据上面的回复核对岗位要求、整理投递材料。`;
  if (!reply) return notice;
  return `${reply}\n\n${notice}`;
}

function publicMessage(message) {
  if (!message) return null;
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

function aiPhaseUserMessageCount(messages) {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'human_agent') break;
    if (message.role === 'assistant' && (message.content === AI_RETURN_NOTICE || message.content === AI_RETURN_NOTICE_LEGACY)) break;
    if (message.role === 'user') count += 1;
  }
  return count;
}

function chatUsagePayload(messages) {
  return {
    aiLimit: AI_USER_MESSAGE_LIMIT,
    aiUserCount: Math.min(aiPhaseUserMessageCount(messages || []), AI_USER_MESSAGE_LIMIT),
  };
}

function publicSession(session) {
  return {
    id: session.id,
    status: session.status,
    jobId: session.jobId,
    jobTitle: session.jobTitle,
  };
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return '';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

async function notifyHumanAssignee(req, sessionId, assignee, { reason = '', lastQuestion = '' } = {}) {
  const recipient = await getAdminForNotification(assignee.id);
  const session = await getChatSession(sessionId);
  const recipientEmail = recipient?.notification_email || '';
  const recipientName = adminName(recipient) || assignee.name || '';
  const baseUrl = getBaseUrl(req);
  const chatUrl = baseUrl ? `${baseUrl}/admin/chat.html?session=${encodeURIComponent(sessionId)}` : '';

  await pool.query(
    `INSERT INTO notifications
       (id, type, recipient_email, recipient_name, subject, body, related_job_id, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'unread',$8)`,
    [
      genId('ntf'),
      'chat_human',
      recipientEmail,
      recipientName,
      `有新的人工咨询需要处理｜${session?.jobTitle || '通用咨询'}`,
      JSON.stringify({ sessionId, reason, lastQuestion, chatUrl }),
      session?.jobId || null,
      now(),
    ]
  );

  await sendHumanChatNotificationEmail(recipientEmail, {
    jobTitle: session?.jobTitle || '通用咨询',
    assigneeName: recipientName,
    reason,
    lastQuestion,
    chatUrl,
  });
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
    res.json({
      sessionId: session.id,
      status: session.status,
      messages: messages.map(publicMessage),
      ...chatUsagePayload(messages),
    });
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
    res.json({
      session: publicSession(session),
      messages: messages.map(publicMessage),
      ...chatUsagePayload(messages),
    });
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
    const normalizedContent = content.trim();

    if (session.status === 'pending_human') {
      const messages = await getChatMessages(sessionId);
      return res.status(409).json({
        error: 'waiting_human',
        reply: '编辑部同事还没有回复，请稍等。对方回复后你可以继续发送。',
        status: 'pending_human',
        sessionId,
        ...chatUsagePayload(messages),
      });
    }

    const historyBeforeMessage = await getChatMessages(sessionId);
    const aiUserCountBefore = aiPhaseUserMessageCount(historyBeforeMessage);
    const inferredFromUser = inferHumanNeed(normalizedContent, '', null);
    if (session.status === 'bot' && aiUserCountBefore >= AI_USER_MESSAGE_LIMIT && !inferredFromUser.needHuman) {
      return res.status(409).json({
        error: 'ai_limit_reached',
        reply: AI_LIMIT_GUIDANCE,
        status: 'bot',
        sessionId,
        ...chatUsagePayload(historyBeforeMessage),
      });
    }

    // 存用户消息
    await addChatMessage({ sessionId, role: 'user', content: normalizedContent });

    if (session.status === 'human_active') {
      const assignee = await resolveAssignee(session);
      await setChatSessionHumanPending(sessionId, {
        assignedAdminId: assignee.id,
        assignedAdminName: assignee.name,
        reason: '用户追加消息，等待人工回复',
      });
      await notifyHumanAssignee(req, sessionId, assignee, {
        reason: '用户追加消息，等待人工回复',
        lastQuestion: normalizedContent,
      });
      const reply = '收到，我已同步你的补充信息。收到回复后，你可以继续补充。';
      await addChatMessage({ sessionId, role: 'assistant', content: reply });
      return res.json({
        reply,
        needHuman: true,
        status: 'pending_human',
        sessionId,
        ...chatUsagePayload(await getChatMessages(sessionId)),
      });
    }

    // 获取历史消息（最多20条，避免超 token）
    const history = await getChatMessages(sessionId);
    const aiUserCount = aiPhaseUserMessageCount(history);
    if (aiUserCount > AI_USER_MESSAGE_LIMIT) {
      const assignee = await resolveAssignee(session);
      const reason = inferredFromUser.reason || '用户在 AI 收束后触发进一步确认';
      await setChatSessionHumanPending(sessionId, {
        assignedAdminId: assignee.id,
        assignedAdminName: assignee.name,
        reason,
      });
      await notifyHumanAssignee(req, sessionId, assignee, {
        reason,
        lastQuestion: normalizedContent,
      });
      const reply = '这个问题需要进一步确认。我已帮你同步，收到回复后你可以继续补充。';
      await addChatMessage({ sessionId, role: 'assistant', content: reply });
      return res.json({
        reply,
        needHuman: true,
        status: 'pending_human',
        sessionId,
        ...chatUsagePayload(await getChatMessages(sessionId)),
      });
    }

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

    // 调用 DeepSeek
    let replyText = '';
    let aiUnavailable = false;

    try {
      replyText = await createAiReply({ systemPrompt, messages: aiMessages });
    } catch (err) {
      const config = getDeepSeekConfig();
      console.error('[chat] deepseek error:', aiErrorDetail(err), `base=${config?.baseUrl || 'unset'}`, `model=${config?.model || 'unset'}`);
      aiUnavailable = true;
    }
    if (!replyText) {
      replyText = aiUnavailable
        ? '招募助手暂时没有连接成功，请稍后再试。'
        : '这个问题需要编辑部同事确认后回复。';
    }

    // 检测是否需要人工介入。AI 暂不可用时，只有用户明确要求人工才转后台。
    const inferred = aiUnavailable
      ? inferHumanNeed(normalizedContent, '', chatJob)
      : inferHumanNeed(normalizedContent, replyText, chatJob);
    const reachedAiLimit = aiUserCount >= AI_USER_MESSAGE_LIMIT;
    const needHuman = inferred.needHuman;
    let cleanReply = tidyAssistantReply(cleanHumanMarker(replyText));

    if (needHuman) {
      const assignee = await resolveAssignee(session);
      const reason = inferred.reason;
      await setChatSessionHumanPending(sessionId, {
        assignedAdminId: assignee.id,
        assignedAdminName: assignee.name,
        reason,
      });
      await notifyHumanAssignee(req, sessionId, assignee, {
        reason,
        lastQuestion: normalizedContent,
      });
      cleanReply = withHumanNotice(cleanReply);
    } else if (reachedAiLimit) {
      cleanReply = withLimitNotice(cleanReply);
    }

    // 存 AI 回复
    await addChatMessage({ sessionId, role: 'assistant', content: cleanReply });

    res.json({
      reply: cleanReply,
      needHuman,
      status: needHuman ? 'pending_human' : 'bot',
      sessionId,
      ...chatUsagePayload(await getChatMessages(sessionId)),
    });
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

/* POST /api/chat/sessions/:id/return-to-ai */
router.post('/sessions/:id/return-to-ai', requireAdmin, async (req, res) => {
  try {
    const session = await getChatSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (req.adminUser.role !== 'superadmin' && session.assignedAdminId && session.assignedAdminId !== req.adminUser.id) {
      return res.status(403).json({ error: 'Only the assignee can return this chat to AI' });
    }

    const ts = now();
    const { rows } = await pool.query(
      `UPDATE chat_sessions
       SET status = 'bot',
           human_reason = '',
           unread_admin = FALSE,
           updated_at = $2
       WHERE id = $1
       RETURNING *`,
      [req.params.id, ts]
    );
    const message = await addChatMessage({
      sessionId: req.params.id,
      role: 'assistant',
      content: AI_RETURN_NOTICE,
    });
    res.json({ session: rows[0], message });
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
