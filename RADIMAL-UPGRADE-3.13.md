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

## Phase 5 automated verification — PASSED (2026-09-14)

- ESLint over all 68 branch-changed source files: clean.
- Jest, every workspace: 1,092 tests green (core 368, cornerstone 600,
  default 92, app 32; measurement-tracking has no 3.13 test files — its
  suite was 3.10-side, reconciliation item).
- Upstream Playwright E2E (--ignore-snapshots, screenshot baselines are
  Radimal-themed by design): 170/177 passed, 5 skipped, 2 failures both
  classified environmental, not regressions —
  LivewireContourSegmentation passes in isolation (4-worker load flake);
  MPRThenRTOverlayNoHydration exceeds the 15s viewport-settle budget on
  a laptop but passes with 60s (43s wall) — expect green on CI hardware.
  Auto-slice-sync explicitly ruled out (spec fails identically with it
  disabled). NM multiframe spec passed (combineFrameInstance
  confirmation). Remaining E2E debt: re-baseline screenshots for the
  Radimal theme if we want visual regression coverage on this branch.

## Phase 5 sequencing (agreed 2026-09-14)

1. Verification now: automated layer locally (all-workspace jest, eslint,
   Playwright with --ignore-snapshots) + remaining staging matrix rows.
2. Reconcile the 3.10 stream — DONE 2026-09-14 against
   origin/v3.10.0.71.radimal tip 5d9d8341a2 (141 commits triaged by final
   file state). Ported: full speed-telemetry stack (posthog.ts rewrite,
   initViewTiming first_image/layout_rendered, frameDownloadTelemetry,
   log.timeStartedAt, UpdateBanner + non-disruptive version polling);
   orthancUtils wholesale (reporterOriginFor, download studyId validation,
   renderedThumbnailUrlFor) with radimalEndpoints retired; rendered-path
   thumbnails (subsumes MONOCHROME1 fix) + tracking-package jest config;
   CT/MR date-time display-set ordering (total-order comparator, resolves
   the sortingCriteria shape caveat); .71 autozoom re-base + manual-delta
   system with CR/DX reveal gate (two documented 3.13 adaptations);
   ViewerLayout series-metadata progress; useStudyInfo requested-UID
   semantics + tests; T6 25-study prior cap; sha- image tags.
   Verified by mechanical audit 2026-09-14: every one of the 79 files in
   the .73->.71 delta compared byte-for-byte against this branch — 22
   identical (verbatim ports), every DIFFERS/ABSENT hunk explicitly
   dispositioned. Audit catches folded in (3df8aa5872): stable panel
   callback identities (T4's real mechanism), deferred prior-study search
   (T6's second half), .71's richer combineFrameInstance suite. Additional
   deliberate skips found in audit: core utils export-manifest test (pins
   the 3.10 manifest; would be pure churn to re-pin), HotkeysManager debug
   cleanup (fork-only code never carried), ui-next StudyBrowser/StudyItem/
   Header/Icons fork hunks (case-status + monitor UI re-implemented via
   radimalCaseStatus/StudyItemActions/menuOptions), reporterOrigin.ts
   ui-next lib (superseded by orthancUtils), apply-openjpeg-patch.js (ours
   from .73 is the NEWER multi-version script — .71 has the older one).
   Re-landed 2026-09-15 (c01f818441): live study-populate — the feature
   reverted from 3.10 in 7ac1202e52 — forward-ported WITH the revert
   ticket's fixes: Mode.tsx deferred-teardown holder (the freeze root
   cause; unit-tested), 24h recency gate + 30-quiet-tick self-stop,
   visibilitychange pause. Config knob: liveStudyPollIntervalMs
   (default 10000, <=0 disables). NOTE: 3.10 does NOT have this feature
   live — the canary is the only deployment of it; watch for the ~30%
   non-teardown freeze theory during canary testing (poll volume across
   tabs is covered by the gates).

   Backed out 2026-09-15: rendered-thumbnail path — 3.10 reverted it again
   (83c7350a59: /rendered <img> skips cornerstone, thumbnail clicks land
   cold; prod retagged to sha-5d9d8341) so the .71 port of it was removed
   from this branch too. Re-landing needs cross-series prefetch first
   (studyPrefetcher.displaySetsCount is 1).

   Re-landed 2026-09-22 (5cff219ee4): Set NxM as Default layout preference —
   originally descoped, restored on specialist request. Preference shapes the
   default hanging protocol stage at module load; save reloads the page.

   Re-landed 2026-09-22 (f8b39e4814): wheel-tool preference + inversion —
   revert-of-revert of 7f9892d593, plus the Scroll Wheel Tool / Invert
   Scroll Wheel rows in the 3.13 preferences modal (save reloads; bindings
   built at mode entry). Same localStorage keys as 3.10.

   Not ported, with reasons: live study-polling + T5 (backed out on .71
   itself); T4 (absorbed upstream via fetchedStudiesRef); HotkeyField
   unpause (absorbed — ui-next Hotkey unpauses on blur); per-viewport
   load-percent overlay (post-cutover polish); build tooling (mise/babel/
   node-version — 3.13 uses pnpm/rspack); ethos buckets (cutover
   checklist). ANY 3.10 COMMIT LANDING AFTER 5d9d8341a2 NEEDS A FRESH
   DELTA CHECK BEFORE CUTOVER (git log 5d9d8341a2..origin/v3.10.0.71.radimal).
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
- Module reality check (2026-09-14): the aurora RDS module is NOT gated on
  enable_rds (only subnet math is), and no deployment has ever run
  enable_rds=false — gating it now would change resource addresses for
  every existing state (destroy/recreate plans on prod RDS). So the canary
  keeps enable_rds=true at minimum ACU (idle, ~$1.5/day) for a plan shape
  identical to the proven blue cluster. Expect the plan to show VPC + ALB +
  ACM + route53 + one ECS service + one idle Aurora, and nothing in any
  existing deployment's state (each deployment has its own state key).

- DECISION 2026-09-14: canary runs on the EXISTING BLUE CLUSTER instead of
  a standalone deployment — blue's OHIF already reads studies from the live
  prod CloudFront (use_cloudfront_from_ohif), so the canary is a one-line
  change: ohif_version "3.10.0.71" -> "3.13.3" in
  orthanc-cluster/deployments/orthanc-blue-prod-1.tfvars. Test URL:
  https://viewer-blue.prod-1.radimal.ai (or view-blue). Rollback = revert
  the line + apply. TRADEOFF ACCEPTED: blue is the prod standby — an
  incident divert to blue during the canary puts users on 3.13; the
  understood answer is revert-and-redeploy blue's ohif (~2 min). The
  standalone canary tfvars below remain UNCOMMITTED in radimal-terraform
  (orthanc-canary-prod-1.{tfvars,backend.tfvars}) as the isolated fallback —
  do not PR them unless the blue approach is vetoed.

- Standalone fallback — EXACT FILES (already written to
  radimal-terraform/orthanc-cluster/deployments/, uncommitted):

  orthanc-cluster/deployments/orthanc-canary-prod-1.backend.tfvars:
    bucket = "radimal-terraform-state"
    key = "orthanc-canary-prod-1"
    region = "us-east-1"

  orthanc-cluster/deployments/orthanc-canary-prod-1.tfvars:
    # 3.13 canary: OHIF-only cluster serving the 3.13 viewer against the
    # PROD Orthanc backend at its own hostname. Normal users stay on 3.10
    # at view.radimal.ai — nothing here touches the prod viewer
    # distribution, asset bucket, or prod ECS. Assets are served from this
    # cluster's nginx (the 3.13 image carries its full dist); studies come
    # from the prod CloudFront dicom-web (CORS '*'). RDS is an idle
    # min-ACU cluster only because the aurora module is ungated (see
    # runbook). Tear down by destroying this deployment.
    env                         = "canary-prod-1"
    subenv                      = "canary"
    stack_name                  = "prod-1"
    aws_region                  = "us-east-1"
    parent_zone                 = "prod-1.radimal.ai"
    is_prod                     = true
    orthanc_active              = false
    orthanc_version             = "25.12.2"
    ohif_version                = "3.13.3"
    enable_rds                  = true
    enable_rds_reader           = false
    perform_acm_validation      = true
    network_provisioner         = false
    network_cidr                = "10.10.80.0/20"
    enabled_services = {
      "orthanc": false
      "orthancegress": false
      "prometheus": false
      "ohif": true
      "dicom": false
      "flask": false
    }
    fqdn_shortnames = {
      "orthanc"    = "orthanc-canary"
      "egress"     = "orthanc-egress-canary"
      "dicom"      = "dicom-canary"
      "flask"      = "flask-canary"
      "viewer"     = "viewer-canary"
      "view"       = "view-canary"
      "cache"      = "cache-canary"
      "prometheus" = "prometheus-canary"
    }
    ssh_tunnel_crossconnect = false
    use_cloudfront_from_ohif = true
    ohif_stack_orthanc_fqdn = "orthanc.prod-1.radimal.ai"
    reporter_fqdn               = "radimal-reporter.onrender.com"
    syslog_log_group_names = []
    rds_min_acu     = 0.5
    rds_max_acu     = 1

- Order of operations: (1) push the Viewers branch first so CI rebuilds
  ohif:v3.13.3.radimal with the reconciliation batch; (2) PR + apply the
  canary deployment; (3) test at
  https://viewer-canary.prod-1.radimal.ai/?StudyInstanceUIDs=<uid>.

Deferred to canary/cumulative testing: staging Reload Study 500 (reporter-
staging /cdn/invalidate), staging View Report failures (reporter-staging
case data), the CT/MR patient-position stack-order check, iPad pass.

- [ ] Phase 5 — full verification + prod cutover. Includes reconciling the
      parallel 3.10 work stream started 2026-08 (viewer speed updates:
      first_image_rendered metric, combineFrameInstance memoization,
      orthancUtils export manifest, and whatever else lands on v3.10.0.7x
      branches after the fork-delta inventory was taken) — diff
      v3.10.0.73.radimal..<final 3.10 tip> and re-port the delta.

## Canary comprehensive test matrix (2026-09-15)

All rows at https://viewer-blue.prod-1.radimal.ai unless noted. For the
multi-window rows, the viewer must believe it is the vet-launched primary
window: prod vet can't open the canary URL, so in the console run
`window.name = 'viewerWindow'; location.reload()` once per tab first.
Without it the monitor menu is hidden BY DESIGN (share-link windows must
not manage the window family) — that is why "Duplicate Window" seems
missing on a pasted URL.

### Header / chrome
| # | Feature | Test | Expected |
|---|---------|------|----------|
| 1 | Download placement | Look right of patient info | Download icon between patient info and gear; spinner while zipping; file lands |
| 2 | Download validation | Append `&studyId=deadbeef` to URL, download | Uses derived id, console warn about malformed id |
| 3 | Reload Study | Gear → Reload Study | Invalidation banner → reload; study reopens (prod reporter, should work unlike staging) |
| 4 | Monitor menu gate | Pasted URL, no rename | No Duplicate/Open Saved/Close Windows in gear |
| 5 | Monitor menu | After window.name trick | All three entries present |
| 6 | Zoom speed pref | Preferences → zoom speed dropdown | Percent options render and persist |
| 7 | Theme | General look | Radimal dark theme, logo, favicon |
| 8 | Undo/Redo arrows | Draw a length measurement, click undo then redo | Measurement disappears/reappears (they are annotation undo/redo — inert until something is drawn) |

### Multi-window (after window.name trick in the PRIMARY tab)
| # | Feature | Test | Expected |
|---|---------|------|----------|
| 9 | Duplicate Window | Gear → Duplicate Window | New window viewerWindow-1, same study |
| 10 | Family fade | Navigate primary to another study | All family windows fade + unfade together after load |
| 11 | Family navigate | Primary changes study | Secondaries follow to the new study |
| 12 | Close Windows | From primary | Secondaries close first, primary last |
| 13 | Open Saved Windows | Duplicate, move/size it, Close Windows, reopen study, Open Saved Windows | Window reopens at saved position (popup blocker note if blocked) |
| 14 | Departure notes | Close a secondary manually, navigate primary | No orphan errors; heartbeat cleanup within ~2s |

### Persistence / viewport
| # | Feature | Test | Expected |
|---|---------|------|----------|
| 15 | Rotation/flip persist | Rotate+flip, switch series, return; then reload tab | Both survive series switch AND reload |
| 16 | Zoom/pan persist | Zoom+pan, switch series, return | Restored |
| 17 | Auto-trim CR/DX | Open collimated CR/DX | Borders trimmed on first render, no flash of untrimmed image |
| 18 | Trim + manual zoom | Trim, zoom in, leave series, return | Manual zoom delta preserved on top of trim |
| 19 | Trim + rotation | Rotate a trimmed image, leave, return | Trim and rotation both correct, no drift/compounding |
| 20 | SmartScrollbar | Scroll a large CT | Scrollbar tracks; no jumps |
| 21 | Series nav bounds | Next/prev series at study edge | Stops at study boundary, does not cross into priors |

### Study browser / data
| # | Feature | Test | Expected |
|---|---------|------|----------|
| 22 | CT/MR ordering | Study with several CT/MR series | Series ordered by date+time, then number; stable across reloads |
| 23 | Priors | Patient with priors | Tabs per study; current study renders before prior search completes (T6 defer) |
| 24 | PDF icon | Study rows with a finished case | PDF icon on the row, opens report; absent on caseless studies |
| 25 | Thumbnails | Rail on a big study | Canvas thumbnails (rendered path backed out); MONOCHROME1 not inverted; clicking a series that has a thumbnail starts warm |
| 26 | Duplicate-UID URL | Open URL with same UID twice in StudyInstanceUIDs | No duplicate-study crash |
| 27 | DNR study | Open a DNR-flagged study | DNR series handling unchanged from 3.10 |

### Live study-populate (NEW — only deployment anywhere)
| # | Feature | Test | Expected |
|---|---------|------|----------|
| 28 | Growth | Open a study < 24h old that is still receiving images | New instances appear in open stack without reload; slice/zoom/W-L kept; console `[LiveStudyPoll]` lines |
| 29 | Empty viewport fill | 2x2 layout with empty tiles while study grows | New series lands in first empty tile |
| 30 | Header count | While growing | Study browser instance count climbs |
| 31 | Idle backoff | Leave a quiet study open ~5 min, watch console | `idling (60000ms) after quiet period`; poll continues at 60s |
| 32 | Idle wake | After idling, send new instances to the study | Within ~60s: `resuming fast poll`, 'New images arriving' toast, viewport grows |
| 33 | Teardown | Open next study before the first finishes loading, repeat 5-10x | No accumulating polls (one `[LiveStudyPoll] polling...` per open study max), no freeze |

### Codecs / telemetry (P4 / P1)
| # | Feature | Test | Expected |
|---|---------|------|----------|
| 34 | Multi-tile J2K | Sedecal multi-tile study | Tiles decode correctly (patched OpenJPEG) |
| 35 | NM multiframe | NM study, scroll frames | Per-frame positions correct (3.13 combineFrameInstance) |
| 36 | PostHog | Open studies, check PostHog live events filtered to viewer-blue origin | first_image_rendered / layout_rendered with build tag; frame download stats on tab close |
| 37 | UpdateBanner | Push any new build while a tab is open | Non-disruptive banner offering reload appears within poll interval |
