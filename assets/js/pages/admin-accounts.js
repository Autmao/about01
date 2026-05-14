/* ===== admin-accounts.js ===== */

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
  if (navLabel) navLabel.textContent = user.role === 'superadmin' ? '账号管理' : '账号设置';
  // 非 superadmin 隐藏成员管理区，只留"修改密码"
  if (user.role !== 'superadmin') {
    const mgmt = document.getElementById('member-management-section');
    if (mgmt) mgmt.style.display = 'none';
  }
}

const ROLE_LABELS = { superadmin: '管理员', member: '成员' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function renderUsers() {
  const users = await Store.listAdminUsers();
  const currentUser = Store.getCurrentUser();
  document.getElementById('users-tbody').innerHTML = users.map(u => `
    <tr>
      <td>${esc(u.username)}</td>
      <td>${esc(u.displayName || '—')}</td>
      <td>
        <div style="display:flex;gap:var(--space-2);align-items:center;min-width:260px;">
          <input type="email" class="form-input" id="email-${esc(u.id)}" value="${esc(u.notificationEmail || '')}" placeholder="通知邮箱">
          <button class="action-btn action-btn--edit" onclick="saveMemberEmail('${esc(u.id)}')">保存</button>
        </div>
      </td>
      <td><span class="tag ${u.role === 'superadmin' ? 'tag--hired' : 'tag--read'}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td>${Utils.formatDate(u.createdAt)}</td>
      <td>
        <div class="table-actions">
          <button class="action-btn action-btn--edit" onclick="openResetModal('${esc(u.id)}')">重置密码</button>
          ${u.id !== currentUser?.id
            ? `<button class="action-btn action-btn--delete" onclick="removeMember('${esc(u.id)}','${esc(u.username)}')">删除</button>`
            : `<span style="font-size:var(--text-xs);color:var(--color-text-muted);">（当前账号）</span>`}
        </div>
      </td>
    </tr>`).join('');
}

async function createMember() {
  const username    = document.getElementById('f-username').value.trim();
  const displayName = document.getElementById('f-displayname').value.trim();
  const notificationEmail = document.getElementById('f-email').value.trim().toLowerCase();
  const password    = document.getElementById('f-password').value;
  const role        = document.getElementById('f-role').value;
  const errEl = document.getElementById('create-error');
  errEl.style.display = 'none';
  if (!username || !password) {
    errEl.textContent = '请填写登录账号和密码'; errEl.style.display = 'block'; return;
  }
  if (!/^1[3-9]\d{9}$/.test(username)) {
    errEl.textContent = '登录账号请填写有效的11位手机号'; errEl.style.display = 'block'; return;
  }
  if (!displayName) {
    errEl.textContent = '请填写用户名（后台显示名字）'; errEl.style.display = 'block'; return;
  }
  if (!notificationEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
    errEl.textContent = '请填写有效的通知邮箱'; errEl.style.display = 'block'; return;
  }
  try {
    await Store.createAdminUser({ username, displayName, notificationEmail, password, role });
    document.getElementById('f-username').value = '';
    document.getElementById('f-displayname').value = '';
    document.getElementById('f-email').value = '';
    document.getElementById('f-password').value = '';
    Utils.showToast(`账号「${username}」已创建`, 'success');
    await renderUsers();
  } catch (err) {
    errEl.textContent = err.message || '创建失败';
    errEl.style.display = 'block';
  }
}
window.createMember = createMember;

async function saveMemberEmail(id) {
  const input = document.getElementById(`email-${id}`);
  const notificationEmail = input?.value.trim().toLowerCase();
  if (!notificationEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
    Utils.showToast('请填写有效的通知邮箱', 'error');
    return;
  }
  try {
    await Store.updateAdminUserNotificationEmail(id, notificationEmail);
    Utils.showToast('通知邮箱已保存', 'success');
    await renderUsers();
  } catch (err) {
    Utils.showToast(err.message || '保存失败', 'error');
  }
}
window.saveMemberEmail = saveMemberEmail;

async function removeMember(id, username) {
  Utils.showConfirm(`确定删除账号「${username}」？此操作不可恢复。`, async () => {
    try {
      await Store.deleteAdminUser(id);
      Utils.showToast('账号已删除', 'success');
      await renderUsers();
    } catch (err) {
      Utils.showToast(err.message || '删除失败', 'error');
    }
  });
}
window.removeMember = removeMember;

let _resetTargetId = null;
function openResetModal(userId) {
  _resetTargetId = userId;
  document.getElementById('reset-pwd').value = '';
  document.getElementById('reset-error').style.display = 'none';
  document.getElementById('reset-modal').style.display = 'flex';
}
window.openResetModal = openResetModal;

function closeResetModal(e) {
  if (!e || e.target === document.getElementById('reset-modal')) {
    document.getElementById('reset-modal').style.display = 'none';
    _resetTargetId = null;
  }
}
window.closeResetModal = closeResetModal;

async function doReset() {
  const newPassword = document.getElementById('reset-pwd').value;
  const errEl = document.getElementById('reset-error');
  errEl.style.display = 'none';
  if (!_resetTargetId || !newPassword) return;
  try {
    await Store.resetAdminUserPassword(_resetTargetId, newPassword);
    Utils.showToast('密码已重置', 'success');
    closeResetModal();
  } catch (err) {
    errEl.textContent = err.message || '重置失败';
    errEl.style.display = 'block';
  }
}
window.doReset = doReset;

async function changeMyPwd() {
  const current = document.getElementById('cp-current').value;
  const newPwd  = document.getElementById('cp-new').value;
  const errEl   = document.getElementById('cp-error');
  errEl.style.display = 'none';
  if (!current || !newPwd) {
    errEl.textContent = '请填写当前密码和新密码'; errEl.style.display = 'block'; return;
  }
  try {
    await Store.changeMyPassword(current, newPwd);
    Utils.showToast('密码已修改，请重新登录', 'success');
    setTimeout(() => { Store.adminLogout(); window.location.href = 'login.html'; }, 1500);
  } catch (err) {
    errEl.textContent = err.message || '修改失败';
    errEl.style.display = 'block';
  }
}
window.changeMyPwd = changeMyPwd;

async function loadMyEmail() {
  try {
    const me = await Store.getAdminMe();
    document.getElementById('my-email').value = me.notificationEmail || '';
  } catch {
    const current = Store.getCurrentUser();
    document.getElementById('my-email').value = current?.notificationEmail || '';
  }
}

async function saveMyEmail() {
  const notificationEmail = document.getElementById('my-email').value.trim().toLowerCase();
  const errEl = document.getElementById('email-error');
  errEl.style.display = 'none';
  if (!notificationEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
    errEl.textContent = '请填写有效的通知邮箱';
    errEl.style.display = 'block';
    return;
  }
  try {
    await Store.updateMyNotificationEmail(notificationEmail);
    Utils.showToast('通知邮箱已保存，重新登录后会同步到会话信息', 'success');
    if (Store.isSuperAdmin()) await renderUsers();
  } catch (err) {
    errEl.textContent = err.message || '保存失败';
    errEl.style.display = 'block';
  }
}
window.saveMyEmail = saveMyEmail;

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  initSidebar();
  await loadMyEmail();
  if (Store.isSuperAdmin()) {
    await renderUsers();
  }
});
