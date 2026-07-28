import type { CSSProperties } from 'react';
import { Command, Settings, PanelRight, Search } from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import ipc from '../../lib/ipc';

const dragStyle: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export default function Topbar() {
  const {
    activeModule,
    setCommandPaletteOpen,
    setGlobalSearchOpen,
    setSettingsOpen,
    toggleRightPanel,
    rightPanelOpen,
  } = useUIStore();

  const moduleLabels: Record<string, string> = {
    home: 'Home',
    dashboard: 'Dashboard',
    leads: 'Leads',
    browser: 'Browser',
    email: 'Email',
    automations: 'Automations',
    jobs: 'Jobs',
    rules: 'Rules',
    files: 'Files',
    search: 'Search',
    settings: 'Settings',
    devtools: 'Dev Tools',
    notifications: 'Notifications',
  };

  return (
    <header className="topbar" style={dragStyle}>
      <div className="topbar-left">
        {/* Breadcrumbs */}
        <div className="breadcrumbs">
          <span className="breadcrumb-item">Agency OS</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-item current">
            {moduleLabels[activeModule] || activeModule}
          </span>
        </div>
      </div>

      {/* Center - Global Search Trigger */}
      <div className="topbar-center" style={noDragStyle}>
        <button
          className="global-search-trigger"
          onClick={() => setGlobalSearchOpen(true)}
        >
          <span className="search-icon"><Search size={14} strokeWidth={1.75} /></span>
          <span className="search-placeholder">Search leads, modules, actions...</span>
          <span className="search-shortcut">
            <kbd>⌘</kbd> <kbd>Space</kbd>
          </span>
        </button>
      </div>

      {/* Right actions */}
      <div className="topbar-right" style={noDragStyle}>
        <button
          className="topbar-btn"
          onClick={() => setCommandPaletteOpen(true)}
          title="Command Palette (⌘K)"
        >
          <Command size={16} strokeWidth={1.75} />
        </button>
        <button
          className="topbar-btn"
          onClick={() => setSettingsOpen(true)}
          title="Settings (⌘,)"
        >
          <Settings size={16} strokeWidth={1.75} />
        </button>
        <button
          className={`topbar-btn ${rightPanelOpen ? 'active' : ''}`}
          onClick={toggleRightPanel}
          title="Toggle Right Panel (⌘J)"
        >
          <PanelRight size={16} strokeWidth={1.75} />
        </button>

        {/* Real window controls, styled as traffic lights — the app is
            frameless (src/main/main.js), so these are the only way to
            close/minimize/maximize the window. */}
        <div className="window-dots" style={{ marginLeft: 'var(--space-2)' }}>
          <button className="dot dot-yellow" onClick={() => ipc.windowMinimize()} title="Minimize" />
          <button className="dot dot-green" onClick={() => ipc.windowMaximize()} title="Maximize" />
          <button className="dot dot-red" onClick={() => ipc.windowClose()} title="Close" />
        </div>
      </div>
    </header>
  );
}
