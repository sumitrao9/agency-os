import * as React from 'react';
import {
  Home, LayoutDashboard, Users, Globe, Mail, Zap, Clock, SlidersHorizontal,
  Folder, Bell, Search, Settings, Terminal, type LucideIcon,
} from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import { useLeadsStore } from '../../stores/leads.store';
import type { ModuleName } from '@shared/types';

interface SidebarNavItem {
  id: ModuleName;
  label: string;
  icon: LucideIcon;
}

// One consistent line-icon set (Lucide — same family used by Linear/Raycast-
// style apps) instead of the previous mix of Unicode glyphs + emoji, which
// is exactly what read as "some icons match, some don't."
const navItems: SidebarNavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads', icon: Users },
  { id: 'browser', label: 'Browser + Scraper', icon: Globe },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'jobs', label: 'Jobs', icon: Clock },
  { id: 'rules', label: 'Rules', icon: SlidersHorizontal },
  { id: 'files', label: 'Files', icon: Folder },
];

const bottomItems: SidebarNavItem[] = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'devtools', label: 'Dev Tools', icon: Terminal },
];

export default function Sidebar() {
  const { sidebarCollapsed, activeModule, setActiveModule, setGlobalSearchOpen, setSettingsOpen } = useUIStore();
  const leadCount = useLeadsStore((s) => s.leads.length);

  const handleNavClick = (item: SidebarNavItem) => {
    if (item.id === 'search') { setGlobalSearchOpen(true); return; }
    if (item.id === 'settings') { setSettingsOpen(true); return; }
    setActiveModule(item.id as ModuleName);
  };

  return (
    <aside className="sidebar" style={{
      width: sidebarCollapsed ? 52 : 240,
      minWidth: sidebarCollapsed ? 52 : 240,
      display: 'flex',
      flexDirection: 'column',
      padding: 'var(--space-3)',
      gap: 'var(--space-1)',
      transition: 'width var(--anim-normal), min-width var(--anim-normal)',
      overflow: 'hidden',
    }}>
      {/* Brand */}
      <div onClick={() => setActiveModule('home')} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)', marginBottom: 'var(--space-3)', cursor: 'pointer' }}>
        <div style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, var(--accent), var(--cyan))', boxShadow: 'var(--accent-glow)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 'var(--font-size-sm)', flexShrink: 0 }}>A</div>
        {!sidebarCollapsed && <h1 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, margin: 0 }}>Agency OS</h1>}
      </div>

      {/* Nav items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeModule === item.id;
          return (
            <button key={item.id} className={`nav-item${isActive ? ' active' : ''}`} onClick={() => handleNavClick(item)} title={sidebarCollapsed ? item.label : undefined}>
              <span className="nav-icon">
                <Icon size={17} strokeWidth={isActive ? 2.25 : 1.75} />
              </span>
              {!sidebarCollapsed && (
                <>
                  <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
                  {item.id === 'leads' && leadCount > 0 && (
                    <span className="nav-badge">{leadCount}</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Footer section */}
      <div style={{ marginTop: 'auto', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {bottomItems.map((item) => {
          const Icon = item.icon;
          // 'search' and 'settings' open modals rather than navigate, so they
          // never carry the active state — only 'notifications'/'devtools' can.
          const isActive = activeModule === item.id;
          return (
            <button key={item.id} className={`nav-item${isActive ? ' active' : ''}`} onClick={() => handleNavClick(item)} title={sidebarCollapsed ? item.label : undefined}>
              <span className="nav-icon">
                <Icon size={17} strokeWidth={isActive ? 2.25 : 1.75} />
              </span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)', height: 32 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0, boxShadow: '0 0 6px var(--green)' }} />
          {!sidebarCollapsed && <span>All systems OK</span>}
        </div>
      </div>
    </aside>
  );
}
