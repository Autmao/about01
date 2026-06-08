/* ===== APPLY.JS ===== */

const params = new URLSearchParams(window.location.search);
const jobId = params.get('jobId');
let linkCount = 1;
const MAX_TOTAL_UPLOAD_SIZE = 50 * 1024 * 1024;
const MAX_BIO_LENGTH = 200;

// 已上传的文件 URL
let uploadedMaterialFiles = []; // [{ name, size, url }]

function applicantLoginUrl() {
  const from = jobId ? `apply.html?jobId=${encodeURIComponent(jobId)}` : 'index.html';
  return `login.html?role=applicant&from=${encodeURIComponent(from)}`;
}

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

function esc(value) {
  return Utils.escapeHtml(value);
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

function uploadedMaterialsSize() {
  return uploadedMaterialFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
}

/* 简历 / 作品集材料上传 */
async function handleMaterialsChange(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const nextTotal = uploadedMaterialsSize() + files.reduce((sum, file) => sum + file.size, 0);
  if (nextTotal > MAX_TOTAL_UPLOAD_SIZE) {
    Utils.showToast('所有上传文件合计不能超过50MB', 'warning', 4000);
    e.target.value = '';
    return;
  }

  setUploading('materials-zone', `上传中…… (0/${files.length})`);
  for (let i = 0; i < files.length; i++) {
    const beforeUploadTotal = uploadedMaterialsSize() + files[i].size;
    if (beforeUploadTotal > MAX_TOTAL_UPLOAD_SIZE) {
      Utils.showToast('已达到50MB上传上限，后续文件未上传', 'warning', 4000);
      break;
    }
    const file = files[i];
    try {
      setUploading('materials-zone', `上传中…… (${i + 1}/${files.length})`);
      const url = await uploadFile(file);
      uploadedMaterialFiles.push({ name: file.name, size: file.size, url });
    } catch (err) {
      Utils.showToast(`「${file.name}」上传失败：${err.message}`, 'error');
    }
  }
  clearUploading('materials-zone');
  renderMaterialFilePreviews();
  e.target.value = '';
}

function removeMaterialFile(idx) {
  uploadedMaterialFiles.splice(idx, 1);
  renderMaterialFilePreviews();
}
window.removeMaterialFile = removeMaterialFile;

function renderMaterialFilePreviews() {
  const container = document.getElementById('materials-files-preview');
  if (!container) return;
  container.innerHTML = uploadedMaterialFiles.map((f, i) => `
    <div class="upload-file-item">
      <span class="upload-file-item__name">材料 ${i + 1} · ${esc(f.name)}</span>
      <span class="upload-file-item__size">${formatSize(f.size)}</span>
      <button type="button" class="upload-file-item__remove" onclick="removeMaterialFile(${i})">×</button>
    </div>`).join('');
}

/* ===== 项目摘要 ===== */
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
  if (bcJob) { bcJob.textContent = '项目详情'; bcJob.href = `job-detail.html?id=${job.id}`; }
}

/* ===== 链接行 ===== */
function addLinkRow(index) {
  const container = document.getElementById('portfolio-links-container');
  const row = document.createElement('div');
  row.className = 'portfolio-link-row';
  row.dataset.index = index;
  row.innerHTML = `
    <span class="portfolio-link-index">链接 ${index}</span>
    <input type="url" class="form-input" name="link_url_${index}" placeholder="https://...">
    <input type="text" class="form-input form-input--sm" name="link_label_${index}" placeholder="备注（如：小红书主页）">
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
    const index = Number(row.dataset.index || links.length + 1);
    if (url) links.push({ url, label: label || `作品链接 ${index}`, index });
  });
  const materialFiles = uploadedMaterialFiles.map(f => ({ name: f.name, size: f.size, url: f.url }));
  return {
    name:           document.getElementById('field-name').value.trim(),
    email:          document.getElementById('field-email').value.trim(),
    phone:          document.getElementById('field-phone').value.trim(),
    wechat:         document.getElementById('field-wechat').value.trim(),
    bio:            document.getElementById('field-bio').value.trim(),
    portfolioNote:  '',
    portfolioLinks: links,
    resumeUrl:      materialFiles[0]?.url || '',
    portfolioFiles: materialFiles,
  };
}

function validateForm(data) {
  const errors = {};
  if (!data.name) errors.name = '请填写你的姓名';
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = '请填写有效的邮箱地址';
  if (!data.phone || !/^1[3-9]\d{9}$/.test(data.phone)) errors.phone = '请填写有效的11位手机号';
  if (!data.wechat) errors.wechat = '请填写微信号';
  if (!data.bio) errors.bio = '请填写200字内的个人介绍';
  if (data.bio && data.bio.length > MAX_BIO_LENGTH) errors.bio = '个人介绍请控制在200字内';
  const totalSize = (data.portfolioFiles || []).reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (!(data.portfolioFiles || []).length) errors.materials = '请上传简历和作品集材料';
  if (totalSize > MAX_TOTAL_UPLOAD_SIZE) errors.materials = '所有上传文件合计不能超过50MB';
  return errors;
}

function clearErrors() {
  ['name','email','phone','wechat','bio','materials'].forEach(f => {
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
  document.querySelector('.form-input.error, .form-error:not(:empty)')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  btn.innerHTML = `<span class="btn-spinner"></span> 提交中......`;

  try {
    const app = await Store.createApplication({ ...data, jobId });
    showSuccess(app);
  } catch (err) {
    btn.classList.remove('btn--loading');
    btn.innerHTML = '提交投递';
    if (err.status === 409) {
      Utils.showToast('你已经投递过该岗位，无需重复提交', 'warning', 4000);
    } else if (err.status === 401) {
      window.location.href = applicantLoginUrl();
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

  if (!Store.isApplicantLoggedIn()) {
    window.location.href = applicantLoginUrl();
    return;
  }

  const job = await Store.getJobById(jobId);
  if (!job || job.status !== 'open' || Utils.isPastDeadline(job.deadline)) {
    document.querySelector('main').innerHTML = `<p style="padding:60px;text-align:center;">该项目不存在或已截止，<a href="index.html" style="color:var(--color-brand);">返回首页</a></p>`;
    return;
  }

  // 预填已登录创作伙伴信息
  const user = Store.getCurrentApplicant();
  if (user) {
    const phoneField = document.getElementById('field-phone');
    const nameField = document.getElementById('field-name');
    const emailField = document.getElementById('field-email');
    if (phoneField && user.phone) phoneField.value = user.phone;
    if (nameField && user.name) nameField.value = user.name;
    if (emailField && user.email) {
      emailField.value = user.email;
      emailField.readOnly = true;
      emailField.setAttribute('aria-readonly', 'true');
    }
  }

  renderJobSummary(job);
  addLinkRow(1);

  document.getElementById('materials-input').addEventListener('change', handleMaterialsChange);

  document.getElementById('add-link-btn').addEventListener('click', () => {
    if (linkCount >= 3) return;
    linkCount++;
    addLinkRow(linkCount);
    if (linkCount >= 3) document.getElementById('add-link-btn').style.display = 'none';
  });

  document.getElementById('field-bio').addEventListener('input', e => {
    const count = e.target.value.length;
    if (count > MAX_BIO_LENGTH) e.target.value = e.target.value.slice(0, MAX_BIO_LENGTH);
    document.getElementById('bio-count').textContent = `${Math.min(count, MAX_BIO_LENGTH)}/${MAX_BIO_LENGTH}`;
  });

  document.getElementById('apply-form').addEventListener('submit', handleSubmit);
});
