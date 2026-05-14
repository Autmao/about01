/* ===== STORE.JS — API 客户端（fetch 版）===== */

const PRODUCTION_ORIGIN = 'https://about01.vercel.app';

function _redirectFilePreviewToProduction() {
  if (window.location.protocol !== 'file:') return;
  const rawPath = decodeURIComponent(window.location.pathname || '');
  const marker = '/about01/';
  const idx = rawPath.lastIndexOf(marker);
  const appPath = idx >= 0 ? rawPath.slice(idx + marker.length) : 'index.html';
  window.location.replace(`${PRODUCTION_ORIGIN}/${appPath}${window.location.search}${window.location.hash}`);
}

_redirectFilePreviewToProduction();

const API = window.location.origin === 'null' ? `${PRODUCTION_ORIGIN}/api` : '/api';

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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PUT ${url} failed: ${res.status}`);
  }
  return res.json();
}
async function _patch(url, data) {
  const res = await fetch(url, {
    method: 'PATCH', headers: _adminHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PATCH ${url} failed: ${res.status}`);
  }
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
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(decodeURIComponent(atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
      return {
        id: payload.sub,
        username: payload.username,
        displayName: payload.displayName,
        notificationEmail: payload.notificationEmail || '',
        role: payload.role,
      };
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
    if (this.isAdminLoggedIn()) {
      try { return await _get(`${API}/jobs/admin/${id}`); }
      catch {}
    }
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
  async getMyApplications(email) {
    return _get(`${API}/applications/my${_qs({ email })}`);
  },

  /* ====== USER AUTH (手机号 OTP) ====== */
  async sendUserOtp(phone) {
    const res = await fetch(`${API}/users/send-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error || 'Failed');
      e.status = res.status;
      throw e;
    }
    return res.json();
  },
  async verifyUserOtp(phone, code, name, email) {
    const res = await fetch(`${API}/users/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, name, email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error || 'Failed');
      e.status = res.status;
      throw e;
    }
    const { token, user } = await res.json();
    localStorage.setItem('mgs_user_token', token);
    localStorage.setItem('mgs_user_info', JSON.stringify(user));
    return user;
  },
  isUserLoggedIn() {
    return !!localStorage.getItem('mgs_user_token');
  },
  getCurrentApplicant() {
    try {
      const info = localStorage.getItem('mgs_user_info');
      if (info) return JSON.parse(info);
      const token = localStorage.getItem('mgs_user_token');
      if (!token) return null;
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(decodeURIComponent(atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
      return { id: payload.sub, phone: payload.phone };
    } catch { return null; }
  },
  userLogout() {
    localStorage.removeItem('mgs_user_token');
    localStorage.removeItem('mgs_user_info');
  },
  async getMe() {
    const token = localStorage.getItem('mgs_user_token');
    if (!token) throw new Error('Not logged in');
    const res = await fetch(`${API}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 401) { this.userLogout(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },
  async updateMe(data) {
    const token = localStorage.getItem('mgs_user_token');
    if (!token) throw new Error('Not logged in');
    const res = await fetch(`${API}/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed');
    const user = await res.json();
    localStorage.setItem('mgs_user_info', JSON.stringify(user));
    return user;
  },
  async getUserApplications() {
    const token = localStorage.getItem('mgs_user_token');
    if (!token) throw new Error('Not logged in');
    const res = await fetch(`${API}/users/me/applications`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 401) { this.userLogout(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },
  async createApplication(data) {
    const token = localStorage.getItem('mgs_user_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API}/applications`, {
      method: 'POST', headers, body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error || `POST failed: ${res.status}`);
      e.status = res.status; e.data = err;
      throw e;
    }
    return res.json();
  },

  /* ====== APPLICANT AUTH ====== */
  async sendOtp(email) {
    const res = await fetch(`${API}/applicant/send-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.message || 'Failed');
      e.code = err.error; e.status = res.status;
      throw e;
    }
    return res.json();
  },
  async verifyOtp(email, code) {
    const res = await fetch(`${API}/applicant/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.message || 'Failed');
      e.code = err.error; e.status = res.status;
      throw e;
    }
    const { token, email: verifiedEmail } = await res.json();
    sessionStorage.setItem('mgs_applicant_token', token);
    sessionStorage.setItem('mgs_applicant_email', verifiedEmail);
    return true;
  },
  getApplicantEmail() {
    return sessionStorage.getItem('mgs_applicant_email') || null;
  },
  isApplicantLoggedIn() {
    return !!sessionStorage.getItem('mgs_applicant_token');
  },
  applicantLogout() {
    sessionStorage.removeItem('mgs_applicant_token');
    sessionStorage.removeItem('mgs_applicant_email');
  },
  async getApplicantApplications() {
    const token = sessionStorage.getItem('mgs_applicant_token');
    if (!token) throw new Error('Not logged in');
    const res = await fetch(`${API}/applicant/me/applications`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 401) {
      this.applicantLogout();
      throw new Error('Session expired');
    }
    if (!res.ok) throw new Error('Failed');
    return res.json();
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
  async getCollaboratorActivity(id) {
    try { return await _get(`${API}/collaborators/${id}/activity`); }
    catch { return { memberNotes: [], actionLog: [] }; }
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
  async getAdminMe() {
    return _get(`${API}/admin/me`);
  },
  async listAdminTeam() {
    return _get(`${API}/admin/team`);
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
  async updateAdminUserNotificationEmail(id, notificationEmail) {
    return _patch(`${API}/admin-users/${id}/notification-email`, { notificationEmail });
  },
  async updateMyNotificationEmail(notificationEmail) {
    return _patch(`${API}/admin/me/notification-email`, { notificationEmail });
  },
  async changeMyPassword(currentPassword, newPassword) {
    return _patch(`${API}/admin/me/password`, { currentPassword, newPassword });
  },

  /* ====== MEMBER NOTES ====== */
  async getMemberNote(appId) {
    return _get(`${API}/admin/notes/${appId}`);
  },
  async getAllMemberNotes(appId) {
    return _get(`${API}/admin/notes/${appId}/all`);
  },
  async archiveToCollaborator(appId) {
    return _post(`${API}/applications/${appId}/archive`, {});
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
