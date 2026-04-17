/* ===== APPLY.JS ===== */

const params = new URLSearchParams(window.location.search);
const jobId = params.get('jobId');
let linkCount = 1;

// 已上传的文件 URL
let uploadedResumeUrl = '';
let uploadedPortfolioFiles = []; // [{ name, size, url }]

/* ===== 文件上传 ===== */
async function uploadFile(file) {
  const res = await fetch(
    `/api/upload?filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '上传失败');
  }
  const { url } = await res.json();
  return url;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function setUploading(zoneId, text) {
  const zone = document.getElementById(zoneId);
  let el = zone.querySelector('.upload-uploading');
  if (!el) { el = document.createElement('div'); el.className = 'upload-uploading'; zone.appendChild(el); }
  el.textContent = text;
}
function clearUploading(zoneId) {
  const el = document.getElementById(zoneId)?.querySelector('.upload-uploading');
  if (el) el.remove();
}

/* 简历上传 */
async function handleResumeChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('resume-preview');
  setUploading('resume-zone', '上传中…');
  try {
    uploadedResumeUrl = await uploadFile(file);
    preview.style.display = 'flex';
    preview.innerHTML = `
      <span class="upload-file-item__name">📄 ${file.name}</span>
      <span class="upload-file-item__size">${formatSize(file.size)}</span>
      <button type="button" class="upload-file-item__remove" onclick="removeResume()">×</button>`;
    clearUploading('resume-zone');
  } catch (err) {
    clearUploading('resume-zone');
    Utils.showToast(`简历上传失败：${err.message}`, 'error');
    e.target.value = '';
  }
}

function removeResume() {
  uploadedResumeUrl = '';
  document.getElementById('resume-preview').style.display = 'none';
  document.getElementById('resume-input').value = '';
}
window.removeResume = removeResume;

/* 作品集文件上传 */
async function handlePortfolioChange(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const remaining = 3 - uploadedPortfolioFiles.length;
  const toUpload = files.slice(0, remaining);
  if (toUpload.length < files.length) Utils.showToast('最多上传3个作品集文件', 'warning');

  setUploading('portfolio-zone', `上传中… (0/${toUpload.length})`);
  for (let i = 0; i < toUpload.length; i++) {
    const file = toUpload[i];
    try {
      setUploading('portfolio-zone', `上传中… (${i + 1}/${toUpload.length})`);
      const url = await uploadFile(file);
      uploadedPortfolioFiles.push({ name: file.name, size: file.size, url });
    } catch (err) {
      Utils.showToast(`「${file.name}」上传失败：${err.message}`, 'error');
    }
  }
  clearUploading('portfolio-zone');
  renderPortfolioFilePreviews();
  e.target.value = '';
  if (uploadedPortfolioFiles.length >= 3) {
    document.getElementById('portfolio-zone').querySelector('.upload-zone__inner').style.display = 'none';
  }
}

function removePortfolioFile(idx) {
  uploadedPortfolioFiles.splice(idx, 1);
  renderPortfolioFilePreviews();
  document.getElementById('portfolio-zone').querySelector('.upload-zone__inner').style.display = '';
}
window.removePortfolioFile = removePortfolioFile;

function renderPortfolioFilePreviews() {
  const container = document.getElementById('portfolio-files-preview');
  container.innerHTML = uploadedPortfolioFiles.map((f, i) => `
    <div class="upload-file-item">
      <span class="upload-file-item__name">🗂️ ${f.name}</span>
      <span class="upload-file-item__size">${formatSize(f.size)}</span>
      <button type="button" class="upload-file-item__remove" onclick="removePortfolioFile(${i})">×</button>
    </div>`).join('');
}

/* ===== 岗位摘要 ===== */
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

/* ===== 链接行 ===== */
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

/* ===== 表单收集 / 验证 ===== */
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
    resumeUrl:      uploadedResumeUrl,
    portfolioFiles: uploadedPortfolioFiles.map(f => ({ name: f.name, url: f.url })),
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

/* ===== 提交 ===== */
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
      Utils.showToast('您已经投递过该岗位，无需重复提交', 'warning', 4000);
    } else {
      Utils.showToast('提交失败，请稍后重试', 'error');
    }
  }
}

/* ===== 初始化 ===== */
document.addEventListener('DOMContentLoaded', async () => {
  if (!jobId) {
    document.querySelector('main').innerHTML = `<p style="padding:60px;text-align:center;">参数缺失，<a href="index.html" style="color:var(--color-brand);">返回首页</a></p>`;
    return;
  }

  const job = await Store.getJobById(jobId);
  if (!job || job.status !== 'open') {
    document.querySelector('main').innerHTML = `<p style="padding:60px;text-align:center;">该岗位不存在或已截止，<a href="index.html" style="color:var(--color-brand);">返回首页</a></p>`;
    return;
  }

  renderJobSummary(job);
  addLinkRow(1);

  document.getElementById('resume-input').addEventListener('change', handleResumeChange);
  document.getElementById('portfolio-input').addEventListener('change', handlePortfolioChange);

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
