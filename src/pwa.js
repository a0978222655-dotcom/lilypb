export function setupPWA({ enabled, onChange = () => {} }) {
  const state = { supported: 'serviceWorker' in navigator && globalThis.isSecureContext, ready: false, updateAvailable: false, offline: !navigator.onLine, standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true, enabled };
  let registration = null, reloading = false;
  const changed = () => onChange({ ...state });
  const controller = {
    state,
    async check() {
      if (!registration || !navigator.onLine) return;
      try { await registration.update(); } catch { /* Offline use must remain available. */ }
    },
    applyUpdate() {
      if (!registration?.waiting) return false;
      reloading = true;
      registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      return true;
    },
  };
  window.addEventListener('online', () => { state.offline = false; changed(); void controller.check(); });
  window.addEventListener('offline', () => { state.offline = true; changed(); });
  if (!enabled || !state.supported) { queueMicrotask(changed); return controller; }
  const inspectUpdate = () => { state.updateAvailable = !!registration?.waiting && !!registration?.active; changed(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); else inspectUpdate(); });
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname, updateViaCache: 'none' }).then(async reg => {
    registration = reg;
    inspectUpdate();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (['installed', 'activated', 'redundant'].includes(worker.state)) inspectUpdate(); });
    });
    const ready = await navigator.serviceWorker.ready;
    state.ready = !!ready.active;
    changed();
  }).catch(() => { state.ready = false; changed(); });
  return controller;
}
