/**
 * Entry point for development and production PWA builds.
 */
import './chunk-error-handler';
import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import App from './App';
import React from 'react';

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
import importCanarySettings, { stampViewerLastUsed } from './utils/importCanarySettings';
export { history } from './utils/history';
export { preserveQueryParameters, preserveQueryStrings } from './utils/preserveQueryParameters';
export { InvalidationService } from './utils/invalidationService';

loadDynamicConfig(window.config)
  // Radimal: carry canary (view-blue) preferences to view.radimal.ai before any
  // service starts, so 3.13's own 3.10-settings migrations see the merged state.
  .then(config_json =>
    importCanarySettings()
      .catch(() => [])
      // After the import decision, which compares against the canary's stamp.
      .then(() => stampViewerLastUsed())
      .then(() => config_json)
  )
  .then(config_json => {
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
