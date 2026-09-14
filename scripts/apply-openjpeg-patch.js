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
 * MULTI-VERSION: the dependency tree can contain MORE THAN ONE codec-openjpeg version
 * at once — e.g. dicom-image-loader (the cornerstone viewport's decoder) pins 1.3.0
 * while dicom-microscopy-viewer pulls 1.2.4. webpack emits the wasm from whichever
 * copy the importer resolves, so EVERY installed copy must be patched or a stock wasm
 * can still ship. We vendor a patched build per version under
 * vendor/codec-openjpeg-<version>-patched/ and patch every installed copy that matches.
 *
 * Two modes:
 *   (default)  best-effort APPLY — patches every installed codec copy whose version we
 *              have a vendored patch for. NEVER fails (yarn's two-phase Docker install
 *              hoists different versions at different stages, so some copies may not
 *              exist yet on the first pass). Run via the root `postinstall`.
 *   --check    VERIFY gate — fails (exit 1) if ANY installed codec copy is not patched,
 *              including a copy whose version we have no vendored patch for (version
 *              drift -> rebuild it). Run as an explicit Dockerfile step AFTER the full
 *              install, where the whole tree is present.
 *
 * On drift / new version: rebuild with scripts/build-openjpeg-patch.sh <version> <emsdk>,
 * which writes vendor/codec-openjpeg-<version>-patched/. No code change needed here.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PKG = '@cornerstonejs/codec-openjpeg';
const tag = '[apply-openjpeg-patch]';
const CHECK = process.argv.includes('--check');

const ROOT = path.resolve(__dirname, '..');
const ROOT_NM = path.join(ROOT, 'node_modules');
const VENDOR_ROOT = path.join(ROOT, 'vendor');

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const safeReaddir = d => {
  try {
    return fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
};

// Discover the versions we ship patched artifacts for:
// vendor/codec-openjpeg-<version>-patched/
function loadVendors() {
  const out = {}; // version -> { dir, files, decodeSha }
  for (const e of safeReaddir(VENDOR_ROOT)) {
    const m = e.isDirectory() && e.name.match(/^codec-openjpeg-(.+)-patched$/);
    if (!m) continue;
    const dir = path.join(VENDOR_ROOT, e.name);
    const files = fs.readdirSync(dir).filter(f => f !== 'README.md');
    out[m[1]] = { dir, files, decodeSha: sha(path.join(dir, 'openjpegwasm_decode.wasm')) };
  }
  return out;
}

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

const vendors = loadVendors();
const supported = Object.keys(vendors).sort();
if (supported.length === 0) {
  const msg = `${tag} no vendored patches found under ${VENDOR_ROOT}`;
  if (CHECK) {
    console.error(`${msg} — cannot verify.`);
    process.exit(1);
  }
  console.log(`${msg}; skipping.`);
  process.exit(0);
}

const dirs = new Set();
if (fs.existsSync(ROOT_NM)) findCopies(ROOT_NM, dirs, 0);
const copies = [...dirs]
  .map(dir => {
    let version = null;
    try {
      version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    } catch {
      /* unreadable */
    }
    return { dir, version };
  })
  .filter(c => c.version);

if (CHECK) {
  if (copies.length === 0) {
    console.error(`${tag} CHECK FAILED: no ${PKG} installed at all.`);
    process.exit(1);
  }
  const problems = [];
  for (const c of copies) {
    const v = vendors[c.version];
    if (!v) {
      problems.push(`${c.version} has no vendored patch  (${c.dir})`);
      continue;
    }
    const wasm = path.join(c.dir, 'dist', 'openjpegwasm_decode.wasm');
    if (!fs.existsSync(wasm) || sha(wasm) !== v.decodeSha) {
      problems.push(`${c.version} is not patched  (${c.dir})`);
    }
  }
  if (problems.length) {
    console.error(`${tag} CHECK FAILED: ${problems.length} codec copy(ies) would ship STOCK:`);
    problems.forEach(p => console.error(`${tag}   ${p}`));
    console.error(
      `${tag} Vendored (supported) versions: ${supported.join(', ')}. For a missing version, run ` +
        `scripts/build-openjpeg-patch.sh <version> <emsdk-tag> and commit the result. See issue #62.`
    );
    process.exit(1);
  }
  console.log(
    `${tag} CHECK OK: all ${copies.length} codec copy(ies) patched ` +
      `(versions: ${[...new Set(copies.map(c => c.version))].sort().join(', ')}).`
  );
  process.exit(0);
}

// APPLY (best-effort; never fail the install)
let patched = 0;
const noPatch = [];
for (const c of copies) {
  const v = vendors[c.version];
  if (!v) {
    noPatch.push(c.version);
    continue;
  }
  try {
    for (const f of v.files) fs.copyFileSync(path.join(v.dir, f), path.join(c.dir, 'dist', f));
    patched++;
  } catch (e) {
    console.warn(`${tag} WARN: could not patch ${c.dir}: ${e.message}`);
  }
}
console.log(
  `${tag} patched ${patched}/${copies.length} codec copy(ies)` +
    (noPatch.length ? `; no vendored patch for ${[...new Set(noPatch)].sort().join(', ')} (--check will flag)` : '') +
    '.'
);
process.exit(0);
