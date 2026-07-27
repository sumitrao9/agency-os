# Agency OS — Complete Migration Plan

## Goal
Migrate from vanilla Electron + HTML/CSS/JS to a production-ready stack:
**React + Vite + TypeScript + Tailwind CSS + Zustand + Prisma + Playwright**

---

## Phase 0: Prerequisites & Scaffolding

### 0.1 Install new dependencies
- React 18, React DOM, React Router
- Vite, @vitejs/plugin-react
- TypeScript, @types/react, @types/react-dom
- Tailwind CSS v3, postcss, autoprefixer
- Zustand (state management)
- Prisma + better-sqlite3 (database)
- Playwright (browser automation)
- Radix UI primitives, Floating UI, Sonner (toasts)
- CMDK (command palette)
- react-resizable-panels, dnd-kit
- TanStack Table, React Hook Form, Zod
- Lucide React (icons)
- Framer Motion (animations)
- Pino, electron-log (logging)
- FlexSearch (local search)
- Nodemailer, IMAPFlow (email)
- Chokidar (file watching)
- node-schedule (scheduler)
- PQueue (job queue)
- Keytar (secure credential storage)
- Testing: Vitest, Playwright Test, @playwright/test
- Dev: ESLint, Prettier, husky, lint-staged, source-map-support

### 0.2 Project structure

```
agency-os/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Entry point
│   │   ├── ipc/                 # IPC handlers
│   │   │   ├── index.ts
│   │   │   ├── leads.ipc.ts
│   │   │   ├── email.ipc.ts
│   │   │   ├── scraper.ipc.ts
│   │   │   ├── settings.ipc.ts
│   │   │   ├── automation.ipc.ts
│   │   │   └── health.ipc.ts
│   │   ├── services/            # Main process services
│   │   │   ├── database.service.ts
│   │   │   ├── email.service.ts
│   │   │   ├── scraper.service.ts
│   │   │   ├── automation.service.ts
│   │   │   ├── discovery.service.ts
│   │   │   └── backup.service.ts
│   │   ├── windows/             # Window management
│   │   │   ├── main.window.ts
│   │   │   └── hidden.window.ts
│   │   └── utils/
│   │       ├── logger.ts
│   │       ├── store.ts         # electron-store / keytar wrapper
│   │       └── paths.ts
│   ├── preload/
│   │   ├── preload.ts           # Context bridge
│   │   └── api.ts               # API type definitions
│   ├── renderer/                # React frontend
│   │   ├── main.tsx             # Entry point
│   │   ├── App.tsx              # Root component with router
│   │   ├── index.html
│   │   ├── assets/
│   │   ├── components/          # Shared UI components
│   │   │   ├── ui/              # Radix-based primitives
│   │   │   ├── layout/          # Sidebar, Topbar, Panel
│   │   │   └── modules/         # Feature-specific components
│   │   ├── features/
│   │   │   ├── dashboard/       # Dashboard module
│   │   │   ├── leads/           # Lead Manager module
│   │   │   ├── browser/         # Browser Manager module
│   │   │   ├── email/           # Email Engine module
│   │   │   ├── scraper/         # Scraper Engine module
│   │   │   ├── automation/      # Automation Engine module
│   │   │   ├── jobs/            # Job Queue module
│   │   │   ├── rules/           # Rule Engine module (UI)
│   │   │   ├── files/           # File Manager module
│   │   │   ├── settings/       # Settings module
│   │   │   ├── search/         # Search module
│   │   │   ├── notifications/  # Notification Center
│   │   │   └── devtools/       # Developer Console
│   │   ├── stores/             # Zustand stores
│   │   │   ├── ui.store.ts     # Sidebar, theme, layout state
│   │   │   ├── leads.store.ts  # Lead data & selection
│   │   │   ├── email.store.ts  # Email state
│   │   │   ├── jobs.store.ts   # Background jobs state
│   │   │   └── settings.store.ts
│   │   ├── hooks/              # Custom React hooks
│   │   ├── lib/                # Utilities
│   │   │   ├── ipc.ts          # IPC wrapper
│   │   │   ├── constants.ts
│   │   │   └── validators.ts   # Zod schemas
│   │   └── styles/
│   │       └── globals.css     # Tailwind + design tokens
│   ├── shared/                 # Shared types (main + renderer)
│   │   ├── types.ts            # Lead, Email, Job types
│   │   ├── ipc-channels.ts     # IPC channel constants
│   │   └── validators.ts       # Shared Zod schemas
│   └── scraper/                # Scraper JS (kept from existing)
│       └── pageScraper.ts
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── seed.ts                 # Optional seed data
├── electron-builder.yml        # Build config
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── .eslintrc.cjs
├── .prettierrc
└── package.json
```

---

## Phase 1: Database Migration

### 1.1 Define Prisma schema
Map the existing SQLite schema (from database.js) to Prisma:

```prisma
model Lead {
  id            String   @id @default(cuid())
  businessName  String
  category      String?
  website       String?
  phone         String?
  email         String?
  address       String?
  googleMapsUrl String?
  rating        Float?
  reviewCount   Int?
  tags          String   @default("[]")     // JSON array
  priority      String   @default("B")
  leadSource    String   @default("chrome-extension")
  createdDate   DateTime @default(now())
  updatedDate   DateTime @updatedAt
  status        String   @default("New")
  owner         String?
  notes         String?
  history       String   @default("[]")     // JSON array
  customFields  String   @default("{}")     // JSON object
  dedupeKey     String?

  @@index([dedupeKey])
  @@index([status])
  @@index([createdDate])
}
```

### 1.2 Create DatabaseService
Replace database.js with Prisma-based service that:
- Initializes Prisma on app startup
- Handles connection lifecycle
- Migrates existing sql.js data if present
- Provides all CRUD operations

---

## Phase 2: IPC Layer

### 2.1 Define typed IPC channels
Replace string-based IPC with typed channels using a shared constants file.

### 2.2 Create typed preload API
Expose type-safe functions via contextBridge.

### 2.3 Create IPC handlers per module
One file per feature area (leads, email, scraper, etc.)

---

## Phase 3: Main Process Services

### 3.1 Database Service
- Prisma client wrapper
- Connection management
- Migration runner
- Backup service

### 3.2 Email Service
- SMTP transport (nodemailer)
- IMAP polling (IMAPFlow)
- Template rendering
- Send queue

### 3.3 Scraper Service
- Playwright browser controller
- Page scraping logic
- Location spoofing
- Auto-scan engine

### 3.4 Automation Service
- Job queue (PQueue)
- Scheduler (node-schedule)
- Worker threads
- Job persistence

### 3.5 Discovery Service
- Hidden window email discovery
- Website quality checking

### 3.6 Settings Service
- Keytar-based credential storage
- Config file management
- Theme/settings persistence

---

## Phase 4: Renderer (React Frontend)

### 4.1 Layout Components
- AppShell (root layout with sidebar + topbar + content)
- Sidebar (Linear-inspired, collapsible)
- Topbar (Raycast-inspired with search + breadcrumbs)
- RightPanel (background jobs / dev tools)
- ResizablePanelGroup (react-resizable-panels)

### 4.2 Feature Modules (each has: UI + Store + IPC integration)
1. **Dashboard** — Stats cards, active jobs, recent leads, calendar
2. **Lead Manager** — Searchable table, filters, bulk actions, detail panel
3. **Browser Manager** — Embedded webview, navigation, capture, auto-scan
4. **Email Engine** — Send panel, queue, templates, follow-ups
5. **Scraper Engine** — Configuration, run controls, results
6. **Automation Engine** — Rules builder, triggers, workflow editor
7. **Job Queue** — Active jobs, queue, logs, controls
8. **File Manager** — File browser, watch folders, actions
9. **Search** — Global search with FlexSearch
10. **Settings** — macOS-style settings panels
11. **Notifications** — Toast system (Sonner)
12. **Developer Console** — Live logs, network monitor, DB viewer

### 4.3 Shared UI Components
- Button, Input, Select, Toggle (Radix + Tailwind)
- DataTable (TanStack Table)
- CommandPalette (CMDK)
- Toast (Sonner)
- Modal/Dialog (Radix)
- ContextMenu (Radix)
- Dropdown (Radix)
- Badge, Tag, Chip
- EmptyState, LoadingSpinner
- ProgressBar
- Tabs
- Tooltip (Floating UI)

### 4.4 State Management (Zustand)
- `uiStore` — theme, sidebar state, active module, panel visibility
- `leadsStore` — leads list, selected lead, filters, search
- `emailStore` — account status, send queue, templates
- `jobsStore` — background jobs, queue, logs
- `settingsStore` — user preferences

---

## Phase 5: Feature Implementation Order

### Sprint 1: Foundation
- [ ] Project scaffold (Vite + React + TS + Tailwind)
- [ ] Electron main process with window management
- [ ] Prisma schema + database service
- [ ] IPC layer typed channels
- [ ] Preload typed API
- [ ] Basic AppShell layout (sidebar + topbar + content area)
- [ ] Theme system (dark/light)

### Sprint 2: Lead Management
- [ ] Lead Manager table view
- [ ] Lead detail panel
- [ ] Search + filters
- [ ] Status management
- [ ] Bulk actions

### Sprint 3: Browser & Scraping
- [ ] Embedded browser webview
- [ ] Navigation controls
- [ ] Lead capture
- [ ] Auto-scan engine
- [ ] Location spoofing

### Sprint 4: Email System
- [ ] SMTP configuration
- [ ] Template rendering
- [ ] Send email
- [ ] Follow-up engine
- [ ] Email queue

### Sprint 5: Automation & Jobs
- [ ] Job queue system
- [ ] Background workers
- [ ] Scheduler
- [ ] Job monitoring panel

### Sprint 6: Search & Discovery
- [ ] Global search (FlexSearch)
- [ ] Email discovery
- [ ] Website quality checking

### Sprint 7: Polish
- [ ] Command palette (CMDK)
- [ ] Context menus
- [ ] Keyboard shortcuts
- [ ] Toast notifications
- [ ] Developer console
- [ ] Settings panels
- [ ] Error handling

### Sprint 8: Testing & Build
- [ ] Unit tests (Vitest)
- [ ] Integration tests (Playwright Test)
- [ ] Electron-builder config
- [ ] CI pipeline

---

## File Migration Map

| Current File | New Location | Notes |
|-------------|-------------|-------|
| `src/main/main.js` | `src/main/index.ts` | Rewrite as TypeScript, use window manager |
| `src/main/appRuntime.js` | Split into `src/main/services/*` | Each service gets its own file |
| `src/main/connectorServer.js` | `src/main/services/connector.service.ts` | Keep HTTP server, but integrate with Prisma |
| `src/main/emailDiscovery.js` | `src/main/services/discovery.service.ts` | Use hidden window service |
| `src/main/healthCheck.js` | `src/main/services/health.service.ts` | Rewrite with proper logging |
| `src/db/database.js` | `prisma/schema.prisma` + `src/main/services/database.service.ts` | Replace sql.js with Prisma |
| `src/email/templates.js` | `src/main/services/email-templates.service.ts` | Keep templates, add TypeScript types |
| `src/email/mailer.js` | `src/main/services/email.service.ts` | Rewrite with IMAP support |
| `src/rules/ruleEngine.js` | `src/shared/rules/` | Keep as shared module (no dependencies) |
| `src/scraper/pageScraper.js` | `src/scraper/pageScraper.ts` | Keep extraction logic, convert to TS |
| `src/preload/preload.js` | `src/preload/preload.ts` + `src/preload/api.ts` | Typed bridge |
| `src/renderer/index.html` | `src/renderer/index.html` | Minimal Vite entry |
| `src/renderer/app.js` | `src/renderer/features/*` + `src/renderer/stores/*` | Split into modules |
| `src/renderer/automationShell.js` | `src/renderer/features/dashboard/shell.ts` | Part of dashboard module |
| `src/renderer/styles/main.css` | `src/renderer/styles/globals.css` | Tailwind + design tokens |
| `src/renderer/webviewPreload.js` | `src/preload/webview-preload.ts` | Keep as-is, add TypeScript |

---

## Data Migration

When first run, the new app will:
1. Check for existing `agency-os.sqlite` file in userData
2. If found, read all data via sql.js (existing module temporarily kept)
3. Write to new Prisma-managed database
4. Rename old file to `agency-os.sqlite.bak`
5. Delete old sql.js dependency after successful migration

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Data loss during migration | Backup old DB first, verify row counts match |
| Playwright dependency size | Lazy-load, only install if browser automation used |
| React bundle size | Code-split by route, lazy-load feature modules |
| Electron security | Strict CSP, context isolation, no nodeIntegration |
| IPC type mismatch | Shared TypeScript interfaces, runtime validation with Zod |
| Build failures | CI pipeline with lint + test + build steps |

