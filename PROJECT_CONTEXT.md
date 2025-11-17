# Project Context - Radimal OHIF Viewers

> **Purpose**: Document Radimal-specific setup, configurations, and customizations. This provides context for AI assistants and team members about the Radimal medical imaging platform.

---

## Project Overview

### Project Details
- **Project Name**: Radimal Medical Imaging Viewer
- **Organization**: Radimal
- **Industry**: Veterinary Medical Imaging
- **Purpose**: Cloud-based DICOM viewer with integrated reporting and consultation workflow
- **OHIF Base Version**: 3.10.0
- **Radimal Version**: v3.10.0.4.radimal
- **Branch**: v3.10.0.4.radimal

### Key Stakeholders
- **Development Team**: Radimal Engineering
- **End Users**: Veterinary professionals, radiologists
- **Infrastructure**: Cloud-based deployment (Render.com, AWS)

### Use Cases
- View and analyze veterinary medical imaging studies (X-ray, CT, MR, Ultrasound)
- Access consultation reports from radiologists
- Download studies for local archiving
- Collaborate across browser tabs with synchronized viewport layouts
- Customize viewer preferences for individual workflow needs

---

## Radimal Platform Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Radimal Ecosystem                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────┐ │
│  │   Platform   │◄────►│    Viewer    │◄────►│ Reporter │ │
│  │  vet.radimal │      │view.radimal  │      │  Backend │ │
│  │     .ai      │      │    .ai       │      │          │ │
│  └──────────────┘      └──────────────┘      └──────────┘ │
│         │                     │                     │       │
│         │                     │                     │       │
│         ▼                     ▼                     ▼       │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Orthanc PACS (DICOM Storage)            │ │
│  │         (DICOMweb: QIDO-RS, WADO-RS, STOW-RS)        │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Service URLs

#### Production Environment
- **Viewer**: https://view.radimal.ai
- **Platform**: https://vet.radimal.ai
- **Reporter Backend**: https://radimal-reporter.onrender.com
- **Orthanc PACS**: (Internal - accessed via Viewer origin)

#### Staging/Development Environment
- **Viewer**: https://radimal-viewer-staging.onrender.com (or localhost:3000)
- **Platform**: https://radimal-vet-staging.onrender.com
- **Reporter Backend**: https://radimal-reporter.onrender.com (shared)
- **Orthanc PACS**: http://localhost:80 (local development)

---

## Custom Features

Radimal has implemented 11 custom features on top of the base OHIF platform. For detailed implementation documentation, see `CLAUDE.md` section 14 and `RADIMAL_FEATURES_DOCUMENTATION.md`.

### Features Quick Reference

| Feature | User Benefit | Technical Implementation |
|---------|--------------|--------------------------|
| **Related Studies Uniqueness** | Patient safety - prevents wrong patient data | 3-field matching (name + birthdate + institution) |
| **Viewer Window Fade** | Visual feedback for navigation | Opacity/visibility management |
| **Overlay Toggle ('o')** | Quick hide/show metadata | CSS class toggling |
| **Default Layout Grid** | Personalized workspace | localStorage preference |
| **Invert Scrolling** | Match user preference | Tool configuration flag |
| **Default Tool Bindings** | Customize mouse buttons | localStorage bindings |
| **Download Study** | Local archiving capability | Orthanc ZIP archive API |
| **Window Management** | Multi-monitor workflow | localStorage + window.open |
| **View Report** | Integrated reporting workflow | Radimal Reporter API |
| **Viewport Persistence** | Maintain work state | localStorage per-image state |
| **Faster Zoom** | Improved navigation speed | Configurable multiplier |

### LocalStorage Usage

All user preferences are stored in browser localStorage:

```javascript
// User Preferences
localStorage.userLayoutPreference      // Default hanging protocol
localStorage.invertScrollWheel         // Scroll direction
localStorage.defaultToolBindings       // Mouse button assignments
localStorage.zoomSpeed                 // Zoom speed multiplier

// Window Management
localStorage.windowData                // Current window data
localStorage.windowsArray              // Saved windows list

// Viewport State (per image)
localStorage.ohif_viewport_state_{studyUID}-{seriesUID}-{instanceUID}
```

**Note**: localStorage is domain-specific, so dev and production environments maintain separate preferences.

---

## Data Sources

### Production Data Source

**Type**: Orthanc PACS via DICOMweb proxy

**Configuration**: Accessed through viewer's origin proxy (no explicit URLs in config)

```javascript
// Inferred from window.location.origin
{
  wadoUriRoot: `${origin}/orthanc/wado`,
  qidoRoot: `${origin}/orthanc/dicom-web`,
  wadoRoot: `${origin}/orthanc/dicom-web`,
  qidoSupportsIncludeField: true,
  supportsReject: true,
  imageRendering: 'wadors',
  dicomUploadEnabled: true,
}
```

### Local Development Data Source

See KNOWN_ISSUES.md for complete Orthanc setup instructions.

**Quick Setup**:
```bash
# Start Orthanc container
cd platform/app/.recipes/Nginx-Orthanc/
docker compose up -d

# Use local Orthanc config
APP_CONFIG=config/local_orthanc.js yarn dev
```

---

## Radimal Reporter Integration

### API Endpoints

**Base URL**: `https://radimal-reporter.onrender.com`

**Endpoints**:
1. **Get Case Data**:
   ```
   GET /case?StudyInstanceUID={studyUID}
   ```
   Returns: Case and consultation data including S3 URL for report PDF

2. **Get Presigned PDF URL**:
   ```
   GET /consultation/pdf?key={s3Key}
   ```
   Returns: Temporary presigned URL for PDF access

### Integration Flow

```
1. User clicks "View Report" in thumbnail menu
   │
   ▼
2. Viewer queries: GET /case?StudyInstanceUID=...
   │
   ├─ No case found → Show "No case found" notification
   │
   └─ Case found → Extract s3_url from response
      │
      ▼
3. Fetch presigned URL: GET /consultation/pdf?key=...
   │
   ▼
4. Open in Radimal Platform:
   window.open(`${platformUrl}/consultation?url=${encodeURIComponent(presignedUrl)}`)
```

### Environment Detection

```typescript
// Automatically detects production vs staging
const isProduction = window.location.origin === 'https://view.radimal.ai';
const platformUrl = isProduction
  ? 'https://vet.radimal.ai'
  : 'https://radimal-vet-staging.onrender.com';
```

---

## Build & Deployment

### Build Configuration

**Version Management**:
```json
// package.json
{
  "scripts": {
    "build": "node scripts/update-version.js && lerna run build:viewer --stream",
    "build:dev": "node scripts/update-version.js && lerna run build:dev --stream",
  }
}
```

**Version Script**: `scripts/update-version.js` automatically updates version before each build.

### CI/CD

**GitHub Actions**: `.github/workflows/playwright.yml`

**Configuration**:
- Uses **Bun** instead of Yarn for faster installs
- **10 parallel shards** for Playwright tests (increased from 5)
- **Node 20** runtime
- Runs on push to `main`/`master` and PRs

**Changes from Base OHIF**:
```yaml
# Added
- name: Install unzip
  run: apt-get update && apt-get install -y unzip
- uses: oven-sh/setup-bun@v2

# Changed
shardIndex: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]  # Was: [1, 2, 3, 4, 5]

# Changed to Bun
run: bun install --frozen-lockfile  # Was: yarn install
run: bun x playwright test          # Was: npx playwright test
```

### Deployment

**Production**: Automatically deployed to Render.com on push to main branch

**Build Command**: `yarn build`

**Start Command**: `yarn start` (serves static files from `platform/app/dist/`)

**Environment Variables**: None required (URLs auto-detected from window.location.origin)

---

## Development Workflow

### Getting Started

```bash
# Clone repository
git clone https://github.com/Radimal/Viewers.git
cd Viewers

# Checkout Radimal branch
git checkout v3.10.0.4.radimal

# Install dependencies
yarn install

# Start development server
yarn dev

# Or with local Orthanc
yarn dev:orthanc
```

### Testing Custom Features

1. **Clear localStorage** to test defaults:
   ```javascript
   localStorage.clear();
   ```

2. **Check console logging** - many features include debug output:
   ```javascript
   // Look for logs like:
   [HOTKEYS] toggleOverlays command executed
   [ViewportPersistence] Restored state for viewport...
   ```

3. **Test window management** - open multiple tabs and verify synchronization

4. **Test download** - requires Orthanc PACS running

5. **Test view report** - requires study to have associated case in Reporter backend

### Debugging

**LocalStorage Inspector**:
```javascript
// View all Radimal preferences
Object.keys(localStorage)
  .filter(key => key.includes('ohif') || key.includes('zoom') || key.includes('window'))
  .forEach(key => console.log(key, localStorage.getItem(key)));
```

**Viewport Persistence**:
```javascript
// Check saved viewport states
Object.keys(localStorage)
  .filter(key => key.startsWith('ohif_viewport_state_'))
  .forEach(key => console.log(key, JSON.parse(localStorage.getItem(key))));
```

---

## Team Conventions

### Git Workflow

**Branch**: `v3.10.0.4.radimal` (main Radimal development branch)

**Commit Convention**: Same as base OHIF (Conventional Commits)

```
type(scope): subject

Examples:
feat(viewer): add download study button
fix(persistence): correct rotation state storage
docs(readme): update Radimal features list
```

### Code Review

**Required Reviews**: 1+ team member
**Testing**: All features should be manually tested before merge
**Documentation**: Update RADIMAL_FEATURES_DOCUMENTATION.md for new features

### Feature Development

**Adding New Features**:
1. Create feature branch from `v3.10.0.4.radimal`
2. Implement feature following OHIF patterns
3. Add localStorage key to PROJECT_CONTEXT.md if applicable
4. Update CLAUDE.md section 14 with feature summary
5. Add detailed docs to RADIMAL_FEATURES_DOCUMENTATION.md
6. Test in dev and staging environments
7. Create PR to `v3.10.0.4.radimal`

---

## Monitoring & Logging

### Client-Side Logging

**Debug Mode**:
```javascript
// Enable verbose logging
localStorage.setItem('debug', 'ohif:*');
```

**Custom Feature Logging**:
- Overlay toggle: `[HOTKEYS]` prefix
- Viewport persistence: `[ViewportPersistence]` prefix
- Window management: Check browser console for window events

### Error Tracking

**Browser Console**: Primary debugging tool

**Network Tab**: Monitor API calls to:
- Orthanc PACS endpoints
- Radimal Reporter API
- Platform integration

### Performance

**Metrics to Monitor**:
- Initial load time
- Viewport rendering speed
- localStorage access performance
- Memory usage (check for leaks in long sessions)

---

## Security Considerations

### Data Privacy

**Patient Data**:
- All DICOM data stays in Orthanc PACS
- No PHI stored in localStorage (only viewport states, preferences)
- Reports fetched via presigned S3 URLs (temporary access)

### Authentication

**Current**: No authentication in viewer (handled by platform/infrastructure)

**Future**: Consider implementing OpenID Connect for user authentication

### API Security

**Reporter API**:
- Uses presigned S3 URLs for report access
- URLs are temporary and expire
- No sensitive data in query parameters

---

## Integration with Radimal Platform

### Platform Features

**Consultation Workflow**:
1. Veterinarian uploads study to Orthanc via Platform
2. Radiologist reviews study in Viewer
3. Radiologist creates report in Platform
4. Report stored in S3, metadata in Reporter backend
5. Veterinarian accesses report via "View Report" in Viewer

**Navigation**:
- Seamless navigation between Platform and Viewer
- Studies open in Viewer with StudyInstanceUID parameter
- Reports open in Platform with presigned URL parameter

---

## Known Limitations

1. **Viewport Persistence**:
   - Only stores rotation/flip, not zoom or pan
   - State tied to StudyUID-SeriesUID-InstanceUID (doesn't persist across study reloads with different UIDs)

2. **Window Management**:
   - Limited to same domain (localStorage restriction)
   - No cross-device synchronization

3. **Download Study**:
   - Requires Orthanc PACS backend
   - Downloads all series (no selective series download)

4. **View Report**:
   - Only works for studies with associated cases in Reporter
   - Requires network connectivity to Reporter API

5. **Local Storage**:
   - 5-10MB browser limit
   - No cleanup of old viewport states (manual clear required)

---

## Future Enhancements

### Planned Features
- [ ] User authentication and preferences sync
- [ ] Cloud storage for viewport states
- [ ] Selective series download
- [ ] Report creation in viewer
- [ ] AI integration for automated measurements
- [ ] Mobile/tablet optimization

### Technical Debt
- [ ] Add unit tests for custom features
- [ ] Add E2E tests for Radimal features
- [ ] Optimize viewport persistence storage (cleanup old states)
- [ ] Add feature flags for gradual rollout
- [ ] Implement error boundaries for custom components

---

## Quick Reference

### Useful Commands

```bash
# Development
yarn dev                    # Start dev server
yarn dev:orthanc           # Dev with Orthanc proxy
yarn dev:no:cache          # Dev without webpack cache

# Building
yarn build                 # Production build (with version update)
yarn build:dev             # Development build

# Testing
yarn test:unit             # Jest unit tests
yarn test:e2e              # Playwright E2E tests
yarn test:e2e:ui           # Playwright UI mode

# Utilities
yarn clean                 # Clean build artifacts
yarn clean:deep            # Clean + remove node_modules
```

### Important URLs

**Documentation**:
- CLAUDE.md - AI assistant guidance (section 14 for Radimal features)
- RADIMAL_FEATURES_DOCUMENTATION.md - Detailed feature docs
- DEVELOPMENT_LOG.md - Session history
- KNOWN_ISSUES.md - Troubleshooting guide

**External Resources**:
- [OHIF Documentation](https://docs.ohif.org/)
- [Cornerstone3D Docs](https://www.cornerstonejs.org/)
- [Orthanc Documentation](https://orthanc.uclouvain.be/book/)

### Key Contacts

**Development Team**: [Your team contacts]
**DevOps/Infrastructure**: [Infrastructure contacts]
**Product Owner**: [Product contact]

---

**Last Updated**: 2025-11-17
**Radimal Version**: v3.10.0.4.radimal
**Maintained By**: Radimal Engineering Team
