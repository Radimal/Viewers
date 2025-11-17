# Known Issues & Workarounds - OHIF Viewers

> **Purpose**: Document common issues, bugs, and their workarounds. This helps developers quickly resolve problems without spending time debugging known issues.

---

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [Build & Configuration Issues](#build--configuration-issues)
3. [Runtime Issues](#runtime-issues)
4. [Data Source & PACS Issues](#data-source--pacs-issues)
5. [Performance Issues](#performance-issues)
6. [Extension & Mode Issues](#extension--mode-issues)
7. [Testing Issues](#testing-issues)

---

## Local Development Setup

### Issue: Local Orthanc Configuration for Development

**Status**: ✅ Documented (Not a bug - Configuration guide)

**Description**:
When developing locally with Orthanc PACS, you need to modify the data source configuration and proxy settings to connect to your local Orthanc instance instead of the default AWS CloudFront demo server.

**Configuration Required**:

#### 1. Data Source Configuration

**File**: `platform/app/public/config/default.js` (Lines 45-48)

**Change from (AWS CloudFront - Default)**:
```javascript
wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
qidoSupportsIncludeField: false,
```

**Change to (Local Orthanc)**:
```javascript
wadoUriRoot: 'http://localhost:80/orthanc/wado',
qidoRoot: 'http://localhost:80/orthanc/dicom-web',
wadoRoot: 'http://localhost:80/orthanc/dicom-web',
qidoSupportsIncludeField: true,
```

#### 2. Package Configuration

**File**: `package.json` (Root level)

**Required Settings**:
```json
{
  "proxy": "http://localhost:80",
  "packageManager": "yarn@1.22.22"
}
```

**Purpose**:
- `proxy`: Routes DICOMweb API requests to local Orthanc during development
- `packageManager`: Ensures consistent Yarn version across team

#### 3. Complete Local Orthanc Data Source Configuration

For reference, here's the complete data source configuration for local Orthanc:

```javascript
dataSources: [
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
      bulkDataURI: {
        enabled: true,
      },
    },
  },
]
```

**Alternative Solution (Recommended)**:
Instead of modifying `default.js`, use the pre-configured local Orthanc config:

```bash
# Use existing local_orthanc.js config
yarn dev:orthanc

# Or explicitly set config
APP_CONFIG=config/local_orthanc.js yarn dev
```

**Related Files**:
- `platform/app/public/config/default.js` - Default config (AWS CloudFront)
- `platform/app/public/config/local_orthanc.js` - Local Orthanc config
- `package.json` - Root package configuration

---

### Issue: Orthanc Docker Container Not Starting

**Status**: ⚠️ Common Issue

**Symptoms**:
- `yarn dev:orthanc` fails to connect
- Error: `ERR_CONNECTION_REFUSED` when accessing http://localhost:80
- Viewer shows "Failed to load studies" error

**Root Cause**: Orthanc Docker container not running

**Solution**:

```bash
# Navigate to Orthanc recipe
cd platform/app/.recipes/Nginx-Orthanc/

# Check if containers are running
docker compose ps

# Start Orthanc + Nginx
docker compose up -d

# Verify Orthanc is responding
curl http://localhost:80/orthanc/system

# Check logs if issues persist
docker compose logs -f
```

**Prevention**:
- Always start Orthanc before running `yarn dev:orthanc`
- Add Orthanc startup to your development script

---

### Issue: Port 80 Already in Use

**Status**: ⚠️ Common on macOS/Linux

**Symptoms**:
- Orthanc Docker container fails to start
- Error: `Bind for 0.0.0.0:80 failed: port is already allocated`

**Root Cause**: Another service (Apache, Nginx, etc.) is using port 80

**Solutions**:

**Option 1: Stop conflicting service**
```bash
# macOS
sudo apachectl stop

# Linux
sudo systemctl stop apache2
# or
sudo systemctl stop nginx
```

**Option 2: Change Orthanc port**
```bash
# Edit platform/app/.recipes/Nginx-Orthanc/docker-compose.yml
# Change port mapping from "80:80" to "8080:80"

# Update config to use new port
wadoUriRoot: 'http://localhost:8080/orthanc/wado',
qidoRoot: 'http://localhost:8080/orthanc/dicom-web',
wadoRoot: 'http://localhost:8080/orthanc/dicom-web',

# Update proxy in package.json
"proxy": "http://localhost:8080"
```

---

### Issue: CORS Errors in Development

**Status**: ⚠️ Configuration Issue

**Symptoms**:
- Browser console shows CORS errors
- Error: `Access to fetch at 'http://localhost:80/...' has been blocked by CORS policy`

**Root Cause**: Cross-origin requests not properly proxied

**Solution**:

1. **Ensure proxy is configured in package.json**:
```json
{
  "proxy": "http://localhost:80"
}
```

2. **Use the dev:orthanc script** (which configures proxy):
```bash
yarn dev:orthanc
```

3. **Check Webpack dev server proxy configuration**:
File: `platform/app/.webpack/webpack.pwa.js`
```javascript
devServer: {
  proxy: {
    '/dicom-web': {
      target: process.env.PROXY_TARGET || 'http://localhost:80',
      changeOrigin: true,
    },
  },
}
```

4. **Set environment variables**:
```bash
export PROXY_TARGET=http://localhost:80/dicom-web
export PROXY_DOMAIN=http://localhost:80
yarn dev
```

---

## Build & Configuration Issues

### Issue: JavaScript Heap Out of Memory

**Status**: ⚠️ Common on Large Builds

**Symptoms**:
```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**Root Cause**: Node.js default memory limit (usually ~2GB) insufficient for build

**Solution**:

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max_old_space_size=8192"

# Then run build
yarn build

# Or for development
yarn dev
```

**Permanent Solution**:
Add to your shell profile (`.bashrc`, `.zshrc`):
```bash
export NODE_OPTIONS="--max_old_space_size=8192"
```

---

### Issue: Webpack Cache Issues

**Status**: ✅ Common, Easy Fix

**Symptoms**:
- Changes not reflecting in browser
- Stale code running
- Build errors after pulling latest changes

**Solution**:

```bash
# Clear webpack cache
yarn dev:no:cache

# Or clean all build artifacts
yarn clean

# Deep clean (removes node_modules)
yarn clean:deep
yarn install
```

---

### Issue: Module Not Found: '@ohif/core'

**Status**: ⚠️ Workspace Linking Issue

**Symptoms**:
```
Module not found: Error: Can't resolve '@ohif/core'
```

**Root Cause**: Yarn workspaces not properly linked

**Solution**:

```bash
# Clean and reinstall
yarn clean:deep
yarn install

# Verify workspaces are linked
yarn workspaces info

# Rebuild packages
yarn build:package-all
```

---

### Issue: TypeScript Compilation Errors After Update

**Status**: ⚠️ Common After Dependency Updates

**Symptoms**:
- TypeScript errors in previously working code
- Type conflicts between packages

**Solution**:

```bash
# Clean TypeScript build cache
yarn clean

# Reinstall dependencies
yarn install

# Rebuild TypeScript declarations
npx tsc --build

# If issues persist
rm -rf node_modules yarn.lock
yarn install
```

---

## Runtime Issues

### Issue: Viewport Not Rendering Images

**Status**: ⚠️ Common Issue

**Symptoms**:
- Viewport appears blank/gray
- Images don't load
- Console error: "Failed to load image"

**Common Causes & Solutions**:

**1. Data Source Not Configured Correctly**
```javascript
// Verify correct data source in config
console.log(window.config.dataSources);

// Check if using correct URLs for your PACS
```

**2. CORS Issues**
- See [CORS Errors in Development](#issue-cors-errors-in-development)

**3. Invalid Study UID**
```javascript
// Check if Study UID is correct
// URL should be: /viewer?StudyInstanceUIDs=<valid-uid>
```

**4. Tool Group Not Initialized**
```javascript
// In mode's onModeEnter, ensure tools are created:
const { toolGroupService } = servicesManager.services;
toolGroupService.createToolGroupAndAddTools('default', {
  active: [{ toolName: 'WindowLevel', bindings: [{ mouseButton: 1 }] }],
});
```

---

### Issue: Memory Leak in Long Sessions

**Status**: 🔴 Known Performance Issue

**Symptoms**:
- Browser becomes slow after viewing many studies
- Memory usage increases over time
- Browser eventually crashes

**Root Cause**: Cornerstone image cache not properly cleared

**Workaround**:

```javascript
// Manually clear cache when switching studies
const { cornerstoneCacheService } = servicesManager.services;
cornerstoneCacheService.purgeCache();

// Or reload the page periodically
```

**Permanent Fix**: In development - related to Cornerstone3D cache management

---

### Issue: Measurements Not Persisting

**Status**: ⚠️ Configuration Dependent

**Symptoms**:
- Measurements disappear after refresh
- Can't save measurements to PACS

**Root Cause**: Measurement persistence not configured or PACS doesn't support SR

**Solution**:

1. **Check if PACS supports DICOM SR (Structured Reports)**:
```javascript
// In data source config
configuration: {
  supportsReject: true,  // Should be true
}
```

2. **Enable measurement tracking mode**:
```bash
# Use longitudinal mode which supports measurement tracking
http://localhost:3000/longitudinal?StudyInstanceUIDs=<uid>
```

3. **Verify MeasurementService is working**:
```javascript
// In browser console
const { measurementService } = window.services;
console.log(measurementService.getMeasurements());
```

---

## Data Source & PACS Issues

### Issue: Studies Not Loading from Orthanc

**Status**: ⚠️ Common Configuration Issue

**Symptoms**:
- Study list is empty
- Error: "No studies found"
- Network tab shows 404 or 500 errors

**Debugging Steps**:

1. **Verify Orthanc has studies**:
```bash
# Check Orthanc studies via API
curl http://localhost:80/orthanc/studies

# Or use Orthanc UI
open http://localhost:80/orthanc/app/explorer.html
```

2. **Verify DICOMweb endpoint**:
```bash
# Test QIDO-RS (Query)
curl http://localhost:80/orthanc/dicom-web/studies

# Should return JSON array of studies
```

3. **Check OHIF is querying correct endpoint**:
```javascript
// In browser Network tab, look for requests to:
// /dicom-web/studies?...

// Should be proxied to:
// http://localhost:80/orthanc/dicom-web/studies?...
```

4. **Upload test data if Orthanc is empty**:
```bash
# Download sample DICOM data
git submodule update --init testdata

# Upload to Orthanc
# Use Orthanc web UI or curl
```

---

### Issue: Images Load Slowly from Orthanc

**Status**: ✅ Expected Behavior

**Symptoms**:
- Images take several seconds to load
- Loading spinner shows for extended time

**Root Cause**:
- Orthanc is a lightweight PACS, not optimized for high-speed image serving
- WADO-RS streaming may be slower than production PACS

**Workarounds**:

1. **Reduce concurrent requests**:
```javascript
// In config
maxNumRequests: {
  interaction: 50,   // Reduced from 100
  thumbnail: 25,     // Reduced from 75
  prefetch: 10,      // Reduced from 25
}
```

2. **Disable prefetching during development**:
```javascript
// In config
maxNumRequests: {
  prefetch: 0,  // Disable prefetch
}
```

3. **Use smaller test datasets**:
- Limit to 10-20 slices per series during development
- Use CT/MR series instead of large whole-slide microscopy

---

### Issue: Authentication Issues with PACS

**Status**: 📝 Depends on PACS Configuration

**Symptoms**:
- 401 Unauthorized errors
- 403 Forbidden errors
- Studies load sometimes but not others

**Solution**:

1. **Configure authentication in data source**:
```javascript
configuration: {
  // ... other config
  headers: {
    Authorization: 'Bearer <token>',
    // or Basic auth
    Authorization: 'Basic ' + btoa('username:password'),
  },
}
```

2. **Use UserAuthenticationService**:
```javascript
// In extension's preRegistration
const { userAuthenticationService } = servicesManager.services;
userAuthenticationService.set({ token: '<token>' });
```

3. **For OpenID Connect**:
- See OHIF documentation for OIDC configuration
- Configure in `window.config.oidc`

---

## Performance Issues

### Issue: Slow Initial Load Time

**Status**: ⚠️ Development Mode Expected

**Symptoms**:
- Takes 10-30 seconds to load viewer initially
- Subsequent loads are faster

**Root Cause**:
- Webpack dev server compiles on demand
- Large bundle size in development mode

**Solutions**:

1. **Use production build for testing performance**:
```bash
yarn build
# Serve production build
npx serve platform/app/dist
```

2. **Enable webpack caching** (default in dev):
```javascript
// Already enabled in webpack.base.js
cache: {
  type: 'filesystem',
}
```

3. **Reduce extensions loaded**:
```javascript
// In config, only load required extensions
extensions: [
  '@ohif/extension-default',
  '@ohif/extension-cornerstone',
  // Comment out unused extensions
]
```

---

### Issue: High Memory Usage in Browser

**Status**: 🔴 Known Issue with Large Datasets

**Symptoms**:
- Browser tab uses >2GB RAM
- Browser becomes sluggish
- "Aw, Snap!" or crash errors

**Root Cause**:
- Large volume datasets (500+ images)
- Multiple viewports with volume rendering
- Image cache not properly managed

**Workarounds**:

1. **Reduce number of web workers**:
```javascript
// In config
maxNumberOfWebWorkers: 2,  // Reduced from 3
```

2. **Limit cache size**:
```javascript
// In cornerstoneExtensionConfig
cornerstoneExtensionConfig: {
  maxCacheSize: 1073741824,  // 1GB instead of 3GB
}
```

3. **Use CPU rendering fallback**:
```javascript
// In config
showCPUFallbackMessage: true,
```

4. **Avoid opening too many studies simultaneously**:
- Close studies before opening new ones
- Use "New Tab" sparingly

---

## Extension & Mode Issues

### Issue: Custom Extension Not Loading

**Status**: ⚠️ Registration Issue

**Symptoms**:
- Extension doesn't appear in viewer
- Console error: "Extension not found"

**Common Causes & Solutions**:

1. **Extension not in workspace**:
```bash
# Verify extension is in workspaces
yarn workspaces info

# Should show: extensions/my-extension
```

2. **Extension not built**:
```bash
# Build your extension
cd extensions/my-extension
yarn build

# Or build all
yarn build:package-all
```

3. **Extension not registered in config**:
```javascript
// In window.config
extensions: [
  '@ohif/extension-my-extension',  // Add your extension
]
```

4. **Extension ID mismatch**:
```javascript
// Ensure ID in extension matches registration
// In extension's index.ts
export default {
  id: '@ohif/extension-my-extension',  // Must match
}
```

---

### Issue: Mode Not Appearing in Viewer

**Status**: ⚠️ Registration Issue

**Symptoms**:
- Mode route returns 404
- Mode doesn't show in mode selector

**Solutions**:

1. **Verify mode is registered**:
```javascript
// In window.config
modes: [
  '@ohif/mode-my-mode',  // Add your mode
]
```

2. **Check mode route**:
```javascript
// In mode definition
{
  id: 'my-mode',
  routeName: 'mymode',  // Use this in URL
}

// Access via:
http://localhost:3000/mymode?StudyInstanceUIDs=<uid>
```

3. **Verify required extensions are loaded**:
```javascript
// Mode's extensions must be in config
extensions: {
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
}
```

---

## Testing Issues

### Issue: Playwright Tests Failing Locally

**Status**: ⚠️ Setup Issue

**Symptoms**:
- Tests fail with timeout errors
- Tests can't find elements
- Browser doesn't launch

**Solutions**:

1. **Install Playwright browsers**:
```bash
npx playwright install --with-deps
```

2. **Start test server before running tests**:
```bash
# Terminal 1: Start server
yarn test:e2e:serve

# Terminal 2: Run tests
yarn test:e2e
```

3. **Use headed mode for debugging**:
```bash
yarn test:e2e:headed
```

4. **Use UI mode for interactive debugging**:
```bash
yarn test:e2e:ui
```

---

### Issue: Jest Tests Failing with CSS Import Errors

**Status**: ✅ Configuration Should Handle This

**Symptoms**:
```
Cannot find module './styles.css' from 'Component.tsx'
```

**Root Cause**: CSS imports not mocked in Jest

**Solution**:

CSS mocking is already configured in `jest.config.base.js`:
```javascript
moduleNameMapper: {
  '\\.(css|less)$': 'identity-obj-proxy',
}
```

If still failing:
```bash
# Clean and reinstall
yarn clean
yarn install

# Run tests
yarn test:unit
```

---

## Troubleshooting Checklist

When encountering issues, go through this checklist:

### Development Setup
- [ ] Node.js version >= 18: `node --version`
- [ ] Yarn version 1.22.22: `yarn --version`
- [ ] Dependencies installed: `yarn install`
- [ ] Workspaces linked: `yarn workspaces info`

### Orthanc Setup
- [ ] Docker installed and running: `docker --version`
- [ ] Orthanc container running: `docker compose ps`
- [ ] Orthanc responding: `curl http://localhost:80/orthanc/system`
- [ ] Test studies uploaded to Orthanc

### Configuration
- [ ] Correct config file being used: Check `APP_CONFIG` env var
- [ ] Data source URLs match your PACS
- [ ] Proxy configured if using local development
- [ ] Extensions and modes registered in config

### Browser
- [ ] Browser console shows no errors
- [ ] Network tab shows successful DICOMweb requests
- [ ] Local storage not corrupted: Clear site data if needed
- [ ] Browser cache cleared: Hard refresh (Cmd+Shift+R / Ctrl+Shift+R)

### Build
- [ ] No webpack errors in terminal
- [ ] No TypeScript compilation errors
- [ ] Build artifacts present in `dist/` folder
- [ ] Source maps working if debugging

---

## Getting Help

If you encounter an issue not listed here:

1. **Check DEVELOPMENT_LOG.md** - See if similar issue was encountered before
2. **Check OHIF GitHub Issues** - https://github.com/OHIF/Viewers/issues
3. **Check OHIF Community Forum** - https://community.ohif.org/
4. **Enable debug logging**:
   ```javascript
   localStorage.setItem('debug', 'ohif:*');
   ```
5. **Document the issue**:
   - Add to this file if you find a solution
   - Add to DEVELOPMENT_LOG.md if it's specific to your project

---

## Template for Adding New Issues

```markdown
### Issue: [Brief Description]

**Status**: 🔴 Critical / ⚠️ Warning / ✅ Fixed / 📝 Workaround Available

**Symptoms**:
- [What the user sees]
- [Error messages]

**Root Cause**: [Technical explanation]

**Solution**:
```bash
# Commands or code changes
```

**Workaround** (if permanent fix not available):
[Temporary solution]

**Related**:
- [Links to GitHub issues]
- [Links to related documentation]
```

---

**Last Updated**: 2025-11-17
**Maintained By**: [Your Team]

**Status Legend**:
- 🔴 Critical - Blocks development
- ⚠️ Warning - Common issue with known solution
- ✅ Fixed/Documented - Resolved or documented workaround
- 📝 Workaround - Temporary solution available
