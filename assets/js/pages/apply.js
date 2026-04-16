/* ===== APPLY.JS ===== */

const params = new URLSearchParams(window.location.search);
const jobId = params.get('jobId');
let linkCount = 1;

function renderJobSummary(job) {
  const cat = Utils.getCategoryInfo(job.category);
  const dl = Utils.deadlineText(job.deadline);
  const el = document.getElementById('job-summary');
  if (!el) return;
  el.innerHTML = `
    <div class="job-summary-cover" style="background:${job.coverColor || cat.color}">${cat.icon}</div>
    <div>
      <div class="job-summary-title">${job.title}</div>
      <div class="job-summary-meta">
        <span>${cat.label}</span>
        <span>稿费：${job.fee ? '¥' + job.fee : '面议'}</span>
        <span>截止：<span class="${dl.cls}">${dl.text}</span></span>
      </div>
    </div>`;
  const bcJob = document.getElementById('bc-job');
  if (bcJob) { bcJob.textContent = job.title; bcJob.href = `job-detail.html?id=${job.id}`; }
}

function addLinkRow(index) {
  const container = document.getElementById('portfolio-links-container');
  const row = document.createElement('div');
  row.className = 'portfolio-link-row';
  row.dataset.index = index;
  row.innerHTML = `
    <input type="url" class="form-input" name="link_url_${index}" placeholder="https://...">
    <input type="text" class="form-input form-input--sm" name="link_label_${index}" placeholder="备注（如：Behance主页）">
    ${index > 1 ? `<button type="button" class="btn-remove-link" onclick="removeLinkRow(this)">×</button>` : ''}`;
  container.appendChild(row);
}

function removeLinkRow(btn) {
  btn.closest('.portfolio-link-row').remove();
  linkCount--;
  if (linkCount < 3) document.getElementById('add-link-btn').style.display = '';
}
window.removeLinkRow = removeLinkRow;

function collectFormData() {
  const links = [];
  document.querySelectorAll('.portfolio-link-row').forEach(row => {
    const url = row.querySelector('input[type=url]').value.trim();
    const label = row.querySelector('input[type=text]').value.trim();
    if (url) links.push({ url, label: label || '作品链接' });
  });
  return {
    name:           document.getElementById('field-name').value.trim(),
    email:          document.getElementById('field-email').value.trim(),
    phone:          document.getElementById('field-phone').value.trim(),
    wechat:         document.getElementById('field-wechat').value.trim(),
    bio:            document.getElementById('field-bio').value.trim(),
    portfolioNote:  document.getElementById('field-note').value.trim(),
    portfolioLinks: links,
  };
}

function validateForm(data) {
  const errors = {};
  if (!data.name) errors.name = '请填写您的姓名';
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = '请填写有效的邮箱地址';
  if (!data.phone || !/^1[3-9]\d{9}$/.test(data.phone)) errors.phone = '请填写有效的11位手机号';
  return errors;
}

function clearErrors() {
  ['name','email','phone'].forEach(f => {
    const el = document.getElementById(`err-${f}`);
    if (el) el.textContent = '';
    const input = document.getElementById(`field-${f}`);
    if (input) input.classList.remove('error');
  });
}

function showErrors(errors) {
  Object.entries(errors).forEach(([field, msg]) => {
    const errEl = document.getElementById(`err-${field}`);
    if (errEl) errEl.textContent = msg;
    const inputEl = document.getElementById(`field-${field}`);
    if (inputEl) inputEl.classList.add('error');
  });
  document.querySelector('.form-input.error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showSuccess(app) {
  document.getElementById('apply-form').style.display = 'none';
  const state = document.getElementById('success-state');
  state.classList.add('visible');
  document.getElementById('success-email').textContent = app.email;
  document.getElementById('success-id').textContent = `投递编号：${app.id}`;
}

async function handleSubmit(e) {
  e.preventDefault();
  clearErrors();
  const data = collectFormData();
  const errors = validateForm(data);
  if (Object.keys(errors).length > 0) { showErrors(errors); return; }

  const btn = document.getElementById('submit-btn');
  btn.classList.add('btn--loading');
  btn.innerHTML = `<span class="btn-spinner"></span> 提交中...`;

  try {
    const app = await Store.createApplication({ ...data, jobId });
    showSuccess(app);
  } catch (err) {
    btn.classList.remove('btn--loading');
    btn.innerHTML = '提交投递';
    if (err.status === 409) {
      Utils.showToast('您已经投递过该工种，无需重复提交', 'warning', 4000);
    } else {
      Utils.showToast('提交失败，请稍后重试', 'error');
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await Store.seedDemoData();

  if (!jobId) {
    document.querySelector('main').innerHTML = `<p style="padding:60px;text-align:center;">参数缺失，<a href="index.html" style="color:var(--color-brand);">返回首页</a></p>`;
    return;
  }

  const job = await Store.getJobById(jobId);
  if (!job || job.status !== 'open') {
    document.querySelector('main').innerHTML = `<p style="padding:60px;text-align:center;">该工种不存在或已截止，<a href="index.html" style="color:var(--color-brand);">返回首页</a></p>`;
    return;
  }

  renderJobSummary(job);
  addLinkRow(1);

  document.getElementById('add-link-btn').addEventListener('click', () => {
    if (linkCount >= 3) return;
    linkCount++;
    addLinkRow(linkCount);
    if (linkCount >= 3) document.getElementById('add-link-btn').style.display = 'none';
  });

  document.getElementById('field-bio').addEventListener('input', e => {
    const count = e.target.value.length;
    if (count > 500) e.target.value = e.target.value.slice(0, 500);
    document.getElementById('bio-count').textContent = `${Math.min(count,500)}/500`;
  });

  document.getElementById('apply-form').addEventListener('submit', handleSubmit);
});
