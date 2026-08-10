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
- [ ] Phase 1 — branding, PostHog, cache manager, reporter helper utils,
      nginx tweaks, https→http endpoint fix, centralized origins
- [ ] Phase 2 — adopt upstream equivalents (MultiMonitorService, presentation
      stores, StudyBrowserSort, Smart Scrollbar), port only the delta
- [ ] Phase 3 — invasive features on new APIs (reporter buttons, DNR/related
      studies, hotkeys/HotkeyField, autozoom/overlays, toolbar buttons)
- [ ] Phase 4 — OpenJPEG multi-tile patch + combineFrameInstance (test stock
      3.13 first; may be obsolete)
- [ ] Phase 5 — full verification + prod cutover
