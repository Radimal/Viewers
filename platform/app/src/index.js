/**
 * Entry point for development and production PWA builds.
 */

// Suppress noisy [INFO] logs from the openjpeg WASM decoder (j2k decode
// progress, one per slice). The codec doesn't expose a log-level config,
// so filter at console.log level.
(function filterOpenJpegLogs() {
  const originalLog = console.log;
  console.log = function (...args) {
    if (
      typeof args[0] === 'string' &&
      args[0].startsWith('[INFO]') &&
      (args[0].includes('j2k') ||
        args[0].includes('tile') ||
        args[0].includes('Main header'))
    ) {
      return;
    }
    return originalLog.apply(console, args);
  };
})();

import './chunk-error-handler';
import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import App from './App';
import React from 'react';
import { history } from './utils/history';

/**
 * EXTENSIONS AND MODES
 * =================
 * pluginImports.js is dynamically generated from extension and mode
 * configuration at build time.
 *
 * pluginImports.js imports all of the modes and extensions and adds them
 * to the window for processing.
 */
import { modes as defaultModes, extensions as defaultExtensions } from './pluginImports';
import loadDynamicConfig from './loadDynamicConfig';

loadDynamicConfig(window.config).then(config_json => {
  // Reset Dynamic config if defined
  if (config_json !== null) {
    window.config = config_json;
  }

  /**
   * Combine our appConfiguration with installed extensions and modes.
   * In the future appConfiguration may contain modes added at runtime.
   *  */
  const appProps = {
    config: window ? window.config : {},
    defaultExtensions,
    defaultModes,
  };

  const container = document.getElementById('root');

  const root = createRoot(container);
  root.render(React.createElement(App, appProps));
});

export { history };
