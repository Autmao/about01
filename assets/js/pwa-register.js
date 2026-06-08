(() => {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isSecure = window.location.protocol === 'https:' || isLocalhost;
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isAdmin = window.location.pathname.startsWith('/admin');
  const params = new URLSearchParams(window.location.search);
  const previewMode = params.get('pwa-preview');
  const dismissKey = 'about-pwa-install-dismissed-at';
  const dismissDays = 7;
  let deferredPrompt = null;

  if ('serviceWorker' in navigator && isSecure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(error => {
        console.warn('[pwa] service worker registration failed:', error);
      });
    });
  }

  if (isAdmin || isStandalone) return;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallAction();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    showInstalledState();
  });

  function shouldShowGuide() {
    if (previewMode) return true;
    const dismissedAt = Number(localStorage.getItem(dismissKey) || 0);
    if (!dismissedAt) return true;
    return Date.now() - dismissedAt > dismissDays * 24 * 60 * 60 * 1000;
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (previewMode === 'ios') return 'ios';
    if (previewMode === 'android') return 'android';
    if (previewMode === 'desktop') return 'desktop';
    if (isIOS) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  function platformCopy(platform = detectPlatform()) {
    if (!isSecure) {
      return {
        label: '安全访问',
        title: '请用安全链接打开',
        steps: [
          '使用 https://join.aboutmgz.com 打开页面。',
          '回到这里后，再添加到手机主屏幕或电脑桌面。',
        ],
      };
    }
    if (platform === 'ios') {
      return {
        label: 'iPhone / iPad',
        title: '在手机主屏幕保留入口',
        steps: [
          '点击浏览器底部的分享按钮。',
          '选择“添加到主屏幕”。',
          '确认名称为 about recruit 后保存。',
        ],
      };
    }
    if (platform === 'android') {
      return {
        label: 'Android',
        title: '添加到手机桌面',
        steps: [
          '点击浏览器右上角菜单。',
          '选择“安装应用”或“添加到主屏幕”。',
          '确认后即可从桌面进入。',
        ],
      };
    }
    return {
      label: '电脑',
      title: '保存为电脑桌面入口',
      steps: [
        '使用 Chrome 或 Edge 打开页面。',
        '点击地址栏右侧的安装图标。',
        '选择“安装 about recruit”。',
      ],
    };
  }

  function otherDeviceGuides(currentPlatform) {
    if (!isSecure) return '';
    return ['ios', 'android', 'desktop']
      .filter(platform => platform !== currentPlatform)
      .map(platform => {
        const copy = platformCopy(platform);
        return `
          <div class="pwa-install__other-item">
            <p>${copy.label}</p>
            <ol>
              ${copy.steps.map(step => `<li>${step}</li>`).join('')}
            </ol>
          </div>`;
      })
      .join('');
  }

  function createGuide() {
    if (!shouldShowGuide() || document.querySelector('.pwa-install')) return;
    const platform = detectPlatform();
    const copy = platformCopy(platform);
    const otherGuides = otherDeviceGuides(platform);
    const guide = document.createElement('section');
    guide.className = 'pwa-install';
    guide.setAttribute('aria-label', '添加到桌面');
    guide.innerHTML = `
      <div class="pwa-install__panel" role="dialog" aria-modal="false" aria-label="添加 about recruit 到桌面">
        <button class="pwa-install__close" type="button" aria-label="稍后再说"></button>
        <div class="pwa-install__head">
          <img src="/assets/icons/about-icon-192.png" alt="" width="42" height="42" decoding="async">
          <div>
            <span>${copy.label}</span>
            <strong>把 about recruit 放到桌面</strong>
          </div>
        </div>
        <p class="pwa-install__desc">之后可以更快查看创作项目、投递进度和咨询记录。</p>
        <div class="pwa-install__actions">
          <button class="pwa-install__primary" type="button">添加到桌面</button>
          <button class="pwa-install__secondary" type="button">稍后</button>
        </div>
        <div class="pwa-install__steps" hidden>
          <p>${copy.title}</p>
          <ol>
            ${copy.steps.map(step => `<li>${step}</li>`).join('')}
          </ol>
          ${otherGuides ? `
            <button class="pwa-install__other-toggle" type="button" aria-expanded="false">查看其他设备添加方式</button>
            <div class="pwa-install__other" hidden>
              ${otherGuides}
            </div>
          ` : ''}
        </div>
      </div>`;
    document.body.appendChild(guide);

    const close = guide.querySelector('.pwa-install__close');
    const primary = guide.querySelector('.pwa-install__primary');
    const secondary = guide.querySelector('.pwa-install__secondary');
    const otherToggle = guide.querySelector('.pwa-install__other-toggle');

    close.addEventListener('click', dismissGuide);
    secondary.addEventListener('click', dismissGuide);
    primary.addEventListener('click', handlePrimaryAction);
    otherToggle?.addEventListener('click', () => toggleOtherDevices(guide));

    if (previewMode) {
      togglePanel(true);
    } else {
      window.setTimeout(() => togglePanel(true), 1600);
    }
    updateInstallAction();
  }

  function togglePanel(force) {
    const guide = document.querySelector('.pwa-install');
    if (!guide) return;
    const shouldOpen = typeof force === 'boolean' ? force : !guide.classList.contains('is-open');
    guide.classList.toggle('is-open', shouldOpen);
  }

  function updateInstallAction() {
    const primary = document.querySelector('.pwa-install__primary');
    if (!primary) return;
    primary.textContent = deferredPrompt ? '直接添加' : '添加到桌面';
  }

  async function handlePrimaryAction() {
    const steps = document.querySelector('.pwa-install__steps');
    if (deferredPrompt && !previewMode) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      updateInstallAction();
      return;
    }
    if (steps) steps.hidden = false;
  }

  function toggleOtherDevices(guide) {
    const panel = guide.querySelector('.pwa-install__other');
    const trigger = guide.querySelector('.pwa-install__other-toggle');
    if (!panel || !trigger) return;
    const nextOpen = panel.hidden;
    panel.hidden = !nextOpen;
    trigger.setAttribute('aria-expanded', String(nextOpen));
    trigger.textContent = nextOpen ? '收起其他设备添加方式' : '查看其他设备添加方式';
  }

  function dismissGuide() {
    if (!previewMode) localStorage.setItem(dismissKey, String(Date.now()));
    document.querySelector('.pwa-install')?.remove();
  }

  function showInstalledState() {
    const guide = document.querySelector('.pwa-install');
    if (!guide) return;
    guide.classList.add('is-open', 'is-installed');
    const desc = guide.querySelector('.pwa-install__desc');
    if (desc) desc.textContent = '已添加到桌面，之后可以从桌面入口直接打开。';
    const actions = guide.querySelector('.pwa-install__actions');
    const steps = guide.querySelector('.pwa-install__steps');
    if (actions) actions.hidden = true;
    if (steps) steps.hidden = true;
    window.setTimeout(() => guide.remove(), 2600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createGuide);
  } else {
    createGuide();
  }
})();
