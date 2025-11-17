# OHIF Viewers v3.10.0.4.radimal - Custom Features Documentation

## Overview
This document details the 11 custom features implemented in the v3.10.0.4.radimal branch of OHIF Viewers for the Radimal medical imaging platform.

---

## 1. Related Studies Uniqueness Fix

### Description
Enhanced patient identification for related studies to ensure uniqueness based on multiple criteria (patient name, birthdate, institution name) instead of just PatientID.

### Implementation Details

**Commit:** `fbc4b7a` - "validate patient name for related studies"

**Files Modified:**
- `/home/user/Viewers/extensions/default/src/Panels/StudyBrowser/PanelStudyBrowser.tsx`
- `/home/user/Viewers/platform/core/src/utils/createStudyBrowserTabs.ts`
- `/home/user/Viewers/extensions/default/src/Panels/getStudiesForPatientByMRN.js`

**Key Changes:**

1. **getStudiesForPatientByMRN.js** - Fetches patient studies with additional fields:
   ```javascript
   includefield: [
     '00081030', // Study Description
     '00080060', // Modality
     '00080080', // Institution Name
     '00100030', // Patient Birthday
     '00101040', // Patient Address
     '00100010', // Patient Name
   ]
   ```

2. **createStudyBrowserTabs.ts** - Uniqueness validation:
   ```typescript
   // Validates on three criteria: institution name, birth date, AND patient name
   if (
     primaryStudies.some(
       p =>
         study.institutionName === p.institutionName &&
         study.birthDate === p.birthDate &&
         study.patientName === p.patientName  // NEW: Added patient name validation
     )
   )
     patientStudies.push(study);
   ```

**Architecture Integration:**
- Integrates with DisplaySetService and QIDO-RS queries
- Used by StudyBrowser panel for related studies lookup
- Improves patient safety by preventing mismatches when institutions reuse PatientIDs

---

## 2. Viewer Window Fade Out

### Description
Implements opacity fade when viewer loses focus or user navigates away. Prevents displaying stale content when switching between windows.

### Implementation Details

**Commit:** `da6221b` - "fix: black screen and opacity fade"

**Files Modified:**
- `/home/user/Viewers/extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx`

**Key Changes:**

1. **Visibility Management:**
   ```typescript
   const [showBlackScreen, setShowBlackScreen] = useState(true); // Start with black screen
   const [isImageReady, setIsImageReady] = useState(false);
   
   // Force viewport to be invisible when displaySets change
   element.style.visibility = 'hidden';
   ```

2. **Fade Logic for Different Viewport Types:**
   - **Stack Viewports:** Hidden until restoration is complete (200ms delay)
   - **Volume Viewports:** Shown after 1-second delay (loading slower)
   - **Emergency Timer:** 1-second fallback for slow-loading images

3. **Viewport Ready Detection:**
   ```typescript
   useEffect(() => {
     const isVolumeViewport = viewportOptions.viewportType === 'volume';
     if (isSlowLoading && displaySets && displaySets.length > 0) {
       const emergencyTimer = setTimeout(() => {
         setIsImageReady(true);
         setShowBlackScreen(false);
         element.style.visibility = 'visible';
       }, 1000);
     }
   }, [viewportId, viewportOptions.viewportType, displaySets]);
   ```

**Architecture Integration:**
- Works with viewport restoration system
- Prevents flicker during image loading
- Coordinates with ViewportPersistenceService

---

## 3. Overlay Toggle Hotkey ('o')

### Description
Allows users to toggle visibility of DICOM overlay information using the 'o' hotkey.

### Implementation Details

**Files:**
- `/home/user/Viewers/platform/core/src/defaults/hotkeyBindings.js`
- `/home/user/Viewers/extensions/default/src/commandsModule.ts`

**Hotkey Configuration:**
```javascript
{
  commandName: 'toggleOverlays',
  label: 'Overlays',
  keys: ['o'],
}
```

**Toggle Command Implementation:**
```typescript
toggleOverlays: () => {
  console.log('[HOTKEYS] toggleOverlays command executed');
  const overlays = document.getElementsByClassName('viewport-overlay');
  
  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays.item(i);
    const wasHidden = overlay.classList.contains('hidden');
    overlay.classList.toggle('hidden');
    console.log(`[HOTKEYS] Overlay ${i} toggled: ${wasHidden ? 'hidden -> visible' : 'visible -> hidden'}`);
  }
}
```

**Architecture Integration:**
- Uses CSS class toggling (`.hidden`) for visibility
- Operates on viewport overlay elements with class `viewport-overlay`
- Includes debugging output for troubleshooting

---

## 4. Default Layout Grid (User-Customizable)

### Description
Allows users to set and persist custom default hanging protocols/layouts across browser sessions.

### Implementation Details

**Commit:** `932c3e4` - "feat: add user-customizable default hanging protocols"

**Files Modified:**
- `/home/user/Viewers/extensions/default/src/Toolbar/ToolbarLayoutSelector.tsx`
- `/home/user/Viewers/extensions/default/src/getHangingProtocolModule.js`

**User Preference Storage:**
```typescript
const getUserLayoutPreference = () => {
  try {
    const saved = localStorage.getItem('userLayoutPreference');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        rows: parsed.rows || 1,
        columns: parsed.columns || 1,
        name: parsed.name || '1x1',
      };
    }
  } catch (error) {
    console.warn('Failed to load user layout preference:', error);
  }
  return { rows: 1, columns: 1, name: '1x1' };
};

const saveUserLayoutPreference = (rows, columns) => {
  const preference = {
    rows,
    columns,
    name: `${rows}x${columns}`,
  };
  localStorage.setItem('userLayoutPreference', JSON.stringify(preference));
};
```

**Default Protocol Integration:**
```javascript
const userPref = getUserLayoutPreference();

const defaultProtocol = {
  id: 'default',
  stages: [{
    name: userPref.name,
    viewportStructure: {
      layoutType: 'grid',
      properties: {
        rows: userPref.rows,
        columns: userPref.columns,
      },
    },
    // ... viewport definitions for grid
  }],
};
```

**Dynamic Viewport Creation:**
```javascript
const createUserPreferredViewports = (rows, columns) => {
  const totalViewports = rows * columns;
  const viewports = [];
  
  for (let i = 0; i < totalViewports; i++) {
    viewports.push({
      viewportOptions: {
        viewportType: 'stack',
        viewportId: i === 0 ? 'default' : undefined,
        // ... additional options
      },
    });
  }
  return viewports;
};
```

**Architecture Integration:**
- Persists in localStorage with key `userLayoutPreference`
- Read by hanging protocol module on app initialization
- Integrates with ToolbarLayoutSelector dropdown

---

## 5. Invert Scrolling Option

### Description
User-configurable option to invert mouse scroll direction for image navigation and zoom.

### Implementation Details

**Commit:** `23e3a9a` - "feat: invert mouse scroll"

**Files Modified:**
- `/home/user/Viewers/modes/longitudinal/src/initToolGroups.js`
- `/home/user/Viewers/modes/segmentation/src/initToolGroups.ts`
- `/home/user/Viewers/modes/tmtv/src/initToolGroups.js`
- `/home/user/Viewers/platform/ui/src/components/UserPreferences/UserPreferences.tsx`

**User Preferences UI:**
```typescript
// UserPreferences.tsx
let invertScrollWheelPreference = localStorage.getItem('invertScrollWheel');
if (invertScrollWheelPreference === null) {
  invertScrollWheelPreference = 'false';
}

const [state, setState] = useState({
  // ...
  invertScrollWheel: invertScrollWheelPreference === 'true',
});

const onSubmitHandler = () => {
  localStorage.setItem('invertScrollWheel', state.invertScrollWheel.toString());
  onSubmit(state);
};
```

**Tool Group Configuration:**
```typescript
// modes/longitudinal/src/initToolGroups.js
const getScrollWheelInversion = () => {
  try {
    const saved = localStorage.getItem('invertScrollWheel');
    return saved === 'true';
  } catch (error) {
    return false;
  }
};

const wheelToolConfig = toolBinding.wheelTool === toolNames.StackScroll ? {
  invert: invertScrollWheel,
} : {};
```

**Architecture Integration:**
- Stored in localStorage under key `invertScrollWheel`
- Applied to StackScroll tool configuration in tool groups
- Configurable per mode (longitudinal, segmentation, TMTV)

---

## 6. Default Tool Options

### Description
Allows users to customize default mouse button assignments (left/right/middle/wheel) for different tools.

### Implementation Details

**Commit:** `bf47249` - "feat: customize default mouse tools"

**Files Modified:**
- `/home/user/Viewers/platform/core/src/defaults/defaultToolBindings.js`
- `/home/user/Viewers/extensions/cornerstone/src/commandsModule.ts`
- `/home/user/Viewers/extensions/default/src/ViewerLayout/ViewerHeader.tsx`
- `/home/user/Viewers/platform/ui/src/components/DefaultToolsPreferences.tsx`
- `/home/user/Viewers/platform/ui/src/components/UserPreferences/UserPreferences.tsx`

**Default Tool Bindings:**
```javascript
const defaultToolBindings = [
  {
    id: 'leftMouseButton',
    commandName: 'updateMouseButtonBinding',
    commandOptions: { mouseButton: 'Primary', toolName: 'WindowLevel' },
    label: 'Left Mouse Button',
    availableTools: ['WindowLevel', 'Pan', 'Zoom'],
    isEditable: true,
  },
  {
    id: 'rightMouseButton',
    commandName: 'updateMouseButtonBinding',
    commandOptions: { mouseButton: 'Secondary', toolName: 'Pan' },
    label: 'Right Mouse Button',
    availableTools: ['WindowLevel', 'Pan', 'Zoom'],
    isEditable: true,
  },
  {
    id: 'middleMouseButton',
    commandName: 'updateMouseButtonBinding',
    commandOptions: { mouseButton: 'Auxiliary', toolName: 'Zoom' },
    availableTools: ['WindowLevel', 'Pan', 'Zoom'],
    isEditable: true,
  },
  {
    id: 'scrollWheel',
    commandName: 'updateScrollWheelBinding',
    commandOptions: { mouseButton: 'Wheel', toolName: 'StackScroll' },
    availableTools: ['Zoom', 'StackScroll'],
    isEditable: true,
  },
];
```

**Persistence in ViewerHeader:**
```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    try {
      const saved = localStorage.getItem('defaultToolBindings');
      if (saved) {
        const savedBindings = JSON.parse(saved);
        const primaryTool = savedBindings.find(b => b.id === 'leftMouseButton')?.commandOptions?.toolName;
        const secondaryTool = savedBindings.find(b => b.id === 'rightMouseButton')?.commandOptions?.toolName;
        const auxiliaryTool = savedBindings.find(b => b.id === 'middleMouseButton')?.commandOptions?.toolName;
        
        if (primaryTool || secondaryTool || auxiliaryTool) {
          servicesManager._commandsManager.runCommand(
            'applyMouseButtonBindings',
            {
              primaryTool: primaryTool || 'WindowLevel',
              secondaryTool: secondaryTool || 'Pan',
              auxiliaryTool: auxiliaryTool || 'Zoom'
            },
            'CORNERSTONE'
          );
        }
      }
    } catch (error) {
      console.warn('Failed to load saved tool preferences:', error);
    }
  }, 1000);
}, [servicesManager?._commandsManager]);
```

**Architecture Integration:**
- Stored in localStorage under key `defaultToolBindings`
- Applied on app initialization via ViewerHeader useEffect
- Customizable per-user in preferences modal
- Commands: `updateMouseButtonBinding`, `updateScrollWheelBinding`, `applyMouseButtonBindings`

---

## 7. Download Study Button

### Description
Enables users to download entire studies in DICOM format through integration with Orthanc backend and Radimal reporter service.

### Implementation Details

**Commits:** 
- `1494bb7` - "feat: download study button"
- `fa27557` - "feat: add download button"

**Files Modified:**
- `/home/user/Viewers/extensions/default/src/ViewerLayout/ViewerHeader.tsx`
- `/home/user/Viewers/platform/core/src/utils/orthancUtils.js`

**Download Functions:**
```javascript
// orthancUtils.js
export async function generateOrthancStudyUUID(patientId, studyInstanceUID) {
  const input = `${patientId}|${studyInstanceUID}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  const formattedUUID = [
    hashHex.slice(0, 8),
    hashHex.slice(8, 16),
    hashHex.slice(16, 24),
    hashHex.slice(24, 32),
    hashHex.slice(32, 40),
  ].join('-');
  
  return formattedUUID;
}

export async function downloadOrthancStudy(orthancStudyUUID, baseUrl, userId = null) {
  const params = new URLSearchParams({
    id: orthancStudyUUID,
    ids: '',
  });
  
  if (userId) {
    params.set('user_id', userId);
  }
  
  const downloadUrl = `${baseUrl}/orthanc/study/download?${params.toString()}`;
  
  const response = await fetch(downloadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ combine: [] }),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (data.urls && data.urls.length > 0) {
    for (let i = 0; i < data.urls.length; i++) {
      const downloadUrl = data.urls[i];
      const a = document.createElement('a');
      a.setAttribute('href', downloadUrl);
      a.setAttribute('download', '');
      a.click();
      
      if (i < data.urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

export async function downloadStudyByDICOMIds(patientId, studyInstanceUID, baseUrl) {
  const orthancUUID = await generateOrthancStudyUUID(patientId, studyInstanceUID);
  return downloadOrthancStudy(orthancUUID, baseUrl);
}
```

**UI Handler in ViewerHeader:**
```typescript
const handleDownloadStudy = async () => {
  if (!studyInfo?.PatientID || !studyInfo?.StudyInstanceUID) {
    uiNotificationService.show({
      title: 'Download Error',
      message: 'Missing required study information for download',
      type: 'error',
      duration: 5000,
    });
    return;
  }

  let reporterOrigin;
  if (window.location.origin === 'http://localhost:3000') {
    reporterOrigin = 'http://localhost:5007';
  } else if (window.location.origin === 'https://viewer.stage-1.radimal.ai') {
    reporterOrigin = 'https://reporter-staging.onrender.com';
  } else if (window.location.origin === 'https://view.radimal.ai') {
    reporterOrigin = 'https://radimal-reporter.onrender.com';
  } else {
    reporterOrigin = 'https://radimal-reporter.onrender.com';
  }

  try {
    uiNotificationService.show({
      title: 'Download Started',
      message: 'Preparing study download...',
      type: 'info',
      duration: 3000,
    });

    await orthancUtils.downloadStudyByDICOMIds(
      studyInfo.PatientID,
      studyInfo.StudyInstanceUID,
      reporterOrigin
    );

    uiNotificationService.show({
      title: 'Download Complete',
      message: 'Study download has been completed successfully',
      type: 'success',
      duration: 5000,
    });
  } catch (error) {
    console.error('Error downloading study:', error);
    uiNotificationService.show({
      title: 'Download Failed',
      message: `Failed to download study: ${error.message || 'Unknown error'}`,
      type: 'error',
      duration: 8000,
    });
  }
};
```

**Architecture Integration:**
- Integrates with multiple Radimal reporter endpoints (dev, staging, production)
- Uses SHA-1 hashing to generate Orthanc study UUIDs
- Notifies user of download progress via UINotificationService
- Triggers sequential downloads with 1-second delays

---

## 8. Duplicate Window / Saved Windows

### Description
Allows users to open duplicate viewer windows and save/restore window configurations (position, size).

### Implementation Details

**Files:**
- `/home/user/Viewers/extensions/default/src/ViewerLayout/ViewerHeader.tsx`

**Window Management in Menu Options:**
```typescript
const monitorOptions = [
  {
    title: t('Header:Duplicate Window'),
    icon: 'tool-monitor',
    onClick: () => {
      let windows = JSON.parse(localStorage.getItem('windowData')) || [];
      const existingWindow = windows.find(win => win.closed && win.id !== 'viewerWindow');

      if (existingWindow) {
        const { width, height, x, y, id, closed } = existingWindow;

        const newWin = window.open(
          window.location.href,
          id,
          `width=${width},height=${height},left=${x},top=${y}`
        );

        if (newWin) {
          existingWindow.closed = false;
          localStorage.setItem('windowData', JSON.stringify(windows));
        }
      } else {
        const newId = `viewerWindow-${Date.now()}`;
        const newWin = window.open(window.location.href, newId);
        if (newWin) {
          const newWindowData = {
            id: newId,
            x: window.screenX,
            y: window.screenY,
            width: window.outerWidth,
            height: window.outerHeight,
            closed: false,
          };

          windows.push(newWindowData);
          localStorage.setItem('windowData', JSON.stringify(windows));
        }
      }
    },
  },
  {
    title: t('Header:Open Saved Windows'),
    icon: 'open-saved-windows',
    onClick: () => {
      let windows = JSON.parse(localStorage.getItem('windowsArray')) || [];
      windows.forEach((win, index) => {
        if (win.id === 'viewerWindow') return;
        setTimeout(() => {
          window.open(
            window.location.href,
            win.id,
            `width=${win.width},height=${win.height},left=${win.x},top=${win.y}`
          );
        }, index * 200);
      });
    },
  },
  {
    title: t('Header:Close Windows'),
    icon: 'close-windows',
    onClick: () => {
      let windowDataArray = [];
      let windows = JSON.parse(localStorage.getItem('windowData')) || [];
      windows.forEach(win => {
        if (win.closed) return;
        const childWindow = window.open('', win.id);
        if (childWindow) {
          childWindow.close();
          win.closed = true;
          windowDataArray.push(win);
        }
      });
      localStorage.setItem('windowData', JSON.stringify(windows));
      localStorage.setItem('windowsArray', JSON.stringify(windowDataArray));
      window.close();
    },
  },
];
```

**Study Synchronization Across Windows:**
```typescript
useEffect(() => {
  const extractStudyId = searchString => {
    const params = new URLSearchParams(searchString);
    return params.get('StudyInstanceUIDs');
  };

  const currentStudyId = extractStudyId(location.search);

  const refreshTab = newStudyId => {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('StudyInstanceUIDs', newStudyId);
    window.location.href = currentUrl.toString();
  };

  const handleStorageChange = event => {
    console.log('Changing study', event);
    if (event.key === 'currentStudyId' && event.newValue) {
      const newStudyId = event.newValue;
      if (currentStudyId !== newStudyId) {
        refreshTab(newStudyId);
      }
    }
  };

  if (
    currentStudyId &&
    localStorage.getItem('currentStudyId') !== currentStudyId &&
    window.name == 'viewerWindow'
  ) {
    localStorage.setItem('currentStudyId', currentStudyId);
  }

  window.addEventListener('storage', handleStorageChange);
  return () => window.removeEventListener('storage', handleStorageChange);
}, [location.search]);
```

**Architecture Integration:**
- Uses localStorage for window metadata storage (`windowData`, `windowsArray`)
- Stores: window ID, position (x, y), size (width, height), closed status
- Synchronizes study changes across windows via storage events
- Staggered window opening (200ms delays) to prevent conflicts

---

## 9. View Report Button

### Description
Displays "View Report" option in thumbnail context menu for studies with associated case consultations.

### Implementation Details

**Commits:**
- `8fb09a2` - "feat: view report"
- `c9c8ebe` - "feat: view report icon"

**Files Modified:**
- `/home/user/Viewers/extensions/default/src/commandsModule.ts`
- `/home/user/Viewers/platform/ui-next/src/components/Thumbnail/Thumbnail.tsx`
- `/home/user/Viewers/platform/ui-next/src/components/Icons/Icons.tsx`

**Get Cases Command:**
```typescript
// commandsModule.ts
async getCases({ displaySetInstanceUID }: { displaySetInstanceUID?: string }) {
  try {
    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    
    if (!displaySet || !displaySet.PatientID || !displaySet.StudyInstanceUID) {
      return null;
    }

    const studyInstanceUID = displaySet.StudyInstanceUID;
    
    const queryString = new URLSearchParams({
      StudyInstanceUID: studyInstanceUID,
    }).toString();

    const caseResponse = await fetch(
      `https://radimal-reporter.onrender.com/case?${queryString}`
    );

    if (!caseResponse.ok) {
      return null;
    }

    const caseData = await caseResponse.json();

    if (
      caseData.cases &&
      caseData.cases.length > 0 &&
      caseData.cases[0].consultations &&
      caseData.cases[0].consultations.length > 0
    ) {
      return caseData;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching case data:', error);
    return null;
  }
}
```

**View Report Command:**
```typescript
async viewReport({ displaySetInstanceUID }: { displaySetInstanceUID?: string }) {
  const caseData = await commandsManager.runCommand('getCases', { displaySetInstanceUID });
  
  if (!caseData) {
    uiNotificationService.show({
      title: 'View Report',
      message: 'No case found for this study.',
      type: 'warning',
      duration: 3000,
    });
    return;
  }

  // Detect environment based on window.location.origin
  const isProduction = window.location.origin === 'https://view.radimal.ai';
  const platformUrl = isProduction
    ? 'https://vet.radimal.ai'
    : 'https://radimal-vet-staging.onrender.com';

  const s3_url = caseData.cases[0].consultations[0].s3_url;
  if (s3_url) {
    try {
      const key = s3_url.split('s3.amazonaws.com/')[1];
      const flaskResponse = await fetch(
        `https://radimal-reporter.onrender.com/consultation/pdf?key=${key}`,
        { method: 'GET' }
      );

      if (!flaskResponse.ok) {
        throw new Error(`Flask API error! status: ${flaskResponse.status}`);
      }

      let presignedUrl = await flaskResponse.text();

      if (presignedUrl.startsWith('"') && presignedUrl.endsWith('"')) {
        presignedUrl = presignedUrl.slice(1, -1);
      }

      window.open(
        `${platformUrl}/consultation?url=${encodeURIComponent(presignedUrl)}`,
        '_blank'
      );
    } catch (error) {
      console.error('Error getting presigned URL:', error);
      uiNotificationService.show({
        title: 'View Report',
        message: 'Failed to generate report URL.',
        type: 'error',
        duration: 3000,
      });
    }
  }
}
```

**Thumbnail UI Integration:**
```typescript
// Thumbnail.tsx
{hasRadimalCase && (
  <DropdownMenuItem
    onSelect={() => {
      onThumbnailContextMenu('viewReport', {
        displaySetInstanceUID,
      });
    }}
    className="gap-[6px]"
  >
    <Icons.Pdf />
    View Report
  </DropdownMenuItem>
)}
```

**Icon Definition:**
```typescript
// Icons.tsx
export const Pdf = ({ className = 'w-5 h-5' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    {/* PDF icon SVG */}
  </svg>
);
```

**Architecture Integration:**
- Queries Radimal reporter backend (`/case` endpoint) for case data
- Fetches presigned PDF URLs from S3 via Flask API
- Environment-aware URL routing (dev/staging/production)
- Opens consultation view in new window via Radimal platform

---

## 10. Viewport Persistence

### Description
Saves and restores viewport state (rotation, flip, zoom) per image when navigating between studies or slices.

### Implementation Details

**Service:** `/home/user/Viewers/extensions/cornerstone/src/services/ViewportPersistenceService.ts`

**Key Features:**

1. **State Storage:**
   - Saves rotation and flip state for each unique image
   - Uses localStorage with key pattern: `ohif_viewport_state_{hash}`
   - Hash generated from: `studyUID-seriesUID-instanceUID`

2. **Hash Generation:**
   ```typescript
   generateViewportHash(viewport: any): string | null {
     const currentImageId = viewport.getCurrentImageId?.();
     if (!currentImageId) return null;

     const imageUids = this._extractUIDsFromImageId(currentImageId);
     if (!imageUids?.studyUID || !imageUids?.seriesUID || !imageUids?.instanceUID) {
       return null;
     }

     const hash = `${imageUids.studyUID}-${imageUids.seriesUID}-${imageUids.instanceUID}`;
     return hash;
   }
   ```

3. **State Storage Methods:**
   ```typescript
   private _storeViewportState(hash: string, viewportState: any): void {
     const storageKey = `${this.STORAGE_KEY_PREFIX}${hash}`;
     localStorage.setItem(storageKey, JSON.stringify(viewportState));
   }

   public storeRotationFlipState(viewportId: string): void {
     const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
     const hash = this.generateViewportHash(viewport);
     const state = this._extractRotationFlipState(viewport);
     
     if (!hash || !state) return;
     
     this._storeViewportState(hash, state);
   }
   ```

4. **State Extraction (Multi-Method Approach):**
   ```typescript
   private _extractRotationFlipState(viewport: any): any | null {
     const state: any = {
       viewportId: viewport.id,
       timestamp: Date.now(),
       type: 'rotation_flip_only',
     };

     const rotationFlipState: any = {};

     // Method 1: Check camera (for volume viewports)
     if (viewport.getCamera) {
       const camera = viewport.getCamera();
       if (camera.flipHorizontal !== undefined) {
         rotationFlipState.flipHorizontal = camera.flipHorizontal;
       }
       if (camera.flipVertical !== undefined) {
         rotationFlipState.flipVertical = camera.flipVertical;
       }
       if (camera.rotation !== undefined) {
         rotationFlipState.rotation = camera.rotation;
       }
     }

     // Method 2: Check view presentation (for stack viewports)
     if (viewport.getViewPresentation) {
       const presentation = viewport.getViewPresentation();
       if (presentation?.rotation !== undefined) {
         rotationFlipState.rotation = presentation.rotation;
       }
       if (presentation?.flipHorizontal !== undefined) {
         rotationFlipState.flipHorizontal = presentation.flipHorizontal;
       }
       if (presentation?.flipVertical !== undefined) {
         rotationFlipState.flipVertical = presentation.flipVertical;
       }
     }

     // Method 3: Check properties as fallback
     if (viewport.getProperties) {
       const properties = viewport.getProperties();
       if (properties?.rotation !== undefined && rotationFlipState.rotation === undefined) {
         rotationFlipState.rotation = properties.rotation;
       }
       // ... similar for flips
     }

     if (Object.keys(rotationFlipState).length > 0) {
       state.rotationFlip = rotationFlipState;
       return state;
     }
     return null;
   }
   ```

5. **Restoration with Fallback:**
   ```typescript
   private _restoreViewportState(viewportId: string): boolean {
     const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
     const hash = this.generateViewportHash(viewport);
     let storedState = this._getViewportState(hash);

     // Fallback: Try to find partial matches (same study+series, different instance)
     if (!storedState?.rotationFlip) {
       const partialMatches = allStoredKeys.filter(key => {
         const storedHash = key.replace(this.STORAGE_KEY_PREFIX, '');
         const hashParts = hash.split('-');
         const storedParts = storedHash.split('-');
         
         // Match on study and series (ignore instance UID)
         return hashParts[0] === storedParts[0] && hashParts[1] === storedParts[1];
       });

       if (partialMatches.length > 0) {
         // Use most recent partial match
         const mostRecentState = /* ... */;
         this._storeViewportState(hash, mostRecentState);
         this._applyViewportState(viewport, mostRecentState);
         return true;
       }
     }

     // Apply stored state if found
     this._applyViewportState(viewport, storedState);
     return true;
   }
   ```

6. **State Application with Retry:**
   ```typescript
   private _applyViewportState(viewport: any, state: any): void {
     if (!state.rotationFlip) return;

     // Special handling for stack viewports (CT scans with multiple frames)
     const isStackViewport = viewport.constructor?.name === 'StackViewport';
     const imageIds = viewport.getImageIds?.() || [];
     const isMultiImageStack = isStackViewport && imageIds.length > 1;

     if (isMultiImageStack) {
       this._applyStackTransformations(viewport, state.rotationFlip);
     } else {
       setTimeout(() => {
         this._applyTransformations(viewport, state.rotationFlip);
       }, 50);
     }
   }
   ```

7. **Integration with OHIFCornerstoneViewport:**
   ```typescript
   // In viewport component
   const viewportPersistenceService = servicesManager.services.viewportPersistenceService;

   // On image change, store current state
   const handleRotationFlip = (evt: Event) => {
     const csViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
     if (csViewport) {
       viewportPersistenceService.storeRotationFlipState(viewportId);
     }
   };

   // Attempt restoration when new images load
   useEffect(() => {
     const attemptRestoration = () => {
       const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
       if (viewport?.getCurrentImageId?.()) {
         viewportPersistenceService.attemptViewportRestoration(viewportId);
       }
     };
     setTimeout(attemptRestoration, 50);
   }, [displaySets]);
   ```

**Architecture Integration:**
- Registers as service: `ViewportPersistenceService`
- Listens to viewport events: VIEWPORT_NEW_IMAGE_SET, IMAGE_RENDERED, STACK_NEW_IMAGE, VOLUME_LOADED
- Events published: VIEWPORT_STATE_STORED, VIEWPORT_STATE_RESTORED, VIEWPORT_STATE_CLEARED
- Tolerates timing delays with retry mechanism (max 5 retries, 25ms delay)
- Handles both stack and volume viewports with optimized timing

---

## 11. Faster Zoom

### Description
Configurable zoom speed multiplier (0.5x to 4x) for keyboard zoom commands (+ and -) with cursor-based anchoring.

### Implementation Details

**Commit:** `267f2eb` - "feat: add configurable scroll wheel zoom with user preferences"

**Zoom Speed Options:**
```typescript
// UserPreferences.tsx
let zoomSpeedPreference = localStorage.getItem('zoomSpeed');
if (!zoomSpeedPreference || zoomSpeedPreference === 'NaN') {
  zoomSpeedPreference = '0.1';
}

const parsedZoomSpeed = parseFloat(zoomSpeedPreference);
if (isNaN(parsedZoomSpeed)) {
  zoomSpeedPreference = '0.1';
  localStorage.setItem('zoomSpeed', '0.1');
}

const [state, setState] = useState({
  zoomSpeed: zoomSpeedPreference,
});

const onSubmitHandler = () => {
  localStorage.setItem('zoomSpeed', state.zoomSpeed.toString());
};
```

**Zoom Speed Multiplier Mapping:**
```typescript
// commandsModule.ts
const getZoomFactor = () => {
  try {
    const saved = localStorage.getItem('zoomSpeed');
    const factor = saved && saved !== 'NaN' ? parseFloat(saved) : 0.1;
    const validFactor = isNaN(factor) ? 0.1 : factor;

    // Map normalized speed to multiplier
    if (validFactor <= 0.075) return 0.5;  // 0.5x speed
    if (validFactor <= 0.15) return 1;     // 1x speed (default)
    if (validFactor <= 0.29) return 2;     // 2x speed
    if (validFactor <= 0.39) return 3;     // 3x speed
    return 4;                               // 4x speed
  } catch (error) {
    return 1;
  }
};
```

**Keyboard Zoom Implementation:**
```typescript
// Zoom commands use the speed preference
scaleViewport: ({ direction }) => {
  const enabledElement = _getActiveViewportEnabledElement();

  const getZoomSpeed = () => {
    try {
      const saved = localStorage.getItem('zoomSpeed');
      return saved ? parseFloat(saved) : 0.1;
    } catch (error) {
      console.warn('Failed to load zoom speed preference:', error);
      return 0.1;
    }
  };

  const zoomSpeed = getZoomSpeed();
  const scaleFactor = direction > 0 ? 1 - zoomSpeed : 1 + zoomSpeed;

  if (!enabledElement) return;
  
  const { viewport } = enabledElement;

  if (viewport instanceof StackViewport) {
    if (direction) {
      const { parallelScale } = viewport.getCamera();
      viewport.setCamera({ parallelScale: parallelScale * scaleFactor });
      viewport.render();
    } else {
      viewport.resetCamera();
      viewport.render();
    }
  }
}
```

**Wheel Zoom with Cursor Anchoring:**
```typescript
// Direct wheel zoom implementation
const directWheelZoom = (event: WheelEvent) => {
  event.preventDefault();
  event.stopPropagation();

  const getZoomFactor = () => {
    const saved = localStorage.getItem('zoomSpeed');
    const factor = saved && saved !== 'NaN' ? parseFloat(saved) : 0.1;
    const validFactor = isNaN(factor) ? 0.1 : factor;

    if (validFactor <= 0.075) return 0.5;
    if (validFactor <= 0.15) return 1;
    if (validFactor <= 0.29) return 2;
    if (validFactor <= 0.39) return 3;
    return 4;
  };

  try {
    const enabledElement = getEnabledElement(viewportElement);
    if (enabledElement && enabledElement.viewport) {
      const { viewport } = enabledElement;
      
      if (viewport && typeof viewport.getZoom === 'function') {
        const currentZoom = viewport.getZoom();
        const zoomFactor = getZoomFactor();
        const baseStep = 0.05 * 0.75;
        const zoomStep = baseStep * zoomFactor;
        
        const direction = event.deltaY > 0 ? -zoomStep : zoomStep;
        const newZoom = currentZoom * (1 + direction);

        const camera = viewport.getCamera();
        const { parallelScale } = camera;
        const zoomRatio = newZoom / currentZoom;
        const newParallelScale = parallelScale / zoomRatio;
        
        const updatedCamera = {
          ...camera,
          parallelScale: newParallelScale
        };
        
        viewport.setCamera(updatedCamera);
        viewport.render();
        
        const viewportId = viewport.id;
        if (viewportId) {
          cornerstoneViewportService.storePresentation({ viewportId });
        }
      }
    }
  } catch (error) {
    // Silent error handling
  }
};

document.addEventListener('wheel', directWheelZoom, { passive: false });
```

**Hotkey Bindings for Keyboard Zoom:**
```javascript
// hotkeyBindings.js
{
  commandName: 'scaleUpViewport',
  label: 'Zoom In',
  keys: ['+'],
  isEditable: true,
},
{
  commandName: 'scaleDownViewport',
  label: 'Zoom Out',
  keys: ['-'],
  isEditable: true,
},
{
  commandName: 'fitViewportToWindow',
  label: 'Zoom to Fit',
  keys: ['='],
  isEditable: true,
}
```

**Architecture Integration:**
- Stored in localStorage under key `zoomSpeed`
- Applied to both keyboard zoom (+/-) and scroll wheel zoom
- User can select from 4 predefined speeds (0.5x, 1x, 2x, 3x, 4x)
- Affects parallelScale camera property for smooth zoom effect
- Presentation stored after zoom for persistence

---

## Summary Table

| Feature | File Locations | Storage | Commands/Services |
|---------|----------------|---------|-------------------|
| 1. Related Studies Uniqueness | createStudyBrowserTabs.ts, getStudiesForPatientByMRN.js | N/A | DisplaySetService |
| 2. Viewer Fade Out | OHIFCornerstoneViewport.tsx | N/A | ViewportPersistenceService |
| 3. Overlay Hotkey | hotkeyBindings.js, commandsModule.ts | N/A | toggleOverlays command |
| 4. Default Layout Grid | ToolbarLayoutSelector.tsx, getHangingProtocolModule.js | localStorage: userLayoutPreference | HangingProtocolService |
| 5. Invert Scrolling | initToolGroups.js (modes), UserPreferences.tsx | localStorage: invertScrollWheel | StackScroll tool config |
| 6. Default Tool Options | defaultToolBindings.js, UserPreferences.tsx | localStorage: defaultToolBindings | updateMouseButtonBinding, applyMouseButtonBindings |
| 7. Download Study | orthancUtils.js, ViewerHeader.tsx | N/A | downloadStudyByDICOMIds, UINotificationService |
| 8. Duplicate Window | ViewerHeader.tsx | localStorage: windowData, windowsArray | window.open, storage events |
| 9. View Report | commandsModule.ts, Thumbnail.tsx | N/A | viewReport, getCases commands |
| 10. Viewport Persistence | ViewportPersistenceService.ts | localStorage: ohif_viewport_state_{hash} | storeRotationFlipState, attemptViewportRestoration |
| 11. Faster Zoom | commandsModule.ts, UserPreferences.tsx | localStorage: zoomSpeed | scaleUpViewport, scaleDownViewport, wheelZoom |

---

## Architecture Patterns Used

### State Management
- **localStorage:** Used for user preferences (zoom speed, tool bindings, layout, scroll inversion)
- **Zustand Stores:** Used for reactive component state
- **Services:** CornerstoneViewportService, DisplaySetService, HangingProtocolService, UINotificationService

### Events & Subscriptions
- ViewportPersistenceService listens to: VIEWPORT_NEW_IMAGE_SET, IMAGE_RENDERED, STACK_NEW_IMAGE, VOLUME_LOADED
- Storage events for cross-window communication
- Cornerstone events for viewport state changes

### API Integration
- **Radimal Reporter:** `/case`, `/consultation/pdf` endpoints
- **Orthanc Server:** SHA-1 UUID generation for study downloads
- **Flask/S3:** Presigned URL generation for PDF reports

### UI Components
- Custom dropdown menus in Header (Monitor Options, Menu Options)
- Thumbnail context menus with conditional rendering
- User Preferences modal with tabs for different settings

---

**Documentation Generated:** 2025-11-17
**Branch:** v3.10.0.4.radimal
**OHIF Version:** 3.9.0+
