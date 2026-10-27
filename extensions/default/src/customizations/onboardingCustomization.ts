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

/**
 * Radimal: replaces stock OHIF's basicViewerTour. 3.10 prod never showed a
 * tour (its app-config defines no `tours`), and the stock steps describe stock
 * mouse bindings — wrong for any reader whose 3.10 bindings were migrated —
 * and wait on the begin-tracking prompt we disable. This intro only explains
 * what changed; no step waits on a specific mouse action. A new id means each
 * reader sees it once per viewer origin (shownTours in localStorage).
 */
export default {
  'ohif.tours': [
    {
      id: 'radimalViewerIntro2026',
      route: '/viewer',
      steps: [
        {
          id: 'welcome',
          title: i18n.t('Onboarding:Welcome to the updated Radimal viewer'),
          text: i18n.t(
            'Onboarding:Your hotkeys, mouse buttons, scroll wheel and zoom settings, default layout and saved windows are all kept. There is nothing to set up.'
          ),
          beforeShowPromise: () => waitForElement('.viewport-element'),
          buttons: [skip, next],
        },
        {
          id: 'preferences',
          title: i18n.t('Onboarding:Your settings'),
          text: i18n.t(
            'Onboarding:Everything is still under Settings → Preferences, with a few new options: scroll wheel tool, invert scroll wheel, zoom toward cursor, and opening your saved windows on start.'
          ),
          attachTo: { element: '[data-cy="header-settings-menu"]', on: 'bottom' },
          beforeShowPromise: () => waitForElement('[data-cy="header-settings-menu"]'),
          buttons: [skip, next],
        },
        {
          id: 'layout',
          title: i18n.t('Onboarding:Default layout'),
          text: i18n.t(
            'Onboarding:Change Layout still has "Set as Default", so every study opens in your preferred grid.'
          ),
          attachTo: { element: '[data-cy="Layout"]', on: 'bottom' },
          beforeShowPromise: () => waitForElement('[data-cy="Layout"]'),
          buttons: [skip, next],
        },
        {
          id: 'liveImages',
          title: i18n.t('Onboarding:Images still arriving'),
          text: i18n.t(
            'Onboarding:If the clinic is still sending images, they now appear in the open study on their own. A "New images arriving" notice tells you when.'
          ),
          buttons: [done],
        },
      ],
      tourOptions: {
        useModalOverlay: true,
      },
    },
  ],
};
