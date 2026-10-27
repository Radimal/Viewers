import i18n from '@ohif/i18n';

function waitForElement(selector, maxAttempts = 20, interval = 25) {
  return new Promise(resolve => {
    let attempts = 0;

    const checkForElement = setInterval(() => {
      const element = document.querySelector(selector);

      if (element || attempts >= maxAttempts) {
        clearInterval(checkForElement);
        resolve();
      }

      attempts++;
    }, interval);
  });
}

const next = {
  text: i18n.t('Onboarding:Next'),
  action() {
    this.next();
  },
};

const skip = {
  text: i18n.t('Onboarding:Skip'),
  action() {
    this.complete();
  },
  secondary: true,
};

const done = {
  text: i18n.t('Onboarding:Done'),
  action() {
    this.complete();
  },
};

// Canary readers have used 3.13 for weeks; they get the intro at cutover on
// view.radimal.ai / veg-view instead. Drop this once the canaries retire.
const CANARY_HOSTS = ['view-blue.prod-1.radimal.ai', 'veg-viewer-blue.prod-1.radimal.ai'];
const isCanaryHost = CANARY_HOSTS.includes(window.location.hostname);

// Plain strings, not i18n.t: i18next reads ':' and '.' in a sentence as
// namespace/key separators and garbles it (showed "optionsfalse").
const radimalIntroTour = {
  id: 'radimalViewerIntro2026',
  route: '/viewer',
  steps: [
    {
      id: 'whatsNew',
      title: "What's new",
      text: 'Your settings came over from the old viewer. New in this version: a Pinned Tools toolbar, many more hotkeys, and more mouse button options.',
      beforeShowPromise: () => waitForElement('.viewport-element'),
      buttons: [skip, next],
    },
    {
      id: 'preferences',
      title: 'Settings → Preferences',
      text: 'Pin your favorite tools to the toolbar and set hotkeys, mouse buttons and the scroll wheel here.',
      attachTo: { element: '[data-cy="header-settings-menu"]', on: 'bottom' },
      beforeShowPromise: () => waitForElement('[data-cy="header-settings-menu"]'),
      buttons: [done],
    },
  ],
  tourOptions: {
    useModalOverlay: true,
  },
};

/**
 * Radimal: replaces stock OHIF's basicViewerTour. 3.10 prod never showed a
 * tour (its app-config defines no `tours`), and the stock steps describe stock
 * mouse bindings — wrong for any reader whose 3.10 bindings were migrated —
 * and wait on the begin-tracking prompt we disable. This intro only explains
 * what changed; no step waits on a specific mouse action. A new id means each
 * reader sees it once per viewer origin (shownTours in localStorage).
 *
 * Onboarding matches the route exactly; radimal-vet opens `/viewer/` (trailing
 * slash), so the tour is listed for both paths. Same id, so it shows once.
 */
export default {
  'ohif.tours': isCanaryHost ? [] : [radimalIntroTour, { ...radimalIntroTour, route: '/viewer/' }],
};
