const BASE_STYLE =
  'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:99999;' +
  'background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:8px;' +
  'font-size:13px;line-height:1.4;box-shadow:0 6px 20px rgba(0,0,0,0.25);' +
  'opacity:0;transition:opacity .2s ease;pointer-events:none;';

export function showToast(message: string, duration = 1400): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = BASE_STYLE;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, duration);
}
