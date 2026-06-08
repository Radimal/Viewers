# Patched `@cornerstonejs/codec-openjpeg` (multi-tile JPEG2000 fix)

These are rebuilt WASM/asm.js artifacts for `@cornerstonejs/codec-openjpeg@1.3.0`,
copied into `node_modules` after install by `scripts/apply-openjpeg-patch.js`
(wired as the repo's `postinstall`).

## Why

Sedecal DX-V scanners (and other sources) emit **multi-tile** JPEG2000 codestreams
— e.g. 3072×3072 split into a 5×7 grid of 35 tiles, transfer syntax
`1.2.840.10008.1.2.4.90` (JPEG 2000 lossless). The stock codec WASM crashes decoding
these with `RuntimeError: indirect call signature mismatch` (a.k.a.
"null function or function signature mismatch") and the study fails to load.

Root cause: an Emscripten function-pointer-cast bug in the codec build, not the data.
See upstream **cornerstonejs/codecs issue #62** and **PR #63**.

## How these were built

From `cornerstonejs/codecs`, `packages/openjpeg`, built in `emscripten/emsdk:3.1.70`
via the package's `build.sh`, with **only** these two link flags added to all four
targets in `src/CMakeLists.txt`:

```
-s ALLOW_TABLE_GROWTH=1
-s EMULATE_FUNCTION_POINTER_CASTS=1
```

We deliberately did NOT take the rest of PR #63 (it also flips
`DISABLE_EXCEPTION_CATCHING`/`ASSERTIONS` to debug values and reformats whole files).

## Verification (Jun 2026)

- Decodes the 35-tile Sedecal frame that crashed production.
- **Byte-identical** output to the stock build on all 26 normal fixtures (single-tile
  correctness intact; matches known-good RAW references).
- Decode speed unchanged (within noise). WASM size +8.5 KB.

## Maintenance

The patch is **version-locked to 1.3.0**. If `@cornerstonejs/dicom-image-loader` bumps
its codec-openjpeg dependency, `scripts/apply-openjpeg-patch.js` will FAIL the build.
To recover: rebuild the codec at the new version with the two flags above, re-vendor
into `vendor/codec-openjpeg-<new-version>-patched/`, and bump `EXPECTED_VERSION`.

When PR #63 (or an equivalent fix) merges and ships in a release we depend on, delete
this directory + the postinstall hook and use the upstream version.

Note: `dicom-microscopy-viewer` bundles its own nested copy (1.2.4, WSI path) which is
NOT patched and out of scope.
```
