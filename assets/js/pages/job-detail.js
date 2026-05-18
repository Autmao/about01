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
  const applicantLoggedIn = Store.isApplicantLoggedIn();
  const applyEntryUrl = applicantLoggedIn
    ? applyUrl
    : `login.html?role=applicant&from=${encodeURIComponent(applyUrl)}`;
  const applyText = applicantLoggedIn ? '立即投递' : '登录后投递';

  document.title = `${job.title} | about编辑部`;
  document.getElementById('bc-title').textContent = '岗位详情';

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
      </div>
    </aside>

    <div class="detail-cta-row">
      ${isClosed
        ? `<button class="btn btn--ghost btn--lg" disabled style="cursor:not-allowed;">招募已截止</button>`
        : `<a href="${applyEntryUrl}" class="btn btn--primary btn--lg">${applyText}</a>`}
      <div class="detail-share">
        <button class="btn btn--ghost btn--lg detail-share-btn" id="detail-share-btn" onclick="toggleShareMenu(event)" aria-haspopup="true" aria-expanded="false">分享岗位</button>
        <div class="detail-share-menu" id="detail-share-menu" hidden>
          <button type="button" onclick="copyLink()">复制链接</button>
          <button type="button" onclick="openPoster()">生成海报</button>
        </div>
      </div>
    </div>`;

  const mobileBar = document.getElementById('apply-bar-mobile');
  if (!isClosed) {
    mobileBar.style.display = 'block';
    const mobileBtn = document.getElementById('apply-btn-mobile');
    mobileBtn.textContent = applyText;
    mobileBtn.onclick = () => { window.location.href = applyEntryUrl; };
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
  closeShareMenu();
  navigator.clipboard.writeText(window.location.href)
    .then(() => Utils.showToast('链接已复制', 'success'))
    .catch(() => Utils.showToast('请手动复制地址栏链接', 'warning'));
}
window.copyLink = copyLink;

function toggleShareMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('detail-share-menu');
  const btn = document.getElementById('detail-share-btn');
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  btn?.setAttribute('aria-expanded', String(willOpen));
}
window.toggleShareMenu = toggleShareMenu;

function closeShareMenu() {
  const menu = document.getElementById('detail-share-menu');
  const btn = document.getElementById('detail-share-btn');
  if (!menu) return;
  menu.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
}
window.closeShareMenu = closeShareMenu;

/* ===== 海报生成 ===== */
let _currentJob = null;

function openPoster() {
  if (!_currentJob) return;
  closeShareMenu();
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

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const chars = text.split('');
  let line = '';
  let currentY = y;
  let lines = 0;
  for (let i = 0; i < chars.length; i++) {
    const testLine = line + chars[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      if (lines + 1 >= maxLines) {
        let clipped = line;
        while (ctx.measureText(`${clipped}…`).width > maxWidth && clipped.length > 0) {
          clipped = clipped.slice(0, -1);
        }
        ctx.fillText(`${clipped}…`, x, currentY);
        return currentY;
      }
      ctx.fillText(line, x, currentY);
      lines++;
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
        colorDark: '#111111', colorLight: '#FFFFFF',
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
  const W = 900, H = 1200;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const cat = Utils.getCategoryInfo(job.category);
  const dl = Utils.deadlineText(job.deadline);
  const fee = job.fee ? `¥${job.fee}` : '面议';
  const url = window.location.href;

  ctx.fillStyle = '#f5f1e8';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(17,17,17,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, W, 92);
  ctx.fillStyle = '#fbf8f1';
  ctx.font = '700 26px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('about编辑部', 64, 58);
  ctx.font = '600 18px "SF Pro Display", "PingFang SC", sans-serif';
  ctx.fillStyle = 'rgba(251,248,241,0.64)';
  ctx.textAlign = 'right';
  ctx.fillText('OPEN CALL 2026', W - 64, 58);

  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 2;
  ctx.strokeRect(64, 132, W - 128, H - 224);

  ctx.fillStyle = '#b84a36';
  ctx.fillRect(64, 132, 12, H - 224);

  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.font = '700 22px "SF Pro Display", "PingFang SC", sans-serif';
  ctx.fillText('POSITION', 104, 188);
  ctx.font = '500 22px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillStyle = '#6f6a60';
  ctx.fillText(`${job.department || 'about编辑部'} / ${cat.label}`, 104, 224);

  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.font = '760 72px "PingFang SC", "Noto Sans SC", sans-serif';
  const titleY = wrapText(ctx, job.title, 104, 332, W - 208, 84, 4);

  ctx.strokeStyle = 'rgba(17,17,17,0.82)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(104, titleY + 44);
  ctx.lineTo(W - 104, titleY + 44);
  ctx.stroke();

  const metaY = titleY + 106;
  const meta = [
    ['截止日期', dl.text],
    ['招募人数', `${job.slots || 1} 人`],
    ['稿费', fee],
    ['结算方式', Utils.feeTypeLabel(job.feeType)],
  ];
  ctx.font = '500 20px "PingFang SC", "Noto Sans SC", sans-serif';
  meta.forEach((item, i) => {
    const x = 104 + (i % 2) * 338;
    const y = metaY + Math.floor(i / 2) * 82;
    ctx.fillStyle = '#8a8377';
    ctx.fillText(item[0], x, y);
    ctx.fillStyle = '#111111';
    ctx.font = '700 28px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText(String(item[1]), x, y + 36);
    ctx.font = '500 20px "PingFang SC", "Noto Sans SC", sans-serif';
  });

  const descY = metaY + 204;
  ctx.fillStyle = '#3f3b34';
  ctx.font = '28px "PingFang SC", "Noto Sans SC", sans-serif';
  const descShort = String(job.description || '打开岗位详情，查看项目背景、具体要求与投递方式。')
    .replace(/\n/g, ' ')
    .slice(0, 86);
  wrapText(ctx, descShort + (String(job.description || '').length > 86 ? '…' : ''), 104, descY, W - 208, 46, 3);

  ctx.fillStyle = '#111111';
  ctx.fillRect(64, H - 160, W - 128, 68);
  ctx.fillStyle = '#fbf8f1';
  ctx.font = '700 24px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillText('扫码查看岗位详情', 104, H - 118);

  try {
    const qrSrc = await generateQRDataURL(url);
    const qrImg = new Image();
    await new Promise(res => { qrImg.onload = res; qrImg.onerror = res; qrImg.src = qrSrc; });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(W - 236, H - 256, 172, 172);
    ctx.drawImage(qrImg, W - 226, H - 246, 152, 152);
  } catch (_) { /* QR 失败静默 */ }

  ctx.fillStyle = '#b84a36';
  ctx.font = '700 22px "SF Pro Display", "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('CREATIVE PARTNER RECRUITMENT', 104, H - 204);
  ctx.fillStyle = 'rgba(17,17,17,0.48)';
  ctx.font = '18px "SF Pro Display", "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('about editor desk open call', 104, H - 60);
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
  document.addEventListener('click', closeShareMenu);

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
