# UI Redesign Plan: Agency OS → Raycast + Linear + Notion Calendar + macOS System Settings

## Information Gathered

After thoroughly analyzing the entire codebase, here's what I've found:

**Current State:**
- The app has a dark theme with flashy gradients, RGB effects, glass morphism, and excessive visual decorations
- The UI is cluttered with too many dashboard sections (14 capability sections in dashboard-card)
- No light mode support, no theme customization (accent color, font size, spacing)
- The sidebar, topbar, and overall layout lack polish compared to modern tools like Raycast/Linear
- Navigation is functional but not optimized for speed (1-2 clicks to everything)
- No command palette (Ctrl+K), global search (Ctrl+Space), or keyboard shortcut indicators
- Missing features: resizable panels, breadcrumbs, favorites, recent items
- Background jobs panel, developer tools, and advanced data views are absent
- The "Today's Mission" overlay is a good start but needs refinement

**Files to modify:**
1. `src/renderer/index.html` — Complete restructure of the HTML layout
2. `src/renderer/styles/main.css` — Complete CSS rewrite with the new design system
3. `src/renderer/app.js` — Major refactor for new UI components and interactions
4. `src/renderer/automationShell.js` — Update module metadata and data builders
5. `src/preload/preload.js` — Add new bridge APIs for theme/settings
6. `src/main/appRuntime.js` — Add handlers for new features
7. `src/main/main.js` — Add new IPC handlers

## Plan

### Phase 1: Design System & Theme Engine
1. **CSS Variables** — Create a proper design token system with:
   - Dark theme (default) and light theme variables
   - Accent color variable (user-customizable)
   - Font size scale (user-customizable)
   - Spacing scale (8px grid)
   - Animation timing tokens (150-250ms)
   - No flashy gradients or RGB effects

2. **Theme Engine in app.js** — Theme toggle (dark/light), accent color picker, font size slider, compact/comfortable spacing toggle

3. **CSS Architecture** — Complete rewrite:
   - Remove all gradient backgrounds, glow effects, and decorative noise
   - Clean, flat surfaces with subtle borders
   - Proper 8px grid spacing
   - Smooth 150-250ms animations
   - Glass effects only where they improve clarity (modals, command palette)

### Phase 2: Layout Restructure
1. **Sidebar** — Linear-inspired:
   - Cleaner brand mark, no tagline
   - Workspace sections with module icons
   - Favorites section
   - Recent items section
   - Bottom: user settings, theme toggle

2. **Topbar** — Raycast-inspired:
   - Global search bar (Ctrl+Space)
   - Command palette button (Ctrl+K)  
   - Breadcrumbs
   - Window controls (existing macOS dots)

3. **Main Content Area** — Clean, minimal:
   - Remove all 14 cluttered capability sections from dashboard
   - Dashboard shows only: Running automations, Active scraper jobs, Email queue, Recent leads, Today's tasks, Calendar, System status, Background Jobs
   - Grid-based layout with resizable panels
   - Clean data tables with advanced filters

### Phase 3: New Features
1. **Command Palette (Ctrl+K)** — Modal overlay with searchable commands
2. **Global Search (Ctrl+Space)** — Search across leads, files, settings
3. **Background Jobs Panel** — Dedicated panel showing current task, queue, progress, pause/resume/retry/logs
4. **Developer Tools Panel** — Live logs, network monitor, database viewer, job inspector, error console
5. **Resizable Panels** — Drag handles between workspace sections
6. **Favorites & Recent Items** — Sidebar sections with storage
7. **Breadcrumbs** — Topbar navigation context

### Phase 4: Data Views
1. **Searchable Tables** — Fast, client-side search across all leads
2. **Advanced Filters** — Multi-condition filtering
3. **Multi-select & Bulk Actions** — Checkbox selection for batch operations
4. **Saved Filters** — Persist filter configurations
5. **Export Buttons** — CSV/JSON export
6. **Column Customization** — Show/hide/reorder columns

### Phase 5: Polish
1. **Keyboard Shortcuts** — Every action should have a shortcut, displayed in UI
2. **Right-click Context Menus** — For leads, files, tabs
3. **Undo/Redo** — For lead updates and actions
4. **Autosave Indicator** — Visual feedback
5. **Global Notifications** — Non-intrusive toast system
6. **Download Manager** — Track exports and file downloads

## Dependent Files to be Edited
- `src/renderer/index.html` — HTML structure
- `src/renderer/styles/main.css` — Complete CSS redesign
- `src/renderer/app.js` — UI logic & interactions
- `src/renderer/automationShell.js` — Module data updates
- `src/preload/preload.js` — New bridge APIs
- `src/main/appRuntime.js` — New feature handlers
- `src/main/main.js` — New IPC channels

## Followup Steps
1. Test the app with `npm start` after changes
2. Verify theme switching works (dark/light)
3. Verify command palette and global search
4. Verify all keyboard shortcuts
5. Test resizable panels
6. Verify background jobs panel functionality

