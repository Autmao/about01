/* ===== JOB-DETAIL.JS ===== */

const params = new URLSearchParams(window.location.search);
const jobId = params.get('id');

function renderDetail(job) {
  const cat = Utils.getCategoryInfo(job.category);
  const dl = Utils.deadlineText(job.deadline);
  const statusInfo = Utils.jobStatusMap[job.status] || { label: job.status, cls: '' };
  const isClosed = job.status !== 'open';
  const feeDisplay = job.fee ? `¥${job.fee}` : '面议';
  const applyUrl = `apply.html?jobId=${job.id}`;

  document.title = `${job.title} | 杂志书工作室`;
  document.getElementById('bc-title').textContent = job.title;

  const reqs = (job.requirements || []).map(r =>
    `<li class="req-item"><span class="req-dot"></span>${r}</li>`
  ).join('');

  document.getElementById('detail-layout').innerHTML = `
    <div class="detail-main">
      <div class="detail-tags">
        <span class="tag tag--category">${cat.icon} ${cat.label}</span>
        <span class="tag ${statusInfo.cls}">${statusInfo.label}</span>
        ${(job.tags || []).map(t => `<span class="tag tag--category">${t}</span>`).join('')}
      </div>
      <h1 class="detail-title">${job.title}</h1>
      <div class="detail-section">
        <p class="detail-section-title">岗位描述</p>
        <p class="detail-desc">${job.description || ''}</p>
      </div>
      ${reqs ? `<div class="detail-section">
        <p class="detail-section-title">具体要求</p>
        <ul class="req-list">${reqs}</ul>
      </div>` : ''}
      ${job.deliverables ? `<div class="detail-section">
        <p class="detail-section-title">交付物</p>
        <p class="detail-desc" style="margin-bottom:0;">${job.deliverables}</p>
      </div>` : ''}
    </div>

    <aside class="detail-sidebar">
      <div class="detail-card">
        <div class="sidebar-row">
          <span class="sidebar-label">稿费</span>
          <span class="sidebar-value sidebar-value--fee">${feeDisplay}</span>
        </div>
        <div class="sidebar-row">
          <span class="sidebar-label">结算方式</span>
          <span class="sidebar-value">${Utils.feeTypeLabel(job.feeType)}</span>
        </div>
        <div class="sidebar-row">
          <span class="sidebar-label">招募人数</span>
          <span class="sidebar-value">${job.slots || 1} 人</span>
        </div>
        <div class="sidebar-row">
          <span class="sidebar-label">截止日期</span>
          <span class="sidebar-value ${dl.cls}">${dl.text}</span>
        </div>
        <div class="sidebar-row" style="border-bottom:none;padding-bottom:0;">
          <span class="sidebar-label">已收到投递</span>
          <span class="sidebar-value">${job.applicationCount || 0} 份</span>
        </div>
        <div class="apply-btn-wrap">
          ${isClosed
            ? `<button class="btn btn--ghost btn--full" disabled style="cursor:not-allowed;">招募已截止</button>`
            : `<a href="${applyUrl}" class="btn btn--primary btn--full btn--lg">立即投递</a>`}
        </div>
        <div class="sidebar-share" onclick="copyLink()">
          <span>🔗</span> 复制分享链接
        </div>
      </div>
    </aside>`;

  const mobileBar = document.getElementById('apply-bar-mobile');
  if (!isClosed) {
    mobileBar.style.display = 'block';
    document.getElementById('apply-btn-mobile').onclick = () => { window.location.href = applyUrl; };
  }
}

async function renderRelated(currentJob) {
  const allJobs = await Store.getJobs({ status: 'open' });
  const related = allJobs.filter(j => j.id !== currentJob.id).slice(0, 3);
  if (related.length === 0) return;

  document.getElementById('related-section').style.display = 'block';
  document.getElementById('related-grid').innerHTML = related.map(job => {
    const cat = Utils.getCategoryInfo(job.category);
    const dl = Utils.deadlineText(job.deadline);
    return `
      <article class="job-card" onclick="window.location.href='job-detail.html?id=${job.id}'">
        <div class="job-card__cover" style="background-color:${job.coverColor || cat.color}">
          <span class="job-card__icon">${cat.icon}</span>
          <span class="tag tag--open">招募中</span>
        </div>
        <div class="job-card__body">
          <div class="job-card__meta"><span class="tag tag--category">${cat.label}</span></div>
          <h3 class="job-card__title">${job.title}</h3>
          <div class="job-card__footer">
            <span class="fee-value">${job.fee ? '¥' + job.fee : '面议'}</span>
            <span class="${dl.cls}">${dl.text}</span>
          </div>
        </div>
      </article>`;
  }).join('');
}

function copyLink() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => Utils.showToast('链接已复制', 'success'))
    .catch(() => Utils.showToast('请手动复制地址栏链接', 'warning'));
}
window.copyLink = copyLink;

document.addEventListener('DOMContentLoaded', async () => {
  await Store.seedDemoData();

  if (!jobId) {
    document.getElementById('detail-layout').innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--color-text-muted);">参数缺失，<a href="index.html" style="color:var(--color-brand);">返回首页</a></div>`;
    return;
  }

  const job = await Store.getJobById(jobId);
  if (!job) {
    document.getElementById('detail-layout').innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--color-text-muted);">岗位不存在，<a href="index.html" style="color:var(--color-brand);">返回首页</a></div>`;
    return;
  }

  renderDetail(job);
  await renderRelated(job);
});
