navigator.serviceWorker.getRegistrations().then(function (registrations) {
  for (let registration of registrations) {
    registration.unregister();
  }
});

// https://developers.google.com/web/tools/workbox/modules/workbox-window
// All major browsers that support service worker also support native JavaScript
// modules, so it's perfectly fine to serve this code to any browsers
// (older browsers will just ignore it)
//
//import { Workbox } from './workbox-window.prod.mjs';
// proper initialization
if ('function' === typeof importScripts) {
  importScripts(
    'https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-window.prod.mjs'
  );

  var supportsServiceWorker = 'serviceWorker' in navigator;
  var isNotLocalDevelopment = ['localhost', '127'].indexOf(location.hostname) === -1;

  if (supportsServiceWorker && isNotLocalDevelopment) {
    const swFileLocation = (window.PUBLIC_URL || '/') + 'sw.js';
    const wb = new Workbox(swFileLocation);

    // Add an event listener to detect when the registered
    // service worker has installed but is waiting to activate.
    wb.addEventListener('waiting', event => {
      // Automatically activate the new service worker
      wb.messageSW({ type: 'SKIP_WAITING' });
    });

    // Add an event listener to detect when the new service worker
    // has taken control and reload the page
    wb.addEventListener('controlling', event => {
      window.location.reload();
    });

    // Register the service worker
    wb.register().then(registration => {
      // Check for updates every hour
      setInterval(
        () => {
          registration.update();
        },
        60 * 60 * 1000
      );
    });
  }
}
