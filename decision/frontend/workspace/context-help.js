import './context-help.css';

export function mountContextHelp() {
  const tip = document.createElement('div');
  tip.id = 'workspace-context-tooltip';
  tip.className = 'context-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  const nativePopover = typeof tip.showPopover === 'function' && typeof tip.hidePopover === 'function';
  if (!nativePopover) tip.removeAttribute('popover');
  tip.hidden = true;
  document.body.append(tip);
  let active = null, pinned = false, openTimer, closeTimer;
  const trigger = node => node instanceof Element ? node.closest('button[data-help]') : null;
  const close = () => {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (active) {
      const ids = (active.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tip.id);
      if (ids.length) active.setAttribute('aria-describedby', ids.join(' ')); else active.removeAttribute('aria-describedby');
      active.removeAttribute('data-help-open');
    }
    if (nativePopover && tip.matches(':popover-open')) tip.hidePopover();
    tip.hidden = true; active = null; pinned = false;
  };
  const position = () => {
    if (!active?.isConnected || !active.getClientRects().length) { close(); return; }
    const a = active.getBoundingClientRect(), b = tip.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || document.documentElement.clientWidth, height = viewport?.height || innerHeight;
    if (a.bottom < top || a.top > top + height || a.right < left || a.left > left + width) { close(); return; }
    tip.style.left = Math.max(left + 12, Math.min(left + width - b.width - 12, a.left + a.width / 2 - b.width / 2)) + 'px';
    const below = a.bottom + 8;
    tip.style.top = Math.max(top + 12, Math.min(top + height - b.height - 12, below + b.height <= top + height - 12 ? below : a.top - b.height - 8)) + 'px';
  };
  const open = button => {
    if (!button?.isConnected || !button.dataset.help) return;
    if (active !== button) close();
    clearTimeout(openTimer); clearTimeout(closeTimer);
    active = button; tip.textContent = button.dataset.help; tip.hidden = false;
    const host = document.fullscreenElement || button.closest('dialog[open]') || document.body;
    if (tip.parentElement !== host) host.append(tip);
    const ids = new Set((button.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(tip.id); button.setAttribute('aria-describedby', [...ids].join(' '));
    button.setAttribute('data-help-open', 'true');
    if (nativePopover && !tip.matches(':popover-open')) tip.showPopover();
    position();
  };
  const laterClose = () => { if (!pinned) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 140); } };
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    if (tip.contains(event.target)) { clearTimeout(closeTimer); return; }
    const button = trigger(event.target);
    if (!button || button.contains(event.relatedTarget) || pinned) return;
    clearTimeout(openTimer); clearTimeout(closeTimer); openTimer = setTimeout(() => open(button), 180);
  });
  document.addEventListener('pointerout', event => {
    const button = trigger(event.target);
    if (button && !button.contains(event.relatedTarget)) { clearTimeout(openTimer); laterClose(); }
    if (tip.contains(event.target) && !tip.contains(event.relatedTarget)) laterClose();
  });
  document.addEventListener('focusin', event => { const button = trigger(event.target); if (button) open(button); });
  document.addEventListener('focusout', event => { if (trigger(event.target) === active && !tip.contains(event.relatedTarget)) close(); });
  document.addEventListener('click', event => {
    const button = trigger(event.target);
    if (button) {
      event.preventDefault(); event.stopPropagation();
      if (active === button && pinned) close(); else { open(button); pinned = true; }
    } else if (!tip.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  }, true);
  document.addEventListener('scroll', event => {
    if (!active || tip.contains(event.target)) return;
    if (pinned || document.activeElement === active) position(); else close();
  }, true);
  document.addEventListener('close', close, true);
  window.addEventListener('resize', close);
  window.addEventListener('hashchange', close);
  document.addEventListener('fullscreenchange', close);
  window.addEventListener('beforeprint', close);
  new MutationObserver(() => { if (active && (!active.isConnected || !active.getClientRects().length)) close(); }).observe(document.body, { childList: true, subtree: true });
  return close;
}
