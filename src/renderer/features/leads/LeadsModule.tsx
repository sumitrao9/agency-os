import { useState, useEffect, useCallback, useRef } from 'react';
import { useLeadsStore } from '../../stores/leads.store';
import { useUIStore } from '../../stores/ui.store';
import ipc from '../../lib/ipc';
import type { BulkJobStatus } from '@shared/types';
import LeadCard from './LeadCard';
import KanbanBoard from './KanbanBoard';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useVirtualizer } from '@tanstack/react-virtual';

const STATUS_OPTIONS = ['New', 'Qualified', 'Sent', 'Replied', 'Interested', 'Call Scheduled', 'Won', 'Lost'];
const SAVED_FILTERS_KEY = 'leads-saved-filters';

interface LastReply {
  snippet: string;
  receivedAt: string;
  subject: string;
}

interface SavedFilter {
  name: string;
  searchQuery: string;
  statusFilter: string;
  priorityFilter: string;
  hideLowQuality: boolean;
}

function loadSavedFilters(): SavedFilter[] {
  try { return JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '[]'); } catch { return []; }
}

export default function LeadsModule() {
  const { leads, searchQuery, setSearchQuery, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, loading, refreshLeads, selectLead, selectedLeadId, updateLeadInStore } = useLeadsStore();
  const { addToast, setActiveModule, setComposeLeadId, setBrowserNavUrl } = useUIStore();
  const selectedLead = leads.find(l => l.id === selectedLeadId) || null;
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [deepScanning, setDeepScanning] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotStatus, setScreenshotStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hideLowQuality, setHideLowQuality] = useState(false);
  const [minCloseProbability, setMinCloseProbability] = useState(0);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters());
  const [bulkJob, setBulkJob] = useState<BulkJobStatus | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards' | 'kanban'>('table');
  const bulkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    refreshLeads();
  }, [refreshLeads]);

  useEffect(() => {
    setNotesDraft(selectedLead?.notes || '');
    // Only resync on lead switch, not on every store update — otherwise an
    // in-flight store refresh would clobber notes the user is mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

  useEffect(() => {
    setScreenshotUrl(null);
    setScreenshotStatus('idle');
    const scan = selectedLead?.customFields?.deepScan as { screenshotPath?: string } | undefined;
    if (!selectedLead || !scan?.screenshotPath) return;
    let cancelled = false;
    setScreenshotStatus('loading');
    const timeout = setTimeout(() => {
      if (!cancelled) setScreenshotStatus((s) => (s === 'loading' ? 'unavailable' : s));
    }, 8000);
    ipc.getLeadScreenshot(selectedLead.id).then((r) => {
      if (cancelled) return;
      if (r.ok && r.dataUrl) {
        setScreenshotUrl(r.dataUrl);
        setScreenshotStatus('ready');
      } else {
        setScreenshotStatus('unavailable');
      }
    }).catch(() => {
      if (!cancelled) setScreenshotStatus('unavailable');
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [selectedLead?.id, selectedLead?.customFields?.deepScan]);

  const handleSelectLead = useCallback((id: string) => {
    selectLead(id);
  }, [selectLead]);

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    updateLeadInStore(id, { status });
    await ipc.updateLead(id, { status });
  }, [updateLeadInStore]);

  const handleSaveNotes = useCallback(async () => {
    if (!selectedLead) return;
    setNotesSaving(true);
    try {
      updateLeadInStore(selectedLead.id, { notes: notesDraft });
      await ipc.updateLead(selectedLead.id, { notes: notesDraft });
    } finally {
      setNotesSaving(false);
    }
  }, [selectedLead, notesDraft, updateLeadInStore]);

  const handleCheckReplies = useCallback(async () => {
    setCheckingReplies(true);
    try {
      const result = await ipc.checkReplies();
      if (result.newReplies.length) {
        result.newReplies.forEach((r) => addToast(`${r.businessName} replied`, 'success'));
        refreshLeads();
      } else {
        addToast('No new replies', 'info');
      }
    } catch (e) {
      addToast(`Reply check failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setCheckingReplies(false);
    }
  }, [addToast, refreshLeads]);

  const handleDelete = useCallback(async () => {
    if (!selectedLead) return;
    await ipc.deleteLead(selectedLead.id);
    selectLead(null);
    refreshLeads();
  }, [selectedLead, selectLead, refreshLeads]);

  const handleOneClickEmail = useCallback(() => {
    if (!selectedLead) return;
    setComposeLeadId(selectedLead.id);
    setActiveModule('email');
  }, [selectedLead, setComposeLeadId, setActiveModule]);

  const handleOpenWebsite = useCallback(() => {
    if (!selectedLead?.website) return;
    const url = selectedLead.website.startsWith('http') ? selectedLead.website : `https://${selectedLead.website}`;
    setBrowserNavUrl(url);
    setActiveModule('browser');
  }, [selectedLead, setBrowserNavUrl, setActiveModule]);

  const handleCopyContact = useCallback(async () => {
    if (!selectedLead) return;
    const parts = [selectedLead.businessName, selectedLead.email, selectedLead.phone].filter(Boolean);
    await navigator.clipboard.writeText(parts.join(' | '));
    addToast('Contact copied', 'success');
  }, [selectedLead, addToast]);

  const handleOpenMaps = useCallback(() => {
    if (!selectedLead) return;
    const url = selectedLead.googleMapsUrl || `https://www.google.com/maps/search/${encodeURIComponent(`${selectedLead.businessName} ${selectedLead.address || ''}`)}`;
    setBrowserNavUrl(url);
    setActiveModule('browser');
  }, [selectedLead, setBrowserNavUrl, setActiveModule]);

  const handleAddToCampaign = useCallback(async () => {
    if (!selectedLead) return;
    const result = await ipc.addToQueue(selectedLead.id);
    addToast(result.ok ? 'Added to action queue' : (result.error || 'Failed to add to queue'), result.ok ? 'success' : 'error');
  }, [selectedLead, addToast]);

  const handleDeepScan = useCallback(async () => {
    if (!selectedLead || !selectedLead.website) return;
    setDeepScanning(true);
    try {
      const result = await ipc.deepScan(selectedLead.id, selectedLead.website);
      if (result.ok) {
        addToast('Deep scan complete', 'success');
        refreshLeads();
      } else {
        addToast(result.error || 'Deep scan failed', 'error');
      }
    } finally {
      setDeepScanning(false);
    }
  }, [selectedLead, addToast, refreshLeads]);

  const handleBlacklist = useCallback(async () => {
    if (!selectedLead) return;
    const result = await ipc.addToBlacklist({
      email: selectedLead.email || undefined,
      domain: selectedLead.website || undefined,
      phone: selectedLead.phone || undefined,
      reason: 'Blocked from Leads',
    });
    if (!result.ok) {
      addToast(result.error || 'Failed to add to do-not-contact list', 'error');
      return;
    }
    await ipc.deleteLead(selectedLead.id);
    selectLead(null);
    refreshLeads();
    addToast(`${selectedLead.businessName} added to do-not-contact list`, 'success');
  }, [selectedLead, selectLead, refreshLeads, addToast]);

  // Polls while a bulk job runs so progress is visibly live (current lead,
  // completed/total, errors) instead of the UI going quiet in the background.
  const pollBulkStatus = useCallback(() => {
    if (bulkPollRef.current) return;
    bulkPollRef.current = setInterval(async () => {
      const status = await ipc.bulkStatus();
      setBulkJob(status);
      if (status.status !== 'running') {
        if (bulkPollRef.current) { clearInterval(bulkPollRef.current); bulkPollRef.current = null; }
        refreshLeads();
      }
    }, 1000);
  }, [refreshLeads]);

  useEffect(() => () => { if (bulkPollRef.current) clearInterval(bulkPollRef.current); }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkEnrich = useCallback(async (force: boolean) => {
    if (!selectedIds.size) return;
    const result = await ipc.bulkStartDeepScan([...selectedIds], force);
    if (!result.ok) { addToast(result.error || 'Could not start bulk scan', 'error'); return; }
    setBulkJob({ status: 'running', total: selectedIds.size, completed: 0, errors: [] });
    pollBulkStatus();
  }, [selectedIds, addToast, pollBulkStatus]);

  const handleBulkCancel = useCallback(async () => { await ipc.bulkCancel(); }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedIds.size) return;
    await ipc.bulkDelete([...selectedIds]);
    setSelectedIds(new Set());
    refreshLeads();
    addToast('Selected leads deleted', 'success');
  }, [selectedIds, refreshLeads, addToast]);

  const handleBulkTag = useCallback(async () => {
    if (!selectedIds.size) return;
    const tag = window.prompt('Tag to apply to selected leads:');
    if (!tag) return;
    const result = await ipc.bulkTag([...selectedIds], tag);
    refreshLeads();
    addToast(`Tagged ${result.count || 0} lead(s)`, 'success');
  }, [selectedIds, refreshLeads, addToast]);

  const handleBulkExport = useCallback(async () => {
    if (!selectedIds.size) return;
    const result = await ipc.exportLeadsCsv([...selectedIds]);
    addToast(result.ok ? `Exported ${result.count} lead(s)` : (result.error || 'Export failed'), result.ok ? 'success' : 'error');
  }, [selectedIds, addToast]);

  const saveCurrentFilter = useCallback(() => {
    const name = window.prompt('Name this filter:');
    if (!name) return;
    const next = [...savedFilters.filter((f) => f.name !== name), { name, searchQuery, statusFilter, priorityFilter, hideLowQuality }];
    setSavedFilters(next);
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(next));
  }, [savedFilters, searchQuery, statusFilter, priorityFilter, hideLowQuality]);

  const applyFilter = useCallback((f: SavedFilter) => {
    setSearchQuery(f.searchQuery);
    setStatusFilter(f.statusFilter);
    setPriorityFilter(f.priorityFilter);
    setHideLowQuality(f.hideLowQuality);
  }, [setSearchQuery, setStatusFilter, setPriorityFilter]);

  const filteredLeads = leads.filter(l => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matches = [l.businessName, l.phone, l.email, l.website, l.category, l.notes, l.address, l.status]
        .some(f => (f || '').toLowerCase().includes(q));
      if (!matches) return false;
    }
    if (statusFilter && l.status !== statusFilter) return false;
    if (priorityFilter) {
      const cached = useLeadsStore.getState().leadPriorityCache[l.id];
      if (!cached || cached.ruled.priority !== priorityFilter) return false;
    }
    if (hideLowQuality) {
      const total = (l.customFields?.scoring as { total?: number } | undefined)?.total;
      if (total != null && total < 60) return false;
    }
    if (minCloseProbability > 0) {
      const cached = useLeadsStore.getState().leadPriorityCache[l.id];
      if (!cached || cached.ruled.closeProbability < minCloseProbability) return false;
    }
    return true;
  });

  const scoreOf = (l: typeof leads[number]) => (l.customFields?.scoring as { total?: number } | undefined)?.total;
  const scoredValues = leads.map(scoreOf).filter((s): s is number => typeof s === 'number').sort((a, b) => b - a);
  const top10Threshold = scoredValues.length ? scoredValues[Math.max(0, Math.ceil(scoredValues.length * 0.1) - 1)] : null;

  // Virtualized rows — renders only what's on screen (plus overscan) instead
  // of a hard 100-row cap, so the table stays fast at 10,000+ leads without
  // silently hiding everything past row 100.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredLeads.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length ? virtualTotalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="leads-module" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-3)' }}>
      <div className="module-header">
        <div className="module-header-info">
          <h2>Leads</h2>
          <p>{leads.length} total leads · {filteredLeads.length} filtered</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="table-toolbar">
        <input
          className="search-input"
          type="text"
          placeholder="Search leads..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="New">New</option>
          <option value="Qualified">Qualified</option>
          <option value="Sent">Sent</option>
          <option value="Replied">Replied</option>
          <option value="Interested">Interested</option>
          <option value="Call Scheduled">Call Scheduled</option>
          <option value="Won">Won</option>
          <option value="Lost">Lost</option>
        </select>
        <select className="filter-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All Priority</option>
          <option value="A">Priority A</option>
          <option value="B">Priority B</option>
          <option value="C">Priority C</option>
        </select>
        {savedFilters.length > 0 && (
          <select
            className="filter-select"
            value=""
            onChange={(e) => { const f = savedFilters.find((sf) => sf.name === e.target.value); if (f) applyFilter(f); }}
          >
            <option value="">Saved filters…</option>
            {savedFilters.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={hideLowQuality} onChange={(e) => setHideLowQuality(e.target.checked)} />
          Hide low-quality (&lt;60)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
          Min close %
          <input
            type="number" min="0" max="100" step="10" value={minCloseProbability || ''}
            placeholder="0"
            onChange={(e) => setMinCloseProbability(parseInt(e.target.value) || 0)}
            style={{ width: 48, height: 24, padding: '0 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          />
        </label>
        <div className="toolbar-actions">
          <button className="btn-secondary" onClick={() => setViewMode(viewMode === 'table' ? 'cards' : viewMode === 'cards' ? 'kanban' : 'table')} title="Cycle table / cards / kanban view">
            {viewMode === 'table' ? '▦ Cards' : viewMode === 'cards' ? '📋 Kanban' : '☰ Table'}
          </button>
          <button className="btn-secondary" onClick={saveCurrentFilter} title="Save current search/filters">💾 Save Filter</button>
          <button className="btn-secondary" onClick={handleCheckReplies} disabled={checkingReplies}>
            {checkingReplies ? '⟳' : '✉'} Check Replies
          </button>
          <button className="btn-secondary" onClick={refreshLeads} disabled={loading}>
            {loading ? '⟳' : '↻'} Refresh
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="dashboard-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 'var(--font-size-sm)' }}>{selectedIds.size} selected</strong>
          <button className="btn-secondary" onClick={() => handleBulkEnrich(false)} disabled={bulkJob?.status === 'running'}>🔍 Enrich (cached)</button>
          <button className="btn-secondary" onClick={() => handleBulkEnrich(true)} disabled={bulkJob?.status === 'running'}>🔄 Re-scan (force)</button>
          <button className="btn-secondary" onClick={handleBulkExport}>⬇ Export</button>
          <button className="btn-secondary" onClick={handleBulkTag}>🏷 Tag</button>
          <button className="btn-secondary" onClick={handleBulkDelete} style={{ color: 'var(--red)' }}>🗑 Delete</button>
          <button className="btn-secondary" onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      {bulkJob && bulkJob.status !== 'idle' && (
        <div className="dashboard-card" style={{ fontSize: 'var(--font-size-xs)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>
              {bulkJob.status === 'running' ? `⚡ Enriching — ${bulkJob.completed}/${bulkJob.total}${bulkJob.currentLead ? ` · currently: ${bulkJob.currentLead}` : ''}` :
               bulkJob.status === 'done' ? `✓ Bulk enrichment done — ${bulkJob.completed}/${bulkJob.total} processed${bulkJob.errors.length ? `, ${bulkJob.errors.length} error(s)` : ''}` :
               `⏹ Cancelled — ${bulkJob.completed}/${bulkJob.total} processed`}
            </span>
            {bulkJob.status === 'running' && <button className="btn-icon" onClick={handleBulkCancel} title="Cancel">⏹</button>}
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${bulkJob.total ? (bulkJob.completed / bulkJob.total) * 100 : 0}%`, background: 'var(--accent)' }} />
          </div>
        </div>
      )}

      <PanelGroup direction="horizontal" style={{ flex: 1, minHeight: 0 }} autoSaveId="leads-split">
      <Panel minSize={40} defaultSize={selectedLead ? 70 : 100}>
      <div style={{ height: '100%', display: 'flex', gap: 'var(--space-3)', minHeight: 0 }}>
        {/* Lead Table / Cards */}
        {viewMode === 'kanban' ? (
          <KanbanBoard leads={filteredLeads} onStatusChange={handleStatusChange} onSelect={handleSelectLead} />
        ) : viewMode === 'cards' ? (
          <div className="leads-grid" style={{ flex: 1 }}>
            {filteredLeads.slice(0, 100).map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                ruled={useLeadsStore.getState().leadPriorityCache[lead.id]?.ruled}
                selected={selectedLeadId === lead.id}
                onSelect={() => handleSelectLead(lead.id)}
                checked={selectedIds.has(lead.id)}
                onToggleCheck={() => toggleSelected(lead.id)}
                onEmail={() => { setComposeLeadId(lead.id); setActiveModule('email'); }}
                onOpenWebsite={() => {
                  if (!lead.website) return;
                  const url = lead.website.startsWith('http') ? lead.website : `https://${lead.website}`;
                  setBrowserNavUrl(url);
                  setActiveModule('browser');
                }}
                onCopyContact={async () => {
                  await navigator.clipboard.writeText([lead.businessName, lead.email, lead.phone].filter(Boolean).join(' | '));
                  addToast('Contact copied', 'success');
                }}
                onOpenMaps={() => {
                  const url = lead.googleMapsUrl || `https://www.google.com/maps/search/${encodeURIComponent(`${lead.businessName} ${lead.address || ''}`)}`;
                  setBrowserNavUrl(url);
                  setActiveModule('browser');
                }}
                onCopyColdEmail={async () => {
                  const ruled = useLeadsStore.getState().leadPriorityCache[lead.id]?.ruled;
                  const templateName = ruled?.recommendedTemplate || 'default';
                  const rendered = await ipc.renderTemplate(templateName, lead);
                  if (!rendered.subject && !rendered.body) { addToast('Could not render a template for this lead', 'error'); return; }
                  await navigator.clipboard.writeText(`Subject: ${rendered.subject}\n\n${rendered.body}`);
                  addToast('Cold email copied — paste it into any mail client or DM', 'success');
                }}
                onOpenLinkedIn={(url) => { setBrowserNavUrl(url); setActiveModule('browser'); }}
              />
            ))}
            {filteredLeads.length === 0 && !loading && (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <div className="empty-icon">🗺</div>
                <div className="empty-title">No leads yet</div>
                <div className="empty-desc">Run the Scraper to pull in leads.</div>
              </div>
            )}
          </div>
        ) : (
        <div ref={tableScrollRef} style={{ flex: 1, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={filteredLeads.length > 0 && filteredLeads.every((l) => selectedIds.has(l.id))}
                    onChange={(e) => setSelectedIds(e.target.checked ? new Set(filteredLeads.map((l) => l.id)) : new Set())}
                  />
                </th>
                <th>Business Name</th>
                <th>Score</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Close %</th>
                <th>Est. Revenue</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Category</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && leads.length === 0 && Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} className="skeleton-row">
                  {Array.from({ length: 11 }).map((__, j) => (
                    <td key={j}><div className="skeleton skeleton-text" style={{ width: j === 1 ? '90%' : '60%' }} /></td>
                  ))}
                </tr>
              ))}
              {paddingTop > 0 && <tr aria-hidden><td colSpan={11} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>}
              {virtualRows.map((virtualRow) => {
                const lead = filteredLeads[virtualRow.index];
                if (!lead) return null;
                const cached = useLeadsStore.getState().leadPriorityCache[lead.id];
                const priority = cached?.ruled?.priority || lead.priority || 'B';
                const closeProbability = cached?.ruled?.closeProbability;
                const revenueLow = cached?.ruled?.revenueLow;
                const revenueHigh = cached?.ruled?.revenueHigh;
                const score = scoreOf(lead);
                const isTop10 = score != null && top10Threshold != null && score >= top10Threshold;
                return (
                  <tr
                    key={lead.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className={selectedLeadId === lead.id ? 'selected' : ''}
                    onClick={() => handleSelectLead(lead.id)}
                    style={{ cursor: 'pointer', background: isTop10 ? 'var(--accent-bg, rgba(255,200,0,0.06))' : undefined }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelected(lead.id)} />
                    </td>
                    <td style={{ fontWeight: 500 }}>{isTop10 && '🔥 '}{lead.businessName}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{score != null ? `${score}/100` : '—'}</td>
                    <td><span className={`badge badge-${lead.status === 'New' ? 'blue' : lead.status === 'Sent' ? 'yellow' : lead.status === 'Replied' ? 'green' : lead.status === 'Won' ? 'green' : lead.status === 'Lost' ? 'red' : 'accent'}`}>{lead.status}</span></td>
                    <td><span className={`badge priority-${priority}`}>{priority}</span></td>
                    <td>
                      {closeProbability != null ? (
                        <span className={`badge badge-${closeProbability >= 80 ? 'green' : closeProbability >= 50 ? 'yellow' : 'accent'}`}>{closeProbability}%</span>
                      ) : '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                      {revenueLow != null && revenueHigh != null ? `${revenueLow.toLocaleString()}–${revenueHigh.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {lead.email ? (
                        <>
                          {(() => {
                            const status = (lead.customFields?.emailVerification as { status?: string } | undefined)?.status;
                            return <span title={status === 'VALID' ? 'Domain has mail servers' : status === 'INVALID' ? 'No mail servers — likely undeliverable' : 'Not yet verified'}>{status === 'VALID' ? '🟢 ' : status === 'INVALID' ? '🔴 ' : '🟡 '}</span>;
                          })()}
                          {lead.email}
                        </>
                      ) : '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{lead.phone || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{lead.category || '—'}</td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>{lead.createdDate?.slice(0, 10) || '—'}</td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && <tr aria-hidden><td colSpan={11} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>}
              {!loading && filteredLeads.length === 0 && (
                <tr>
                  <td colSpan={11}>
                    <div className="empty-state">
                      <div className="empty-icon">{leads.length === 0 ? '🗺' : '🔍'}</div>
                      <div className="empty-title">{leads.length === 0 ? 'No leads yet' : 'No leads match your filters'}</div>
                      <div className="empty-desc">
                        {leads.length === 0
                          ? 'Run the Scraper to pull in leads from Google Maps, Yelp, and other directories.'
                          : 'Try clearing the search, status, or priority filters.'}
                      </div>
                      {leads.length === 0 && (
                        <div className="empty-state-suggestions">
                          {['Dentist', 'Restaurant', 'Gym', 'Photographer', 'Salon'].map((n) => (
                            <button key={n} className="empty-state-suggestion" onClick={() => setActiveModule('browser')}>{n}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
      </Panel>

      {selectedLead && (
        <>
          <PanelResizeHandle className="resize-handle-v" />
          <Panel minSize={22} defaultSize={30}>
          <div className="dashboard-card" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h4>{selectedLead.businessName}</h4>
              <button className="btn-icon" onClick={() => selectLead(null)} title="Close">✕</button>
            </div>

            {(() => {
              const lastReply = selectedLead.customFields?.lastReply as LastReply | undefined;
              if (!lastReply) return null;
              return (
                <div style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', background: 'var(--green-bg)', border: '1px solid var(--border-glass)' }}>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--green)', fontWeight: 600, marginBottom: 2 }}>
                    ✉ Replied {new Date(lastReply.receivedAt).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{lastReply.snippet}</div>
                </div>
              );
            })()}

            <div className="field-group">
              <label>Status</label>
              <select
                value={selectedLead.status}
                onChange={(e) => handleStatusChange(selectedLead.id, e.target.value)}
                style={{ height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 var(--space-2)' }}
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div style={{ fontSize: 'var(--font-size-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div><strong>Email:</strong> {selectedLead.email || '—'}</div>
              <div><strong>Phone:</strong> {selectedLead.phone || '—'}</div>
              <div><strong>Website:</strong> {selectedLead.website || '—'}</div>
              <div><strong>Address:</strong> {selectedLead.address || '—'}</div>
              <div><strong>Category:</strong> {selectedLead.category || '—'}</div>
              {selectedLead.rating != null && <div><strong>Rating:</strong> {selectedLead.rating} ({selectedLead.reviewCount || 0} reviews)</div>}
              {selectedLead.customFields?.duplicateConfidence != null && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                  Seen via {(selectedLead.customFields.mergedSources as string[] | undefined)?.join(', ') || 'multiple sources'} · duplicate confidence: {String(selectedLead.customFields.duplicateConfidence)}%
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
              <button className="btn-secondary" onClick={handleOneClickEmail} disabled={!selectedLead.email} title="Compose email">✉ Email</button>
              <button className="btn-secondary" onClick={handleOpenWebsite} disabled={!selectedLead.website} title="Open website">🌐 Website</button>
              <button className="btn-secondary" onClick={handleCopyContact} title="Copy name/email/phone">📋 Copy Contact</button>
              <button className="btn-secondary" onClick={handleOpenMaps} title="Open in Google Maps">📍 Maps</button>
              <button className="btn-secondary" onClick={handleAddToCampaign} title="Add to action queue">➕ Add to Campaign</button>
            </div>

            {(() => {
              const analysis = selectedLead.customFields?.websiteAnalysis as import('@shared/types').WebsiteAnalysis | undefined;
              const tech = selectedLead.customFields?.techStack as import('@shared/types').TechStack | undefined;
              if (!analysis && !tech) return null;
              const statusOf = (name: string) => analysis?.checks.find((c) => c.check === name)?.status;
              const badges: { icon: string; label: string; on: boolean }[] = [
                { icon: '⚡', label: 'Speed OK', on: statusOf('Speed') === 'PASS' },
                { icon: '📱', label: 'Mobile OK', on: statusOf('Mobile friendly') === 'PASS' },
                { icon: '🔒', label: 'HTTPS', on: statusOf('SSL') === 'PASS' },
                { icon: '🤖', label: 'Chatbot', on: (tech?.categories?.Chatbot || []).length > 0 },
                { icon: '📅', label: 'Booking', on: (tech?.categories?.Booking || []).length > 0 },
              ];
              return (
                <div style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)' }}>
                  {badges.map((b) => (
                    <span key={b.label} title={b.label} style={{ opacity: b.on ? 1 : 0.3 }}>{b.icon}</span>
                  ))}
                </div>
              );
            })()}

            {selectedLead.website && (
              <button className="btn-secondary" onClick={handleDeepScan} disabled={deepScanning}>
                {deepScanning ? '⟳ Scanning…' : '🔍 Deep Scan + Analyze Website'}
              </button>
            )}

            {(() => {
              const scan = selectedLead.customFields?.deepScan as import('@shared/types').DeepScanResult | undefined;
              if (!scan) return null;
              if (scan.error) return <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--red)' }}>Deep scan: {scan.error}</div>;
              return (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div><strong>Scanned:</strong> {new Date(scan.scannedAt).toLocaleString()}</div>
                  {scan.description && <div><strong>Description:</strong> {scan.description}</div>}
                  {!!scan.categories?.length && <div><strong>Categories:</strong> {scan.categories.join(', ')}</div>}
                  {!!scan.socialLinks?.length && <div><strong>Social:</strong> {scan.socialLinks.length} link(s)</div>}
                  {!!scan.dns?.mx?.length && <div><strong>MX:</strong> {scan.dns.mx.join(', ')}</div>}
                  {scan.screenshotPath && (
                    screenshotStatus === 'ready' && screenshotUrl
                      ? (
                        <img
                          src={screenshotUrl}
                          alt="Website screenshot"
                          style={{ width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)', marginTop: 4 }}
                          onError={() => setScreenshotStatus('unavailable')}
                        />
                      )
                      : screenshotStatus === 'unavailable'
                        ? <div style={{ color: 'var(--text-tertiary)' }}>Screenshot unavailable</div>
                        : <div style={{ color: 'var(--text-tertiary)' }}>Loading screenshot…</div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const cf = selectedLead.customFields || {};
              const emailV = cf.emailVerification as import('@shared/types').EmailVerification | undefined;
              const hasBonus = cf.faviconPath || cf.language || cf.timezone || cf.suggestedCategory || cf.contactPageUrl || emailV;
              if (!hasBonus) return null;
              const vColor = emailV?.status === 'VALID' ? 'var(--green)' : emailV?.status === 'INVALID' ? 'var(--red)' : 'var(--text-tertiary)';
              return (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {cf.faviconPath ? <div>🖼 <strong>Favicon:</strong> saved</div> : null}
                  {emailV && <div>✉ <strong>Email:</strong> <span style={{ color: vColor }}>{String(emailV.status)}</span> — {String(emailV.reason)}</div>}
                  {cf.language != null && cf.language !== '' && <div>🌐 <strong>Language:</strong> {String(cf.language)}</div>}
                  {cf.timezone != null && <div>🕒 <strong>Timezone:</strong> {String(cf.timezone)}</div>}
                  {cf.suggestedCategory != null && <div>🏷 <strong>Suggested category:</strong> {String(cf.suggestedCategory)} <span style={{ opacity: 0.6 }}>(not applied automatically)</span></div>}
                  {cf.contactPageUrl != null && <div>📇 <strong>Contact page:</strong> found</div>}
                </div>
              );
            })()}

            {(() => {
              const analysis = selectedLead.customFields?.websiteAnalysis as import('@shared/types').WebsiteAnalysis | undefined;
              if (!analysis) return null;
              const issues = analysis.checks.filter((c) => c.status === 'FAIL' || c.status === 'WARNING');
              return (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>
                    <strong>Site health:</strong>{' '}
                    <span style={{ color: 'var(--green)' }}>{analysis.summary.PASS || 0} PASS</span>{' · '}
                    <span style={{ color: 'var(--yellow, orange)' }}>{analysis.summary.WARNING || 0} WARN</span>{' · '}
                    <span style={{ color: 'var(--red)' }}>{analysis.summary.FAIL || 0} FAIL</span>{' · '}
                    {analysis.summary.UNKNOWN || 0} UNKNOWN
                  </div>
                  {issues.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {issues.slice(0, 8).map((c) => (
                        <li key={c.check} style={{ color: c.status === 'FAIL' ? 'var(--red)' : undefined }}>
                          <strong>{c.check}:</strong> {c.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}

            {(() => {
              const profile = selectedLead.customFields?.businessProfile as import('@shared/types').BusinessProfile | undefined;
              if (!profile) return null;
              return (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>
                    <strong>Business Maturity:</strong>{' '}
                    <span style={{ color: 'var(--accent)' }}>{'★'.repeat(profile.maturity.stars)}{'☆'.repeat(5 - profile.maturity.stars)}</span>{' '}
                    <span>({profile.maturity.confidencePercent}% confidence)</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {profile.answers.map((a) => (
                      <li key={a.question}>
                        <strong>{a.question}</strong> {String(a.answer)} <span style={{ opacity: 0.7 }}>({a.detail})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            {(() => {
              const tech = selectedLead.customFields?.techStack as import('@shared/types').TechStack | undefined;
              if (!tech || !tech.flat.length) return null;
              return (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                  <strong>Tech stack:</strong>{' '}
                  {Object.entries(tech.categories).filter(([, names]) => names.length).map(([cat, names]) => `${cat}: ${names.join(', ')}`).join(' · ')}
                </div>
              );
            })()}

            {(() => {
              const scoring = selectedLead.customFields?.scoring as import('@shared/types').ScoreResult | undefined;
              if (!scoring) return null;
              const stars = Math.max(1, Math.min(5, Math.round(scoring.total / 20)));
              return (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div>
                    <strong>Smart Lead Score:</strong> {scoring.total}/100{' '}
                    <span style={{ color: 'var(--accent)' }}>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
                    {' · '}<strong>Decision:</strong> {scoring.decision}
                  </div>
                  <div>{Object.entries(scoring.categories).map(([c, v]) => `${c}: ${v}/20`).join(' · ')}</div>
                </div>
              );
            })()}

            {selectedLead.customFields?.autoNote != null && (
              <div style={{ fontSize: 'var(--font-size-xs)', fontStyle: 'italic', color: 'var(--text-secondary)', padding: 'var(--space-2)', borderLeft: '2px solid var(--accent)' }}>
                {String(selectedLead.customFields.autoNote)}
              </div>
            )}

            {(() => {
              const opportunities = selectedLead.customFields?.opportunities as import('@shared/types').Opportunity[] | undefined;
              if (!opportunities || !opportunities.length) return null;
              const color = (sev: string) => sev === 'HIGH' ? 'var(--red)' : sev === 'MEDIUM' ? 'var(--yellow, orange)' : 'var(--text-tertiary)';
              const dot = (sev: string) => sev === 'HIGH' ? '🔴' : sev === 'MEDIUM' ? '🟡' : '🔵';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <strong style={{ fontSize: 'var(--font-size-sm)' }}>Opportunities</strong>
                  {opportunities.map((o) => (
                    <div key={o.gap} style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)', fontSize: 'var(--font-size-xs)' }}>
                      <div style={{ fontWeight: 600 }}>{dot(o.severity)} {o.gap}</div>
                      <div>Severity: <span style={{ color: color(o.severity), fontWeight: 600 }}>{o.severity}</span></div>
                      <div>Potential Service: {o.potentialService}</div>
                      <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>{o.detail}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="field-group">
              <label>Notes</label>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={5}
                style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: 'var(--space-2)', resize: 'vertical' }}
              />
              <button className="btn-secondary" onClick={handleSaveNotes} disabled={notesSaving}>
                {notesSaving ? 'Saving…' : 'Save Notes'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button className="btn-secondary" onClick={handleDelete} style={{ color: 'var(--red)', flex: 1 }}>
                Delete Lead
              </button>
              <button className="btn-secondary" onClick={handleBlacklist} title="Never contact this business again" style={{ color: 'var(--red)', flex: 1 }}>
                🚫 Do Not Contact
              </button>
            </div>
          </div>
          </Panel>
        </>
      )}
      </PanelGroup>
    </div>
  );
}
