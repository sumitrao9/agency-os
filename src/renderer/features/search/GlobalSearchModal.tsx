import { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '../../stores/ui.store';
import { useLeadsStore } from '../../stores/leads.store';
import type { Lead } from '@shared/types';

export default function GlobalSearchModal() {
  const { globalSearchOpen, setGlobalSearchOpen, setActiveModule } = useUIStore();
  const { leads, selectLead } = useLeadsStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Lead[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (globalSearchOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [globalSearchOpen]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    const q = value.toLowerCase();
    const filtered = leads.filter(l => {
      return [l.businessName, l.phone, l.email, l.website, l.category, l.notes, l.address, l.status]
        .some(f => (f || '').toLowerCase().includes(q));
    });
    setResults(filtered.slice(0, 20));
    setSelectedIndex(0);
  }, [leads]);

  const handleSelect = useCallback((lead: Lead) => {
    selectLead(lead.id);
    setActiveModule('leads');
    setGlobalSearchOpen(false);
  }, [selectLead, setActiveModule, setGlobalSearchOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setGlobalSearchOpen(false);
    }
  }, [results, selectedIndex, handleSelect, setGlobalSearchOpen]);

  if (!globalSearchOpen) return null;

  return (
    <div className="modal-overlay open" onClick={() => setGlobalSearchOpen(false)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-search">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search leads across all fields..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="modal-list">
          {results.map((lead, i) => (
            <div
              key={lead.id}
              className={`modal-list-item ${i === selectedIndex ? 'active' : ''}`}
              onClick={() => handleSelect(lead)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="item-icon">⊞</div>
              <div className="item-info">
                <div className="item-title">{lead.businessName}</div>
                <div className="item-desc">
                  {lead.category && `${lead.category} · `}
                  {lead.email || lead.phone || 'No contact'}
                  {lead.status && ` · ${lead.status}`}
                </div>
              </div>
            </div>
          ))}
          {query && results.length === 0 && (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No leads match "{query}"
            </div>
          )}
          {!query && (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Type to search across all leads
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
