/* ===== ADMIN-COLLAB.JS ===== */

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
  if (navLabel) navLabel.textContent = '账号管理';
}

let currentSort = 'recent';
let currentKeyword = '';
const esc = value => Utils.escapeHtml(value);
const safeUrl = value => Utils.safeUrl(value);

function renderStars(rating, collabId) {
  return [1,2,3,4,5].map(n => `
    <span class="star ${n <= rating ? 'star--filled' : 'star--empty'}"
      onclick="setRating('${collabId}', ${n})">★</span>
  `).join('');
}

function renderCollabCard(collab) {
  const avatar = Utils.getAvatarInfo(collab.name);
  const cats = (collab.categories || []).map(c => {
    const info = Utils.getCategoryInfo(c);
    return `<span class="tag tag--category">${info.label}</span>`;
  }).join('');
  const tags = (collab.internalTags || []).map(t => `<span class="internal-tag">${esc(t)}</span>`).join('');

  return `
    <div class="collab-card" onclick="openModal('${collab.id}')">
      <div class="collab-card__header">
        <div class="avatar avatar--lg" style="background:${avatar.bg}">${esc(avatar.char)}</div>
        <div>
          <div class="collab-card__name">${esc(collab.name)}</div>
          <div class="star-rating" onclick="event.stopPropagation()">
            ${renderStars(collab.rating || 0, collab.id)}
          </div>
        </div>
      </div>
      <div class="collab-card__cats">${cats}</div>
      <div class="collab-card__history">合作 ${(collab.cooperationHistory || []).length} 次 · 加入于 ${esc(Utils.formatDate(collab.addedAt))}</div>
      ${tags ? `<div class="collab-card__tags">${tags}</div>` : ''}
    </div>`;
}

async function renderGrid() {
  const collabs = await Store.getCollaborators({ keyword: currentKeyword, sortBy: currentSort });
  const grid  = document.getElementById('collab-grid');
  const empty = document.getElementById('collab-empty');
  document.getElementById('collab-stats').textContent = `共 ${collabs.length} 位合作者`;

  if (collabs.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = collabs.map(renderCollabCard).join('');
}

async function setRating(collabId, rating) {
  await Store.updateCollaborator(collabId, { rating });
  await renderGrid();
}
window.setRating = setRating;

async function openModal(collabId) {
  const [collab, activity] = await Promise.all([
    Store.getCollaboratorById(collabId),
    Store.getCollaboratorActivity(collabId),
  ]);
  if (!collab) return;

  const avatar = Utils.getAvatarInfo(collab.name);
  const cats = (collab.categories || []).map(c => {
    const info = Utils.getCategoryInfo(c);
    return `<span class="tag tag--category">${info.icon} ${info.label}</span>`;
  }).join(' ');

  const links = (collab.portfolioLinks || []).map(l =>
    `<a href="${safeUrl(l.url)}" target="_blank" rel="noopener" style="display:block;color:var(--color-brand-light);font-size:var(--text-sm);margin-bottom:var(--space-2);">作品链接 · ${esc(l.label || '未命名')}</a>`
  ).join('');

  const history = (collab.cooperationHistory || []).map(h => `
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        ${esc(h.jobTitle || '未知岗位')}
        <div class="timeline-date">${esc(h.date || '')}</div>
      </div>
    </div>`).join('');

  // 成员备注区块
  const memberNotesHtml = (activity.memberNotes || []).length
    ? (activity.memberNotes || []).map(m => `
        <div class="collab-member-notes">
          <div class="collab-member-notes__name">${esc(m.displayName)}</div>
          ${m.notes.map(n => `
            <div class="collab-member-note-item">
              <span class="collab-member-note-item__job">${esc(n.jobTitle || '')}</span>
              <span class="collab-member-note-item__text">${esc(n.note)}</span>
              <span class="collab-member-note-item__time">${esc(n.updatedAt ? n.updatedAt.slice(0,10) : '')}</span>
            </div>`).join('')}
        </div>`).join('')
    : `<p style="font-size:var(--text-sm);color:var(--color-text-muted);">暂无成员备注</p>`;

  // 操作记录区块
  const ACTION_LABELS = { pending:'待查看', read:'已读', hired:'录用', rejected:'婉拒' };
  const actionLogHtml = (activity.actionLog || []).length
    ? (activity.actionLog || []).map(h => {
        const time = h.at ? h.at.slice(0,16).replace('T',' ') : '';
        if (h.action === 'archived') {
          return `<div class="action-log-item">
            <span class="action-log__actor">${esc(h.actor)}</span> 将「${esc(h.jobTitle || '')}」加入了合作档案
            <span class="action-log__time">${esc(time)}</span>
          </div>`;
        }
        return `<div class="action-log-item">
          <span class="action-log__actor">${esc(h.actor)}</span> 将「${esc(h.jobTitle || '')}」标记为「${esc(ACTION_LABELS[h.to] || h.to)}」
          <span class="action-log__time">${esc(time)}</span>
        </div>`;
      }).join('')
    : `<p style="font-size:var(--text-sm);color:var(--color-text-muted);">暂无操作记录</p>`;

  document.getElementById('modal-name').textContent = collab.name;
  document.getElementById('modal-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6);">
      <div class="avatar avatar--lg" style="background:${avatar.bg}">${esc(avatar.char)}</div>
      <div>
        <div style="font-size:var(--text-lg);font-weight:var(--weight-semibold);">${esc(collab.name)}</div>
        <div style="margin-top:var(--space-2);">${cats}</div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">联系方式</div>
      <div style="font-size:var(--text-sm);color:var(--color-text-secondary);line-height:var(--leading-loose);">
        邮箱：${esc(collab.email)}<br>手机：${esc(collab.phone || '—')}${collab.wechat ? `<br>微信：${esc(collab.wechat)}` : ''}
      </div>
    </div>

    ${collab.bio ? `<div class="modal-section">
      <div class="modal-section-title">个人介绍</div>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);line-height:var(--leading-loose);">${esc(collab.bio)}</p>
    </div>` : ''}

    ${links ? `<div class="modal-section">
      <div class="modal-section-title">作品集</div>${links}
    </div>` : ''}

    ${history ? `<div class="modal-section">
      <div class="modal-section-title">合作历史</div>
      <div class="timeline">${history}</div>
    </div>` : ''}

    <div class="modal-section">
      <div class="modal-section-title">成员备注</div>
      ${memberNotesHtml}
    </div>

    <div class="modal-section">
      <div class="modal-section-title">操作记录</div>
      <div class="action-log">${actionLogHtml}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">评分</div>
      <div class="star-rating" id="modal-stars">${renderStars(collab.rating || 0, collab.id)}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">内部标签</div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);" id="modal-tags">
        ${(collab.internalTags || []).map(t => `
          <span class="internal-tag" style="cursor:pointer;" onclick="removeTag('${collab.id}',decodeURIComponent('${encodeURIComponent(t)}'))">
            ${esc(t)} ×
          </span>`).join('')}
      </div>
      <div style="display:flex;gap:var(--space-2);">
        <input type="text" class="form-input" id="new-tag-input" placeholder="新标签..."
          style="font-size:var(--text-sm);"
          onkeydown="if(event.key==='Enter'){addTag('${collab.id}');event.preventDefault();}">
        <button class="btn btn--ghost btn--sm" onclick="addTag('${collab.id}')">添加</button>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">内部备注</div>
      <textarea class="form-input" id="collab-note" rows="3"
        placeholder="仅内部可见的合作评价..."
        onblur="saveCollabNote('${collab.id}', this.value)">${esc(collab.internalNote || '')}</textarea>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:var(--space-3);padding-top:var(--space-4);">
      <button class="btn btn--ghost btn--sm" style="color:var(--color-rejected);border-color:var(--color-rejected);"
        onclick="deleteCollab('${collab.id}')">删除档案</button>
    </div>`;

  document.getElementById('collab-modal').style.display = 'flex';
}
window.openModal = openModal;

function closeModal(e) {
  if (!e || e.target === document.getElementById('collab-modal')) {
    document.getElementById('collab-modal').style.display = 'none';
    renderGrid();
  }
}
window.closeModal = closeModal;

async function addTag(collabId) {
  const input = document.getElementById('new-tag-input');
  const tag = input.value.trim();
  if (!tag) return;
  const collab = await Store.getCollaboratorById(collabId);
  if (!collab) return;
  const tags = collab.internalTags || [];
  if (!tags.includes(tag)) tags.push(tag);
  await Store.updateCollaborator(collabId, { internalTags: tags });
  input.value = '';
  await openModal(collabId);
}
window.addTag = addTag;

async function removeTag(collabId, tag) {
  const collab = await Store.getCollaboratorById(collabId);
  if (!collab) return;
  await Store.updateCollaborator(collabId, {
    internalTags: (collab.internalTags || []).filter(t => t !== tag)
  });
  await openModal(collabId);
}
window.removeTag = removeTag;

async function saveCollabNote(collabId, note) {
  await Store.updateCollaborator(collabId, { internalNote: note });
}
window.saveCollabNote = saveCollabNote;

async function deleteCollab(collabId) {
  const collab = await Store.getCollaboratorById(collabId);
  Utils.showConfirm(`确定删除「${esc(collab?.name)}」的档案？`, async () => {
    await Store.deleteCollaborator(collabId);
    closeModal();
    await renderGrid();
    Utils.showToast('档案已删除', 'success');
  });
}
window.deleteCollab = deleteCollab;

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  initSidebar();
  await renderGrid();

  document.getElementById('sort-select').addEventListener('change', e => {
    currentSort = e.target.value;
    renderGrid();
  });

  document.getElementById('collab-search').addEventListener('input', Utils.debounce(e => {
    currentKeyword = e.target.value.trim();
    renderGrid();
  }, 300));
});
