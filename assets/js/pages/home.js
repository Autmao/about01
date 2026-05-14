/* ===== HOME.JS ===== */

let currentCategory = 'all';
let currentKeyword = '';

function esc(value) {
  return Utils.escapeHtml(value);
}

function twoDigit(n) {
  return String(n).padStart(2, '0');
}

function shortDescription(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderJobItem(job, index) {
  const cat = Utils.getCategoryInfo(job.category);
  const dl = Utils.deadlineText(job.deadline);
  const effectiveStatus = Utils.isPastDeadline(job.deadline) ? 'closed' : job.status;
  const statusInfo = Utils.jobStatusMap[effectiveStatus] || { label: effectiveStatus, cls: '' };
  const fee = job.fee
    ? `¥${job.fee}`
    : job.feeType === 'negotiable'
      ? '费用面议'
      : '费用待定';
  const href = `job-detail.html?id=${encodeURIComponent(job.id)}`;

  return `
    <article class="home-job-item" onclick="window.location.href='${href}'">
      <span class="home-job-item__no">${twoDigit(index + 1)}</span>
      <div>
        <h3>${esc(job.title)}</h3>
        <p>${esc(shortDescription(job.description) || '这是一份正在招募中的创作 brief，欢迎打开详情了解项目背景与投递要求。')}</p>
      </div>
      <div class="home-job-meta">
        <strong>${esc(statusInfo.label)}</strong>
        <span>${esc(cat.label)} / 招募 ${job.slots || 1} 人</span>
        <span>${esc(dl.text)}</span>
        <span>${esc(fee)}</span>
      </div>
    </article>`;
}

async function renderGrid() {
  const list = document.getElementById('jobs-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '<div class="home-loading">正在整理当前开放的 brief...</div>';

  try {
    const jobs = await Store.getJobs({ category: currentCategory, keyword: currentKeyword });

    if (jobs.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = jobs.map(renderJobItem).join('');

    list.querySelectorAll('.home-job-item').forEach((item, i) => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(12px)';
      item.style.transition = `opacity 280ms ease ${i * 45}ms, transform 280ms ease ${i * 45}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        item.style.opacity = '1';
        item.style.transform = 'translateY(0)';
      }));
    });
  } catch {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('strong').textContent = '暂时无法载入招募 brief。';
    empty.querySelector('span').textContent = '请稍后刷新页面，或直接联系编辑部确认。';
  }
}

async function updateHeroCount() {
  try {
    const jobs = await Store.getJobs({ status: 'open' });
    const el = document.getElementById('open-count');
    if (el) el.textContent = twoDigit(jobs.length);
  } catch {
    const el = document.getElementById('open-count');
    if (el) el.textContent = '--';
  }
}

function bindEvents() {
  document.getElementById('filter-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.home-filter-chip');
    if (!tab) return;
    document.querySelectorAll('.home-filter-chip').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.category;
    renderGrid();
  });

  document.getElementById('search-input').addEventListener('input', Utils.debounce(e => {
    currentKeyword = e.target.value.trim();
    renderGrid();
  }, 300));
}

document.addEventListener('DOMContentLoaded', async () => {
  await Store.seedDemoData();
  await Promise.all([updateHeroCount(), renderGrid()]);
  bindEvents();
});
