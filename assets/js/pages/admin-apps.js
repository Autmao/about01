/* ===== ADMIN-APPS.JS ===== */

async function checkAuth() {
  if (Store.isAdminLoggedIn()) return true;
  const pwd = prompt('请输入管理员密码：');
  if (!pwd) { window.location.href = '../index.html'; return false; }
  try {
    await Store.adminLogin(pwd);
    return true;
  } catch {
    alert('密码错误');
    window.location.href = '../index.html';
    return false;
  }
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

function renderAppCard(app) {
  const avatar = Utils.getAvatarInfo(app.name);
  const statusInfo = Utils.getStatusInfo(app.status);
  const links = (app.portfolioLinks || []).map(l =>
    `<a href="${l.url}" target="_blank" rel="noopener">🔗 ${l.label || '作品链接'}</a>`
  ).join('');

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
          <span class="app-card__time">${Utils.relativeTime(app.submittedAt)}</span>
          <span class="app-card__toggle">▼</span>
        </div>
      </div>
      <div class="app-detail" id="detail-${app.id}">
        ${app.bio ? `<div class="app-detail__bio">${app.bio}</div>` : ''}
        ${links ? `<div class="app-detail__links">${links}</div>` : ''}
        ${app.portfolioNote ? `<p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">${app.portfolioNote}</p>` : ''}
        <div class="app-detail__actions">
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
            ${app.status !== 'read'     ? `<button class="btn btn--ghost btn--sm" onclick="changeStatus('${app.id}','read')">标记已读</button>` : ''}
            ${app.status !== 'hired'    ? `<button class="btn btn--primary btn--sm" onclick="changeStatus('${app.id}','hired')">录用</button>` : ''}
            ${app.status !== 'rejected' ? `<button class="btn btn--ghost btn--sm" style="color:var(--color-rejected);border-color:var(--color-rejected);" onclick="changeStatus('${app.id}','rejected')">婉拒</button>` : ''}
          </div>
          <div class="app-detail__note">
            <input type="text" class="app-note-input" placeholder="内部备注（仅自己可见）"
              value="${app.adminNote || ''}"
              onblur="saveNote('${app.id}', this.value)">
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

  if (newStatus === 'hired') {
    const app = await Store.getApplicationById(appId);
    Utils.showConfirm(
      `是否将「${app?.name}」加入合作者档案库？`,
      async () => {
        await Store.createCollaboratorFromApp(appId);
        Utils.showToast('已加入合作者档案库', 'success');
      }
    );
  } else {
    Utils.showToast(`状态已更新为「${Utils.getStatusInfo(newStatus).label}」`, 'success');
  }

  await renderApps();
}
window.changeStatus = changeStatus;

async function saveNote(appId, note) {
  await Store.updateApplicationNote(appId, note);
}
window.saveNote = saveNote;

document.addEventListener('DOMContentLoaded', async () => {
  if (!await checkAuth()) return;
  await renderJobSelector();
  await renderApps();

  document.getElementById('job-selector').addEventListener('change', e => {
    currentJobId = e.target.value;
    renderApps();
  });

  document.getElementById('status-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.status-tab');
    if (!tab) return;
    document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentStatus = tab.dataset.status;
    renderApps();
  });

  document.getElementById('app-search').addEventListener('input', Utils.debounce(e => {
    currentKeyword = e.target.value.trim();
    renderApps();
  }, 300));
});
