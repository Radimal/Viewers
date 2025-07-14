const fs = require('fs');
const path = require('path');

// Generate new version info
const version = {
  version: process.env.npm_package_version || `1.0.${Date.now()}`,
  timestamp: Date.now(),
  buildId: process.env.BUILD_ID || Math.random().toString(36).substring(7)
};

// Write to public directory
const versionPath = path.join(__dirname, '../platform/app/public/version.json');
fs.writeFileSync(versionPath, JSON.stringify(version, null, 2));

console.log('Version updated:', version);