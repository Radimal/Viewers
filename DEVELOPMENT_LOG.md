# Development Log - OHIF Viewers Customization

> **Purpose**: Track development sessions, decisions, changes, and learnings over time. This helps AI assistants understand the current state and history of the project.

---

## Current State

### Working Features
- ✅ Base OHIF Viewer running successfully
- ✅ AWS CloudFront data source configured (default)
- ✅ Local Orthanc integration available
- ✅ Comprehensive AI documentation (CLAUDE.md)

### In Progress
- 🔄 [Add items as you work on them]

### Needs Work
- ⚠️ [Document issues or features that need attention]

### Current Blockers
- 🚫 [List any blocking issues]

---

## Session History

### 2025-11-17 - Session 1: Documentation Setup

**Goal**: Create comprehensive AI assistant documentation

**Changes Made**:
- ✅ Created `CLAUDE.md` (1,703 lines) - Complete codebase architecture documentation
  - Documented all 15+ extensions and their module types
  - Documented all 7+ modes and workflow configurations
  - Detailed build system (Webpack 5, Babel, TypeScript)
  - Testing setup (Jest + Playwright)
  - Code conventions and best practices
  - Extension/Mode development guides

- ✅ Created `DEVELOPMENT_LOG.md` - Session tracking and history
- ✅ Created `PROJECT_CONTEXT.md` - Project-specific configuration
- ✅ Created `KNOWN_ISSUES.md` - Common issues and workarounds

**Key Insights**:
- OHIF uses a plugin-based architecture with Extensions and Modes
- 19+ services manage shared state (DisplaySetService, MeasurementService, etc.)
- Zustand stores handle component-local state
- Tailwind CSS for all styling

**Decisions Made**:
1. Use CLAUDE.md as master reference for AI assistants
2. Track ongoing work in DEVELOPMENT_LOG.md
3. Document project-specific setup in PROJECT_CONTEXT.md
4. Keep KNOWN_ISSUES.md updated with workarounds

**Files Modified**:
- Created: `/CLAUDE.md`
- Created: `/DEVELOPMENT_LOG.md`
- Created: `/PROJECT_CONTEXT.md`
- Created: `/KNOWN_ISSUES.md`

**Next Steps**:
- [ ] Document any custom extensions being developed
- [ ] Add specific deployment configurations
- [ ] Document custom hanging protocols if any
- [ ] Add testing strategies for custom features

---

## Failed Approaches & Learnings

### [Date] - [Issue Description]
**Problem**: [What we were trying to solve]

**Approaches Tried**:
1. **Approach A**: [Description]
   - Failed because: [Reason]
   - Learning: [What we learned]

2. **Approach B**: [Description]
   - Result: [Success/Failure]
   - Why: [Explanation]

**Final Solution**: [What actually worked]

---

## Open Questions

### Technical Questions
- [ ] [Question about architecture or implementation]
- [ ] [Question about best practices]

### Configuration Questions
- [ ] [Question about specific settings]
- [ ] [Question about deployment]

### Integration Questions
- [ ] [Question about PACS integration]
- [ ] [Question about custom data sources]

---

## Custom Development

### Custom Extensions Built
_Document any custom extensions your team has created_

#### Extension: [Name]
- **Location**: `extensions/[name]/`
- **Purpose**: [What it does]
- **Module Types**: [commandsModule, viewportModule, etc.]
- **Status**: [In Development / Production]
- **Dependencies**: [Other extensions it requires]
- **Notes**: [Special considerations]

### Custom Modes Built
_Document any custom modes your team has created_

#### Mode: [Name]
- **Location**: `modes/[name]/`
- **Purpose**: [Workflow description]
- **Extensions Used**: [List of required extensions]
- **Modalities Supported**: [CT, MR, PT, etc.]
- **Status**: [In Development / Production]
- **Notes**: [Special considerations]

### Custom Services
_Document any custom services_

#### Service: [Name]
- **Location**: [File path]
- **Purpose**: [What it manages]
- **Events**: [Events it publishes]
- **Dependencies**: [Other services it uses]

---

## Environment-Specific Notes

### Development Environment
- **OS**: [Your development OS]
- **Node Version**: >=18
- **Yarn Version**: 1.22.22
- **Data Source**: Local Orthanc (see PROJECT_CONTEXT.md)
- **Port**: 3000 (default dev server)
- **Proxy**: http://localhost:80 (for Orthanc)

### Staging Environment
- **URL**: [If applicable]
- **Data Source**: [Configuration]
- **Notes**: [Special considerations]

### Production Environment
- **URL**: [If applicable]
- **Data Source**: AWS CloudFront (default config)
- **CDN**: [If applicable]
- **Notes**: [Special considerations]

---

## Performance Notes

### Known Performance Issues
- [Document any performance bottlenecks]

### Optimizations Applied
- [Document optimizations and their impact]

### Performance Metrics
- [Build time, load time, etc.]

---

## Testing Notes

### Test Coverage
- **Unit Tests**: [Coverage percentage]
- **E2E Tests**: [Number of tests]
- **Custom Tests**: [Description]

### Testing Strategies
- [Document testing approaches]
- [Integration testing setup]
- [CI/CD testing pipeline]

---

## Security Considerations

### Authentication
- [How auth is handled]
- [User management approach]

### Data Security
- [HIPAA compliance considerations]
- [Data encryption approach]

### Network Security
- [CORS configuration]
- [SSL/TLS setup]

---

## Deployment History

### [Date] - Deployment to [Environment]
- **Version**: [Version number]
- **Changes**: [Summary of changes]
- **Issues**: [Any issues encountered]
- **Rollback**: [Whether rollback was needed]

---

## Useful Commands Reference

### Development
```bash
yarn dev                    # Start dev server
yarn dev:orthanc           # Dev with Orthanc proxy
yarn dev:no:cache          # Dev without webpack cache
```

### Building
```bash
yarn build                 # Production build
yarn build:dev             # Development build
APP_CONFIG=config/local_orthanc.js yarn build  # Build with specific config
```

### Testing
```bash
yarn test:unit             # Run Jest tests
yarn test:e2e              # Run Playwright tests
yarn test:e2e:ui           # Playwright UI mode
```

### Debugging
```bash
export NODE_OPTIONS="--max_old_space_size=8192"  # Increase memory for builds
yarn clean                 # Clean build artifacts
yarn clean:deep            # Clean + remove node_modules
```

---

## Quick Links

- [OHIF Documentation](https://docs.ohif.org/)
- [GitHub Repository](https://github.com/OHIF/Viewers)
- [Community Forum](https://community.ohif.org/)
- [Cornerstone3D Docs](https://www.cornerstonejs.org/)

---

## Notes Template

Use this template for adding new session notes:

```markdown
### YYYY-MM-DD - Session N: [Brief Title]

**Goal**: [What you're trying to accomplish]

**Changes Made**:
- ✅ [Completed item]
- ⚠️ [Item with issues]
- 🔄 [In progress]

**Key Insights**:
- [Important discovery or learning]

**Decisions Made**:
1. [Decision and rationale]

**Files Modified**:
- Modified: `path/to/file`
- Created: `path/to/new/file`

**Next Steps**:
- [ ] [Action item]
```

---

**Last Updated**: 2025-11-17
**Maintained By**: [Your Team]
