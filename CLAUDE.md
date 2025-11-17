# CLAUDE.md - OHIF Medical Imaging Viewer

> **Project Context for AI Assistants**
>
> This document provides comprehensive guidance for AI assistants working on the OHIF Viewers codebase. It covers architecture, development workflows, testing, and code conventions.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Repository Structure](#repository-structure)
3. [Architecture](#architecture)
4. [Development Setup](#development-setup)
5. [Build System](#build-system)
6. [Testing](#testing)
7. [Code Conventions](#code-conventions)
8. [Extension Development](#extension-development)
9. [Mode Development](#mode-development)
10. [Common Patterns](#common-patterns)
11. [Configuration](#configuration)
12. [Git Workflow](#git-workflow)
13. [Troubleshooting](#troubleshooting)

---

## Project Overview

**OHIF Viewers** is a zero-footprint medical imaging viewer built as a Progressive Web Application (PWA). It's maintained by the Open Health Imaging Foundation (OHIF).

### Key Facts

- **Type**: Yarn workspace monorepo
- **Language**: TypeScript/JavaScript (ES2022+)
- **Framework**: React 18.3.1
- **Build Tool**: Webpack 5
- **Package Manager**: Yarn 1.22.22 (workspaces enabled)
- **State Management**: Zustand stores + Service-based architecture
- **Styling**: Tailwind CSS 3.2.4
- **Testing**: Jest (unit) + Playwright (E2E)
- **License**: MIT

### Project Goals

- Provide a configurable, extensible medical imaging viewer
- Support DICOMweb archives and various DICOM modalities
- Enable customization through extensions and modes
- Maintain zero-footprint (runs entirely in browser)

---

## Repository Structure

```
/home/user/Viewers/
├── extensions/              # Plugin modules (15+ extensions)
│   ├── cornerstone/         # Cornerstone3D rendering
│   ├── cornerstone-dicom-seg/  # Segmentation support
│   ├── cornerstone-dicom-sr/   # Structured reporting
│   ├── default/             # Core UI, data sources, panels
│   ├── dicom-pdf/           # PDF rendering
│   ├── dicom-video/         # Video support
│   ├── measurement-tracking/   # Measurement tools
│   └── tmtv/                # TMTV calculations
│
├── modes/                   # Workflow configurations (7+ modes)
│   ├── basic-dev-mode/      # Basic viewer
│   ├── longitudinal/        # Longitudinal studies
│   ├── microscopy/          # Whole slide imaging
│   ├── segmentation/        # Segmentation workflow
│   └── tmtv/                # TMTV workflow
│
├── platform/                # Core infrastructure
│   ├── core/                # @ohif/core - Business logic
│   ├── ui/                  # @ohif/ui - React components
│   ├── ui-next/             # @ohif/ui-next - Next-gen UI
│   ├── app/                 # @ohif/app - Main viewer app
│   ├── i18n/                # @ohif/i18n - Internationalization
│   ├── cli/                 # @ohif/cli - CLI tooling
│   └── docs/                # Documentation (Docusaurus)
│
├── addOns/                  # External dependencies
├── tests/                   # E2E tests (Playwright)
├── .webpack/                # Shared Webpack configuration
├── .github/workflows/       # CI/CD (GitHub Actions)
├── package.json             # Root workspace config
├── lerna.json               # Lerna monorepo config
└── tsconfig.json            # TypeScript configuration
```

### Workspace Packages

Defined in `package.json`:
```json
{
  "workspaces": {
    "packages": [
      "platform/*",
      "extensions/*",
      "modes/*",
      "addOns/externals/*"
    ]
  }
}
```

---

## Architecture

### Core Concepts

The OHIF Viewer follows a **plugin-based architecture**:

1. **Platform** - Core infrastructure (managers, services, UI components)
2. **Extensions** - Modular features that extend functionality
3. **Modes** - Workflow configurations that combine extensions

### Platform Packages

#### @ohif/core (`platform/core/`)

**Purpose**: Generic business logic for medical imaging

**Key Exports**:
- `ExtensionManager` - Loads and registers extensions
- `CommandsManager` - Manages application commands
- `ServicesManager` - Coordinates 19+ services
- `HotkeysManager` - Keyboard shortcut management

**Services** (19 total):
```typescript
- UINotificationService     - Toast notifications
- UIModalService            - Modal dialogs
- DisplaySetService         - Image series management
- MeasurementService        - Measurement tracking
- ToolbarService            - Toolbar state
- ViewportGridService       - Viewport layout
- HangingProtocolService    - Display protocols
- CineService               - Cine playback
- UserAuthenticationService - Auth handling
- CustomizationService      - UI customization
- StudyPrefetcherService    - Prefetch optimization
- ToolGroupService          - Tool management
- ViewportActionCornersService - Viewport actions
- StateSyncService          - State synchronization
- PanelService              - Panel management
- WorkflowStepsService      - Workflow management
- CornerstoneCacheService   - Image caching
- SegmentationService       - Segmentation handling
- PubSubService             - Event bus
```

**Location**: `platform/core/src/services/`

#### @ohif/ui (`platform/ui/`)

**Purpose**: React component library

**Key Components**:
- `ViewportPane` - Individual viewport container
- `ViewportGrid` - Multi-viewport layout
- `SidePanel` - Collapsible side panels
- `Toolbar` - Top toolbar
- `StudyBrowser` - Study/series browser
- `MeasurementTable` - Measurement display

**Features**:
- Tailwind CSS styling
- Drag-and-drop support (react-dnd)
- Storybook documentation
- D3 charts for measurements

#### @ohif/app (`platform/app/`)

**Purpose**: Main viewer application

**Entry Point**: `src/index.js`

**Key Files**:
- `App.tsx` - Root React component
- `appInit.js` - Initialization (managers, services, extensions)
- `src/routes/` - React Router v6 routing
- `src/state/` - Zustand stores for app state
- `public/config/` - Configuration files

**Build Output**: `dist/` (production build)

### Extension Architecture

Extensions provide modular functionality through **module types**:

```javascript
// From platform/core/src/extensions/MODULE_TYPES.js
{
  COMMANDS: 'commandsModule',
  CUSTOMIZATION: 'customizationModule',
  DATA_SOURCE: 'dataSourcesModule',
  PANEL: 'panelModule',
  SOP_CLASS_HANDLER: 'sopClassHandlerModule',
  TOOLBAR: 'toolbarModule',
  VIEWPORT: 'viewportModule',
  LAYOUT_TEMPLATE: 'layoutTemplateModule',
  HANGING_PROTOCOL: 'hangingProtocolModule',
  UTILITY: 'utilityModule',
}
```

**Extension Structure** (example: `extensions/default/`):

```
/extensions/default/
  /src/
    index.ts                     # Main entry point
    init.ts                      # preRegistration hook
    getCommandsModule.ts         # Command definitions
    getDataSourcesModule.js      # Data source APIs
    getToolbarModule.tsx         # Toolbar configuration
    getSopClassHandlerModule.js  # DICOM SOP handling
    getPanelModule.tsx           # UI panels
    getViewportModule.tsx        # Viewport implementations
    getHangingProtocolModule.js  # Display protocols
    getCustomizationModule.tsx   # UI customizations
    /Components/                 # React components
    /Panels/                     # Panel implementations
    /stores/                     # Zustand stores
    /utils/                      # Utilities
    /hooks/                      # React hooks
  package.json
  README.md
```

**Extension Entry Point** (`index.ts`):
```typescript
import { Types } from '@ohif/core';

const extension: Types.Extensions.Extension = {
  id: '@ohif/extension-default',

  preRegistration: async ({ servicesManager, commandsManager }) => {
    // Initialize before registration
  },

  getCommandsModule: ({ servicesManager }) => {
    // Return command definitions
  },

  getDataSourcesModule: ({ servicesManager }) => {
    // Return data source implementations
  },

  // ... other module getters
};

export default extension;
```

### Mode Architecture

Modes define **workflows** by combining extensions and configuration.

**Mode Structure** (example: `modes/basic-dev-mode/`):

```typescript
const mode = {
  id: 'basic-dev-mode',
  routeName: 'dev',
  displayName: 'Basic Dev Viewer',

  // Called when mode is activated
  onModeEnter: ({ servicesManager, extensionManager }) => {
    // Setup tools, toolbar, hanging protocols
    const { toolGroupService, toolbarService } = servicesManager.services;
    toolGroupService.createToolGroupAndAddTools('default', tools);
    toolbarService.addButtons(toolbarButtons);
  },

  // Called when mode is exited
  onModeExit: ({ servicesManager }) => {
    // Cleanup
  },

  // Validation tags for study/series filtering
  validationTags: {
    study: [],
    series: [],
  },

  // Determine if mode is valid for given modalities
  isValidMode: ({ modalities }) => ({
    valid: true,
    description: '',
  }),

  // Route definitions
  routes: [{
    path: 'viewer-cs3d',
    layoutTemplate: ({ location, servicesManager }) => ({
      id: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
      props: {
        leftPanels: ['@ohif/extension-default.panelModule.seriesList'],
        rightPanels: ['@ohif/extension-default.panelModule.measure'],
        viewports: [/* viewport configurations */],
      },
    }),
  }],

  // Required extensions
  extensions: {
    '@ohif/extension-default': '^3.0.0',
    '@ohif/extension-cornerstone': '^3.0.0',
  },

  // SOP class handlers to use
  sopClassHandlers: [
    '@ohif/extension-default.sopClassHandlerModule.stack',
  ],

  // Hotkey bindings
  hotkeys: [
    { commandName: 'incrementActiveViewport', keys: ['right'] },
    { commandName: 'decrementActiveViewport', keys: ['left'] },
  ],
};
```

### Component Interaction Flow

```
App.tsx (initializes)
  ↓
appInit.js (loads configuration)
  ├─ Creates CommandsManager
  ├─ Creates ExtensionManager
  ├─ Creates ServicesManager
  ├─ Creates HotkeysManager
  └─ Loads extensions & modes via pluginImports
      ↓
ExtensionManager.registerExtensions()
  ├─ Calls preRegistration hooks
  ├─ Registers module providers (commands, viewports, panels, etc.)
  └─ Stores modules in modulesMap
      ↓
Mode activation (via routing)
  ├─ Calls mode.onModeEnter()
  ├─ Applies layout template
  ├─ Registers SOP handlers
  └─ Activates hotkeys
```

---

## Development Setup

### Requirements

- **Node.js**: >=18 (specified in `package.json` engines)
- **Yarn**: >=1.20.0 (preferably 1.22.22)
- **Git**: For version control

### Initial Setup

```bash
# Clone repository
git clone https://github.com/OHIF/Viewers.git
cd Viewers

# Enable Yarn workspaces (if not already enabled)
yarn config set workspaces-experimental true

# Install dependencies
yarn install

# Start development server
yarn dev
```

### Development Commands

```bash
# Development
yarn dev                    # Start dev server (port 3000)
yarn dev:no:cache          # Dev server without webpack cache
yarn dev:orthanc           # Dev with Orthanc backend proxy
yarn dev:static            # Dev with static files

# Build
yarn build                 # Production build
yarn build:dev             # Development build
yarn build:ci              # CI build (Netlify config)
yarn build:demo            # Demo build (with Rollbar)

# Testing
yarn test:unit             # Run Jest tests with coverage
yarn test:e2e              # Run Playwright E2E tests
yarn test:e2e:ui           # Playwright UI mode
yarn test:e2e:headed       # Headed browser tests

# Linting & Formatting
npx prettier --write .     # Format all files
npx eslint --fix .         # Fix linting errors

# Monorepo Management
yarn clean                 # Clean build artifacts
yarn clean:deep            # Clean + remove node_modules
yarn see-changed           # See changed packages (Lerna)
```

### Environment Variables

**Webpack Build**:
```bash
NODE_ENV=production|development
APP_CONFIG=config/default.js      # Config file to use
PUBLIC_URL=/                      # Base URL for assets
HTML_TEMPLATE=index.html          # HTML template
QUICK_BUILD=true                  # Skip optimization
```

**Development Server**:
```bash
OHIF_PORT=3000                    # Dev server port
PROXY_TARGET=http://localhost:8042/dicom-web
PROXY_DOMAIN=http://localhost:8042
```

**Internationalization**:
```bash
USE_LOCIZE=true                   # Use Locize backend
LOCIZE_PROJECTID=...
LOCIZE_API_KEY=...
```

### File Watching

The dev server (`yarn dev`) uses:
- **Webpack Dev Server** - Hot Module Replacement (HMR)
- **React Refresh** - Fast component reloading
- **Filesystem cache** - Faster rebuilds

Changes to these file types trigger recompilation:
- `.js`, `.jsx`, `.ts`, `.tsx` - TypeScript/JavaScript
- `.css` - Stylesheets (PostCSS + Tailwind)
- `.svg` - SVG components (@svgr/webpack)

---

## Build System

### Webpack Configuration

**Base Config**: `.webpack/webpack.base.js`

**App Config**: `platform/app/.webpack/webpack.pwa.js`

**Key Features**:
- **Module Federation** - For dynamic extension loading
- **Code Splitting** - Lazy load extensions/modes
- **Tree Shaking** - Remove unused code
- **Source Maps** - `source-map` (prod), `cheap-module-source-map` (dev)
- **Minification** - TerserPlugin (production only)
- **Filesystem Cache** - Speed up rebuilds

**Loaders**:
```javascript
{
  test: /\.(tsx?|jsx?)$/,
  use: 'babel-loader',           // Transpile JS/TS
},
{
  test: /\.svg$/,
  use: '@svgr/webpack',           // SVG to React
},
{
  test: /\.css$/,
  use: ['style-loader', 'css-loader', 'postcss-loader'], // CSS + Tailwind
},
{
  test: /\.worker\.js$/,
  use: 'worker-loader',           // Web Workers
}
```

### Babel Configuration

**File**: `babel.config.js`

**Presets**:
- `@babel/preset-env` - ES2022+ transpilation
- `@babel/preset-react` - JSX transformation
- `@babel/preset-typescript` - TypeScript support

**Plugins**:
- `@babel/plugin-proposal-class-properties`
- `@babel/plugin-transform-typescript`
- `@babel/plugin-proposal-private-methods`
- `@babel/plugin-proposal-private-property-in-object`
- `@babel/plugin-transform-runtime` - Async/await helpers

### TypeScript Configuration

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "jsx": "react",
    "moduleResolution": "bundler",
    "emitDeclarationOnly": true,
    "sourceMap": true,
    "strict": false,
    "paths": {
      "@ohif/core": ["platform/core/src"],
      "@ohif/ui": ["platform/ui/src"],
      "@ohif/ui-next": ["platform/ui-next/src"],
      "@ohif/i18n": ["platform/i18n/src"],
      "@state": ["./platform/app/src/state"]
    }
  }
}
```

**Path Aliases**: Use `@ohif/core`, `@ohif/ui`, etc. in imports instead of relative paths.

### Build Outputs

**Production Build** (`yarn build`):
```
platform/app/dist/
├── index.html
├── app.bundle.[hash].js
├── app.bundle.[hash].css
├── vendor.bundle.[hash].js    # Third-party libraries
├── [extension].[hash].js      # Code-split extensions
└── config/
    └── default.js             # Configuration file
```

**Development Build** (`yarn dev`):
- Served from memory (no disk writes)
- Accessible at `http://localhost:3000`

---

## Testing

### Unit Testing (Jest)

**Configuration**: `jest.config.base.js`

**Test Patterns**:
- Test files: `*.test.js`, `*.test.ts`, `*.test.tsx`
- Location: Colocated with source files
- Example: `ExtensionManager.test.js` next to `ExtensionManager.ts`

**Running Tests**:
```bash
yarn test:unit              # All tests with coverage
yarn test:unit:ci           # CI mode (parallel, coverage)
```

**Writing Tests**:
```typescript
// MyComponent.test.tsx
import { render, screen } from '@testing-library/react';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent title="Test" />);
    expect(screen.getByText('Test')).toBeInTheDocument();
  });
});
```

**Mocking**:
```javascript
// CSS/LESS modules
'\\.(css|less)$': 'identity-obj-proxy',

// Static assets
'\\.(jpg|png|svg|...)$': '<rootDir>/src/__mocks__/fileMock.js',
```

### E2E Testing (Playwright)

**Configuration**: `playwright.config.ts`

**Test Location**: `tests/*.spec.ts`

**Running Tests**:
```bash
yarn test:e2e               # Interactive UI mode
yarn test:e2e:headed        # Headed browser
yarn test:e2e:ci            # CI mode with video
yarn test:e2e:serve         # Start test server
```

**Writing Tests**:
```typescript
// tests/Circle.spec.ts
import { test } from '@playwright/test';

test('should display the circle tool', async ({ page }) => {
  await page.goto('http://localhost:3000/viewer?StudyInstanceUIDs=...');

  // Use data-cy test IDs
  await page.getByTestId('MeasurementTools-split-button-secondary').click();
  await page.getByTestId('CircleROI').click();

  // Interact with canvas
  const canvas = page.getByTestId('viewport-pane').locator('canvas');
  await canvas.click({ position: { x: 100, y: 100 } });

  // Screenshot comparison
  await page.screenshot({ path: 'screenshots/circle.png' });
});
```

**Test IDs**:
- Use `data-cy` attribute for test selection
- Example: `<button data-cy="save-button">Save</button>`

**CI Configuration** (`.github/workflows/playwright.yml`):
- Runs on push to `main`/`master` and PRs
- Uses Playwright Docker container
- Sharded across 5 parallel jobs
- Generates HTML reports with screenshots/videos

---

## Code Conventions

### Language & Style

**TypeScript Usage**:
- Prefer TypeScript (`.ts`, `.tsx`) for new code
- Use strict types where possible
- Define types in `platform/core/src/types/`

**React Patterns**:
- **Functional components only** (no class components)
- Use **hooks** for state and side effects
- Props destructuring in function signature

**Example Component**:
```typescript
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface MyComponentProps {
  title: string;
  onSave: (value: string) => void;
}

function MyComponent({ title, onSave }: MyComponentProps) {
  const { t } = useTranslation('MyNamespace');
  const [value, setValue] = useState('');

  useEffect(() => {
    // Side effects here
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-primary-light text-2xl">{title}</h1>
      <input
        className="border border-common-light rounded px-2 py-1"
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button
        className="bg-primary-main text-white px-4 py-2 rounded hover:bg-primary-dark"
        onClick={() => onSave(value)}
      >
        {t('save')}
      </button>
    </div>
  );
}

export default MyComponent;
```

### Styling Conventions

**Tailwind CSS**:
- Use **Tailwind utility classes exclusively**
- Avoid inline styles or CSS modules for new code
- Use semantic color names from theme

**Color Palette** (`platform/ui/tailwind.config.js`):
```javascript
colors: {
  primary: {
    light: '#b9b9b9',
    main: '#338DED',    // OHIF blue
    dark: 'black',
  },
  secondary: {
    main: 'black',
  },
  common: {
    bright: '#e1e1e1',
    light: '#a19fad',
    dark: '#726f7e',
  },
  success: {
    light: '#2ce293',
    dark: '#0a6e2e',
  },
  error: {
    light: '#ff7d7d',
    dark: '#a10000',
  },
  warning: {
    light: '#ffc851',
    dark: '#a0781f',
  },
}
```

**Responsive Design**:
```tsx
<div className="flex flex-col md:flex-row gap-4 p-4 md:p-8">
  <div className="w-full md:w-1/2">Left</div>
  <div className="w-full md:w-1/2">Right</div>
</div>
```

### State Management

**Zustand Stores** (preferred for extension-local state):

```typescript
// extensions/default/src/stores/useMyStore.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface MyStore {
  count: number;
  increment: () => void;
  reset: () => void;
}

const createMyStore = (set) => ({
  count: 0,
  increment: () => set(state => ({ count: state.count + 1 })),
  reset: () => set({ count: 0 }),
});

export const useMyStore = create<MyStore>()(
  devtools(createMyStore, { name: 'MyStore' })
);
```

**Services** (for shared/global state):

```typescript
// Access services via ServicesManager
const { servicesManager } = useAppConfig();
const { displaySetService, measurementService } = servicesManager.services;

// Subscribe to service events
useEffect(() => {
  const subscription = displaySetService.subscribe(
    displaySetService.EVENTS.DISPLAY_SETS_ADDED,
    ({ displaySetsAdded }) => {
      console.log('Display sets added:', displaySetsAdded);
    }
  );

  return () => subscription.unsubscribe();
}, []);
```

### File Organization

**Naming Conventions**:
- Components: PascalCase (`MyComponent.tsx`)
- Utilities: camelCase (`myUtility.js`)
- Stores: `use[Name]Store.ts` (`useViewportGridStore.ts`)
- Types: PascalCase (`AppTypes.ts`)
- Constants: UPPER_SNAKE_CASE (`MODULE_TYPES.js`)

**Directory Structure**:
```
/src/
  /components/          # Reusable components
  /hooks/               # Custom React hooks
  /stores/              # Zustand stores
  /utils/               # Utility functions
  /services/            # Service implementations
  /types/               # TypeScript type definitions
  index.ts              # Main entry point
```

### Code Quality

**Linting** (ESLint):
```bash
npx eslint --fix .
```

**Formatting** (Prettier):
```bash
npx prettier --write .
```

**Pre-commit Hooks** (Husky):
- Configured in `package.json`
- Runs Prettier on staged files

**Rules**:
- Use `const` over `let` where possible
- Always use curly braces for control flow
- Prefer destructuring for props and imports
- Use async/await over promises
- Add JSDoc comments for public APIs

---

## Extension Development

### Creating a New Extension

**Method 1: Using OHIF CLI**
```bash
npx @ohif/cli create-extension
# Follow interactive prompts
```

**Method 2: Manual Creation**

1. Create directory: `extensions/my-extension/`
2. Add `package.json`:
```json
{
  "name": "@ohif/extension-my-extension",
  "version": "3.9.0",
  "main": "dist/ohif-extension-my-extension.umd.js",
  "files": ["dist"],
  "dependencies": {
    "@ohif/core": "^3.9.0",
    "@ohif/ui": "^3.9.0"
  }
}
```

3. Create `src/index.ts`:
```typescript
import { Types } from '@ohif/core';

const extension: Types.Extensions.Extension = {
  id: '@ohif/extension-my-extension',

  preRegistration: async ({ servicesManager, commandsManager }) => {
    // Initialize before registration
  },

  getCommandsModule: ({ servicesManager }) => ({
    definitions: {
      myCommand: {
        commandFn: ({ params }) => {
          console.log('My command executed', params);
        },
      },
    },
    defaultContext: 'VIEWER',
  }),
};

export default extension;
```

4. Add to workspace: Update root `package.json` workspaces (auto-detected)

### Extension Module Types

#### Commands Module

```typescript
getCommandsModule: ({ servicesManager }) => ({
  definitions: {
    commandName: {
      commandFn: ({ params }) => {
        // Command implementation
      },
      storeContexts: [],       // Contexts where command is available
      options: {},
    },
  },
  defaultContext: 'VIEWER',
})
```

#### Data Source Module

```typescript
getDataSourcesModule: ({ servicesManager }) => [
  {
    name: 'myDataSource',
    type: 'webApi',
    createDataSource: (configuration) => ({
      initialize: async () => {},
      query: {
        studies: {
          search: async (filters) => [/* studies */],
        },
        series: {
          search: async (studyInstanceUID) => [/* series */],
        },
      },
      retrieve: {
        directURL: async (instance) => 'url',
        bulkDataURI: async (instance) => 'url',
      },
    }),
  },
]
```

#### Panel Module

```typescript
import MyPanel from './components/MyPanel';

getPanelModule: ({ servicesManager }) => [
  {
    name: 'myPanel',
    iconName: 'group-layers',
    iconLabel: 'My Panel',
    label: 'My Panel',
    component: MyPanel,
  },
]
```

#### Viewport Module

```typescript
getViewportModule: ({ servicesManager, extensionManager }) => [
  {
    name: 'myViewport',
    component: MyViewportComponent,
  },
]
```

#### SOP Class Handler Module

```typescript
getSopClassHandlerModule: ({ servicesManager }) => [
  {
    name: 'myHandler',
    sopClassUIDs: ['1.2.840.10008.5.1.4.1.1.2'], // CT Image Storage
    getDisplaySetsFromSeries: (series, study) => {
      return [
        {
          displaySetInstanceUID: uid(),
          SeriesInstanceUID: series.SeriesInstanceUID,
          // ... other properties
        },
      ];
    },
  },
]
```

### Extension Best Practices

1. **Use Services for Shared State**: Don't create global variables
2. **Subscribe to Service Events**: React to state changes
3. **Cleanup on unmount**: Unsubscribe from events
4. **Use Translation**: Always use `useTranslation()` for text
5. **Follow Naming Conventions**: Use `@ohif/extension-[name]` format
6. **Document Your Extension**: Add README.md with usage instructions

---

## Mode Development

### Creating a New Mode

1. Create directory: `modes/my-mode/`
2. Add `package.json`:
```json
{
  "name": "@ohif/mode-my-mode",
  "version": "3.9.0",
  "main": "dist/ohif-mode-my-mode.umd.js"
}
```

3. Create `src/index.ts`:
```typescript
import { hotkeys } from '@ohif/core';
import toolbarButtons from './toolbarButtons';

const mode = {
  id: 'my-mode',
  routeName: 'mymode',
  displayName: 'My Mode',

  onModeEnter: ({ servicesManager, extensionManager }) => {
    const { toolGroupService, toolbarService } = servicesManager.services;

    // Create tool group
    toolGroupService.createToolGroupAndAddTools('default', {
      active: [
        { toolName: 'WindowLevel', bindings: [{ mouseButton: 1 }] },
      ],
      passive: [
        { toolName: 'Length' },
      ],
    });

    // Add toolbar buttons
    toolbarService.addButtons(toolbarButtons);
  },

  onModeExit: ({ servicesManager }) => {
    const { toolGroupService } = servicesManager.services;
    toolGroupService.destroy();
  },

  validationTags: {
    study: [],
    series: [],
  },

  isValidMode: ({ modalities }) => ({
    valid: modalities.includes('CT') || modalities.includes('MR'),
    description: 'CT or MR study required',
  }),

  routes: [
    {
      path: 'mymode',
      layoutTemplate: ({ location, servicesManager }) => ({
        id: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
        props: {
          leftPanels: ['@ohif/extension-default.panelModule.seriesList'],
          rightPanels: ['@ohif/extension-default.panelModule.measure'],
          viewports: [
            {
              namespace: '@ohif/extension-cornerstone.viewportModule.cornerstone',
              displaySetsToDisplay: ['@ohif/extension-default.sopClassHandlerModule.stack'],
            },
          ],
        },
      }),
    },
  ],

  extensions: {
    '@ohif/extension-default': '^3.0.0',
    '@ohif/extension-cornerstone': '^3.0.0',
  },

  sopClassHandlers: [
    '@ohif/extension-default.sopClassHandlerModule.stack',
  ],

  hotkeys: [...hotkeys.defaults.hotkeyBindings],
};

export default mode;
```

4. Create `src/toolbarButtons.js`:
```javascript
const toolbarButtons = [
  {
    id: 'MeasurementTools',
    type: 'ohif.splitButton',
    props: {
      groupId: 'MeasurementTools',
      primary: {
        id: 'Length',
        icon: 'tool-length',
        label: 'Length',
        tooltip: 'Length Tool',
        commands: [
          {
            commandName: 'setToolActive',
            commandOptions: { toolName: 'Length' },
          },
        ],
      },
      secondary: {
        icon: 'chevron-down',
        tooltip: 'More Tools',
      },
      items: [
        {
          id: 'Bidirectional',
          icon: 'tool-bidirectional',
          label: 'Bidirectional',
          commands: [
            {
              commandName: 'setToolActive',
              commandOptions: { toolName: 'Bidirectional' },
            },
          ],
        },
      ],
    },
  },
];

export default toolbarButtons;
```

### Mode Configuration

Modes can be configured in `platform/app/public/config/default.js`:

```javascript
window.config = {
  modes: [],

  modesConfiguration: {
    'my-mode': {
      // Mode-specific settings
      showStudyList: false,
      maxConcurrentMetadataRequests: 5,
    },
  },
};
```

---

## Common Patterns

### Accessing Services

```typescript
import { useAppConfig } from '@state';

function MyComponent() {
  const { servicesManager } = useAppConfig();
  const {
    displaySetService,
    measurementService,
    toolbarService,
  } = servicesManager.services;

  // Use services...
}
```

### Running Commands

```typescript
import { useAppConfig } from '@state';

function MyComponent() {
  const { commandsManager } = useAppConfig();

  const handleClick = () => {
    commandsManager.runCommand('myCommand', { param: 'value' });
  };

  return <button onClick={handleClick}>Run Command</button>;
}
```

### Subscribing to Service Events

```typescript
import { useEffect } from 'react';
import { useAppConfig } from '@state';

function MyComponent() {
  const { servicesManager } = useAppConfig();
  const { displaySetService } = servicesManager.services;

  useEffect(() => {
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      ({ displaySetsAdded }) => {
        console.log('Display sets added:', displaySetsAdded);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [displaySetService]);

  return <div>My Component</div>;
}
```

### Using Translations

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation('MyNamespace');

  return (
    <div>
      <h1>{t('title')}</h1>
      <p>{t('description', { name: 'OHIF' })}</p>
    </div>
  );
}
```

### Drag and Drop

```typescript
import { useDrop } from 'react-dnd';

function MyDropZone() {
  const [{ isOver }, drop] = useDrop({
    accept: 'displayset',
    drop: (item, monitor) => {
      console.log('Dropped item:', item);
    },
    collect: monitor => ({
      isOver: monitor.isOver(),
    }),
  });

  return (
    <div
      ref={drop}
      className={`border-2 ${isOver ? 'border-primary-main' : 'border-gray-300'}`}
    >
      Drop here
    </div>
  );
}
```

### Creating Custom Hooks

```typescript
// hooks/useViewportActive.ts
import { useState, useEffect } from 'react';
import { useAppConfig } from '@state';

export function useViewportActive(viewportId: string) {
  const [isActive, setIsActive] = useState(false);
  const { servicesManager } = useAppConfig();
  const { viewportGridService } = servicesManager.services;

  useEffect(() => {
    const subscription = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      ({ activeViewportId }) => {
        setIsActive(activeViewportId === viewportId);
      }
    );

    return () => subscription.unsubscribe();
  }, [viewportId, viewportGridService]);

  return isActive;
}
```

---

## Configuration

### App Configuration

**Location**: `platform/app/public/config/default.js`

**Structure**:
```javascript
window.config = {
  routerBasename: '/',

  // Extension configuration
  extensions: [],

  // Mode configuration
  modes: [],

  // Customization service settings
  customizationService: {
    // UI customizations
  },

  // Feature flags
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,

  // Data sources
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'My PACS',
        wadoUriRoot: 'https://example.com/wado',
        qidoRoot: 'https://example.com/qido',
        wadoRoot: 'https://example.com/wado',
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
      },
    },
  ],

  // Request throttling
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    prefetch: 25,
  },

  // Default hotkeys
  hotkeys: [
    { commandName: 'incrementActiveViewport', keys: ['right'] },
    { commandName: 'decrementActiveViewport', keys: ['left'] },
  ],

  // Cornerstonejs configuration
  cornerstoneExtensionConfig: {},

  // Dynamic config loading
  dangerouslyUseDynamicConfig: {
    enabled: false,
    regex: /.*/,
  },
};
```

### Loading Custom Configuration

**Via query parameter**:
```
http://localhost:3000/?configUrl=https://example.com/config.js
```

**Via environment variable**:
```bash
APP_CONFIG=config/my-config.js yarn build
```

### Extension Configuration

Extensions receive configuration via the app config:

```javascript
window.config = {
  extensions: [
    ['@ohif/extension-my-extension', {
      // Extension-specific config
      setting1: 'value',
      setting2: true,
    }],
  ],
};
```

Accessed in extension:
```typescript
preRegistration: async ({ configuration }) => {
  console.log(configuration.setting1); // 'value'
}
```

---

## Git Workflow

### Branching Strategy

**Main Branches**:
- `master` - Latest development (beta releases)
- `release/*` - Stable releases (e.g., `release/3.9`)

**Feature Branches**:
- Format: `feature/[description]` or `fix/[description]`
- Created from: `master`
- Merged to: `master` via PR

**Release Process**:
1. Development happens on `master`
2. When stable, create `release/X.Y` branch
3. Tag release: `v3.9.0`
4. Publish packages to npm
5. Build and deploy Docker images

### Commit Conventions

**Format**: Conventional Commits

```
type(scope): subject

body

footer
```

**Types**:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance

**Examples**:
```
feat(ui): add dark mode toggle

Adds a new toggle button to switch between light and dark themes.
Themes are persisted to localStorage.

Closes #123

fix(cornerstone): correct viewport rendering issue

The viewport was not rendering properly when switching between
display sets. This fix ensures the viewport is properly cleaned
up before rendering new content.
```

**Interactive Commit** (recommended):
```bash
yarn cm
# Follow interactive prompts
```

### Pull Request Process

1. **Fork** the repository (for external contributors)
2. **Create feature branch** from `master`
3. **Make changes** and commit
4. **Push** to your fork
5. **Open PR** to `OHIF/Viewers:master`
6. **Pass CI checks** (tests, linting)
7. **Code review** by maintainers
8. **Merge** when approved

**PR Template**:
```markdown
## Description
Brief description of changes

## Related Issue
Fixes #123

## Testing
- [ ] Unit tests added/updated
- [ ] E2E tests added/updated
- [ ] Manually tested

## Screenshots (if applicable)
[Add screenshots]

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### CI/CD

**GitHub Actions** (`.github/workflows/`):
- `playwright.yml` - E2E tests on push/PR
- `build-and-push-to-ecr.yml` - Deploy to AWS ECR

**Playwright Tests**:
- Runs on: Push to `main`/`master`, PRs
- Matrix: 5 parallel shards
- Reports: HTML report with screenshots/videos

---

## Troubleshooting

### Common Issues

#### Build Errors

**Issue**: `Module not found: Error: Can't resolve '@ohif/core'`

**Solution**: Ensure dependencies are installed and paths are correct
```bash
yarn clean
yarn install
```

**Issue**: `JavaScript heap out of memory`

**Solution**: Increase Node.js memory limit
```bash
export NODE_OPTIONS="--max_old_space_size=8192"
yarn build
```

#### Development Server

**Issue**: Dev server not starting on port 3000

**Solution**: Port may be in use, change port
```bash
OHIF_PORT=3001 yarn dev
```

**Issue**: Changes not reflecting (HMR not working)

**Solution**: Clear webpack cache
```bash
yarn dev:no:cache
```

#### Testing

**Issue**: Playwright tests failing locally

**Solution**: Install browsers
```bash
npx playwright install --with-deps
```

**Issue**: Jest tests failing with CSS import errors

**Solution**: CSS modules are mocked by jest config (should work automatically)

#### TypeScript

**Issue**: Type errors after updating dependencies

**Solution**: Rebuild type definitions
```bash
yarn clean
yarn install
npx tsc --build
```

### Debugging

**Enable Debug Mode**:
```javascript
// In browser console
localStorage.setItem('debug', 'ohif:*');
```

**Redux DevTools** (for Zustand):
```javascript
// Stores created with devtools middleware are automatically visible
```

**React DevTools**:
- Install browser extension
- Inspect component tree and props

**Webpack Bundle Analyzer**:
```bash
# Add to webpack config
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

plugins: [
  new BundleAnalyzerPlugin(),
]
```

### Performance

**Slow Build Times**:
- Use `QUICK_BUILD=true` to skip optimization
- Enable webpack filesystem cache (default)
- Use `yarn dev` instead of `yarn build`

**Slow Runtime**:
- Check number of web workers (`maxNumberOfWebWorkers`)
- Review hanging protocols (complex protocols slow loading)
- Use lazy loading for large extensions

### Getting Help

**Resources**:
- [Documentation](https://docs.ohif.org/)
- [GitHub Issues](https://github.com/OHIF/Viewers/issues)
- [Community Forum](https://community.ohif.org/)
- [Slack Channel](https://join.slack.com/t/cornerstonejs/shared_invite/...)

**Reporting Bugs**:
1. Check existing issues
2. Create minimal reproduction
3. Include browser/OS version
4. Attach screenshots/console errors
5. Specify OHIF version

---

## Quick Reference

### File Paths

```
Core Business Logic:    platform/core/src/
UI Components:          platform/ui/src/components/
App Entry:              platform/app/src/index.js
App Config:             platform/app/public/config/default.js
Extensions:             extensions/[name]/src/
Modes:                  modes/[name]/src/
Tests (E2E):            tests/*.spec.ts
Tests (Unit):           **/*.test.{js,ts,tsx}
Webpack Config:         .webpack/webpack.base.js
TypeScript Config:      tsconfig.json
Linting:                .eslintrc.json
Formatting:             .prettierrc
```

### Important Types

```typescript
// Platform core types
import { Types } from '@ohif/core';

Types.Extensions.Extension        // Extension definition
Types.Extensions.Module            // Module definition
Types.HangingProtocol              // Hanging protocol
Types.DisplaySet                   // Display set
Types.StudyMetadata                // Study metadata
Types.Command                      // Command definition
```

### Key Managers

```typescript
ExtensionManager      // Load/register extensions
CommandsManager       // Execute commands
ServicesManager       // Access services
HotkeysManager        // Keyboard shortcuts
```

### Key Services

```typescript
DisplaySetService            // Manage image series
MeasurementService          // Track measurements
ViewportGridService         // Viewport layout
HangingProtocolService      // Display protocols
ToolbarService              // Toolbar state
UINotificationService       // Notifications
UIModalService              // Modals/dialogs
```

### Extension Module Getters

```typescript
getCommandsModule()
getDataSourcesModule()
getPanelModule()
getViewportModule()
getSopClassHandlerModule()
getToolbarModule()
getLayoutTemplateModule()
getHangingProtocolModule()
getCustomizationModule()
getUtilityModule()
```

---

## Summary

The OHIF Viewers is a sophisticated medical imaging platform with:

- **Modular Architecture**: Extensions and modes for customization
- **Service-Based State**: 19+ services for coordinated functionality
- **Modern Stack**: React 18 + TypeScript + Tailwind CSS
- **Comprehensive Testing**: Jest + Playwright
- **Flexible Configuration**: JSON-based with dynamic loading
- **Active Development**: Continuous releases on `master` and `release/*` branches

When working on this codebase:

1. **Understand the architecture** - Extensions provide features, modes combine them into workflows
2. **Use services for state** - Don't create global variables
3. **Follow conventions** - TypeScript, Tailwind CSS, functional React
4. **Test your changes** - Write unit and E2E tests
5. **Document your work** - Update READMEs and add JSDoc comments

---

**Last Updated**: 2025-11-17
**OHIF Version**: 3.9.0
**Repository**: https://github.com/OHIF/Viewers
