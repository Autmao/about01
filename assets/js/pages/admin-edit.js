/* ===== ADMIN-EDIT.JS ===== */

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
  if (el) el.textContent = `${user.username}${user.role === 'superadmin' ? ' · 管理员' : ''}`;
  const navAccounts = document.getElementById('nav-accounts');
  if (navAccounts && user.role === 'superadmin') navAccounts.style.display = 'flex';
}

const params = new URLSearchParams(window.location.search);
const editId = params.get('id');
let selectedColor = '#E8DDD0';

function collectData() {
  return {
    title:        document.getElementById('f-title').value.trim(),
    category:     document.getElementById('f-category').value,
    slots:        parseInt(document.getElementById('f-slots').value) || 1,
    description:  document.getElementById('f-desc').value.trim(),
    requirements: document.getElementById('f-reqs').value.trim().split('\n').map(s=>s.trim()).filter(Boolean),
    deliverables: document.getElementById('f-deliverables').value.trim(),
    fee:          document.getElementById('f-fee').value.trim(),
    feeType:      document.getElementById('f-fee-type').value,
    deadline:     document.getElementById('f-deadline').value,
    tags:         document.getElementById('f-tags').value.split(',').map(s=>s.trim()).filter(Boolean),
    coverColor:   selectedColor,
    status:       document.querySelector('input[name=status]:checked').value,
  };
}

function validate(data) {
  const errors = {};
  if (!data.title) errors.title = '请填写岗位名称';
  if (!data.category) errors.category = '请选择岗位类型';
  if (!data.description) errors.desc = '请填写岗位描述';
  if (!data.deadline) errors.deadline = '请选择截止日期';
  return errors;
}

function showErrors(errors) {
  ['title','category','desc','deadline'].forEach(f => {
    const el = document.getElementById(`err-${f}`);
    if (el) el.textContent = errors[f] || '';
  });
}

function fillForm(job) {
  document.getElementById('f-title').value        = job.title || '';
  document.getElementById('f-category').value     = job.category || '';
  document.getElementById('f-slots').value        = job.slots || 1;
  document.getElementById('f-desc').value         = job.description || '';
  document.getElementById('f-reqs').value         = (job.requirements || []).join('\n');
  document.getElementById('f-deliverables').value = job.deliverables || '';
  document.getElementById('f-fee').value          = job.fee || '';
  document.getElementById('f-fee-type').value     = job.feeType || 'per_project';
  document.getElementById('f-deadline').value     = job.deadline || '';
  document.getElementById('f-tags').value         = (job.tags || []).join(', ');

  if (job.coverColor) {
    selectedColor = job.coverColor;
    document.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('selected', s.dataset.color === job.coverColor);
    });
  }
  const statusRadio = document.querySelector(`input[name=status][value="${job.status}"]`);
  if (statusRadio) statusRadio.checked = true;

  document.getElementById('page-title').textContent = '编辑岗位';
  document.getElementById('submit-btn').textContent = '保存修改';
}

async function handleSubmit(e) {
  e.preventDefault();
  const data = collectData();
  const errors = validate(data);
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  const btn = document.getElementById('submit-btn');
  btn.classList.add('btn--loading');
  btn.innerHTML = '<span class="btn-spinner"></span> 保存中...';

  try {
    if (editId) {
      await Store.updateJob(editId, data);
      Utils.showToast('岗位已更新', 'success');
    } else {
      await Store.createJob(data);
      Utils.showToast('岗位已发布', 'success');
    }
    await Utils.sleep(800);
    window.location.href = 'index.html';
  } catch (err) {
    btn.classList.remove('btn--loading');
    btn.textContent = editId ? '保存修改' : '发布岗位';
    Utils.showToast('操作失败，请重试', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  initSidebar();

  if (editId) {
    const job = await Store.getJobById(editId);
    if (job) fillForm(job);
  }

  document.getElementById('color-picker').addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    swatch.classList.add('selected');
    selectedColor = swatch.dataset.color;
  });

  document.getElementById('job-form').addEventListener('submit', handleSubmit);
});
