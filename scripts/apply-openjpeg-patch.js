#!/usr/bin/env node
/**
 * Re-applies the multi-tile JPEG2000 fix to @cornerstonejs/codec-openjpeg after install.
 *
 * WHY: Sedecal DX-V scanners emit multi-tile J2K (e.g. 3072x3072 in 35 tiles,
 * transfer syntax 1.2.840.10008.1.2.4.90) that crashes the stock codec WASM with
 * "indirect call / null function signature mismatch". The fix is a rebuild of the
 * codec with `-s EMULATE_FUNCTION_POINTER_CASTS=1 -s ALLOW_TABLE_GROWTH=1`
 * (the functional part of upstream cornerstonejs/codecs PR #63 / issue #62).
 *
 * The build does `yarn install --frozen-lockfile` from scratch and node_modules is
 * git/docker-ignored, so the patched dist must be re-copied after every install.
 * patch-package can't be used here because the critical artifact is a binary .wasm.
 *
 * The patch is version-LOCKED: if codec-openjpeg ever resolves to a version other
 * than EXPECTED_VERSION, this script fails the build instead of shipping a stale or
 * unverified binary. Recovery: rebuild the wasm against the new codec version with the
 * two flags above, re-vendor into vendor/codec-openjpeg-<version>-patched/, bump below.
 */
const fs = require('fs');
const path = require('path');

const EXPECTED_VERSION = '1.3.0';
const VENDOR_DIR = path.resolve(__dirname, '..', 'vendor', `codec-openjpeg-${EXPECTED_VERSION}-patched`);

function findCodecPkg() {
  // The package's `exports` field blocks deep-resolving `.../package.json`, so
  // resolve the main entry (the "." export) and walk up to its package root.
  let dir;
  try {
    dir = path.dirname(require.resolve('@cornerstonejs/codec-openjpeg'));
  } catch {
    return null;
  }
  while (dir !== path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        if (require(pkg).name === '@cornerstonejs/codec-openjpeg') return dir;
      } catch {
        /* keep walking */
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

const tag = '[apply-openjpeg-patch]';
const codecDir = findCodecPkg();

// Not installed (e.g. partial install) — nothing to do, don't fail.
if (!codecDir) {
  console.log(`${tag} @cornerstonejs/codec-openjpeg not found; skipping.`);
  process.exit(0);
}

const installedVersion = require(path.join(codecDir, 'package.json')).version;
if (installedVersion !== EXPECTED_VERSION) {
  console.error(
    `${tag} ERROR: codec-openjpeg is ${installedVersion} but the multi-tile J2K patch was ` +
      `built for ${EXPECTED_VERSION}.\n` +
      `${tag} The vendored WASM may not match this version. Rebuild the codec with\n` +
      `${tag}   -s EMULATE_FUNCTION_POINTER_CASTS=1 -s ALLOW_TABLE_GROWTH=1\n` +
      `${tag} re-vendor into vendor/codec-openjpeg-${installedVersion}-patched/, and bump\n` +
      `${tag} EXPECTED_VERSION in scripts/apply-openjpeg-patch.js. See vendor README / issue #62.`
  );
  process.exit(1);
}

const destDir = path.join(codecDir, 'dist');
const files = fs.readdirSync(VENDOR_DIR).filter(f => f !== 'README.md');
for (const f of files) {
  fs.copyFileSync(path.join(VENDOR_DIR, f), path.join(destDir, f));
}
console.log(`${tag} applied multi-tile J2K patch to codec-openjpeg@${installedVersion} (${files.length} files).`);
