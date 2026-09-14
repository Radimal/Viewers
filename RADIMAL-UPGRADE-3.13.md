# Radimal OHIF 3.13 Upgrade — Runbook

Strategy: **clean re-port**, not rebase. Branch fresh from the upstream tag and
re-apply fork customizations feature-by-feature. The 3.10 fork
(`v3.10.0.*.radimal` branches) stays deployable throughout; prod keeps running
it until the port is verified end-to-end.

Verified on staging (stage-1) 2026-08: vanilla `v3.13.3.radimal` builds,
deploys, and serves studies correctly.

## How the deploy pipeline works (the contract)

1. **Branch name = ECR tag.** Pushing a branch matching the trigger filter in
   `.github/workflows/build-and-push-to-ecr.yml` builds the root `Dockerfile`
   and pushes `668564009563.dkr.ecr.us-east-1.amazonaws.com/ohif:<branch-name>`.
2. **The workflow file is per-branch.** Push triggers use the workflow file on
   the pushed branch, so each release line controls its own trigger filter and
   its own S3 bucket list. The `v3.10.*` branches sync all four asset buckets
   (both prods included); the `v3.13.*` workflow syncs **stage-1 only** and
   must never list prod buckets.
3. **terraform picks the tag.** `radimal-terraform/orthanc-cluster` composes
   `ohif:v${var.ohif_version}.radimal`; `ohif_version` lives in each cluster's
   tfvars under `orthanc-cluster/deployments/`.
4. **Assets are served from CloudFront + S3, not nginx.** Each stack's
   CloudFront distribution routes `*.js *.css *.woff *.woff2 *.png *.jpg *.svg
   *.map` to that stack's `radimal-viewer-assets-<stack>` bucket **at the flat
   root**; `index.html` and `app-config.js` always come from the ECS nginx
   container. The CI workflow's `aws s3 sync` is what populates the bucket —
   without it the viewer white-screens on missing JS.
5. **App config is injected by terraform, not baked in.** The ECS task sets
   `APP_CONFIG` (env var containing the whole config, templated from
   `orthanc-cluster/configs/app-config.js.tmpl`); the container entrypoint
   writes it to `app-config.js` at startup.

## Gotchas (each one bit or nearly bit us)

- **Unhashed files collide in the shared bucket root.** Hashed JS/CSS is
  additive across versions, but `init-service-worker.js`, `sw.js`, `assets/*`
  (branding), logos, and `dicom-microscopy-viewer/*` are last-writer-wins.
  Whichever branch's CI ran last owns those files for every cluster on the
  stack. **Restore procedure: re-run the workflow on the branch you want to
  win** (e.g. re-run the `v3.10.*` build after a 3.13 staging test).
- **Vanilla 3.13 does not emit `dist/version.json`** (it's a fork feature).
  The 3.13 workflow falls back to the branch name for the versioned S3 copy.
  Remove the fallback once the cache-manager feature (which owns version.json)
  is re-ported.
- **Vanilla 3.13 emits unhashed CSS** (`app.bundle.css`), which the sync
  uploads with `immutable, max-age=1y` — stale-CSS trap. Fixed on
  `v3.13.3.radimal` by content-hashing CSS filenames in
  `platform/app/.webpack/webpack.pwa.js` (same as the 3.10 fork).
- **`app-config.js.tmpl` is shared by ALL clusters including prod.** The
  current template is 3.13-compatible as-is (verified line-by-line; fork-only
  keys like `posthog` are ignored by vanilla). If 3.13 ever needs config
  changes, add a per-deployment template variable — do not edit the shared
  template while prod is on 3.10.
- **3.13 uses pnpm + Node 24 + Rspack** (fork was yarn + Node 20 + webpack).
  Upstream's Dockerfile handles all of it; fork webpack customizations must be
  re-expressed against rspack config when re-porting.
- **Both upstream and the fork unregister-then-reregister service workers**
  in `init-service-worker.js`, so cutovers between versions self-heal on first
  load. The fork's delta (re-ported in Phase 1) is auto-activation of waiting
  workers plus a reload, NetworkFirst caching for js/css, and hourly update
  checks — vanilla leaves new workers waiting and uses StaleWhileRevalidate.
- **IAM does not enforce the prod/staging split** — the CI credentials can
  write every bucket. The per-branch workflow bucket list is the only
  guardrail; review any workflow edit on release branches accordingly.

## Deploying to a staging cluster

1. Push the `v3.13.*` branch; confirm the Actions run is green.
2. Verify artifacts:
   ```bash
   aws ecr describe-images --repository-name ohif --image-ids imageTag=v3.13.3.radimal
   aws s3 ls s3://radimal-viewer-assets-stage-1/v3.13.3.radimal/   # proves sync ran
   ```
3. In `radimal-terraform/orthanc-cluster/deployments/<cluster>.tfvars`:
   `ohif_version = "3.13.3"` — then plan/apply that deployment only. The plan
   should show exactly one substantive change: the `ohif_http` container image
   in that cluster's task definition.
4. Note `view.stage-1.radimal.ai` serves whichever cluster is currently live
   (DNS divert); deploy to the live one or divert to see it.
5. Smoke checks: `curl -s https://view.stage-1.../app-config.js | head`
   (config injected), load CR/DX/CT/US/PDF studies, confirm assets load with
   3.13 hashed filenames, hard-refresh an old session (SW unregistration).

## Phase 5 sequencing (agreed 2026-09-14)

1. Verification now: automated layer locally (all-workspace jest, eslint,
   Playwright with --ignore-snapshots) + remaining staging matrix rows.
2. Reconcile the 3.10 stream (diff v3.10.0.71.radimal tip vs what's ported;
   .71 IS the live source — the .73 branches are stale for multi-window).
   Known items: first_image_rendered/layout_rendered telemetry,
   all-images-rendered telemetry, update banner, MONOCHROME1 thumbnail fix
   (already merged), orthancUtils.reporterOriginFor refactor (dedupe with
   radimalEndpoints — keep ONE), ethos buckets + sha- ECR tags in the
   workflow, thumbnails-dicomweb-rendered revert history, whatever lands
   after this note.
3. Canary deployment (plan below) for reporter-heavy verification against
   prod data.
4. Cutover per the checklist below, then destroy the canary.

## Cutover checklist (execute in order, each reversible)

1. Freeze the 3.10 branch (agree with the team: no more 3.10 feature work
   after final reconciliation diff).
2. App config: add 3.13-only keys via a per-deployment template variable
   (NOT the shared app-config.js.tmpl until every cluster is 3.13):
   measurementTrackingMode: 'simplified' (decided Phase 3). Note
   autoTrimCollimationBorders defaults ON (config key only needed to
   disable).
3. Workflow: on the final v3.13.x release branch, re-add the prod buckets
   to the S3 sync (prod-1, veg-prod-1 — and check whether ethos-stage-1/
   ethos-prod-1 apply to 3.13 clusters), and mirror the 3.10 workflow's
   later additions (sha-<commit> ECR tag, *.map exclusion — already
   excluded on 3.13? verify). Push → CI builds + syncs.
4. Terraform: flip ohif_version in prod tfvars one cluster at a time
   (veg-prod after prod-1 soak, or per team preference). Plan must show
   ONLY the ohif_http image change per cluster.
5. Invalidate index.html on the prod CloudFront distributions.
6. Soak + watch PostHog (first_image_rendered baseline vs 3.10 — the
   speed-instrumentation dashboard) and error rates.
7. Rollback lever (keep warm until soak ends): revert ohif_version in
   tfvars + apply, re-run the newest v3.10.* branch workflow to restore
   3.10 unhashed assets in prod buckets.
8. After soak: destroy the canary deployment, archive the 3.10 branches
   (keep the last one + its ECR image), move this runbook's content into
   the repo docs if desired.

## Production rollout (when the port is done — Phase 5)

Preconditions: all five phases re-ported, regression checklist green on
staging, modality matrix (CR/DX/CT/MR/US/PDF) + iPad + multi-monitor verified.

1. **Add prod buckets back to the S3 sync list** on the final `v3.13.*`
   release branch — this is the deliberate moment 3.13 assets reach prod
   buckets. The flat sync is additive for hashed files; the unhashed files
   flip to 3.13 versions, which matters only once prod traffic is being
   served 3.13 `index.html` (step 3).
2. Push → CI builds `ohif:v3.13.x.y.radimal` and syncs all buckets.
3. Update `ohif_version` in prod tfvars (`orthanc-blue-prod-1`, `orthanc-1`,
   `orthanc-veg-prod`) and apply — same one-image-change plan expectation.
4. Invalidate `index.html` on the prod CloudFront distributions if stale.
5. **Rollback:** revert `ohif_version` in tfvars + apply, then re-run the
   latest `v3.10.*` branch workflow to restore 3.10 unhashed assets in the
   prod buckets. Keep the last 3.10 branch and its ECR image until 3.13 has
   soaked in prod.

## Port status

- [x] Phase 0 — vanilla 3.13.3 baseline building, deployed, verified on stage-1
- [x] Phase 1 — branding, PostHog, cache manager, reporter helper utils,
      https→http endpoint fix, origins centralized in
      `platform/core/src/utils/radimalEndpoints.js` (Phase 3 consumers must
      import from it). The fork's nginx gzip tweaks were upstreamed into 3.13
      — nothing to port. Dev-recipe nginx configs deliberately skipped.
- [x] Phase 2 — adopt upstream equivalents, port only the delta. Implemented
      2026-08 (rotation/flip presentations + cross-reload store, study browser
      sort/tabs/DNR/single-click, wheel preferences on new hosts; SmartScrollbar
      adopted as upstream default). The multi-window re-port (fork model kept,
      per decision) rides with Phase 3, which rebuilds the same
      ViewerLayout/ViewerHeader files. Evaluation verdicts:
      - Viewport persistence: retire ~85% of ViewportPersistenceService — it
        only ever persisted rotation/flip; upstream presentation stores cover
        pan/zoom/VOI. Delta: widen the `getViewPresentation` selector in
        `LegacyViewportBackend.ts` to include rotation/flip (one line), plus
        optional cross-reload persistence decision.
      - Multi-monitor: fork and upstream MultiMonitorService share zero
        lineage (upstream added theirs after our fork point) and embody
        different products (ad-hoc "Duplicate Window" clones vs config-declared
        screens). Vet-app heartbeat/FADE/CLOSE postMessage bridge stays custom
        regardless — upstream has no postMessage at all. Use
        `radimalEndpoints.VET_APP_ALLOWED_ORIGINS` when re-porting.
      - StudyBrowserSort: Instance Number sort, DNR filter, and reporter PDF
        menu items become pure `customizationService` entries (no ui-next
        patches); date+StudyTime ordering, patient-scoped tabs, always-visible
        sort UI, single-click open remain as small patches concentrated in
        `createStudyBrowserTabs.ts` + `PanelStudyBrowser.tsx`. The 3.10
        tracking-panel duplicate patches disappear (3.13 delegates to
        PanelStudyBrowser). birthDate mapping is now upstream in qido.js.
      - "Smart Scrollbar" was mislabeled in the original plan: it is an
        upstream 3.13 feature, not fork code — adopt as-is (on by default,
        `viewportScrollbar.variant`). The fork's real scroll delta = wheel-tool
        preference (StackScroll/Zoom), wheel inversion, zoomSpeed — re-port to
        `viewportToolsCustomization` + userPreferences customization (old
        hosts `modes/longitudinal/initToolGroups.js` and @ohif/ui
        UserPreferences no longer exist). frameViewSynchronizer fix and iPad
        two-finger-zoom bindings retire (upstream merged equivalents).
- [ ] Phase 3 — invasive features on new APIs. Research done (2026-08, three
      implementation maps; full detail in agent reports). Plan in waves:
      - Wave 1 — DONE (pushed to staging 2026-08-17). Wave 2 — DONE
        2026-08-18 incl. automatic image-slice sync (fork feature surfaced by
        review: auto-groups viewports by patient/study/frame-count/anatomy
        compatibility; ported to
        extensions/cornerstone/src/utils/imageSliceSync/autoImageSliceSync.ts)
        and the NotificationProvider autoClose fix (activated by route-init's
        persistent error notifications). Wave 3 — DONE 2026-08-18 (CR/DX auto-VOI, collimation auto-trim, prefs modal mouse bindings + zoom speed; wheel-tool UI still parked on the zoom verdict). Phase 3 code complete — staging verification next.
      - Wave 1 (trivial, no decisions): DeferredPromise fix in
        retrieveMetadataLoaderAsync (bug still live upstream); error-handler
        guards in cornerstone init.tsx + initWADOImageLoader (TypeError on
        every failed image load in stock 3.13); ImageOverlayViewerTool bounds
        check; 5 Radimal hotkeys via 'ohif.hotkeyBindings' $push; 10 overlay
        fields (sex/neutered/acq time/institution/physician/body part) via
        'viewportOverlay.topLeft' (customizationType→inheritsFrom); 4-way
        orientation markers; rotate-left toolbar button + ToolRotateLeft icon
        via toolbarButtonsCustomization; MRN-query includefield (dependency of
        shipped patient tabs); Mode.tsx setupRouteInit catch; OIDC PostHog
        identify (cover BOTH setUser sites); study-bounded series navigation.
      - Wave 2 (reporter + multi-window; zero ui-next patches): useStudyInfo
        hook (useSystem idiom); viewReport command (getCases is dead code —
        drop); icons via Icons.addIcon in default-ext preRegistration;
        View Report entries in studyBrowser thumbnail/study MenuItems (first
        studyMenuItems entry activates the ⋯ menu); Reload Study menuOptions
        (activates already-ported InvalidationService; export it from
        @ohif/app); Download Study via empty 'secondary' toolbar section;
        monitor menu as plain menuOptions (no Header prop); ViewerLayout
        heartbeat/FADE/CLOSE via radimalEndpoints (fix the leaked beforeunload
        listener); currentStudyId cross-tab sync; DNR guard at SOP-handler
        top (the ROOT filter — test all-DNR and partial-DNR studies);
        tracking-panel DNR in customMapDisplaySets; defaultRouteInit
        duplicate-study handler (use radimalEndpoints).
      - Wave 3 (moderate/invasive): CR/DX auto-VOI in _setStackViewport
        (~:930, serves both backends; no upstream equivalent; fix fork bugs:
        metadata-path VOI check, null guard, typed-array percentiles);
        auto-trim collimation (isStackViewportType not instanceof; keep
        rotation/flip restore on Legacy lane only; driver via useSystem +
        customization gate, runs AFTER rotation/flip seed); preferences modal
        (mouse bindings via ToolGroupService binding API — fork's
        applyMouseButtonBindings/reload UX obsolete; zoomSpeed needs scaleBy
        patch in both backends; wheel half pending native-zoom verdict);
        case-status gating stage 2 (cache service + 1-line selector widening
        in menuContentCustomization) if pre-filtering required.
      - Corrections from research: combineFrameInstance fix is LIKELY OBSOLETE
        (upstream restructured per-frame objects in 3.13; retest NM multiframe
        instead of porting — supersedes the earlier 'still needed' note).
        promptTrackNewSeries → set measurementTrackingMode: 'simplified' in
        app config (semantic widening: also changes dirty-SR gating). Fork
        hotkey persistence absorbed upstream INCLUDING a migration that reads
        the fork's 'hotkey-definitions' localStorage key. Known caveat: the
        sortingCriteria customization also drives series-METADATA fetch order
        (objects lack .images there → degrades to SeriesNumber/UID; decide).
      - Decisions (2026-08-17): always-visible PDF icon on study rows
        (accepting the StudyItem.tsx patch + case-status cache service in
        wave 2); keep 3.13 patient-position intra-stack ordering (verify on
        a CT/MR before Phase 5); descope 'Set NxM as Default'; adopt
        measurementTrackingMode: 'simplified' (add to app config at deploy —
        NOT the shared terraform template while prod is on 3.10).
      - Descope candidates: 'Set NxM as Default' layout preference (3.13
        LayoutSelector rewritten with no extension point); NotificationProvider
        autoClose (no caller on branch yet); ErrorBoundary prod toast (try
        showErrorDetails: 'dev' first).
## Phase 3 staging checklist (focused pass — run once this batch deploys)

Wave 1 (already on staging): hotkeys w/p/m/o/q; vet overlay fields incl.
sex/neutered/acq time; 4-way orientation markers; rotate-left button;
patient-scoped tabs still populate (MRN includefield); PostHog identify
after login.

This batch:
- Multi-window: open viewer from vet app → heartbeat (vet app sees
  geometry), FADE dims viewer, CLOSE closes all windows; Duplicate
  Window → navigate study in primary → duplicates follow; Open Saved
  Windows after closing.
- Reporter: PDF icon appears on study rows only for studies with cases;
  click opens consultation PDF; View Report in study + thumbnail ⋯
  menus; "no case" toast on a study without one.
- Header: Reload Study (CDN invalidation → 30s → hard reload);
  Download Study from the header slot (with and without ?studyId).
- DNR: fully-DNR study still hangs a protocol; partially-DNR study
  hides those series everywhere (browser, navigation, prefetch).
- Duplicate study: known duplicate-UID URL → auto-download + persistent
  notification (stays open — autoClose fix).
- Auto slice sync: 2x2 CT/MR layout scrolls in lockstep per anatomy
  group; manual toolbar toggle still works as override.
- X-ray: CR/DX without WindowCenter/Width renders readable (auto-VOI);
  collimated shot auto-crops with rotation/flip surviving; user zoom
  suppresses re-trim on remount.
- Preferences: mouse-button assignment applies live and survives
  reload; zoom speed changes zoom step in both a stack and MPR
  viewport.

- [x] Phase 4 — implemented 2026-09-14. OpenJPEG multi-tile patch is NOT
      obsolete: 3.13.3 still pins codec-openjpeg 1.3.0 with the stock wasm
      (hash-verified) — ported vendor/1.3.0-patched + postinstall apply +
      Dockerfile --check gate; patched wasm verified byte-identical in dist.
      combineFrameInstance patch IS obsolete: new regression suite for the
      real cross-frame leak passes on 3.13 (4/4). Staging confirmations:
      load a multi-tile Sedecal J2K study; load an NM multiframe with
      spatial sync (matrix rows P4a/P4b). Confirmed
      still needed: the fork's combineFrameInstance regression test (untracked
      `platform/core/src/utils/combineFrameInstance.test.js`) fails against
      3.13.3 — upstream still mutates the shared instance object. OpenJPEG
      multi-tile remains to be tested on stock 3.13.
## Phase 5 canary (verified feasible 2026-09-14)

Run 3.13 against PROD studies at its own URL while normal users stay on
3.10 — verifies reporter-heavy flows (DNR, View Report, Reload Study,
duplicate-study handling) against real cases, which staging cannot
(reporter-staging lacks the case data; staging Reload's /cdn/invalidate
500s are reporter-staging-side).

Design — an OHIF-only cluster deployment on the prod stack (the blue/green
pattern minus everything but ohif):
- New `orthanc-cluster/deployments/orthanc-canary-prod-1.tfvars` modeled on
  orthanc-blue-prod-1.tfvars with: env=canary-prod-1, subenv=canary,
  stack_name=prod-1, ohif_version="3.13.3", enable_rds=false, enabled_services
  ohif-only (orthanc/dicom/egress/prometheus/flask all false), canary
  fqdn_shortnames (viewer-canary/view-canary/...), a free network_cidr
  (10.10.80.0/20 — prod uses 10.10.0.0/20 and 10.10.64.0/20),
  use_cloudfront_from_ohif=true, ohif_stack_orthanc_fqdn=
  orthanc.prod-1.radimal.ai, syslog_log_group_names=[].
  Plus orthanc-canary-prod-1.backend.tfvars (key = "orthanc-canary-prod-1").
- Test URL: https://viewer-canary.prod-1.radimal.ai/?StudyInstanceUIDs=...
  Page + assets served from the canary nginx (3.13 image carries its full
  dist — NO prod bucket sync, no CI workflow change); studies read from the
  prod CloudFront dicom-web (its CORS policy is '*' — verified); reporter
  resolves to PROD (hostname ends .radimal.ai, not .stage-1 — verified
  against reporterOriginFor/radimalEndpoints); reporter CORS is wildcard
  (CORS(app) — verified). PostHog: filter canary traffic by origin.
- Zero prod-touch: prod distribution, bucket, and ECS unchanged. The canary
  only exercises prod READ paths, plus two deliberate write-ish flows to
  test knowingly: Reload Study invalidates the prod CDN's cached frames for
  that one study (harmless, re-caches), and Download Study downloads via the
  prod reporter.
- Not covered by the canary: vet-app multi-window flows (prod vet opens
  view.radimal.ai) — verified on staging instead. Cutover later = flip
  ohif_version in the real prod tfvars per the runbook, then destroy the
  canary deployment.
- Expect the terraform plan to show ALB + ACM + route53 + one ECS service
  for the new cluster and nothing in any existing deployment's state (each
  deployment has its own state key).

Deferred to canary/cumulative testing: staging Reload Study 500 (reporter-
staging /cdn/invalidate), staging View Report failures (reporter-staging
case data), the CT/MR patient-position stack-order check, iPad pass.

- [ ] Phase 5 — full verification + prod cutover. Includes reconciling the
      parallel 3.10 work stream started 2026-08 (viewer speed updates:
      first_image_rendered metric, combineFrameInstance memoization,
      orthancUtils export manifest, and whatever else lands on v3.10.0.7x
      branches after the fork-delta inventory was taken) — diff
      v3.10.0.73.radimal..<final 3.10 tip> and re-port the delta.
