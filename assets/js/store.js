/* ===== STORE.JS — API 客户端（fetch 版）===== */

const API = '/api';

function _adminHeaders(extra = {}) {
  const token = sessionStorage.getItem('mgs_admin_token');
  const h = { 'Content-Type': 'application/json', ...extra };
  if (token) h['X-Admin-Token'] = token;
  return h;
}

async function _get(url) {
  const res = await fetch(url, { headers: _adminHeaders() });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}
async function _post(url, data) {
  const res = await fetch(url, {
    method: 'POST', headers: _adminHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `POST ${url} failed: ${res.status}`);
    e.status = res.status; e.data = err;
    throw e;
  }
  return res.json();
}
async function _put(url, data) {
  const res = await fetch(url, {
    method: 'PUT', headers: _adminHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PUT ${url} failed: ${res.status}`);
  return res.json();
}
async function _patch(url, data) {
  const res = await fetch(url, {
    method: 'PATCH', headers: _adminHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PATCH ${url} failed: ${res.status}`);
  return res.json();
}
async function _delete(url) {
  const res = await fetch(url, { method: 'DELETE', headers: _adminHeaders() });
  if (!res.ok) throw new Error(`DELETE ${url} failed: ${res.status}`);
  return res.json();
}
function _qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

const Store = {

  /* ====== AUTH ====== */
  async adminLogin(username, password) {
    const res = await fetch(`${API}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    const { token } = await res.json();
    sessionStorage.setItem('mgs_admin_token', token);
    return true;
  },
  adminLogout() {
    const token = sessionStorage.getItem('mgs_admin_token');
    if (token) {
      fetch(`${API}/admin/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      }).catch(() => {});
    }
    sessionStorage.removeItem('mgs_admin_token');
  },
  isAdminLoggedIn() {
    return !!sessionStorage.getItem('mgs_admin_token');
  },
  getCurrentUser() {
    const token = sessionStorage.getItem('mgs_admin_token');
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { id: payload.sub, username: payload.username, displayName: payload.displayName, role: payload.role };
    } catch { return null; }
  },
  isSuperAdmin() {
    const u = this.getCurrentUser();
    return u?.role === 'superadmin';
  },

  /* ====== JOBS ====== */
  async getJobs(filters = {}) {
    return _get(`${API}/jobs${_qs(filters)}`);
  },
  async getJobById(id) {
    try { return await _get(`${API}/jobs/${id}`); }
    catch { return null; }
  },
  async createJob(data) {
    return _post(`${API}/jobs`, data);
  },
  async updateJob(id, data) {
    return _put(`${API}/jobs/${id}`, data);
  },
  async deleteJob(id) {
    return _delete(`${API}/jobs/${id}`);
  },
  async getAllJobsAdmin(filters = {}) {
    return _get(`${API}/jobs/admin${_qs(filters)}`);
  },

  /* ====== APPLICATIONS ====== */
  async getApplications(filters = {}) {
    return _get(`${API}/applications${_qs(filters)}`);
  },
  async getApplicationById(id) {
    try { return await _get(`${API}/applications/${id}`); }
    catch { return null; }
  },
  async getApplicationsByEmail(email) {
    return _get(`${API}/applications${_qs({ email })}`);
  },
  async createApplication(data) {
    return _post(`${API}/applications`, data);
  },
  async updateApplicationStatus(id, status, note = '') {
    return _patch(`${API}/applications/${id}/status`, { status, note });
  },
  async updateApplicationNote(id, note) {
    return _patch(`${API}/applications/${id}/note`, { note });
  },
  async getAppStatusCounts(jobId) {
    return _get(`${API}/applications/counts${_qs({ jobId: jobId || '' })}`);
  },

  /* ====== COLLABORATORS ====== */
  async getCollaborators(filters = {}) {
    return _get(`${API}/collaborators${_qs(filters)}`);
  },
  async getCollaboratorById(id) {
    try { return await _get(`${API}/collaborators/${id}`); }
    catch { return null; }
  },
  async createCollaboratorFromApp(appId) {
    return _post(`${API}/collaborators/from-app/${appId}`, {});
  },
  async updateCollaborator(id, data) {
    return _put(`${API}/collaborators/${id}`, data);
  },
  async deleteCollaborator(id) {
    return _delete(`${API}/collaborators/${id}`);
  },

  /* ====== ADMIN USERS ====== */
  async listAdminUsers() {
    return _get(`${API}/admin-users`);
  },
  async createAdminUser(data) {
    return _post(`${API}/admin-users`, data);
  },
  async deleteAdminUser(id) {
    return _delete(`${API}/admin-users/${id}`);
  },
  async resetAdminUserPassword(id, newPassword) {
    return _patch(`${API}/admin-users/${id}/password`, { newPassword });
  },
  async changeMyPassword(currentPassword, newPassword) {
    return _patch(`${API}/admin/me/password`, { currentPassword, newPassword });
  },

  /* ====== MEMBER NOTES ====== */
  async getMemberNote(appId) {
    return _get(`${API}/admin/notes/${appId}`);
  },
  async saveMemberNote(appId, note) {
    return _put(`${API}/admin/notes/${appId}`, { note });
  },

  /* ====== MEMBER PREFERENCES ====== */
  async getPreferences() {
    return _get(`${API}/admin/preferences`);
  },
  async savePreferences(prefs) {
    return _put(`${API}/admin/preferences`, prefs);
  },

  /* ====== STATS ====== */
  async getStats() {
    return _get(`${API}/stats`);
  },

  /* ====== SEED（由服务端在启动时自动执行，前端不再调用）====== */
  async seedDemoData() {
    return Promise.resolve();
  },
};

window.Store = Store;
