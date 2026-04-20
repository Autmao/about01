/* ===== ADMIN-CHAT.JS ===== */

function checkAuth() {
  if (Store.isAdminLoggedIn()) return true;
  window.location.href = 'login.html';
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

const STATUS_LABELS = { bot: 'AI 对话中', pending_human: '待介入', resolved: '已解决' };
const STATUS_COLORS = { bot: '#E8F5E9:#2E7D32', pending_human: '#FFF8E1:#B8860B', resolved: '#E3F2FD:#1565C0' };

let currentStatus = 'all';
let currentSessionId = null;
let allSessions = [];

async function loadSessions(status = 'all') {
  currentStatus = status;
  try {
    const qs = status && status !== 'all' ? `?status=${status}` : '';
    const res = await fetch(`/api/chat/sessions${qs}`, {
      headers: { 'X-Admin-Token': sessionStorage.getItem('mgs_admin_token') }
    });
    if (!res.ok) throw new Error();
    allSessions = await res.json();
    renderSessions(allSessions);
    updateCounts();
  } catch {
    Utils.showToast('加载失败', 'error');
  }
}

function updateCounts() {
  const all = allSessions;
  document.getElementById('cnt-all').textContent = all.length;
  document.getElementById('cnt-pending').textContent = all.filter(s => s.status === 'pending_human').length;
  document.getElementById('cnt-resolved').textContent = all.filter(s => s.status === 'resolved').length;
  document.getElementById('cnt-bot').textContent = all.filter(s => s.status === 'bot').length;
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
    const [bg, color] = (STATUS_COLORS[s.status] || '#F5F5F5:#666').split(':');
    const statusLabel = STATUS_LABELS[s.status] || s.status;
    const date = s.updatedAt ? s.updatedAt.slice(0, 16).replace('T', ' ') : '';
    const preview = s.lastMessage ? escHtml(s.lastMessage) : '<span style="color:var(--color-text-muted)">暂无消息</span>';
    const jobLabel = s.jobTitle ? escHtml(s.jobTitle) : '通用咨询';
    return `
    <div class="app-row" style="cursor:pointer;padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--color-border-light);"
      onclick="openSession('${s.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--color-text-primary);margin-bottom:2px;">
            ${jobLabel}
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${preview}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--space-1);flex-shrink:0;">
          <span style="font-size:var(--text-xs);font-weight:var(--weight-medium);padding:2px 8px;border-radius:999px;background:${bg};color:${color};">${statusLabel}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-muted);">${date}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function openSession(id) {
  currentSessionId = id;
  try {
    const res = await fetch(`/api/chat/sessions/${id}/messages`, {
      headers: { 'X-Admin-Token': sessionStorage.getItem('mgs_admin_token') }
    });
    if (!res.ok) throw new Error();
    const { session, messages } = await res.json();

    document.getElementById('modal-job-title').textContent = session.jobTitle || '通用咨询';
    const meta = [
      session.email ? `邮箱：${session.email}` : null,
      `访客 ID：${session.visitorId || '-'}`,
      `创建：${(session.createdAt || '').slice(0, 16).replace('T', ' ')}`,
    ].filter(Boolean).join(' · ');
    document.getElementById('modal-meta').textContent = meta;

    const msgEl = document.getElementById('modal-messages');
    msgEl.innerHTML = messages.map(m => {
      const roleLabel = m.role === 'user' ? '访客' : m.role === 'human_agent' ? '编辑部' : 'AI';
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
          font-size:var(--text-sm);line-height:var(--leading-normal);word-break:break-word;
          background:${bg};color:${color};">${escHtml(m.content)}</div>
      </div>`;
    }).join('');
    msgEl.scrollTop = msgEl.scrollHeight;

    // 显示回复区（仅 pending_human）
    const replyArea = document.getElementById('reply-area');
    replyArea.style.display = session.status === 'pending_human' ? 'block' : 'none';
    document.getElementById('reply-input').value = '';

    document.getElementById('chat-modal').style.display = 'flex';
  } catch {
    Utils.showToast('加载对话失败', 'error');
  }
}

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
    closeModal();
    await loadSessions(currentStatus);
  } catch {
    Utils.showToast('发送失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '发送回复';
  }
}
window.sendReply = sendReply;

function closeModal(e) {
  if (e && e.target !== document.getElementById('chat-modal')) return;
  document.getElementById('chat-modal').style.display = 'none';
  currentSessionId = null;
}
window.closeModal = closeModal;
window.openSession = openSession;

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  initSidebar();

  // Tab 切换
  document.getElementById('status-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.status-tab');
    if (!tab) return;
    document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadSessions(tab.dataset.status);
  });

  await loadSessions('all');
});
