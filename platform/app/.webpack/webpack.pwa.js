const path = require('path');
const fs = require('fs');
const { merge } = require('webpack-merge');
const webpack = require('webpack');
const webpackBase = require('./../../../.webpack/webpack.base.js');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { InjectManifest } = require('workbox-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');
const PUBLIC_DIR = path.join(__dirname, '../public');
const HTML_TEMPLATE = process.env.HTML_TEMPLATE || 'index.html';
const PUBLIC_URL = process.env.PUBLIC_URL || '/';
const APP_CONFIG = process.env.APP_CONFIG || 'config/default.js';

const PROXY_TARGET = process.env.PROXY_TARGET;
const PROXY_DOMAIN = process.env.PROXY_DOMAIN;
const PROXY_PATH_REWRITE_FROM = process.env.PROXY_PATH_REWRITE_FROM;
const PROXY_PATH_REWRITE_TO = process.env.PROXY_PATH_REWRITE_TO;

const OHIF_PORT = Number(process.env.OHIF_PORT || 3000);
const ENTRY_TARGET = process.env.ENTRY_TARGET || `${SRC_DIR}/index.js`;
const Dotenv = require('dotenv-webpack');
const writePluginImportFile = require('./writePluginImportsFile.js');

const copyPluginFromExtensions = writePluginImportFile(SRC_DIR, DIST_DIR);

// Build identity for /version.json — the SAME sources webpack.base.js bakes
// into the bundle via DefinePlugin (process.env.COMMIT_HASH / VERSION_NUMBER),
// so a fetched /version.json can be compared against the running bundle to
// detect that a newer build has been deployed (see src/utils/cacheManager.js).
const readBuildFile = (filePath, fallback) => {
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    return value || fallback;
  } catch (error) {
    return fallback;
  }
};
const PKG_VERSION = require('../package.json').version || '0.0.0';
const VERSION_NUMBER = readBuildFile(path.join(__dirname, '../../../version.txt'), PKG_VERSION);
const COMMIT_HASH = readBuildFile(path.join(__dirname, '../../../commit.txt'), 'local');

const buildVersionJson = () => {
  const now = Date.now();
  return JSON.stringify(
    {
      version: VERSION_NUMBER,
      commit: COMMIT_HASH,
      buildTime: new Date(now).toISOString(),
      timestamp: now,
    },
    null,
    2
  );
};

const setHeaders = (res, path) => {
  if (path.indexOf('.gz') !== -1) {
    res.setHeader('Content-Encoding', 'gzip');
  } else if (path.indexOf('.br') !== -1) {
    res.setHeader('Content-Encoding', 'br');
  }
  if (path.indexOf('.pdf') !== -1) {
    res.setHeader('Content-Type', 'application/pdf');
  } else if (path.indexOf('mp4') !== -1) {
    res.setHeader('Content-Type', 'video/mp4');
  } else if (path.indexOf('frames') !== -1) {
    res.setHeader('Content-Type', 'multipart/related');
  } else {
    res.setHeader('Content-Type', 'application/json');
  }
};

module.exports = (env, argv) => {
  const baseConfig = webpackBase(env, argv, { SRC_DIR, DIST_DIR });
  const isProdBuild = process.env.NODE_ENV === 'production';
  const hasProxy = PROXY_TARGET && PROXY_DOMAIN;

  const mergedConfig = merge(baseConfig, {
    entry: {
      app: ENTRY_TARGET,
    },
    output: {
      path: DIST_DIR,
      filename: isProdBuild ? '[name].[contenthash].js' : '[name].js',
      chunkFilename: isProdBuild ? '[name].[contenthash].chunk.js' : '[name].chunk.js',
      publicPath: PUBLIC_URL,
      devtoolModuleFilenameTemplate: function (info) {
        if (isProdBuild) {
          return `webpack:///${info.resourcePath}`;
        } else {
          return 'file:///' + encodeURI(info.absoluteResourcePath);
        }
      },
    },
    optimization: {
      runtimeChunk: 'single',
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
        },
      },
    },
    resolve: {
      modules: [
        path.resolve(__dirname, '../node_modules'),
        path.resolve(__dirname, '../../../node_modules'),
        SRC_DIR,
      ],
    },
    plugins: [
      new Dotenv(),
      new CleanWebpackPlugin(),
      new webpack.ProvidePlugin({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      }),
      new CopyWebpackPlugin({
        patterns: [
          ...copyPluginFromExtensions,
          {
            from: PUBLIC_DIR,
            to: DIST_DIR,
            toType: 'dir',
            globOptions: {
              // version.json is emitted with real build identity below, not
              // copied from the stale static file.
              ignore: ['**/config/**', '**/html-templates/**', '.DS_Store', '**/version.json'],
            },
          },
          {
            from: `${PUBLIC_DIR}/version.json`,
            to: `${DIST_DIR}/version.json`,
            transform: () => buildVersionJson(),
          },
          {
            from: `${PUBLIC_DIR}/config/google.js`,
            to: `${DIST_DIR}/google.js`,
          },
          {
            from: `${PUBLIC_DIR}/${APP_CONFIG}`,
            to: `${DIST_DIR}/app-config.js`,
          },
          {
            from: '../../../node_modules/dicom-microscopy-viewer/dist/dynamic-import',
            to: DIST_DIR,
            globOptions: {
              ignore: ['**/*.min.js.map'],
            },
          },
        ],
      }),
      new HtmlWebpackPlugin({
        template: `${PUBLIC_DIR}/html-templates/${HTML_TEMPLATE}`,
        filename: 'index.html',
        templateParameters: {
          PUBLIC_URL: PUBLIC_URL,
        },
      }),
      new InjectManifest({
        swDest: 'sw.js',
        swSrc: path.join(SRC_DIR, 'service-worker.js'),
        // version.json must never be precached — it is fetched fresh to detect
        // new deploys (src/utils/cacheManager.js).
        exclude: [/theme/, /version\.json$/],
        maximumFileSizeToCacheInBytes: 1024 * 1024 * 50,
      }),
    ],
    devServer: {
      open: true,
      port: OHIF_PORT,
      client: {
        overlay: { errors: true, warnings: false },
      },
      proxy: {
        '/dicomweb': 'http://localhost:5000',
      },
      static: [
        {
          directory: '../../testdata',
          staticOptions: {
            extensions: ['gz', 'br', 'mht'],
            index: ['index.json.gz', 'index.mht.gz'],
            redirect: true,
            setHeaders,
          },
          publicPath: '/viewer-testdata',
        },
      ],
      historyApiFallback: {
        disableDotRule: true,
        index: PUBLIC_URL + 'index.html',
      },
      devMiddleware: {
        writeToDisk: true,
      },
    },
  });

  if (hasProxy) {
    mergedConfig.devServer.proxy = mergedConfig.devServer.proxy || {};
    mergedConfig.devServer.proxy = {
      [PROXY_TARGET]: {
        target: PROXY_DOMAIN,
        changeOrigin: true,
        pathRewrite: {
          [`^${PROXY_PATH_REWRITE_FROM}`]: PROXY_PATH_REWRITE_TO,
        },
      },
    };
  }

  if (isProdBuild) {
    mergedConfig.plugins.push(
      new MiniCssExtractPlugin({
        filename: '[name].[contenthash].css',
        chunkFilename: '[id].[contenthash].css',
      })
    );
  }

  mergedConfig.watchOptions = {
    ignored: /node_modules\/@cornerstonejs/,
  };

  return mergedConfig;
};
