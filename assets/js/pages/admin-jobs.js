/* ===== ADMIN-JOBS.JS ===== */

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

let currentStatus = 'all';
let currentKeyword = '';

async function renderStats() {
  const s = await Store.getStats();
  document.getElementById('stat-open').textContent    = s.openJobs;
  document.getElementById('stat-monthly').textContent = s.monthlyApps;
  document.getElementById('stat-pending').textContent  = s.pendingApps;
  document.getElementById('stat-hired').textContent   = s.hiredTotal;
}

async function renderJobsTable() {
  const jobs = await Store.getAllJobsAdmin({ status: currentStatus, keyword: currentKeyword });
  const tbody = document.getElementById('jobs-tbody');
  const empty = document.getElementById('jobs-empty');

  // tab 计数
  const all = await Store.getAllJobsAdmin({});
  document.getElementById('count-all').textContent    = all.length;
  document.getElementById('count-open').textContent   = all.filter(j => j.status === 'open').length;
  document.getElementById('count-closed').textContent = all.filter(j => j.status === 'closed').length;
  document.getElementById('count-draft').textContent  = all.filter(j => j.status === 'draft').length;

  if (jobs.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = jobs.map(job => {
    const cat = Utils.getCategoryInfo(job.category);
    const statusInfo = Utils.jobStatusMap[job.status] || { label: job.status, cls: '' };
    const dl = Utils.deadlineText(job.deadline);
    return `
      <tr>
        <td>
          <div class="table-job-title">${job.title}</div>
          <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">${(job.tags || []).slice(0,3).join(' · ')}</div>
        </td>
        <td><span class="tag tag--category">${cat.label}</span></td>
        <td><span class="tag ${statusInfo.cls}">${statusInfo.label}</span></td>
        <td>${job.applicationCount || 0}</td>
        <td><span class="${dl.cls}">${dl.text}</span></td>
        <td>${Utils.formatDate(job.createdAt)}</td>
        <td>
          <div class="table-actions">
            <button class="action-btn action-btn--view" onclick="viewApps('${job.id}')">查看投递</button>
            <button class="action-btn action-btn--edit" onclick="editJob('${job.id}')">编辑</button>
            ${job.status === 'open'
              ? `<button class="action-btn action-btn--close" onclick="toggleStatus('${job.id}','closed')">关闭</button>`
              : `<button class="action-btn action-btn--view" onclick="toggleStatus('${job.id}','open')">开启</button>`}
            <button class="action-btn action-btn--delete" onclick="deleteJob('${job.id}')">删除</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function viewApps(jobId)  { window.location.href = `applications.html?jobId=${jobId}`; }
function editJob(jobId)   { window.location.href = `job-edit.html?id=${jobId}`; }
window.viewApps = viewApps;
window.editJob = editJob;

async function toggleStatus(jobId, newStatus) {
  await Store.updateJob(jobId, { status: newStatus });
  await Promise.all([renderStats(), renderJobsTable()]);
  Utils.showToast(`岗位已${newStatus === 'open' ? '开启招募' : '关闭招募'}`, 'success');
}
window.toggleStatus = toggleStatus;

async function deleteJob(jobId) {
  const job = await Store.getJobById(jobId);
  Utils.showConfirm(`确定删除「${job?.title}」？此操作不可恢复。`, async () => {
    await Store.deleteJob(jobId);
    await Promise.all([renderStats(), renderJobsTable()]);
    Utils.showToast('岗位已删除', 'success');
  });
}
window.deleteJob = deleteJob;

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  initSidebar();
  await Promise.all([renderStats(), renderJobsTable()]);

  document.getElementById('status-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.status-tab');
    if (!tab) return;
    document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentStatus = tab.dataset.status;
    renderJobsTable();
  });

  document.getElementById('table-search').addEventListener('input', Utils.debounce(e => {
    currentKeyword = e.target.value.trim();
    renderJobsTable();
  }, 300));
});
