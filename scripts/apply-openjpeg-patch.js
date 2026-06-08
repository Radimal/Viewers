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
 * The prod build does `yarn install --frozen-lockfile` from scratch and node_modules
 * is git/docker-ignored, so the patched dist must be re-copied after every install.
 * patch-package can't be used here because the critical artifact is a binary .wasm.
 *
 * Two modes:
 *   (default)  best-effort APPLY — copies the vendored 1.3.0 artifacts over EVERY
 *              installed copy of codec-openjpeg@1.3.0, leaving other versions (e.g.
 *              dicom-microscopy-viewer's nested 1.2.4) untouched. NEVER fails: yarn's
 *              two-phase install (deps-only, then full) hoists different versions to
 *              the root at different stages, so the 1.3.0 copy may not exist yet on
 *              the first pass. Run via the root `postinstall`.
 *   --check    VERIFY gate — fails (exit 1) if no 1.3.0 copy exists (version drift:
 *              dicom-image-loader bumped its codec dep => the vendored WASM is stale,
 *              rebuild it) or if any 1.3.0 copy is not byte-identical to the vendored
 *              WASM. Run as an explicit Dockerfile step AFTER the full install.
 *
 * On drift: rebuild the codec at the new version with the two flags above, re-vendor
 * into vendor/codec-openjpeg-<version>-patched/, and bump EXPECTED_VERSION below.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPECTED_VERSION = '1.3.0';
const PKG = '@cornerstonejs/codec-openjpeg';
const tag = '[apply-openjpeg-patch]';
const CHECK = process.argv.includes('--check');

const ROOT = path.resolve(__dirname, '..');
const ROOT_NM = path.join(ROOT, 'node_modules');
const VENDOR_DIR = path.resolve(ROOT, 'vendor', `codec-openjpeg-${EXPECTED_VERSION}-patched`);

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const safeReaddir = d => {
  try {
    return fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
};

// Find every installed copy of the codec by walking node_modules trees only.
function findCopies(nmDir, acc, depth) {
  if (depth > 8) return;
  const codec = path.join(nmDir, '@cornerstonejs', 'codec-openjpeg');
  if (fs.existsSync(path.join(codec, 'package.json'))) acc.add(codec);
  for (const e of safeReaddir(nmDir)) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const p = path.join(nmDir, e.name);
    if (e.name.startsWith('@')) {
      for (const s of safeReaddir(p)) {
        const nested = path.join(p, s.name, 'node_modules');
        if (fs.existsSync(nested)) findCopies(nested, acc, depth + 1);
      }
    } else {
      const nested = path.join(p, 'node_modules');
      if (fs.existsSync(nested)) findCopies(nested, acc, depth + 1);
    }
  }
}

function vendoredFiles() {
  return fs.readdirSync(VENDOR_DIR).filter(f => f !== 'README.md');
}

if (!fs.existsSync(VENDOR_DIR)) {
  const msg = `${tag} vendored artifacts not found at ${VENDOR_DIR}`;
  if (CHECK) {
    console.error(`${msg} — cannot verify.`);
    process.exit(1);
  }
  console.log(`${msg}; skipping.`);
  process.exit(0);
}

const dirs = new Set();
if (fs.existsSync(ROOT_NM)) findCopies(ROOT_NM, dirs, 0);

const copies = [...dirs].map(dir => {
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  } catch {
    /* ignore unreadable */
  }
  return { dir, version };
});
const targets = copies.filter(c => c.version === EXPECTED_VERSION);
const others = copies.filter(c => c.version !== EXPECTED_VERSION);
const vendoredDecodeSha = sha(path.join(VENDOR_DIR, 'openjpegwasm_decode.wasm'));

if (CHECK) {
  if (targets.length === 0) {
    console.error(
      `${tag} CHECK FAILED: no ${PKG}@${EXPECTED_VERSION} installed ` +
        `(found: ${copies.map(c => c.version).filter(Boolean).join(', ') || 'none'}).\n` +
        `${tag} The codec version likely drifted. Rebuild the WASM with ` +
        `-s EMULATE_FUNCTION_POINTER_CASTS=1 -s ALLOW_TABLE_GROWTH=1, re-vendor, and bump ` +
        `EXPECTED_VERSION. See vendor README / cornerstonejs/codecs issue #62.`
    );
    process.exit(1);
  }
  const unpatched = targets.filter(
    t => sha(path.join(t.dir, 'dist', 'openjpegwasm_decode.wasm')) !== vendoredDecodeSha
  );
  if (unpatched.length) {
    console.error(`${tag} CHECK FAILED: ${unpatched.length} copy(ies) of ${EXPECTED_VERSION} not patched:`);
    unpatched.forEach(u => console.error(`${tag}   ${u.dir}`));
    process.exit(1);
  }
  console.log(`${tag} CHECK OK: ${targets.length} copy(ies) of ${PKG}@${EXPECTED_VERSION} patched.`);
  process.exit(0);
}

// APPLY (best-effort; never fail the install)
if (targets.length === 0) {
  console.log(
    `${tag} no ${PKG}@${EXPECTED_VERSION} present yet ` +
      `(found: ${copies.map(c => c.version).filter(Boolean).join(', ') || 'none'}); skipping.`
  );
  process.exit(0);
}
const files = vendoredFiles();
let patched = 0;
for (const t of targets) {
  try {
    for (const f of files) fs.copyFileSync(path.join(VENDOR_DIR, f), path.join(t.dir, 'dist', f));
    patched++;
  } catch (e) {
    console.warn(`${tag} WARN: could not patch ${t.dir}: ${e.message}`);
  }
}
const otherVersions = [...new Set(others.map(o => o.version).filter(Boolean))];
console.log(
  `${tag} patched ${patched}/${targets.length} copy(ies) of ${PKG}@${EXPECTED_VERSION}` +
    (otherVersions.length ? `; left other versions untouched (${otherVersions.join(', ')})` : '') +
    '.'
);
process.exit(0);
