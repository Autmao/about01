/* ===== JOB-DETAIL.JS ===== */

const params = new URLSearchParams(window.location.search);
const jobId = params.get('id');
const esc = value => Utils.escapeHtml(value);

function jobEditorialLabel(category) {
  const labels = {
    writing: 'WRITING',
    editing: 'EDITING',
    illustration: 'ILLUSTRATION',
    design: 'DESIGN',
    photography: 'PHOTO',
    photo_video: 'PHOTO / VIDEO',
    podcast: 'PODCAST',
    audio_editing: 'AUDIO',
    audio_editor: 'AUDIO',
    planning: 'EVENT',
    event_planner: 'EVENT',
    interview: 'INTERVIEW',
    x: 'X',
    other: 'OPEN CALL',
  };
  return labels[category] || 'OPEN CALL';
}

function safeCssColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : fallback;
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function renderOrderedList(items) {
  const list = (items || []).map(item => String(item || '').trim()).filter(Boolean);
  if (!list.length) return '';
  return `
    <ol class="detail-ordered-list">
      ${list.map((item, index) => `
        <li class="detail-ordered-item">
          <span class="detail-ordered-item__no">${index + 1}.</span>
          <span>${esc(item)}</span>
        </li>`).join('')}
    </ol>`;
}

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
  const applyText = '立即投递';

  document.title = `${job.title} | about编辑部`;
  document.getElementById('bc-title').textContent = '岗位详情';

  const descriptionList = renderOrderedList(splitLines(job.description));
  const reqs = renderOrderedList(job.requirements || []);
  const deliverablesList = renderOrderedList(splitLines(job.deliverables));

  document.getElementById('detail-layout').innerHTML = `
    <div class="detail-main">
      <div class="detail-hashtags" aria-label="岗位标签">
        <span>#${esc(statusInfo.label)}</span>
        <span>#${esc(job.department || 'about编辑部')}</span>
        <span>#${esc(cat.label)}</span>
      </div>
      <h1 class="detail-title">${esc(job.title)}</h1>
      ${descriptionList ? `<div class="detail-section">
        <p class="detail-section-title">岗位描述</p>
        ${descriptionList}
      </div>` : ''}
      ${reqs ? `<div class="detail-section">
        <p class="detail-section-title">具体要求</p>
        ${reqs}
      </div>` : ''}
      ${deliverablesList ? `<div class="detail-section">
        <p class="detail-section-title">交付要求</p>
        ${deliverablesList}
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

}

async function renderRelated(currentJob) {
  const allJobs = await Store.getJobs({ status: 'open' });
  const related = allJobs.filter(j => j.id !== currentJob.id).slice(0, 3);
  if (related.length === 0) return;

  document.getElementById('related-section').style.display = 'block';
  document.getElementById('related-grid').innerHTML = related.map((job) => {
    const cat = Utils.getCategoryInfo(job.category);
    const dept = Utils.getDepartmentInfo(job.department);
    const deptLabel = job.department ? dept.label : 'about编辑部';
    const accent = safeCssColor(job.coverColor, dept.color || cat.color || '#E8DDD0');
    const dl = Utils.deadlineText(job.deadline);
    return `
      <article class="job-card" onclick="window.location.href='job-detail.html?id=${job.id}'">
        <div class="job-card__cover job-card__cover--editorial" style="--job-accent:${accent};">
          <span class="job-card__cover-dept">${esc(deptLabel)}</span>
          <span class="job-card__cover-type">${esc(jobEditorialLabel(job.category))}</span>
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

function posterFont(size, weight = 500, family = '"PingFang SC", "Noto Sans SC", sans-serif') {
  return `${weight} ${size}px ${family}`;
}

function normalizePosterText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[•*]+/g, '')
    .replace(/[—–-]{2,}/g, ' ')
    .trim();
}

function ellipsizeText(ctx, text, maxWidth, force = false) {
  let clipped = String(text || '').trim();
  if (!force && ctx.measureText(clipped).width <= maxWidth) return clipped;
  while (ctx.measureText(`${clipped}…`).width > maxWidth && clipped.length > 0) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped || ''}…`;
}

function splitCanvasLines(ctx, text, maxWidth) {
  const source = normalizePosterText(text);
  if (!source) return [];
  const lines = [];
  let line = '';
  for (const char of source.split('')) {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line.trim());
      line = char.trimStart();
    } else {
      line = testLine;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function fitWrappedText(ctx, text, maxWidth, {
  maxLines = 3,
  maxHeight = Infinity,
  minSize = 24,
  maxSize = 72,
  weight = 600,
  lineRatio = 1.16,
} = {}) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = posterFont(size, weight);
    const lineHeight = Math.round(size * lineRatio);
    const lines = splitCanvasLines(ctx, text, maxWidth);
    const height = lines.length ? (lines.length - 1) * lineHeight + size : 0;
    if (lines.length <= maxLines && height <= maxHeight) {
      return { size, lineHeight, lines };
    }
  }

  ctx.font = posterFont(minSize, weight);
  const lineHeight = Math.round(minSize * lineRatio);
  const lines = splitCanvasLines(ctx, text, maxWidth).slice(0, maxLines);
  if (lines.length) lines[lines.length - 1] = ellipsizeText(ctx, lines[lines.length - 1], maxWidth, true);
  return { size: minSize, lineHeight, lines };
}

function drawTextLines(ctx, lines, x, y, lineHeight) {
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return lines.length ? y + (lines.length - 1) * lineHeight : y;
}

function drawFittedLine(ctx, text, x, y, maxWidth) {
  ctx.fillText(ellipsizeText(ctx, normalizePosterText(text), maxWidth), x, y);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const allLines = splitCanvasLines(ctx, text, maxWidth);
  const lines = allLines.slice(0, maxLines);
  if (lines.length && allLines.length > maxLines) {
    lines[lines.length - 1] = ellipsizeText(ctx, lines[lines.length - 1], maxWidth, true);
  }
  return drawTextLines(ctx, lines, x, y, lineHeight);
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
  const contentX = 104;
  const contentW = W - 208;
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
  ctx.font = posterFont(22, 700, '"SF Pro Display", "PingFang SC", sans-serif');
  ctx.fillText('POSITION', contentX, 188);
  ctx.font = posterFont(22, 500);
  ctx.fillStyle = '#6f6a60';
  drawFittedLine(ctx, `${job.department || 'about编辑部'} / ${cat.label}`, contentX, 224, contentW);

  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  const title = fitWrappedText(ctx, job.title, contentW, {
    maxLines: 5,
    maxHeight: 260,
    minSize: 38,
    maxSize: 72,
    weight: 760,
    lineRatio: 1.14,
  });
  ctx.font = posterFont(title.size, 760);
  const titleLastY = drawTextLines(ctx, title.lines, contentX, 320, title.lineHeight);

  ctx.strokeStyle = 'rgba(17,17,17,0.82)';
  ctx.lineWidth = 2;
  const dividerY = Math.min(Math.max(titleLastY + 38, 438), 590);
  ctx.beginPath();
  ctx.moveTo(contentX, dividerY);
  ctx.lineTo(W - contentX, dividerY);
  ctx.stroke();

  const metaY = dividerY + 58;
  const meta = [
    ['截止日期', dl.text],
    ['招募人数', `${job.slots || 1} 人`],
    ['稿费', fee],
    ['结算方式', Utils.feeTypeLabel(job.feeType)],
  ];
  ctx.font = posterFont(20, 500);
  meta.forEach((item, i) => {
    const x = contentX + (i % 2) * 338;
    const y = metaY + Math.floor(i / 2) * 82;
    const valueW = 278;
    ctx.fillStyle = '#8a8377';
    ctx.fillText(item[0], x, y);
    ctx.fillStyle = '#111111';
    ctx.font = posterFont(28, 700);
    drawFittedLine(ctx, String(item[1]), x, y + 36, valueW);
    ctx.font = posterFont(20, 500);
  });

  const descY = Math.min(metaY + 204, 848);
  ctx.fillStyle = '#3f3b34';
  const desc = fitWrappedText(ctx, job.description || '打开岗位详情，查看项目背景、具体要求与投递方式。', contentW, {
    maxLines: 3,
    maxHeight: 118,
    minSize: 22,
    maxSize: 28,
    weight: 400,
    lineRatio: 1.5,
  });
  ctx.font = posterFont(desc.size, 400);
  drawTextLines(ctx, desc.lines, contentX, descY, desc.lineHeight);

  ctx.fillStyle = '#111111';
  ctx.fillRect(64, H - 160, W - 128, 68);
  ctx.fillStyle = '#fbf8f1';
  ctx.font = posterFont(24, 700);
  ctx.fillText('扫码查看岗位详情', contentX, H - 118);

  try {
    const qrSrc = await generateQRDataURL(url);
    const qrImg = new Image();
    await new Promise(res => { qrImg.onload = res; qrImg.onerror = res; qrImg.src = qrSrc; });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(W - 236, H - 256, 172, 172);
    ctx.drawImage(qrImg, W - 226, H - 246, 152, 152);
  } catch (_) { /* QR 失败静默 */ }

  ctx.fillStyle = '#b84a36';
  ctx.font = posterFont(22, 700, '"SF Pro Display", "PingFang SC", sans-serif');
  ctx.textAlign = 'left';
  ctx.fillText('CREATIVE PARTNER RECRUITMENT', contentX, H - 204);
  ctx.fillStyle = 'rgba(17,17,17,0.48)';
  ctx.font = posterFont(18, 400, '"SF Pro Display", "PingFang SC", sans-serif');
  ctx.textAlign = 'left';
  ctx.fillText('about editor desk open call', contentX, H - 60);
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
