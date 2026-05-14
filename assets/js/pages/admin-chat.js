/* ===== ADMIN-CHAT.JS ===== */

function checkAuth() {
  if (Store.isAdminLoggedIn()) return true;
  const from = `chat.html${window.location.search || ''}`;
  window.location.href = `login.html?from=${encodeURIComponent(from)}`;
  return false;
}
function logout() { Store.adminLogout(); window.location.href = 'login.html'; }
window.logout = logout;

function initSidebar() {
  const user = Store.getCurrentUser();
  if (!user) return;
  const el = document.getElementById('sidebar-user');
  if (el) el.textContent = `${user.displayName || user.username}${user.role === 'superadmin' ? ' · 管理员' : ''}`;
  const navLabel = document.getElementById('nav-accounts-label');
  if (navLabel) navLabel.textContent = user.role === 'superadmin' ? '账号管理' : '账号设置';
}

const STATUS_LABELS = {
  bot: 'AI 对话中',
  pending_human: '待介入',
  human_active: '人工跟进中',
  resolved: '已解决',
};
const STATUS_COLORS = {
  bot: '#E8F5E9:#2E7D32',
  pending_human: '#FFF8E1:#B8860B',
  human_active: '#E3F2FD:#1565C0',
  resolved: '#F0F0F0:#666',
};

let currentStatus = 'all';
let currentScope = 'mine';
let unreadOnly = false;
let currentSessionId = null;
let currentSession = null;
let allSessions = [];
let team = [];

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function statusStyle(status) {
  const [bg, color] = (STATUS_COLORS[status] || '#F5F5F5:#666').split(':');
  return `background:${bg};color:${color};`;
}

function sessionQuery() {
  const qs = new URLSearchParams();
  qs.set('scope', currentScope);
  if (unreadOnly) qs.set('unread', '1');
  return qs.toString();
}

async function loadTeam() {
  try {
    team = await Store.listAdminTeam();
  } catch {
    team = [];
  }
}

async function loadSessions(status = currentStatus) {
  currentStatus = status;
  try {
    const res = await fetch(`/api/chat/sessions?${sessionQuery()}`, {
      headers: { 'X-Admin-Token': sessionStorage.getItem('mgs_admin_token') },
    });
    if (!res.ok) throw new Error();
    const sessionsForCounts = await res.json();
    allSessions = status && status !== 'all'
      ? sessionsForCounts.filter(s => s.status === status)
      : sessionsForCounts;
    renderSessions(allSessions);
    updateCounts(sessionsForCounts);
  } catch {
    Utils.showToast('加载失败', 'error');
  }
}

function updateCounts(sessions) {
  document.getElementById('cnt-all').textContent = sessions.length;
  document.getElementById('cnt-pending').textContent = sessions.filter(s => s.status === 'pending_human').length;
  document.getElementById('cnt-human').textContent = sessions.filter(s => s.status === 'human_active').length;
  document.getElementById('cnt-resolved').textContent = sessions.filter(s => s.status === 'resolved').length;
  document.getElementById('cnt-bot').textContent = sessions.filter(s => s.status === 'bot').length;
}

function renderSessions(sessions) {
  const list = document.getElementById('sessions-list');
  const empty = document.getElementById('sessions-empty');
  if (!sessions.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = sessions.map(s => {
    const statusLabel = STATUS_LABELS[s.status] || s.status;
    const date = s.updatedAt ? s.updatedAt.slice(0, 16).replace('T', ' ') : '';
    const preview = s.lastMessage ? escHtml(s.lastMessage) : '<span style="color:var(--color-text-muted)">暂无消息</span>';
    const jobLabel = s.jobTitle ? escHtml(s.jobTitle) : '通用咨询';
    const assignee = s.assignedAdminName ? `负责人：${escHtml(s.assignedAdminName)}` : '负责人：未指定';
    const reason = s.humanReason ? ` · ${escHtml(s.humanReason)}` : '';
    const unread = s.unreadAdmin ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--color-rejected);display:inline-block;"></span>' : '';
    return `
    <div class="app-row" style="cursor:pointer;padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--color-border-light);"
      onclick="openSession('${escHtml(s.id)}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3);">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--color-text-primary);margin-bottom:2px;">
            ${unread}<span>${jobLabel}</span>
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:3px;">
            ${assignee}${reason}
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${preview}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--space-1);flex-shrink:0;">
          <span style="font-size:var(--text-xs);font-weight:var(--weight-medium);padding:2px 8px;border-radius:999px;${statusStyle(s.status)}">${statusLabel}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-muted);">${date}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function fillAssigneeSelect(session) {
  const select = document.getElementById('assign-select');
  const currentUser = Store.getCurrentUser();
  let options = Store.isSuperAdmin() ? team : team.filter(u => u.id === currentUser?.id);
  if (!options.length && currentUser) options = [currentUser];
  if (session.assignedAdminId && !options.some(u => u.id === session.assignedAdminId)) {
    options = [{ id: session.assignedAdminId, displayName: session.assignedAdminName || '当前负责人', username: '' }, ...options];
  }
  select.innerHTML = options.map(u => (
    `<option value="${escHtml(u.id)}">${escHtml(u.displayName || u.username || '未命名成员')}</option>`
  )).join('');
  select.value = session.assignedAdminId || currentUser?.id || '';
}

async function openSession(id) {
  currentSessionId = id;
  try {
    const res = await fetch(`/api/chat/sessions/${id}/messages`, {
      headers: { 'X-Admin-Token': sessionStorage.getItem('mgs_admin_token') },
    });
    if (!res.ok) throw new Error();
    const { session, messages } = await res.json();
    currentSession = session;

    document.getElementById('modal-job-title').textContent = session.jobTitle || '通用咨询';
    const meta = [
      session.email ? `邮箱：${session.email}` : null,
      `访客 ID：${session.visitorId || '-'}`,
      `创建：${(session.createdAt || '').slice(0, 16).replace('T', ' ')}`,
    ].filter(Boolean).join(' · ');
    document.getElementById('modal-meta').textContent = meta;

    const statusEl = document.getElementById('modal-status');
    statusEl.textContent = STATUS_LABELS[session.status] || session.status;
    statusEl.setAttribute('style', statusStyle(session.status));
    const reasonEl = document.getElementById('modal-reason');
    reasonEl.textContent = session.humanReason || '';
    reasonEl.style.display = session.humanReason ? 'inline-flex' : 'none';
    fillAssigneeSelect(session);

    const msgEl = document.getElementById('modal-messages');
    msgEl.innerHTML = messages.map(m => {
      const roleLabel = m.role === 'user'
        ? '访客'
        : m.role === 'human_agent'
          ? `编辑部${m.authorAdminName ? ` · ${escHtml(m.authorAdminName)}` : ''}`
          : 'AI';
      const [bg, color] = m.role === 'user'
        ? ['var(--color-brand)', 'white']
        : m.role === 'human_agent'
          ? ['#E3F2FD', '#1565C0']
          : ['var(--color-surface-warm)', 'var(--color-text-primary)'];
      const align = m.role === 'user' ? 'flex-end' : 'flex-start';
      return `
      <div style="display:flex;flex-direction:column;align-items:${align};gap:2px;">
        <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:1px;">${roleLabel}</div>
        <div style="max-width:85%;padding:var(--space-2) var(--space-3);border-radius:var(--radius-lg);
          font-size:var(--text-sm);line-height:var(--leading-normal);word-break:break-word;white-space:pre-wrap;
          background:${bg};color:${color};">${escHtml(m.content)}</div>
      </div>`;
    }).join('');
    msgEl.scrollTop = msgEl.scrollHeight;

    const replyArea = document.getElementById('reply-area');
    replyArea.style.display = session.status === 'resolved' ? 'none' : 'block';
    document.getElementById('reply-input').value = '';

    document.getElementById('chat-modal').style.display = 'flex';
    await loadSessions(currentStatus);
  } catch {
    Utils.showToast('加载对话失败', 'error');
  }
}

async function assignCurrentSession() {
  if (!currentSessionId) return;
  const adminUserId = document.getElementById('assign-select').value;
  try {
    const res = await fetch(`/api/chat/sessions/${currentSessionId}/assign`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': sessionStorage.getItem('mgs_admin_token'),
      },
      body: JSON.stringify({ adminUserId }),
    });
    if (!res.ok) throw new Error();
    Utils.showToast('负责人已更新', 'success');
    await openSession(currentSessionId);
  } catch {
    Utils.showToast('更新负责人失败', 'error');
  }
}
window.assignCurrentSession = assignCurrentSession;

async function sendReply() {
  const content = document.getElementById('reply-input').value.trim();
  if (!content || !currentSessionId) return;
  const btn = document.getElementById('reply-btn');
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    const res = await fetch(`/api/chat/sessions/${currentSessionId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': sessionStorage.getItem('mgs_admin_token'),
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error();
    Utils.showToast('回复已发送', 'success');
    await openSession(currentSessionId);
  } catch {
    Utils.showToast('发送失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '发送回复';
  }
}
window.sendReply = sendReply;

async function resolveSession() {
  if (!currentSessionId) return;
  try {
    const res = await fetch(`/api/chat/sessions/${currentSessionId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': sessionStorage.getItem('mgs_admin_token'),
      },
      body: JSON.stringify({ status: 'resolved' }),
    });
    if (!res.ok) throw new Error();
    Utils.showToast('已标记解决', 'success');
    closeModal();
    await loadSessions(currentStatus);
  } catch {
    Utils.showToast('操作失败', 'error');
  }
}
window.resolveSession = resolveSession;

function closeModal(e) {
  if (e && e.target !== document.getElementById('chat-modal')) return;
  document.getElementById('chat-modal').style.display = 'none';
  currentSessionId = null;
  currentSession = null;
}
window.closeModal = closeModal;
window.openSession = openSession;

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  initSidebar();
  await loadTeam();

  document.getElementById('status-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.status-tab');
    if (!tab) return;
    document.querySelectorAll('#status-tabs .status-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadSessions(tab.dataset.status);
  });

  document.getElementById('scope-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.status-tab');
    if (!tab) return;
    document.querySelectorAll('#scope-tabs .status-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentScope = tab.dataset.scope;
    loadSessions(currentStatus);
  });

  document.getElementById('unread-toggle').addEventListener('click', e => {
    unreadOnly = !unreadOnly;
    e.currentTarget.dataset.active = unreadOnly ? '1' : '0';
    e.currentTarget.textContent = unreadOnly ? '显示全部' : '只看未读';
    loadSessions(currentStatus);
  });

  await loadSessions('all');
  const targetSessionId = new URLSearchParams(window.location.search).get('session');
  if (targetSessionId) openSession(targetSessionId);
});
