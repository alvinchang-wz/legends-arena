'use strict';
/* ============================================================
   native.js — glue for the Capacitor Android shell.

   Everything here is a no-op in a plain browser. Inside the app the
   Capacitor bridge injects `window.Capacitor` before our scripts run,
   and the natively registered plugins (App, StatusBar) are reachable
   through `Capacitor.Plugins` without a bundler.

   Responsibilities:
   - hide the system bars (immersive landscape, like every mobile MOBA)
   - map the hardware / gesture back button onto the screen flow
   - mark the document so CSS can react to the native shell
   ============================================================ */

const Native = {
  cap: null,

  init() {
    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
    this.cap = cap;
    document.documentElement.classList.add('native', 'native-' + cap.getPlatform());
    const P = cap.Plugins || {};
    if (P.StatusBar) {
      P.StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      P.StatusBar.hide().catch(() => {});
    }
    if (P.App) P.App.addListener('backButton', () => this.onBack());
  },

  /* Android back: close what is on top, step back through the menus, and
     only leave the app from the title screen. Never quit mid-match. */
  onBack() {
    if (typeof Screens === 'undefined') return;
    if (Screens.closeModals()) return;
    if (document.getElementById('settingsPanel') && !document.getElementById('settingsPanel').classList.contains('hidden')) {
      UI.toggleSettings(false);
      return;
    }
    if (Game.state === 'play' && !Game.attract) {
      if (Game.paused) Game.resume(); else Game.pause();
      return;
    }
    if (Game.state === 'end') { UI.returnToSelect(); return; }
    switch (Screens.current) {
      case 'pick':
      case 'modes': Screens.back(); break;
      case 'lobby': Screens.show('title'); break;
      case 'title':
      default: if (this.cap.Plugins.App) this.cap.Plugins.App.exitApp();
    }
  },
};
