/* ===== JOB-DETAIL.JS ===== */

const params = new URLSearchParams(window.location.search);
const jobId = params.get('id');
const esc = value => Utils.escapeHtml(value);

function renderDetail(job) {
  const cat = Utils.getCategoryInfo(job.category);
  const dl = Utils.deadlineText(job.deadline);
  const effectiveStatus = Utils.isPastDeadline(job.deadline) ? 'closed' : job.status;
  const statusInfo = Utils.jobStatusMap[effectiveStatus] || { label: effectiveStatus, cls: '' };
  const isClosed = effectiveStatus !== 'open';
  const feeDisplay = job.fee ? `¥${job.fee}` : '面议';
  const applyUrl = `apply.html?jobId=${job.id}`;

  document.title = `${job.title} | about编辑部`;
  document.getElementById('bc-title').textContent = job.title;

  const reqs = (job.requirements || []).map(r =>
    `<li class="req-item"><span class="req-dot"></span>${esc(r)}</li>`
  ).join('');

  document.getElementById('detail-layout').innerHTML = `
    <div class="detail-main">
      <div class="detail-tags">
        ${job.department ? `<span class="tag tag--category">${esc(job.department)}</span>` : ''}
        <span class="tag tag--category">${esc(cat.label)}</span>
        <span class="tag ${statusInfo.cls}">${statusInfo.label}</span>
      </div>
      <h1 class="detail-title">${esc(job.title)}</h1>
      <div class="detail-section">
        <p class="detail-section-title">岗位描述</p>
        <p class="detail-desc">${esc(job.description || '')}</p>
      </div>
      ${reqs ? `<div class="detail-section">
        <p class="detail-section-title">具体要求</p>
        <ul class="req-list">${reqs}</ul>
      </div>` : ''}
      ${job.deliverables ? `<div class="detail-section">
        <p class="detail-section-title">交付物</p>
        <p class="detail-desc" style="margin-bottom:0;">${esc(job.deliverables)}</p>
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
      </div>
    </aside>

    <div class="detail-cta-row">
      ${isClosed
        ? `<button class="btn btn--ghost btn--lg" disabled style="cursor:not-allowed;">招募已截止</button>`
        : `<a href="${applyUrl}" class="btn btn--primary btn--lg">立即投递</a>`}
      <button class="btn btn--ghost btn--lg" onclick="if(window.openChatWidget)openChatWidget();">咨询岗位问题</button>
      <button class="btn btn--ghost btn--lg detail-share-btn" onclick="copyLink()">复制链接</button>
      <button class="btn btn--ghost btn--lg detail-share-btn" onclick="openPoster()">生成海报</button>
    </div>`;

  const mobileBar = document.getElementById('apply-bar-mobile');
  if (!isClosed) {
    mobileBar.style.display = 'block';
    document.getElementById('apply-btn-mobile').onclick = () => { window.location.href = applyUrl; };
  } else {
    mobileBar.style.display = 'none';
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
          <span class="job-card__icon">${esc(cat.icon)}</span>
          <span class="tag tag--open">招募中</span>
        </div>
        <div class="job-card__body">
          <div class="job-card__meta"><span class="tag tag--category">${esc(cat.label)}</span></div>
          <h3 class="job-card__title">${esc(job.title)}</h3>
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

/* ===== 海报生成 ===== */
let _currentJob = null;

function openPoster() {
  if (!_currentJob) return;
  document.getElementById('poster-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  drawPoster(_currentJob);
}
window.openPoster = openPoster;

function closePosterBtn() {
  document.getElementById('poster-overlay').classList.remove('active');
  document.body.style.overflow = '';
}
window.closePosterBtn = closePosterBtn;

function closePoster(e) {
  if (e.target === document.getElementById('poster-overlay')) closePosterBtn();
}
window.closePoster = closePoster;

function downloadPoster() {
  const canvas = document.getElementById('poster-canvas');
  const a = document.createElement('a');
  a.download = `about编辑部-${(_currentJob?.title || '岗位').slice(0, 12)}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}
window.downloadPoster = downloadPoster;

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split('');
  let line = '';
  let currentY = y;
  for (let i = 0; i < chars.length; i++) {
    const testLine = line + chars[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = chars[i];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, currentY);
  return currentY;
}

async function generateQRDataURL(url) {
  return new Promise((resolve, reject) => {
    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.left = '-9999px';
    document.body.appendChild(div);
    try {
      const qr = new QRCode(div, {
        text: url, width: 200, height: 200,
        colorDark: '#2C4A3E', colorLight: '#FFFFFF',
        correctLevel: QRCode.CorrectLevel.M,
      });
      setTimeout(() => {
        const img = div.querySelector('img') || div.querySelector('canvas');
        const src = img?.src || (img instanceof HTMLCanvasElement ? img.toDataURL() : null);
        document.body.removeChild(div);
        src ? resolve(src) : reject(new Error('QR generation failed'));
      }, 200);
    } catch (e) {
      document.body.removeChild(div);
      reject(e);
    }
  });
}

async function drawPoster(job) {
  const canvas = document.getElementById('poster-canvas');
  const W = 750, H = 1200;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const cat = Utils.getCategoryInfo(job.category);
  const dl = Utils.deadlineText(job.deadline);
  const fee = job.fee ? `¥${job.fee}` : '面议';
  const url = window.location.href;

  // ── 背景 ──
  ctx.fillStyle = '#FAF8F5';
  ctx.fillRect(0, 0, W, H);

  // ── 顶部色块 ──
  const coverColor = job.coverColor || cat.color || '#E8DDD0';
  ctx.fillStyle = coverColor;
  ctx.fillRect(0, 0, W, 380);

  // ── 顶部 icon ──
  ctx.font = '72px serif';
  ctx.textAlign = 'center';
  ctx.fillText(cat.icon, W / 2, 180);

  // ── 品牌名 ──
  ctx.font = 'bold 22px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText('about编辑部', W / 2, 240);

  // ── 类型标签 ──
  const tagText = cat.label;
  ctx.font = '20px "PingFang SC", "Noto Sans SC", sans-serif';
  const tagW = ctx.measureText(tagText).width + 32;
  const tagX = (W - tagW) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  roundRect(ctx, tagX, 268, tagW, 36, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(tagText, W / 2, 292);

  // ── 岗位标题 ──
  ctx.fillStyle = '#1A1A1A';
  ctx.textAlign = 'left';
  ctx.font = 'bold 44px "PingFang SC", "Noto Sans SC", sans-serif';
  const titleY = wrapText(ctx, job.title, 60, 460, W - 120, 58);

  // ── 截止日期 ──
  ctx.fillStyle = '#999999';
  ctx.font = '24px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillText('截止日期', 60, titleY + 60);
  ctx.fillStyle = '#1A1A1A';
  ctx.textAlign = 'right';
  ctx.fillText(dl.text, W - 60, titleY + 60);
  ctx.textAlign = 'left';

  // ── 简介（截取前60字）──
  if (job.description) {
    ctx.fillStyle = '#5C5C5C';
    ctx.font = '26px "PingFang SC", "Noto Sans SC", sans-serif';
    const descShort = job.description.replace(/\n/g, ' ').slice(0, 60) + (job.description.length > 60 ? '…' : '');
    wrapText(ctx, descShort, 60, titleY + 120, W - 120, 42);
  }

  // ── 底部区域 ──
  ctx.fillStyle = '#2C4A3E';
  ctx.fillRect(0, H - 240, W, 240);

  // ── 二维码 ──
  try {
    const qrSrc = await generateQRDataURL(url);
    const qrImg = new Image();
    await new Promise(res => { qrImg.onload = res; qrImg.onerror = res; qrImg.src = qrSrc; });
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 60, H - 210, 160, 160, 12);
    ctx.fill();
    ctx.drawImage(qrImg, 68, H - 202, 144, 144);
  } catch (_) { /* QR 失败静默 */ }

  // ── 底部文案 ──
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 28px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('扫码查看岗位详情', 250, H - 145);
  ctx.font = '22px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('about编辑部', 250, H - 105);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

document.addEventListener('DOMContentLoaded', async () => {

  if (!jobId) {
    document.getElementById('detail-layout').innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--color-text-muted);">参数缺失，<a href="index.html" style="color:var(--color-brand);">返回首页</a></div>`;
    return;
  }

  const job = await Store.getJobById(jobId);
  if (!job) {
    document.getElementById('detail-layout').innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--color-text-muted);">岗位不存在，<a href="index.html" style="color:var(--color-brand);">返回首页</a></div>`;
    return;
  }

  _currentJob = job;
  renderDetail(job);
  await renderRelated(job);
});
