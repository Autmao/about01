/* ===== HOME.JS ===== */

let currentCategory = 'all';
let currentKeyword = '';

function renderJobCard(job) {
  const cat = Utils.getCategoryInfo(job.category);
  const dl = Utils.deadlineText(job.deadline);
  const statusInfo = Utils.jobStatusMap[job.status] || { label: job.status, cls: '' };
  const feeDisplay = job.fee ? `¥${job.fee}` : (job.feeType === 'negotiable' ? '面议' : '—');

  return `
    <article class="job-card" onclick="window.location.href='job-detail.html?id=${job.id}'">
      <div class="job-card__cover" style="background-color:${job.coverColor || cat.color}">
        <span class="job-card__icon">${cat.icon}</span>
        <span class="tag ${statusInfo.cls}">${statusInfo.label}</span>
      </div>
      <div class="job-card__body">
        <div class="job-card__meta">
          <span class="tag tag--category">${cat.label}</span>
          <span class="job-card__slots">招募 ${job.slots || 1} 人</span>
        </div>
        <h3 class="job-card__title">${job.title}</h3>
        <p class="job-card__excerpt">${job.description || ''}</p>
        <div class="job-card__footer">
          <div>
            <span class="fee-label">稿费</span>
            <span class="fee-value">${feeDisplay}</span>
          </div>
          <div>
            <span class="deadline-label">截止</span>
            <span class="${dl.cls}">${dl.text}</span>
          </div>
        </div>
      </div>
    </article>`;
}

async function renderGrid() {
  const grid = document.getElementById('jobs-grid');
  const empty = document.getElementById('empty-state');
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:var(--space-12);color:var(--color-text-muted);">加载中...</div>`;

  const jobs = await Store.getJobs({ category: currentCategory, keyword: currentKeyword });

  if (jobs.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = jobs.map(renderJobCard).join('');

  grid.querySelectorAll('.job-card').forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px)';
    card.style.transition = `opacity 0.3s ease ${i * 50}ms, transform 0.3s ease ${i * 50}ms`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }));
  });
}

async function updateHeroCount() {
  const jobs = await Store.getJobs({ status: 'open' });
  const el = document.getElementById('open-count');
  if (el) el.textContent = jobs.length;
}

function bindEvents() {
  document.getElementById('filter-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.category;
    renderGrid();
  });

  document.getElementById('search-input').addEventListener('input', Utils.debounce(e => {
    currentKeyword = e.target.value.trim();
    renderGrid();
  }, 300));
}

async function checkMyApplication() {
  const email = prompt('请输入您投递时填写的邮箱：');
  if (!email || !email.trim()) return;
  try {
    const apps = await Store.getMyApplications(email.trim());
    if (apps.length === 0) {
      Utils.showToast('未找到该邮箱的投递记录', 'warning');
      return;
    }
    const statusLabels = { pending: '审核中', read: '已读取', hired: '已录用 🎉', rejected: '未通过' };
    const lines = apps.map(a => `• ${a.jobTitle || '未知岗位'}：${statusLabels[a.status] || a.status}`).join('\n');
    alert(`您的投递记录（${apps.length}条）：\n\n${lines}`);
  } catch (e) {
    Utils.showToast('查询失败，请稍后重试', 'error');
  }
}
window.checkMyApplication = checkMyApplication;

document.addEventListener('DOMContentLoaded', async () => {
  await Store.seedDemoData();
  await Promise.all([updateHeroCount(), renderGrid()]);
  bindEvents();
});
