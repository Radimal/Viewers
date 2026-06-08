# Patched `@cornerstonejs/codec-openjpeg` (multi-tile JPEG2000 fix)

These are rebuilt WASM/asm.js artifacts for `@cornerstonejs/codec-openjpeg@1.2.4`,
copied into `node_modules` after install by `scripts/apply-openjpeg-patch.js`
(wired as the repo's `postinstall`, plus an explicit verify step in the Dockerfile).

## Why

Sedecal DX-V scanners (and other sources) emit **multi-tile** JPEG2000 codestreams
— e.g. 3072×3072 split into a 5×7 grid of 35 tiles, transfer syntax
`1.2.840.10008.1.2.4.90` (JPEG 2000 lossless). The stock codec WASM crashes decoding
these with `RuntimeError: indirect call signature mismatch` (a.k.a.
"null function or function signature mismatch") and the study fails to load.

Root cause: an Emscripten function-pointer-cast bug in the codec build, not the data.
See upstream **cornerstonejs/codecs issue #62** and **PR #63**.

## Which version & why

The committed `yarn.lock` resolves `@cornerstonejs/dicom-image-loader@^2.11.2` →
`2.19.16` → `@cornerstonejs/codec-openjpeg@1.2.4`, so **1.2.4 is what production
actually builds and ships** (confirmed by a clean `--frozen-lockfile` Docker build).
`dicom-microscopy-viewer` also resolves to 1.2.4, so patching all 1.2.4 copies covers
both the cornerstone viewport and microscopy.

## How these were built

From `cornerstonejs/codecs` at tag `@cornerstonejs/codec-openjpeg@1.2.4`,
`packages/openjpeg`, built in `emscripten/emsdk:3.1.28` (the Emscripten version that
tag's CI used) via the package's `build.sh`, with **only** these two link flags added
to all four targets in `src/CMakeLists.txt`:

```
-s ALLOW_TABLE_GROWTH=1
-s EMULATE_FUNCTION_POINTER_CASTS=1
```

We deliberately did NOT take the rest of PR #63 (which also flips
`DISABLE_EXCEPTION_CATCHING`/`ASSERTIONS` to debug values and reformats whole files).

## Verification (Jun 2026)

- Stock 1.2.4 throws on the 35-tile Sedecal frame; patched 1.2.4 decodes it to a
  3072×3072 16-bit frame.
- **Byte-identical** output to stock 1.2.4 on all 25 normal fixtures (single-tile
  correctness intact; matches known-good RAW references).
- Decode speed unchanged (within noise on the 1.3.0 build of the same fix). WASM +~5 KB.

## Maintenance

The patch is **version-locked to 1.2.4** (`EXPECTED_VERSION` in
`scripts/apply-openjpeg-patch.js`). If `@cornerstonejs/dicom-image-loader` is bumped
and pulls a different codec version, the Dockerfile's `--check` step FAILS the build.
To recover: rebuild the codec at the new version with the two flags above (matching that
version's Emscripten), re-vendor into `vendor/codec-openjpeg-<new-version>-patched/`,
and bump `EXPECTED_VERSION`.

When PR #63 (or an equivalent fix) merges and ships in a release we depend on, delete
this directory + the postinstall/Dockerfile hooks and use the upstream version.
