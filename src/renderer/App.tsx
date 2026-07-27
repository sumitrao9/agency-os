import { useEffect, useCallback } from 'react';
import { useUIStore } from './stores/ui.store';
import { useLeadsStore } from './stores/leads.store';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import Workspace from './components/layout/Workspace';
import RightPanel from './components/layout/RightPanel';
import CommandPalette from './features/search/CommandPalette';
import GlobalSearchModal from './features/search/GlobalSearchModal';
import SettingsModal from './features/SettingsModal';
import ToastContainer from './components/ToastContainer';
import MissionOverlay from './features/dashboard/MissionOverlay';
import ipc from './lib/ipc';
import type { ThemeMode, SpacingMode } from '@shared/types';

export default function App() {
  const {
    sidebarCollapsed,
    rightPanelOpen,
    commandPaletteOpen,
    globalSearchOpen,
    settingsOpen,
    setCommandPaletteOpen,
    setGlobalSearchOpen,
    setSettingsOpen,
    setActiveModule,
    toggleSidebar,
    toggleRightPanel,
    addToast,
    applyThemeSettings,
  } = useUIStore();

  const { refreshLeads } = useLeadsStore();

  // Paint with the cached theme immediately, then reconcile with the
  // durable copy on disk (theme.json) once IPC answers.
  useEffect(() => {
    applyThemeSettings({
      mode: (localStorage.getItem('theme-mode') as ThemeMode) || 'dark',
      accentHue: parseInt(localStorage.getItem('accent-h') || '140'),
      accentSaturation: parseInt(localStorage.getItem('accent-s') || '100'),
      accentLightness: parseInt(localStorage.getItem('accent-l') || '70'),
      fontSize: parseInt(localStorage.getItem('font-size') || '13'),
      spacing: (localStorage.getItem('spacing') as SpacingMode) || 'comfortable',
    });

    let cancelled = false;
    (async () => {
      try {
        const saved = await ipc.getThemeSettings();
        if (!cancelled && saved) applyThemeSettings(saved);
      } catch {
        // Cached theme already applied — nothing further to do.
      }
    })();
    return () => { cancelled = true; };
  }, [applyThemeSettings]);

  // Load leads on init, then keep them fresh.
  useEffect(() => {
    refreshLeads();
    const interval = setInterval(refreshLeads, 15000);
    return () => clearInterval(interval);
  }, [refreshLeads]);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const cmdOrCtrl = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl + K -> Command Palette
    if (cmdOrCtrl && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(!commandPaletteOpen);
    }

    // Cmd/Ctrl + Space -> Global Search
    if (cmdOrCtrl && e.key === ' ') {
      e.preventDefault();
      setGlobalSearchOpen(!globalSearchOpen);
    }

    // Cmd/Ctrl + , -> Settings
    if (cmdOrCtrl && e.key === ',') {
      e.preventDefault();
      setSettingsOpen(!settingsOpen);
    }

    // Cmd/Ctrl + \ -> Toggle Sidebar
    if (cmdOrCtrl && e.key === '\\') {
      e.preventDefault();
      toggleSidebar();
    }

    // Cmd/Ctrl + J -> Toggle Right Panel
    if (cmdOrCtrl && e.key === 'j') {
      e.preventDefault();
      toggleRightPanel();
    }

    // Escape closes modals
    if (e.key === 'Escape') {
      if (commandPaletteOpen) setCommandPaletteOpen(false);
      else if (globalSearchOpen) setGlobalSearchOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
    }

    // Number shortcuts for modules
    if (cmdOrCtrl && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      // Mirrors the sidebar's nav order so ⌘1-9 matches what the user sees.
      // Settings is a modal (⌘,), not a module — routing to it here would
      // silently fall through to the dashboard.
      const modules = ['dashboard', 'leads', 'browser', 'email', 'automations', 'jobs', 'rules', 'files'] as const;
      const idx = parseInt(e.key) - 1;
      if (idx < modules.length) setActiveModule(modules[idx]);
    }
  }, [commandPaletteOpen, globalSearchOpen, settingsOpen, setCommandPaletteOpen, setGlobalSearchOpen, setSettingsOpen, setActiveModule, toggleSidebar, toggleRightPanel]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-detected replies push straight to a toast — the whole point of
  // reply tracking is that the user never has to go looking for it.
  useEffect(() => {
    const unsubscribe = ipc.onNewReplies((replies) => {
      replies.forEach((r) => addToast(`${r.businessName} replied: "${r.snippet.slice(0, 80)}"`, 'success', 10000));
      refreshLeads();
    });
    return unsubscribe;
  }, [addToast, refreshLeads]);

  // A newly captured lead gets scanned, scored, and email-discovered
  // automatically in the background (see autoEnrichNewLead in
  // appRuntime.js) — this just refreshes the table when that finishes, so
  // score/email fill in without the user having to click anything.
  useEffect(() => {
    const unsubscribe = ipc.onLeadAutoEnriched(() => refreshLeads());
    return unsubscribe;
  }, [refreshLeads]);

  // Health check on startup
  useEffect(() => {
    (async () => {
      try {
        const health = await ipc.getHealth();
        if (health && !health.ok) {
          const issues = health.results.filter((r) => !r.ok).map((r) => `${r.check}: ${r.detail}`).join(' · ');
          addToast(`System issues: ${issues}`, 'warning', 8000);
        }
      } catch {
        // Non-critical
      }
    })();
  }, [addToast]);

  // Background auto-updater: checked once on main-process startup (see
  // setupAutoUpdater in main.js). Downloads happen silently; the app installs
  // the update automatically on the next natural quit, so this is a
  // heads-up, not an action the user has to take.
  useEffect(() => {
    const unsubscribe = ipc.onUpdaterStatus((status) => {
      if (status.state === 'available') addToast(`Update ${status.version} found — downloading in the background…`, 'info', 6000);
      else if (status.state === 'downloaded') addToast(`Update ${status.version} downloaded — installs next time you restart AgencyOS.`, 'success', 10000);
      else if (status.state === 'error') addToast(`Update check failed: ${status.message}`, 'warning', 6000);
    });
    return unsubscribe;
  }, [addToast]);

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}
    >
      <Sidebar />
      <div className="workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar />
        <Workspace />
      </div>
      {rightPanelOpen && <RightPanel />}

      {/* Modals */}
      {commandPaletteOpen && <CommandPalette />}
      {globalSearchOpen && <GlobalSearchModal />}
      {settingsOpen && <SettingsModal />}

      {/* Mission Overlay - shown on first launch */}
      <MissionOverlay />

      {/* Notifications */}
      <ToastContainer />
    </div>
  );
}
