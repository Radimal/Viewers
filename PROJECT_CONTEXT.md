# Project Context - OHIF Viewers Customization

> **Purpose**: Document project-specific setup, configurations, and customizations that differ from the standard OHIF installation. This helps AI assistants understand your specific environment and requirements.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Data Sources Configuration](#data-sources-configuration)
3. [Local Development Setup](#local-development-setup)
4. [Custom Extensions](#custom-extensions)
5. [Custom Modes](#custom-modes)
6. [Deployment Configuration](#deployment-configuration)
7. [Team Conventions](#team-conventions)

---

## Project Overview

### Project Details
- **Project Name**: [Your Project Name]
- **Organization**: [Your Organization]
- **Purpose**: [Brief description of your medical imaging solution]
- **OHIF Version**: 3.9.0
- **Started**: [Date]

### Key Stakeholders
- **Development Team**: [Team members]
- **Medical Staff**: [Key users]
- **IT/DevOps**: [Infrastructure team]

### Use Cases
- [Primary use case 1]
- [Primary use case 2]
- [Primary use case 3]

---

## Data Sources Configuration

### Production Data Source (Default)

**Configuration File**: `platform/app/public/config/default.js`

```javascript
// AWS CloudFront Static WADO Server
{
  namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
  sourceName: 'dicomweb',
  configuration: {
    friendlyName: 'AWS S3 Static wado server',
    name: 'aws',
    wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
    qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
    wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
    qidoSupportsIncludeField: false,
    imageRendering: 'wadors',
    thumbnailRendering: 'wadors',
    enableStudyLazyLoad: true,
    supportsFuzzyMatching: false,
    supportsWildcard: true,
    staticWado: true,
    singlepart: 'bulkdata,video',
  }
}
```

**Purpose**: Demo/staging environment using AWS CloudFront CDN
**Characteristics**:
- Static WADO server (read-only)
- No upload/reject capabilities
- Optimized for demo purposes
- Uses WADO-RS for image rendering

### Local Development Data Source (Orthanc)

**Configuration File**: `platform/app/public/config/local_orthanc.js`

```javascript
// Local Orthanc DICOMWeb Server
{
  namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
  sourceName: 'orthanc',
  configuration: {
    friendlyName: 'local Orthanc DICOMWeb Server',
    name: 'DCM4CHEE',
    wadoUriRoot: 'http://localhost:80/orthanc/wado',
    qidoRoot: 'http://localhost:80/orthanc/dicom-web',
    wadoRoot: 'http://localhost:80/orthanc/dicom-web',
    qidoSupportsIncludeField: true,
    supportsReject: true,
    imageRendering: 'wadors',
    thumbnailRendering: 'wadors',
    enableStudyLazyLoad: true,
    supportsFuzzyMatching: true,
    supportsWildcard: true,
    dicomUploadEnabled: true,
    omitQuotationForMultipartRequest: true,
  }
}
```

**Purpose**: Local development and testing with full DICOM capabilities
**Characteristics**:
- Full DICOMweb support (QIDO-RS, WADO-RS, WADO-URI, STOW-RS)
- Upload/reject enabled
- Fuzzy matching support
- Runs on localhost:80

**Setup Instructions**: See [Local Development Setup](#local-development-setup) section

---

## Local Development Setup

### Prerequisites

```bash
# Required Software
- Node.js >= 18
- Yarn 1.22.22
- Docker (for Orthanc)
- Git
```

### Orthanc PACS Setup

#### Starting Orthanc with Docker

```bash
# Navigate to Orthanc recipe
cd platform/app/.recipes/Nginx-Orthanc/

# Start Orthanc + Nginx
docker compose up -d

# Verify Orthanc is running
curl http://localhost:80/orthanc/system
```

#### Orthanc Configuration
- **Orthanc API**: http://localhost:80/orthanc/
- **Orthanc DICOMweb**: http://localhost:80/orthanc/dicom-web/
- **Orthanc WADO**: http://localhost:80/orthanc/wado/
- **Default Credentials**: (configured in docker-compose.yml)

#### Uploading Test Data to Orthanc

```bash
# Using Orthanc Web UI
# Navigate to: http://localhost:80/orthanc/app/explorer.html
# Click "Upload" button and select DICOM files

# Using curl
curl -X POST http://localhost:80/orthanc/instances \
  -H "Content-Type: application/dicom" \
  --data-binary @/path/to/dicom/file.dcm

# Using StoreSCU (DICOM C-STORE)
storescu -aec ORTHANC localhost 4242 /path/to/dicom/files/*.dcm
```

### Development Workflow

#### 1. Start Orthanc (in separate terminal)
```bash
cd platform/app/.recipes/Nginx-Orthanc/
docker compose up
```

#### 2. Start OHIF Viewer with Orthanc Config

**Option A: Using Environment Variable**
```bash
# Set config before starting dev server
APP_CONFIG=config/local_orthanc.js yarn dev:orthanc
```

**Option B: Modify default.js temporarily**
```javascript
// In platform/app/public/config/default.js
// Change lines 45-48 to:
wadoUriRoot: 'http://localhost:80/orthanc/wado',
qidoRoot: 'http://localhost:80/orthanc/dicom-web',
wadoRoot: 'http://localhost:80/orthanc/dicom-web',
qidoSupportsIncludeField: true,
```

#### 3. Access Viewer
```bash
# Viewer URL
http://localhost:3000

# View specific study
http://localhost:3000/viewer?StudyInstanceUIDs=<study-uid>
```

### Package Manager Configuration

**File**: `package.json` (root)

```json
{
  "packageManager": "yarn@1.22.22",
  "proxy": "http://localhost:80"
}
```

**Important Notes**:
- **Yarn 1.22.22** is pinned - do not upgrade without testing
- **Proxy setting** routes API requests to Orthanc during development
- Webpack dev server proxies requests to avoid CORS issues

### Switching Between Data Sources

**Method 1: Environment Variable (Recommended)**
```bash
# Use CloudFront (default)
yarn dev

# Use local Orthanc
yarn dev:orthanc
# or
APP_CONFIG=config/local_orthanc.js yarn dev

# Use custom config
APP_CONFIG=config/my_custom_config.js yarn dev
```

**Method 2: Query Parameter**
```bash
# Enable dynamic config in config file
dangerouslyUseDynamicConfig: { enabled: true }

# Then use URL parameter
http://localhost:3000?configUrl=http://example.com/config.js
```

### Common Development Tasks

#### Running Tests Against Orthanc
```bash
# Start Orthanc
docker compose -f platform/app/.recipes/Nginx-Orthanc/docker-compose.yml up -d

# Run E2E tests
yarn test:e2e

# Run specific test
npx playwright test tests/MyTest.spec.ts
```

#### Debugging with Orthanc
```bash
# Enable verbose logging
localStorage.setItem('debug', 'ohif:*')

# Check Orthanc logs
docker compose -f platform/app/.recipes/Nginx-Orthanc/docker-compose.yml logs -f

# Check network requests in browser DevTools
# Network tab -> Filter by "dicom-web"
```

---

## Custom Extensions

### Extension Development Guidelines

_Document any custom extensions your team has built_

#### Template for Custom Extension Documentation

```markdown
### Extension: [Extension Name]

**Location**: `extensions/[extension-name]/`
**ID**: `@ohif/extension-[extension-name]`
**Version**: [version]
**Status**: [Development / Beta / Production]

**Purpose**: [What problem it solves]

**Module Types Provided**:
- [x] Commands Module
- [x] Panel Module
- [ ] Viewport Module
- [ ] SOP Class Handler Module
- [ ] Toolbar Module
- [ ] Data Source Module
- [ ] Hanging Protocol Module
- [ ] Customization Module

**Dependencies**:
- `@ohif/core`: ^3.9.0
- `@ohif/ui`: ^3.9.0
- [Other dependencies]

**Configuration**:
```javascript
{
  extensions: [
    ['@ohif/extension-[name]', {
      // Extension-specific config
      setting1: 'value',
    }],
  ],
}
```

**Key Features**:
1. [Feature 1]
2. [Feature 2]

**Known Limitations**:
- [Limitation 1]
- [Limitation 2]

**Testing**:
- Unit tests: [Location]
- E2E tests: [Location]
- Manual testing: [Procedure]
```

---

## Custom Modes

### Mode Development Guidelines

_Document any custom modes your team has built_

#### Template for Custom Mode Documentation

```markdown
### Mode: [Mode Name]

**Location**: `modes/[mode-name]/`
**ID**: `[mode-id]`
**Route Name**: `/[route-name]`
**Version**: [version]
**Status**: [Development / Beta / Production]

**Purpose**: [What workflow it enables]

**Modalities Supported**:
- [x] CT
- [x] MR
- [ ] PT
- [ ] US
- [ ] XA
- [ ] MG
- [ ] Other

**Required Extensions**:
- `@ohif/extension-default`
- `@ohif/extension-cornerstone`
- [Other extensions]

**Layout Configuration**:
- Left Panels: [Panel list]
- Right Panels: [Panel list]
- Viewport Count: [Number]
- Viewport Types: [Stack, Volume, MPR, etc.]

**Toolbar Configuration**:
- [Tool groups]
- [Primary tools]
- [Secondary tools]

**Hanging Protocol**:
- [Default hanging protocol]
- [Matching rules]

**Configuration**:
```javascript
{
  modesConfiguration: {
    '[mode-id]': {
      // Mode-specific settings
    },
  },
}
```

**Usage**:
```
http://localhost:3000/[route-name]?StudyInstanceUIDs=<uid>
```

**Known Issues**:
- [Issue 1]
- [Issue 2]
```

---

## Deployment Configuration

### Development Environment
- **URL**: http://localhost:3000
- **Data Source**: Local Orthanc
- **Config**: `config/local_orthanc.js`
- **Build Command**: `yarn dev:orthanc`

### Staging Environment
- **URL**: [Your staging URL]
- **Data Source**: [Configuration]
- **Config**: [Config file]
- **Build Command**: `APP_CONFIG=config/staging.js yarn build`

### Production Environment
- **URL**: [Your production URL]
- **Data Source**: [Configuration]
- **Config**: `config/default.js` (AWS CloudFront)
- **Build Command**: `yarn build`
- **Deployment**: [Deployment method]

### Environment Variables

```bash
# Development
NODE_ENV=development
OHIF_PORT=3000
PROXY_TARGET=http://localhost:80/dicom-web
PROXY_DOMAIN=http://localhost:80

# Production
NODE_ENV=production
PUBLIC_URL=/
APP_CONFIG=config/default.js

# Feature Flags
QUICK_BUILD=false
USE_LOCIZE=false
```

---

## Team Conventions

### Code Review Process
- [Your team's code review workflow]
- [Required reviewers]
- [Merge requirements]

### Branch Naming
- Feature: `feature/description`
- Bug Fix: `fix/description`
- Hotfix: `hotfix/description`
- Release: `release/X.Y.Z`

### Commit Message Format
```
type(scope): subject

body

footer
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Testing Requirements
- [ ] Unit tests for new business logic
- [ ] E2E tests for new user workflows
- [ ] Manual testing checklist
- [ ] Performance testing (if applicable)

### Documentation Requirements
- [ ] Update DEVELOPMENT_LOG.md with session notes
- [ ] Update KNOWN_ISSUES.md if bugs found
- [ ] Update CLAUDE.md if architecture changes
- [ ] Add inline JSDoc comments for public APIs
- [ ] Update README if setup changes

---

## Integration Points

### PACS Integration
- **PACS System**: [Your PACS name/vendor]
- **Protocol**: DICOMweb (QIDO-RS, WADO-RS, STOW-RS)
- **Authentication**: [Auth method]
- **Special Configuration**: [Any special setup]

### External Systems
- **RIS Integration**: [If applicable]
- **EMR Integration**: [If applicable]
- **Reporting System**: [If applicable]
- **Archive System**: [If applicable]

### Authentication/Authorization
- **Auth Provider**: [OpenID Connect, SAML, etc.]
- **User Management**: [System]
- **Role-Based Access**: [If implemented]

---

## Monitoring & Logging

### Application Monitoring
- **Tool**: [Monitoring tool if any]
- **Metrics Tracked**: [Key metrics]
- **Alerting**: [Alert configuration]

### Error Tracking
- **Tool**: [Error tracking service]
- **Configuration**: [Setup details]

### Logging Strategy
- **Client-Side Logs**: [Browser console, service]
- **Server-Side Logs**: [If applicable]
- **Log Retention**: [Policy]

---

## Quick Reference

### Useful URLs

**Development**:
- Viewer: http://localhost:3000
- Orthanc UI: http://localhost:80/orthanc/app/explorer.html
- Orthanc API: http://localhost:80/orthanc/

**Documentation**:
- OHIF Docs: https://docs.ohif.org/
- Orthanc Docs: https://orthanc.uclouvain.be/book/
- DICOMweb Standard: https://www.dicomstandard.org/using/dicomweb/

**Project Docs**:
- CLAUDE.md: AI assistant guidance
- DEVELOPMENT_LOG.md: Session history
- KNOWN_ISSUES.md: Common problems & solutions

### Key Contacts
- **Project Lead**: [Name/Email]
- **Technical Lead**: [Name/Email]
- **DevOps**: [Name/Email]
- **Medical Informatics**: [Name/Email]

---

**Last Updated**: 2025-11-17
**Maintained By**: [Your Team]
