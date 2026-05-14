/* ===== CHAT-WIDGET.JS — 前台聊天悬浮组件 ===== */
(function () {

  /* ── 状态 ── */
  let visitorId = localStorage.getItem('mgs_visitor_id');
  if (!visitorId) {
    visitorId = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    localStorage.setItem('mgs_visitor_id', visitorId);
  }

  const jobId = new URLSearchParams(location.search).get('id') || null;
  let sessionId = null;
  let isSending = false;
  let pollTimer = null;
  const renderedMessageIds = new Set();
  const pendingEchoes = [];

  /* ── 注入 HTML ── */
  const container = document.createElement('div');
  container.innerHTML = `
    <button class="chat-fab" id="chat-fab" aria-label="在线咨询" onclick="window.__openChatWidget()">
      💬
      <span class="chat-fab__badge" id="chat-fab-badge"></span>
    </button>
    <div class="chat-panel" id="chat-panel">
      <div class="chat-header">
        <div>
          <div class="chat-header__title">about编辑部 · 在线咨询</div>
          <div class="chat-header__sub" id="chat-header-sub">AI 助手为你解答岗位问题</div>
        </div>
        <button class="chat-header__close" onclick="window.__closeChatWidget()">×</button>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <textarea class="chat-input" id="chat-input" rows="1"
          placeholder="输入你的问题…（回车发送，Shift+回车换行）"></textarea>
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
        body: JSON.stringify({ jobId, visitorId }),
      });
      if (!res.ok) throw new Error('session init failed');
      const data = await res.json();
      sessionId = data.sessionId;
      updateHeader(data.status);

      // 恢复历史消息
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => renderStoredMessage(m));
      } else {
        // 欢迎语
        const welcome = jobId
          ? '你好！我是 about编辑部的 AI 助手，有关这个岗位的问题都可以问我。'
          : '你好！我是 about编辑部的 AI 助手，有任何招募相关的问题欢迎咨询。';
        renderMessage('assistant', welcome);
      }
      scrollToBottom();
    } catch (e) {
      renderMessage('assistant', '助手暂时无法连接，请稍后再试。');
    }
  }

  /* ── 发送消息 ── */
  window.__sendChatMessage = async function () {
    const content = inputEl.value.trim();
    if (!content || isSending) return;
    if (!sessionId) return;

    isSending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    renderMessage('user', content);
    rememberEcho('user', content);
    scrollToBottom();

    // 打字动画占位
    const typingEl = renderMessage('assistant', '正在思考…', true);
    scrollToBottom();

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content }),
      });
      if (!res.ok) throw new Error('message failed');
      const data = await res.json();

      // 替换打字动画为真实回复
      typingEl.textContent = data.reply;
      typingEl.classList.remove('chat-msg--typing');
      typingEl.classList.add('chat-msg--assistant');
      rememberEcho('assistant', data.reply);
      updateHeader(data.status);

      if (data.needHuman) {
        renderNotice('您的问题已通知编辑部，稍后会有团队成员回复。');
        startPolling();
      }
      scrollToBottom();
    } catch {
      typingEl.textContent = '发送失败，请稍后重试。';
      typingEl.classList.remove('chat-msg--typing');
      typingEl.classList.add('chat-msg--assistant');
      scrollToBottom();
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  };

  async function pollMessages() {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/chat/session/${sessionId}/messages?visitorId=${encodeURIComponent(visitorId)}`);
      if (!res.ok) return;
      const data = await res.json();
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
    pollTimer = setInterval(pollMessages, 8000);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function updateHeader(status) {
    if (status === 'pending_human') headerSub.textContent = '等待编辑部人工回复中…';
    else if (status === 'human_active') headerSub.textContent = '编辑部已介入，可继续沟通';
    else if (status === 'resolved') headerSub.textContent = '对话已解决，可继续提问';
    else headerSub.textContent = 'AI 助手为你解答岗位问题';
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
    el.textContent = content;
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
