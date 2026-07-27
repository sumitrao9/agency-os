# Agency OS — Complete Implementation Plan

## Phase 1: IPC Layer Completion
- [ ] Update `appRuntime.js` — add missing handlers: `getLead`, `deleteLead`, `theme:get`, `theme:save`, `settings:get`, `settings:save`
- [ ] Update `preload.js` — expose new bridge methods matching `ipc.ts`
- [ ] Update `main.js` — register all new IPC handlers
- [ ] Ensure `ipc.ts` matches preload API exactly
- [ ] Add type-safe validation and error logging to all IPC handlers

## Phase 2: CSS & Theme System
- [ ] Complete `main.css` with all component styles:
  - [ ] CommandPalette modal styles
  - [ ] GlobalSearchModal styles
  - [ ] SettingsModal styles
  - [ ] ToastContainer styles
  - [ ] RightPanel styles
  - [ ] Data table styles
  - [ ] Card/stat styles
  - [ ] Button variants (primary, secondary, icon)
  - [ ] Badge/tag styles
  - [ ] Form input styles
  - [ ] Modal overlay styles
  - [ ] MissionOverlay styles
  - [ ] Empty state styles
  - [ ] Progress bar styles
  - [ ] Job item styles
- [ ] Ensure theme variables for light/dark mode
- [ ] Add spacing modes (comfortable/compact)

## Phase 3: Feature Module Completion
- [ ] **LeadsModule**: Add lead detail panel, enrichment, email history, notes editing
- [ ] **BrowserModule**: Add quick search (Google Maps, Bing, Yelp), location spoof controls, lead capture
- [ ] **EmailModule**: Add template rendering, follow-up management, send UI
- [ ] **AutomationsModule**: Add workflow pipeline visualization
- [ ] **FilesModule**: Implement CSV export and import
- [ ] **DevToolsModule**: Add IPC call log, real database stats
- [ ] **SettingsModal**: Add keyboard shortcuts display, about/version info
- [ ] **ScraperModule**: Build full scrape pipeline with progress

## Phase 4: Workflow Integration
- [ ] Maps search → lead extraction pipeline
- [ ] Lead extraction → website analysis
- [ ] Website analysis → contact discovery
- [ ] Contact discovery → lead scoring
- [ ] Lead scoring → CRM
- [ ] CRM → email outreach
- [ ] Email outreach → follow-up queue
- [ ] Follow-up queue → reporting

## Phase 5: Performance Optimization
- [ ] Lazy load all modules
- [ ] Virtualized lead table
- [ ] Debounced search (300ms)
- [ ] Smart caching for lead data
- [ ] Clean up intervals and event listeners
- [ ] React.memo and useMemo optimizations
- [ ] Idle task scheduling

## Phase 6: Code Quality & Build
- [ ] Fix all TypeScript errors
- [ ] Run build check
- [ ] Start app and verify functionality
- [ ] Fix any runtime errors
- [ ] Production build test
</create_file>
