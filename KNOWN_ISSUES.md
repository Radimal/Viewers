# Known Issues & Workarounds - Radimal OHIF Viewers

> **Purpose**: Document common issues, bugs, and their workarounds for the Radimal medical imaging viewer. This helps developers quickly resolve problems without spending time debugging known issues.

---

## Table of Contents

1. [Radimal-Specific Issues](#radimal-specific-issues)
2. [Local Development Setup](#local-development-setup)
3. [Build & Configuration Issues](#build--configuration-issues)
4. [Runtime Issues](#runtime-issues)
5. [Data Source & PACS Issues](#data-source--pacs-issues)
6. [Performance Issues](#performance-issues)
7. [LocalStorage Issues](#localstorage-issues)

---

## Radimal-Specific Issues

### Issue: Viewport Persistence Not Working

**Status**: ⚠️ Common Configuration Issue

**Symptoms**:
- Rotations/flips not saved when navigating between images
- State resets on page reload
- Console shows no persistence logs

**Root Causes & Solutions**:

**1. LocalStorage Disabled**:
```javascript
// Test if localStorage is available
try {
  localStorage.setItem('test', 'test');
  localStorage.removeItem('test');
  console.log('localStorage is available');
} catch (e) {
  console.error('localStorage is disabled', e);
}
```

**Solution**: Enable localStorage in browser settings (Privacy & Security).

**2. LocalStorage Quota Exceeded**:
```javascript
// Check localStorage usage
let total = 0;
for (let key in localStorage) {
  total += localStorage[key].length + key.length;
}
console.log(`LocalStorage used: ${(total / 1024).toFixed(2)} KB`);
```

**Solution**: Clear old viewport states:
```javascript
// Clear all viewport states
Object.keys(localStorage)
  .filter(key => key.startsWith('ohif_viewport_state_'))
  .forEach(key => localStorage.removeItem(key));
```

**3. Service Not Registered**:
Check console for `[ViewportPersistence]` logs. If none appear, service may not be initialized.

**Solution**: Verify Cornerstone extension is loaded in config.

---

### Issue: Download Study Button Not Working

**Status**: ⚠️ Orthanc Dependency

**Symptoms**:
- Click download button → nothing happens
- 404 error in network tab
- "Failed to download study" message

**Root Cause**: Orthanc PACS not running or not accessible

**Debugging Steps**:

1. **Check if Orthanc is accessible**:
   ```bash
   # Should return JSON system info
   curl http://localhost/orthanc/system
   # OR
   curl http://view.radimal.ai/orthanc/system
   ```

2. **Check if study exists in Orthanc**:
   ```bash
   # Get Orthanc UUID from StudyInstanceUID
   # Use SHA-1 hash of StudyInstanceUID

   # Check study exists
   curl http://localhost/orthanc/studies/{orthanc-uuid}
   ```

3. **Test archive endpoint directly**:
   ```bash
   # Should trigger ZIP download
   curl -O http://localhost/orthanc/studies/{orthanc-uuid}/archive
   ```

**Solutions**:

**Development**: Start Orthanc container
```bash
cd platform/app/.recipes/Nginx-Orthanc/
docker compose up -d
```

**Production**: Verify Orthanc is deployed and proxied correctly

---

### Issue: View Report Button Missing

**Status**: ✅ Expected Behavior

**Symptoms**:
- "View Report" option doesn't appear in thumbnail dropdown
- Menu only shows standard options

**Root Cause**: Study doesn't have associated case in Radimal Reporter

**Explanation**:
The "View Report" button only appears if:
1. `getCases` command returns case data
2. Case has consultations with S3 URL

**Check if case exists**:
```javascript
// In browser console
const studyUID = '1.2.3.4.5.6...';  // Your study UID
fetch(`https://radimal-reporter.onrender.com/case?StudyInstanceUID=${studyUID}`)
  .then(r => r.json())
  .then(d => console.log('Case data:', d));
```

**Solution**: This is not a bug - button is hidden when no report exists.

---

### Issue: Saved Windows Not Synchronizing

**Status**: ⚠️ Configuration/Browser Issue

**Symptoms**:
- Open window in tab A
- Tab B doesn't show new window in "Saved Windows" list
- Windows list out of sync between tabs

**Root Causes**:

**1. LocalStorage Event Not Firing**:
- Chrome bug in certain versions
- Incognito mode (localStorage isolated)
- Different domains (dev vs prod)

**Debugging**:
```javascript
// Add listener to check if events fire
window.addEventListener('storage', (e) => {
  console.log('Storage event:', e.key, e.newValue);
});

// Then in another tab, modify windowsArray
localStorage.setItem('windowsArray', JSON.stringify([{url: 'test'}]));
```

**Solution**:
- Use same domain across all tabs
- Avoid incognito mode for multi-window workflows
- Manually refresh if needed

**2. LocalStorage Quota Exceeded**:
See [LocalStorage Issues](#localstorage-issues) section below.

---

### Issue: Zoom Speed Too Fast/Slow

**Status**: ✅ User Preference

**Symptoms**:
- Zoom feels too sensitive or too sluggish
- Different from expected behavior

**Solution**: Adjust zoom speed in User Preferences

**Manual Override**:
```javascript
// Set zoom speed (0.5 = slow, 1 = normal, 4 = very fast)
localStorage.setItem('zoomSpeed', '1.5');  // 1.5x speed

// Reset to default
localStorage.removeItem('zoomSpeed');
```

---

### Issue: Inverted Scrolling Not Working

**Status**: ⚠️ Mode-Specific Issue

**Symptoms**:
- Set "Invert Scrolling" in preferences
- Scrolling direction doesn't change
- Works in some modes but not others

**Root Cause**: Mode's `initToolGroups` doesn't check preference

**Affected Files**:
- `modes/longitudinal/src/initToolGroups.js` ✅ (Fixed)
- `modes/tmtv/src/initToolGroups.js` ✅ (Fixed)
- Custom modes may need updates

**Solution for Custom Modes**:
```javascript
// In initToolGroups.js
const invertScrollWheel = localStorage.getItem('invertScrollWheel') === 'true';

toolGroupService.createToolGroupAndAddTools('default', {
  active: [
    {
      toolName: 'StackScroll',
      bindings: [{ mouseButton: MouseBindings.Wheel }],
      configuration: {
        invert: invertScrollWheel,  // Add this
      },
    },
  ],
});
```

---

### Issue: Related Studies Showing Wrong Patient

**Status**: 🔴 Critical - Patient Safety

**Symptoms**:
- Related studies sidebar shows studies from different patients
- Patient name/birthdate doesn't match primary study
- Occurs with certain institutions

**Root Cause**: Institution uses generic/reused PatientID numbers

**Fix Applied**: 3-field validation (institution + birthdate + name)

**Verification**:
```javascript
// Check validation logic in createStudyBrowserTabs.ts
// Should validate on ALL three fields:
study.institutionName === p.institutionName &&
study.birthDate === p.birthDate &&
study.patientName === p.patientName  // Critical!
```

**If issue persists**:
1. Check DICOM tags are populated correctly
2. Verify institution name is consistent
3. Check birthdate format (YYYYMMDD)

---

## Local Development Setup

### Issue: Orthanc Container Not Starting

**Status**: ⚠️ Common Issue

**Symptoms**:
- `yarn dev:orthanc` fails to connect
- Error: `ERR_CONNECTION_REFUSED` when accessing http://localhost
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
curl http://localhost/orthanc/system

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

# Update references to use new port
http://localhost:8080/orthanc/...
```

---

## Build & Configuration Issues

### Issue: JavaScript Heap Out of Memory

**Status**: ⚠️ Common on Large Builds

**Symptoms**:
```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**Root Cause**: Node.js default memory limit insufficient for build

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

### Issue: Bun vs Yarn Conflicts

**Status**: ⚠️ CI/CD Specific

**Symptoms**:
- CI builds failing
- Local works but CI doesn't
- Package installation errors

**Root Cause**: Radimal CI uses Bun, local development uses Yarn

**Solution**:

**For CI**: Configuration in `.github/workflows/playwright.yml` is correct

**For Local Development**: Always use Yarn (not Bun)
```bash
# Use Yarn
yarn install
yarn dev
yarn build

# Don't use Bun locally
# (Bun is only for CI speed optimization)
```

---

## Runtime Issues

### Issue: Viewport Fade Stays Black

**Status**: ⚠️ Timing Issue

**Symptoms**:
- Viewport turns black and doesn't recover
- Image loaded but not visible
- Console shows no errors

**Root Cause**: Fade timer didn't fire or viewport restoration failed

**Debugging**:
```javascript
// Check element visibility
const element = document.querySelector('.viewport-element');
console.log('Visibility:', element.style.visibility);
console.log('Opacity:', element.style.opacity);
```

**Solutions**:

**1. Force visibility**:
```javascript
// In browser console
document.querySelectorAll('.viewport-element').forEach(el => {
  el.style.visibility = 'visible';
  el.style.opacity = '1';
});
```

**2. Reload study**:
- Navigate away and back
- Or reload page

**3. Check viewport type**:
- Volume viewports take longer (1000ms vs 200ms)
- May need to wait for volume loading

---

### Issue: Overlay Toggle Not Working

**Status**: ⚠️ CSS Class Issue

**Symptoms**:
- Press 'o' key
- Overlays don't hide/show
- No effect visible

**Debugging**:

1. **Check if command executes**:
   ```javascript
   // Should see logs in console when pressing 'o'
   [HOTKEYS] toggleOverlays command executed
   [HOTKEYS] Overlay 0 toggled: visible -> hidden
   ```

2. **Check overlay elements exist**:
   ```javascript
   const overlays = document.getElementsByClassName('viewport-overlay');
   console.log(`Found ${overlays.length} overlays`);
   ```

3. **Check CSS hidden class**:
   ```javascript
   // Verify hidden class is defined
   document.querySelector('.hidden');  // Should return element or null
   ```

**Solutions**:

**If no logs**: Hotkey not registered
- Check `hotkeyBindings.js` includes toggleOverlays
- Verify mode loads default hotkeys

**If logs but no visual change**: CSS issue
- Check Tailwind CSS is loaded
- Verify `.hidden { display: none; }` is defined
- Manually toggle class:
  ```javascript
  document.querySelectorAll('.viewport-overlay').forEach(el => {
    el.classList.toggle('hidden');
  });
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
   curl http://localhost/orthanc/studies

   # Or use Orthanc UI
   open http://localhost/orthanc/app/explorer.html
   ```

2. **Verify DICOMweb endpoint**:
   ```bash
   # Test QIDO-RS (Query)
   curl http://localhost/orthanc/dicom-web/studies

   # Should return JSON array of studies
   ```

3. **Check OHIF is querying correct endpoint**:
   ```javascript
   // In browser Network tab, look for requests to:
   // /dicom-web/studies?...

   // Should be proxied to:
   // http://localhost/orthanc/dicom-web/studies?...
   ```

4. **Upload test data if Orthanc is empty**:
   ```bash
   # Download sample DICOM data
   git submodule update --init testdata

   # Upload to Orthanc via UI
   # Or use curl
   ```

---

### Issue: Reporter API Timeout

**Status**: ⚠️ Network/Backend Issue

**Symptoms**:
- "View Report" takes very long
- Eventually times out or shows error
- Works sometimes but not others

**Root Cause**: Radimal Reporter backend on free tier (cold starts)

**Solution**:

**Wait for warmup**: First request may take 30-60 seconds

**Check backend status**:
```bash
curl https://radimal-reporter.onrender.com/health
# or
curl https://radimal-reporter.onrender.com/case?StudyInstanceUID=test
```

**Workaround**: Refresh and try again after backend warms up

---

## Performance Issues

### Issue: Slow Viewport Rendering

**Status**: ⚠️ Large Dataset Issue

**Symptoms**:
- Viewports take seconds to render
- Sluggish navigation between images
- High memory usage

**Root Causes**:

**1. Large Volume Dataset** (500+ images):
- Solution: Use CPU fallback or reduce viewport count

**2. Multiple Volume Viewports**:
- Solution: Switch to stack viewports for better performance

**3. Too Many Saved Viewport States**:
```javascript
// Check how many states are saved
const stateCount = Object.keys(localStorage)
  .filter(k => k.startsWith('ohif_viewport_state_')).length;
console.log(`Viewport states: ${stateCount}`);
```

**Solution**: Clear old states (see LocalStorage section)

---

## LocalStorage Issues

### Issue: LocalStorage Quota Exceeded

**Status**: 🔴 Critical - Blocks All Features

**Symptoms**:
- Error: "QuotaExceededError"
- Preferences not saving
- Viewport persistence stops working
- Window management fails

**Check Usage**:
```javascript
function getLocalStorageSize() {
  let total = 0;
  let details = {};

  for (let key in localStorage) {
    const size = (localStorage[key].length + key.length) * 2; // UTF-16
    total += size;

    // Group by prefix
    const prefix = key.split('_')[0];
    details[prefix] = (details[prefix] || 0) + size;
  }

  console.log(`Total: ${(total / 1024 / 1024).toFixed(2)} MB`);
  console.log('By prefix:', details);

  return { total, details };
}

getLocalStorageSize();
```

**Solutions**:

**1. Clear Viewport States** (safe - will rebuild on use):
```javascript
Object.keys(localStorage)
  .filter(key => key.startsWith('ohif_viewport_state_'))
  .forEach(key => localStorage.removeItem(key));
```

**2. Clear Old Saved Windows**:
```javascript
localStorage.removeItem('windowsArray');
localStorage.removeItem('windowData');
```

**3. Clear All Radimal Data** (will reset preferences):
```javascript
Object.keys(localStorage)
  .filter(key =>
    key.startsWith('ohif_') ||
    key.includes('zoom') ||
    key.includes('window') ||
    key.includes('userLayout') ||
    key.includes('defaultTool')
  )
  .forEach(key => localStorage.removeItem(key));
```

**4. Complete Reset** (last resort):
```javascript
localStorage.clear();
// Then reload page
location.reload();
```

**Prevention**: Implement automatic cleanup (future enhancement):
```javascript
// Pseudo-code for cleanup strategy
function cleanupOldViewportStates() {
  const states = Object.keys(localStorage)
    .filter(k => k.startsWith('ohif_viewport_state_'))
    .map(k => ({
      key: k,
      data: JSON.parse(localStorage.getItem(k)),
    }))
    .sort((a, b) => b.data.timestamp - a.data.timestamp);

  // Keep only 100 most recent
  states.slice(100).forEach(s => localStorage.removeItem(s.key));
}
```

---

### Issue: LocalStorage Not Persisting

**Status**: ⚠️ Browser/Privacy Issue

**Symptoms**:
- Set preferences
- Reload page
- Preferences reset to defaults

**Root Causes**:

**1. Incognito/Private Mode**:
- LocalStorage is cleared on browser close
- **Solution**: Use normal browser mode

**2. Browser Privacy Settings**:
- "Clear cookies on exit" enabled
- **Solution**: Disable or whitelist domain

**3. Different Domain**:
- Dev: `localhost:3000`
- Prod: `view.radimal.ai`
- **Solution**: LocalStorage is domain-specific (expected behavior)

**Debugging**:
```javascript
// Test persistence
localStorage.setItem('test', Date.now());
console.log('Saved:', localStorage.getItem('test'));

// Reload page, then:
console.log('After reload:', localStorage.getItem('test'));
// Should show same value
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
- [ ] Orthanc responding: `curl http://localhost/orthanc/system`
- [ ] Test studies uploaded to Orthanc

### LocalStorage
- [ ] LocalStorage enabled in browser
- [ ] Not in incognito mode
- [ ] Quota not exceeded: Check with `getLocalStorageSize()`
- [ ] Domain is correct (dev vs prod)

### Radimal Features
- [ ] Check console for feature-specific logs
- [ ] Verify localStorage keys exist: `Object.keys(localStorage)`
- [ ] Test features individually
- [ ] Clear localStorage and test defaults

### Network
- [ ] Reporter API accessible: `curl https://radimal-reporter.onrender.com/health`
- [ ] Orthanc API accessible
- [ ] No CORS errors in console
- [ ] Network tab shows successful requests

---

## Getting Help

If you encounter an issue not listed here:

1. **Check DEVELOPMENT_LOG.md** - See if similar issue was encountered before
2. **Check RADIMAL_FEATURES_DOCUMENTATION.md** - Detailed feature implementations
3. **Check console logs** - Many features include verbose logging
4. **Enable debug mode**:
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
\`\`\`bash
# Commands or code changes
\`\`\`

**Workaround** (if permanent fix not available):
[Temporary solution]

**Related**:
- [Links to GitHub issues]
- [Links to related documentation]
```

---

**Last Updated**: 2025-11-17
**Radimal Version**: v3.10.0.4.radimal
**Maintained By**: Radimal Engineering Team

**Status Legend**:
- 🔴 Critical - Blocks functionality
- ⚠️ Warning - Common issue with known solution
- ✅ Fixed/Documented - Resolved or documented workaround
- 📝 Workaround - Temporary solution available
