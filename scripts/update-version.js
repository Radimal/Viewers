const fs = require('fs');
const path = require('path');

// Same build-identity sources webpack.base.js bakes into the bundle via
// DefinePlugin (process.env.COMMIT_HASH / VERSION_NUMBER), so the emitted
// /version.json can be compared against the RUNNING bundle by update
// detection (src/utils/cacheManager.js + UpdateBanner). Without `commit` /
// `buildTime` here the banner can never fire — isUpdateAvailable() compares
// exactly these fields.
const readBuildFile = (filePath, fallback) => {
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    return value || fallback;
  } catch (error) {
    return fallback;
  }
};

const now = Date.now();
const version = {
  version:
    readBuildFile(path.join(__dirname, '../version.txt'), '') ||
    process.env.npm_package_version ||
    `1.0.${now}`,
  timestamp: now,
  buildId: process.env.BUILD_ID || Math.random().toString(36).substring(7),
  commit: readBuildFile(path.join(__dirname, '../commit.txt'), 'local'),
  buildTime: new Date(now).toISOString(),
};

// Write to public directory
const versionPath = path.join(__dirname, '../platform/app/public/version.json');
fs.writeFileSync(versionPath, JSON.stringify(version, null, 2));

console.log('Version updated:', version);