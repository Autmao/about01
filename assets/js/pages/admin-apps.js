/* ===== ADMIN-APPS.JS ===== */

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

const urlParams = new URLSearchParams(window.location.search);
let currentJobId = urlParams.get('jobId') || '';
let currentStatus = 'all';
let currentKeyword = '';

const STATUS_MSGS = {
  read:     '我们已收到您的投递，正在认真审阅中，请耐心等待。',
  hired:    '恭喜！您已通过审核，我们会尽快联系您确认合作细节。',
  rejected: '感谢您的投递，本次暂未通过，欢迎关注我们后续的岗位发布。',
};

async function renderJobSelector() {
  const selector = document.getElementById('job-selector');
  const jobs = await Store.getAllJobsAdmin({});
  selector.innerHTML = `<option value="">全部岗位</option>` +
    jobs.map(j => `<option value="${j.id}" ${j.id === currentJobId ? 'selected' : ''}>${j.title}</option>`).join('');
}

async function updateCounts() {
  const counts = await Store.getAppStatusCounts(currentJobId || null);
  document.getElementById('cnt-all').textContent      = counts.all;
  document.getElementById('cnt-pending').textContent  = counts.pending;
  document.getElementById('cnt-read').textContent     = counts.read;
  document.getElementById('cnt-hired').textContent    = counts.hired;
  document.getElementById('cnt-rejected').textContent = counts.rejected;
}

function isArchived(app) {
  return (app.statusHistory || []).some(h => h.action === 'archived');
}

function renderActionHistory(history) {
  if (!history || !history.length) return '';
  const relevant = history.filter(h => h.actor && (h.from !== h.to || h.action === 'archived'));
  if (!relevant.length) return '';
  const items = relevant.map(h => {
    const time = h.at ? h.at.slice(0, 16).replace('T', ' ') : '';
    if (h.action === 'archived') {
      return `<div class="action-log-item"><span class="action-log__actor">${h.actor}</span> 加入了合作档案 <span class="action-log__time">${time}</span></div>`;
    }
    const toLabel = { pending:'待查看', read:'已读', hired:'录用', rejected:'婉拒' }[h.to] || h.to;
    return `<div class="action-log-item"><span class="action-log__actor">${h.actor}</span> 标记为「${toLabel}」<span class="action-log__time">${time}</span></div>`;
  });
  return `<div class="action-log" id="action-log-appId">${items.join('')}</div>`;
}

function renderAppCard(app) {
  const avatar = Utils.getAvatarInfo(app.name);
  const statusInfo = Utils.getStatusInfo(app.status);
  const archived = isArchived(app);
  const resumeLink = app.resumeUrl
    ? `<a href="${app.resumeUrl}" target="_blank" rel="noopener">📄 下载简历</a>`
    : '';
  const portfolioFileLinks = (app.portfolioFiles || []).map(f =>
    `<a href="${f.url}" target="_blank" rel="noopener">🗂️ ${f.name || '作品集文件'}</a>`
  ).join('');
  const links = (app.portfolioLinks || []).map(l =>
    `<a href="${l.url}" target="_blank" rel="noopener">🔗 ${l.label || '作品链接'}</a>`
  ).join('');
  const allLinks = resumeLink + portfolioFileLinks + links;

  // 录用/婉拒互斥：active 态显示已选中样式
  const hiredActive   = app.status === 'hired';
  const rejectedActive = app.status === 'rejected';

  const hiredBtn = hiredActive
    ? `<button class="btn btn--primary btn--sm action-btn--active" onclick="changeStatus('${app.id}','read')" title="撤销录用">✓ 已录用</button>`
    : `<button class="btn btn--ghost btn--sm" onclick="changeStatus('${app.id}','hired')">录用</button>`;

  const rejectedBtn = rejectedActive
    ? `<button class="btn btn--ghost btn--sm action-btn--active-reject" onclick="changeStatus('${app.id}','read')" title="撤销婉拒">✓ 已婉拒</button>`
    : `<button class="btn btn--ghost btn--sm" style="color:var(--color-rejected);border-color:var(--color-rejected);" onclick="changeStatus('${app.id}','rejected')">婉拒</button>`;

  const archiveBtn = archived
    ? `<button class="btn btn--ghost btn--sm action-btn--archived" disabled title="已在合作档案">📁 已入档</button>`
    : `<button class="btn btn--ghost btn--sm" onclick="archiveApp('${app.id}')">加入合作档案</button>`;

  return `
    <div class="app-card" id="app-card-${app.id}">
      <div class="app-card__header" onclick="toggleDetail('${app.id}')">
        <div class="avatar" style="background:${avatar.bg}">${avatar.char}</div>
        <div class="app-card__info">
          <div class="app-card__name">${app.name}</div>
          <div class="app-card__meta">
            <span>📧 ${app.email}</span>
            <span>📱 ${app.phone}</span>
            ${app.wechat ? `<span>💬 ${app.wechat}</span>` : ''}
            ${app.jobTitle ? `<span>岗位：${app.jobTitle}</span>` : ''}
          </div>
        </div>
        <div class="app-card__right">
          <span class="tag ${statusInfo.cls}">${statusInfo.label}</span>
          ${archived ? `<span class="tag tag--archived">📁 已入档</span>` : ''}
          <span class="app-card__time">${Utils.relativeTime(app.submittedAt)}</span>
          <span class="app-card__toggle">▼</span>
        </div>
      </div>
      <div class="app-detail" id="detail-${app.id}">
        ${app.bio ? `<div class="app-detail__bio">${app.bio}</div>` : ''}
        ${allLinks ? `<div class="app-detail__links">${allLinks}</div>` : ''}
        ${app.portfolioNote ? `<p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">${app.portfolioNote}</p>` : ''}
        <div class="app-detail__actions">
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center;">
            ${app.status !== 'read' ? `<button class="btn btn--ghost btn--sm" onclick="changeStatus('${app.id}','read')">标记已读</button>` : ''}
            ${hiredBtn}
            ${rejectedBtn}
            <span style="width:1px;height:20px;background:var(--color-border-light);margin:0 2px;"></span>
            ${archiveBtn}
          </div>
          ${renderActionHistory(app.statusHistory)}
          <div class="app-detail__note">
            <div style="display:flex;flex-direction:column;gap:var(--space-2);">
              <div>
                <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:3px;">共享备注（所有成员可见）</div>
                <input type="text" class="app-note-input" placeholder="添加共享备注..."
                  value="${app.adminNote || ''}"
                  onblur="saveNote('${app.id}', this.value)">
              </div>
              <div>
                <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:3px;">我的备注（仅自己可见）</div>
                <input type="text" class="app-note-input" id="my-note-${app.id}" placeholder="添加私人备注..."
                  onblur="saveMyNote('${app.id}', this.value)">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

async function renderApps() {
  const [apps] = await Promise.all([
    Store.getApplications({ jobId: currentJobId || undefined, status: currentStatus, keyword: currentKeyword }),
    updateCounts(),
  ]);

  const list  = document.getElementById('apps-list');
  const empty = document.getElementById('apps-empty');

  if (apps.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = apps.map(renderAppCard).join('');
}

async function toggleDetail(appId) {
  const detail = document.getElementById(`detail-${appId}`);
  const card   = document.getElementById(`app-card-${appId}`);
  const isOpen = detail.classList.contains('expanded');
  detail.classList.toggle('expanded', !isOpen);
  const toggle = card.querySelector('.app-card__toggle');
  if (toggle) toggle.textContent = isOpen ? '▼' : '▲';

  if (!isOpen) {
    // 加载成员私有备注
    Store.getMemberNote(appId).then(({ note }) => {
      const el = document.getElementById(`my-note-${appId}`);
      if (el) el.value = note || '';
    }).catch(() => {});

    // 自动标记为已读
    const app = await Store.getApplicationById(appId);
    if (app && app.status === 'pending') {
      await Store.updateApplicationStatus(appId, 'read');
      await updateCounts();
      const statusEl = card.querySelector('.tag');
      if (statusEl) {
        const info = Utils.getStatusInfo('read');
        statusEl.className = `tag ${info.cls}`;
        statusEl.textContent = info.label;
      }
    }
  }
}
window.toggleDetail = toggleDetail;

async function changeStatus(appId, newStatus) {
  await Store.updateApplicationStatus(appId, newStatus);
  Utils.showToast(`已标记为「${Utils.getStatusInfo(newStatus).label}」`, 'success');
  await renderApps();
}
window.changeStatus = changeStatus;

async function archiveApp(appId) {
  const app = await Store.getApplicationById(appId);
  Utils.showConfirm(
    `将「${app?.name}」加入合作者档案？`,
    async () => {
      await Store.archiveToCollaborator(appId);
      Utils.showToast('已加入合作者档案', 'success');
      await renderApps();
    }
  );
}
window.archiveApp = archiveApp;

async function saveNote(appId, note) {
  await Store.updateApplicationNote(appId, note);
}
window.saveNote = saveNote;

async function saveMyNote(appId, note) {
  await Store.saveMemberNote(appId, note);
}
window.saveMyNote = saveMyNote;

let _prefsLoaded = false;
function _savePrefs() {
  if (!_prefsLoaded) return;
  Store.savePreferences({ jobId: currentJobId, status: currentStatus }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  initSidebar();
  await renderJobSelector();

  // 恢复筛选偏好
  try {
    const prefs = await Store.getPreferences();
    if (prefs.jobId !== undefined) {
      currentJobId = prefs.jobId;
      const sel = document.getElementById('job-selector');
      if (sel) sel.value = prefs.jobId;
    }
    if (prefs.status) {
      currentStatus = prefs.status;
      document.querySelectorAll('.status-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.status === currentStatus);
      });
    }
  } catch {}
  _prefsLoaded = true;

  await renderApps();

  document.getElementById('job-selector').addEventListener('change', e => {
    currentJobId = e.target.value;
    _savePrefs();
    renderApps();
  });

  document.getElementById('status-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.status-tab');
    if (!tab) return;
    document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentStatus = tab.dataset.status;
    _savePrefs();
    renderApps();
  });

  document.getElementById('app-search').addEventListener('input', Utils.debounce(e => {
    currentKeyword = e.target.value.trim();
    renderApps();
  }, 300));
});
