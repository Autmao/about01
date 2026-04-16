/* ===== UTILS.JS — 通用工具函数 ===== */

const Utils = {
  /* 日期格式化 */
  formatDate(isoString, format = 'YYYY-MM-DD') {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return format
      .replace('YYYY', d.getFullYear())
      .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(d.getDate()).padStart(2, '0'));
  },

  /* 相对时间 */
  relativeTime(isoString) {
    if (!isoString) return '—';
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1)  return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)   return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30)    return `${days}天前`;
    return this.formatDate(isoString);
  },

  /* 截止日期文案 */
  deadlineText(dateString) {
    if (!dateString) return { text: '—', cls: '' };
    const deadline = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    deadline.setHours(0, 0, 0, 0);
    const days = Math.round((deadline - today) / 86400000);
    if (days < 0)    return { text: '已截止', cls: 'deadline--passed' };
    if (days === 0)  return { text: '今日截止', cls: 'deadline--urgent' };
    if (days <= 3)   return { text: `仅剩 ${days} 天`, cls: 'deadline--urgent' };
    if (days <= 7)   return { text: `还有 ${days} 天`, cls: 'deadline--soon' };
    return { text: dateString, cls: 'deadline--normal' };
  },

  /* 工种类型映射 */
  categoryMap: {
    writing:     { label: '撰稿',    icon: '✍️',  color: '#D0DDE8' },
    interview:   { label: '采访',    icon: '🎙️', color: '#E8E0D0' },
    editing:     { label: '编辑',    icon: '📝',  color: '#D8D0E8' },
    photography: { label: '摄影',    icon: '📷',  color: '#E8DDD0' },
    planning:    { label: '活动策划', icon: '🎪', color: '#D8E8D0' },
    other:       { label: '其他',    icon: '✨',  color: '#E8D0D8' },
  },

  getCategoryInfo(category) {
    return this.categoryMap[category] || { label: category, icon: '✦', color: '#F0EDE6' };
  },

  /* 投递状态映射 */
  statusMap: {
    pending:  { label: '待查看', cls: 'tag--pending' },
    read:     { label: '已读',   cls: 'tag--read' },
    hired:    { label: '已录用', cls: 'tag--hired' },
    rejected: { label: '已婉拒', cls: 'tag--rejected' },
  },

  getStatusInfo(status) {
    return this.statusMap[status] || { label: status, cls: '' };
  },

  /* 工种状态映射 */
  jobStatusMap: {
    open:   { label: '招募中', cls: 'tag--open' },
    closed: { label: '已截止', cls: 'tag--closed' },
    draft:  { label: '草稿',   cls: 'tag--draft' },
  },

  /* 头像占位（首字母 + 颜色） */
  getAvatarInfo(name) {
    const char = name ? (name[0]) : '?';
    const colors = ['#E8DDD0', '#D0DDE8', '#D8E8D0', '#E8D0D8', '#E8E0D0', '#D8D0E8'];
    const idx = name ? name.charCodeAt(0) % colors.length : 0;
    return { char, bg: colors[idx] };
  },

  /* Toast 通知 */
  showToast(message, type = 'success', duration = 3000) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { requestAnimationFrame(() => { toast.classList.add('toast--visible'); }); });
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /* 确认弹窗 */
  showConfirm(message, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-message">${message}</p>
        <div class="confirm-actions">
          <button class="btn btn--ghost btn--sm confirm-cancel">取消</button>
          <button class="btn btn--primary btn--sm confirm-ok">确认</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.confirm-ok').onclick  = () => { overlay.remove(); onConfirm && onConfirm(); };
    overlay.querySelector('.confirm-cancel').onclick = () => { overlay.remove(); onCancel && onCancel(); };
  },

  /* 稿费类型标签 */
  feeTypeLabel(type) {
    const map = { per_project: '按项目', per_word: '按字数', per_day: '按天', negotiable: '面议' };
    return map[type] || type;
  },

  /* 防抖 */
  debounce(fn, ms = 300) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  },

  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

window.Utils = Utils;
