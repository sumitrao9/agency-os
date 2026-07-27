import { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '../../stores/ui.store';
import ipc from '../../lib/ipc';
import type { ModuleName } from '@shared/types';

interface CommandItem {
  id: string;
  label: string;
  desc: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

export default function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, setActiveModule, setGlobalSearchOpen, setSettingsOpen, toggleSidebar, toggleRightPanel, addToast } = useUIStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = [
    { id: 'go-dashboard', label: 'Go to Dashboard', desc: 'View your business overview', icon: '◉', shortcut: '⌘1', action: () => { setActiveModule('dashboard' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-leads', label: 'Go to Leads', desc: 'Manage your lead pipeline', icon: '⊞', shortcut: '⌘2', action: () => { setActiveModule('leads' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-browser', label: 'Go to Browser + Scraper', desc: 'Investigate businesses, browse, or run a mass scrape', icon: '⊙', shortcut: '⌘3', action: () => { setActiveModule('browser' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-email', label: 'Go to Email', desc: 'Email outreach and templates', icon: '✉', shortcut: '⌘4', action: () => { setActiveModule('email' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-automations', label: 'Go to Automations', desc: 'Automation workflows', icon: '▶', shortcut: '⌘5', action: () => { setActiveModule('automations' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-jobs', label: 'Go to Jobs', desc: 'Background job queue', icon: '◷', shortcut: '⌘6', action: () => { setActiveModule('jobs' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-rules', label: 'Go to Rules', desc: 'Rule engine configuration', icon: '⚙', shortcut: '⌘7', action: () => { setActiveModule('rules' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-files', label: 'Go to Files', desc: 'File management and exports', icon: '📁', shortcut: '⌘8', action: () => { setActiveModule('files' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-notifications', label: 'Go to Notifications', desc: 'System notifications and alerts', icon: '🔔', action: () => { setActiveModule('notifications' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'go-devtools', label: 'Go to Dev Tools', desc: 'System diagnostics', icon: '⎔', action: () => { setActiveModule('devtools' as ModuleName); setCommandPaletteOpen(false); } },
    { id: 'search', label: 'Search leads...', desc: 'Full-text search across all leads', icon: '🔍', shortcut: '⌘Space', action: () => { setGlobalSearchOpen(true); setCommandPaletteOpen(false); } },
    { id: 'settings', label: 'Open Settings', desc: 'Configure application settings', icon: '⚡', shortcut: '⌘,', action: () => { setSettingsOpen(true); setCommandPaletteOpen(false); } },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', desc: 'Show or hide the sidebar', icon: '☰', shortcut: '⌘\\', action: () => { toggleSidebar(); setCommandPaletteOpen(false); } },
    { id: 'toggle-panel', label: 'Toggle Right Panel', desc: 'Show or hide the right panel', icon: '◧', shortcut: '⌘J', action: () => { toggleRightPanel(); setCommandPaletteOpen(false); } },
    { id: 'export-csv', label: 'Export All Leads (CSV)', desc: 'Save every lead to a CSV file', icon: '⬇', action: async () => {
      setCommandPaletteOpen(false);
      const r = await ipc.exportLeadsCsv();
      addToast(r.ok ? `Exported ${r.count} lead(s)` : (r.error || 'Export failed'), r.ok ? 'success' : 'error');
    } },
  ];

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
    } else if (e.key === 'Escape') {
      setCommandPaletteOpen(false);
    }
  }, [filtered, selectedIndex, setCommandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  return (
    <div className="modal-overlay open" onClick={() => setCommandPaletteOpen(false)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-search">
          <span className="search-icon">⌘</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
          />
          <div className="modal-shortcuts">
            <kbd>↑</kbd> <kbd>↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>esc</kbd> close
          </div>
        </div>
        <div className="modal-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`modal-list-item ${i === selectedIndex ? 'active' : ''}`}
              onClick={cmd.action}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="item-icon">{cmd.icon}</div>
              <div className="item-info">
                <div className="item-title">{cmd.label}</div>
                <div className="item-desc">{cmd.desc}</div>
              </div>
              {cmd.shortcut && (
                <div className="item-shortcut">
                  {cmd.shortcut.split(' ').map((key, j) => <kbd key={j}>{key}</kbd>)}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No commands found
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span>Type to filter commands</span>
          <span><kbd>⌘K</kbd> to toggle</span>
        </div>
      </div>
    </div>
  );
}
