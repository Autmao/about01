/* ===== CHAT-WIDGET.JS — 前台聊天悬浮组件 ===== */
(function () {

  /* ── 状态 ── */
  let visitorId = localStorage.getItem('mgs_visitor_id');
  if (!visitorId) {
    visitorId = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    localStorage.setItem('mgs_visitor_id', visitorId);
  }

  const initialJobId = new URLSearchParams(location.search).get('id') || null;
  let selectedJobId = initialJobId;
  let sessionId = null;
  let isSending = false;
  let pollTimer = null;
  let currentStatus = 'bot';
  const renderedMessageIds = new Set();
  const pendingEchoes = [];
  const POLL_INTERVAL_MS = 2500;
  const AI_RETURN_NOTICE_LEGACY = '人工暂时搬砖中，AI助手继续服务。';
  const AI_RETURN_NOTICE = '人工暂时搬砖中，招募助手继续服务。';
  let aiLimit = 3;
  let aiUserCount = 0;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── 注入 HTML ── */
  const container = document.createElement('div');
  container.innerHTML = `
    <button class="chat-fab" id="chat-fab" aria-label="岗位咨询" onclick="window.__openChatWidget()">
      <span class="chat-fab__mark" aria-hidden="true"></span>
      <span class="chat-fab__badge" id="chat-fab-badge"></span>
    </button>
    <div class="chat-panel" id="chat-panel">
      <div class="chat-header">
        <div>
          <div class="chat-header__title">about编辑部招募助手</div>
          <div class="chat-header__sub" id="chat-header-sub">如有岗位相关疑问，欢迎咨询</div>
        </div>
        <button class="chat-header__close" onclick="window.__closeChatWidget()">×</button>
      </div>
      <label class="chat-topic">
        <span>咨询岗位</span>
        <select class="chat-topic__select" id="chat-job-select">
          <option value="">不指定岗位</option>
        </select>
      </label>
      <div class="chat-usage" id="chat-usage">
        <div class="chat-usage__bar" aria-hidden="true">
          <span id="chat-usage-fill"></span>
        </div>
        <div class="chat-usage__meta">
          <span id="chat-usage-count">本轮咨询 0/3</span>
          <span id="chat-usage-hint">请尽量一次说清楚，招募助手最多回复 3 条</span>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <textarea class="chat-input" id="chat-input" rows="1"
          placeholder="输入你的问题…..."></textarea>
        <button class="chat-send-btn" id="chat-send-btn" onclick="window.__sendChatMessage()" aria-label="发送">
          ↑
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const panel = document.getElementById('chat-panel');
  const messagesEl = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const headerSub = document.getElementById('chat-header-sub');
  const jobSelectEl = document.getElementById('chat-job-select');
  const usageEl = document.getElementById('chat-usage');
  const usageFillEl = document.getElementById('chat-usage-fill');
  const usageCountEl = document.getElementById('chat-usage-count');
  const usageHintEl = document.getElementById('chat-usage-hint');

  loadJobOptions();

  jobSelectEl.addEventListener('change', async () => {
    const nextJobId = jobSelectEl.value || null;
    if (nextJobId === selectedJobId) return;
    selectedJobId = nextJobId;
    sessionId = null;
    renderedMessageIds.clear();
    pendingEchoes.length = 0;
    messagesEl.innerHTML = '';
    setAiUsage(0);
    updateHeader('bot');
    stopPolling();
    if (panel.classList.contains('open')) {
      await initSession();
      startPolling();
    }
  });

  /* ── 回车发送 ── */
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.__sendChatMessage();
    }
  });
  // 自动扩展高度
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
  });

  /* ── 打开聊天面板 ── */
  window.__openChatWidget = async function () {
    panel.classList.add('open');
    document.getElementById('chat-fab-badge').classList.remove('visible');
    if (!sessionId) {
      await initSession();
    }
    startPolling();
    setTimeout(() => inputEl.focus(), 150);
  };

  window.__closeChatWidget = function () {
    panel.classList.remove('open');
    stopPolling();
  };

  // 供 job-detail 页内嵌按钮调用
  window.openChatWidget = window.__openChatWidget;

  async function initSession() {
    try {
      const res = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: selectedJobId, visitorId }),
      });
      if (!res.ok) throw new Error('session init failed');
      const data = await res.json();
      sessionId = data.sessionId;
      setAiUsage(data.aiUserCount ?? computeAiUserCount(data.messages || []), data.aiLimit);
      updateHeader(data.status);

      // 恢复历史消息
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => renderStoredMessage(m));
      } else {
        // 欢迎语
        const welcome = selectedJobId
          ? '你好，我是 about编辑部招募助手。\n\n本轮最多回复 3 条，请尽量把岗位职责、要求、投递方式等问题一次说清楚。\n\n我会优先根据公开招募信息帮你收束答案。'
          : '你好，我是 about编辑部招募助手。\n\n本轮最多回复 3 条，请尽量把岗位、投递流程、作品准备等问题一次说清楚。\n\n我会优先根据公开招募信息帮你收束答案。';
        renderMessage('assistant', welcome);
      }
      scrollToBottom();
    } catch (e) {
      renderMessage('assistant', '助手暂时不在线，请稍后再试。');
    }
  }

  /* ── 发送消息 ── */
  window.__sendChatMessage = async function () {
    const content = inputEl.value.trim();
    if (!content || isSending || currentStatus === 'pending_human') return;
    if (!sessionId) return;

    if (currentStatus === 'bot' && aiUserCount >= aiLimit && !shouldSubmitAfterLimit(content)) {
      inputEl.value = '';
      inputEl.style.height = 'auto';
      renderNotice('本轮咨询的 3 条额度已经用完。建议你根据上面的回复核对岗位要求、整理投递材料。');
      scrollToBottom();
      inputEl.focus();
      return;
    }

    isSending = true;
    updateComposerState();
    inputEl.value = '';
    inputEl.style.height = 'auto';

    renderMessage('user', content);
    rememberEcho('user', content);
    scrollToBottom();

    // 打字动画占位
    const typingEl = renderMessage('assistant', '正在思考…...', true);
    scrollToBottom();

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setMessageContent(typingEl, 'assistant', data.reply || '编辑部同事还没有回复，请稍等。');
        typingEl.classList.remove('chat-msg--typing');
        typingEl.classList.add('chat-msg--assistant');
        setAiUsage(data.aiUserCount, data.aiLimit);
        updateHeader(data.status || 'pending_human');
        startPolling();
        scrollToBottom();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessageContent(typingEl, 'assistant', data.reply || '这条消息暂时没有发出去，请稍后再试。');
        typingEl.classList.remove('chat-msg--typing');
        typingEl.classList.add('chat-msg--assistant');
        setAiUsage(data.aiUserCount, data.aiLimit);
        updateHeader(data.status || currentStatus);
        scrollToBottom();
        return;
      }
      const data = await res.json();

      // 替换打字动画为真实回复
      setMessageContent(typingEl, 'assistant', data.reply);
      typingEl.classList.remove('chat-msg--typing');
      typingEl.classList.add('chat-msg--assistant');
      rememberEcho('assistant', data.reply);
      setAiUsage(data.aiUserCount, data.aiLimit);
      updateHeader(data.status);

      if (data.needHuman) {
        renderNotice('这个问题需要进一步确认。收到回复后，你可以继续补充。');
        startPolling();
      }
      scrollToBottom();
    } catch {
      setMessageContent(typingEl, 'assistant', '网络有点不稳定，这条消息暂时没有送达。请稍后再试。');
      typingEl.classList.remove('chat-msg--typing');
      typingEl.classList.add('chat-msg--assistant');
      scrollToBottom();
    } finally {
      isSending = false;
      updateComposerState();
      inputEl.focus();
    }
  };

  async function pollMessages() {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/chat/session/${sessionId}/messages?visitorId=${encodeURIComponent(visitorId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setAiUsage(data.aiUserCount, data.aiLimit);
      updateHeader(data.session?.status);
      let added = false;
      (data.messages || []).forEach(m => {
        if (renderStoredMessage(m)) added = true;
      });
      if (added && !panel.classList.contains('open')) {
        document.getElementById('chat-fab-badge').classList.add('visible');
      }
      if (added) scrollToBottom();
    } catch {
      // 静默重试，避免打断咨询体验
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollMessages, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function updateHeader(status) {
    currentStatus = status || currentStatus || 'bot';
    if (currentStatus === 'pending_human') headerSub.textContent = '正在进一步确认';
    else if (currentStatus === 'human_active') headerSub.textContent = '可继续补充';
    else if (currentStatus === 'resolved') headerSub.textContent = '对话已解决，可以重新发起咨询';
    else if (aiUserCount >= aiLimit) headerSub.textContent = '招募助手已完成本轮回答';
    else headerSub.textContent = selectedJobId ? '招募助手服务中，可直接提问' : '招募助手服务中，欢迎咨询';
    updateComposerState();
  }

  function updateComposerState() {
    const waitingHuman = currentStatus === 'pending_human';
    inputEl.disabled = waitingHuman || isSending;
    sendBtn.disabled = waitingHuman || isSending;
    if (waitingHuman) {
      inputEl.placeholder = '正在进一步确认，收到回复后可继续发送';
    } else if (currentStatus === 'human_active') {
      inputEl.placeholder = '继续补充你的问题…...';
    } else if (aiUserCount >= aiLimit) {
      inputEl.placeholder = '本轮咨询已完成';
    } else {
      inputEl.placeholder = '输入你的问题…...';
    }
  }

  function setAiUsage(count, limit) {
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) aiLimit = Number(limit);
    const nextCount = Number.isFinite(Number(count)) ? Number(count) : aiUserCount;
    aiUserCount = Math.max(0, Math.min(nextCount, aiLimit));
    const ratio = aiLimit ? aiUserCount / aiLimit : 0;
    usageFillEl.style.width = `${Math.min(100, ratio * 100)}%`;
    usageCountEl.textContent = `本轮咨询 ${aiUserCount}/${aiLimit}`;
    usageHintEl.textContent = aiUserCount >= aiLimit
      ? '本轮咨询已完成'
      : `还可向招募助手咨询 ${Math.max(aiLimit - aiUserCount, 0)} 条`;
    usageEl.dataset.state = aiUserCount >= aiLimit ? 'limit' : 'active';
    updateComposerState();
  }

  function computeAiUserCount(messages) {
    let count = 0;
    for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'human_agent') break;
      if (message.role === 'assistant' && (message.content === AI_RETURN_NOTICE || message.content === AI_RETURN_NOTICE_LEGACY)) break;
      if (message.role === 'user') count += 1;
    }
    return Math.min(count, aiLimit);
  }

  function shouldSubmitAfterLimit(text) {
    return /转人工|人工|真人|工作人员|延期|延长|错过截止|截止.*过|补交|晚交|特殊申请|破例|单独沟通|加微信|电话沟通|邮件联系|拉群|合同|发票|版权|署名|付款|打款|结算|税|保密/i.test(text || '');
  }

  function formatChatText(role, content) {
    let text = String(content || '').replace(/\r\n/g, '\n').trim();
    if (role === 'assistant' && (text === AI_RETURN_NOTICE || text === AI_RETURN_NOTICE_LEGACY)) return '招募助手继续服务。';
    if (role !== 'assistant') return text;
    text = text
      .replace(/\*\*/g, '')
      .replace(/(^|\n)\s*[-*•—]+\s*/g, '$1')
      .replace(/^(结论|依据|下一步)[:：]\s*/g, '')
      .replace(/([。！？；])\s*(?=(建议|需要注意|你可以这样做|补充说明|如果|若|另外|同时)[:：])/g, '$1\n\n')
      .replace(/\n{3,}/g, '\n\n');
    return text;
  }

  function setMessageContent(el, role, content) {
    el.textContent = formatChatText(role, content);
  }

  async function loadJobOptions() {
    try {
      const res = await fetch('/api/jobs?status=open');
      if (!res.ok) throw new Error('jobs failed');
      const jobs = await res.json();
      const hasInitial = jobs.some(job => job.id === initialJobId);
      jobSelectEl.innerHTML = `
        <option value="">不指定岗位</option>
        ${!hasInitial && initialJobId ? `<option value="${escapeHtml(initialJobId)}">当前岗位</option>` : ''}
        ${(jobs || []).map(job => `<option value="${escapeHtml(job.id)}">${escapeHtml(job.title)}</option>`).join('')}
      `;
      jobSelectEl.value = selectedJobId || '';
      updateHeader('bot');
    } catch {
      jobSelectEl.innerHTML = `
        <option value="">不指定岗位</option>
        ${initialJobId ? `<option value="${escapeHtml(initialJobId)}">当前岗位</option>` : ''}
      `;
      jobSelectEl.value = selectedJobId || '';
    }
  }

  function rememberEcho(role, content) {
    pendingEchoes.push({ role, content, at: Date.now() });
    while (pendingEchoes.length > 12) pendingEchoes.shift();
  }

  function isPendingEcho(message) {
    const idx = pendingEchoes.findIndex(item =>
      item.role === message.role &&
      item.content === message.content &&
      Date.now() - item.at < 30000
    );
    if (idx === -1) return false;
    pendingEchoes.splice(idx, 1);
    return true;
  }

  function renderStoredMessage(message) {
    if (!message?.id || renderedMessageIds.has(message.id)) return false;
    renderedMessageIds.add(message.id);
    if (isPendingEcho(message)) return false;
    renderMessage(message.role, message.content);
    return true;
  }

  /* ── 渲染气泡 ── */
  function renderMessage(role, content, isTyping = false) {
    const el = document.createElement('div');
    el.className = 'chat-msg ' + (isTyping ? 'chat-msg--typing' : `chat-msg--${role}`);
    setMessageContent(el, role, content);
    messagesEl.appendChild(el);
    return el;
  }

  function renderNotice(text) {
    const el = document.createElement('div');
    el.className = 'chat-notice';
    el.textContent = text;
    messagesEl.appendChild(el);
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

})();
