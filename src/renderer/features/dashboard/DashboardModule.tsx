import { useState, useEffect, useMemo } from 'react';
import { useLeadsStore } from '../../stores/leads.store';
import { useUIStore } from '../../stores/ui.store';
import CountUp from '../../components/CountUp';
import TodaysOpportunities from './TodaysOpportunities';

interface ActivityEntry {
  leadId: string;
  businessName: string;
  event: string;
  at: string;
}

function activityIcon(event: string): { icon: string; bg: string } {
  if (/reply|replied/i.test(event)) return { icon: '💬', bg: 'var(--green)' };
  if (/merge|duplicate/i.test(event)) return { icon: '🔗', bg: 'var(--accent)' };
  if (/sent|contacted/i.test(event)) return { icon: '✉', bg: 'var(--blue, #3b82f6)' };
  if (/scan|analy/i.test(event)) return { icon: '🔍', bg: 'var(--yellow, #f59e0b)' };
  return { icon: '➕', bg: 'var(--text-tertiary)' };
}

export default function DashboardModule() {
  const { leads, leadPriorityCache, refreshLeads, selectLead } = useLeadsStore();
  const { setActiveModule } = useUIStore();
  const [stats, setStats] = useState({
    totalLeads: 0,
    priorityA: 0,
    priorityB: 0,
    priorityC: 0,
    newLeads: 0,
    contacted: 0,
    replied: 0,
    won: 0,
    highPriority: 0,
    bestIndustry: '—',
    topOpportunity: '—',
    dealValueLow: 0,
    dealValueHigh: 0,
  });

  useEffect(() => {
    refreshLeads();
  }, [refreshLeads]);

  useEffect(() => {
    let a = 0, b = 0, c = 0, newL = 0, contacted = 0, replied = 0, won = 0, highPriority = 0;
    let dealValueLow = 0, dealValueHigh = 0;
    const industryCounts: Record<string, number> = {};
    const opportunityCounts: Record<string, number> = {};

    leads.forEach(l => {
      const cached = leadPriorityCache[l.id];
      const p = cached?.ruled?.priority || l.priority || 'B';
      if (p === 'A') a++;
      else if (p === 'B') b++;
      else c++;
      if (l.status === 'New' || !l.status) newL++;
      if (l.status === 'Sent') contacted++;
      if (l.status === 'Replied' || l.status === 'Interested') replied++;
      if (l.status === 'Won') won++;

      if (l.category) industryCounts[l.category] = (industryCounts[l.category] || 0) + 1;

      const decision = (l.customFields?.scoring as { decision?: string } | undefined)?.decision;
      if (decision === 'Call today' || decision === 'Email today' || decision === 'Priority') highPriority++;

      const opportunities = l.customFields?.opportunities as { gap: string }[] | undefined;
      opportunities?.forEach((o) => { opportunityCounts[o.gap] = (opportunityCounts[o.gap] || 0) + 1; });

      const proposal = l.customFields?.proposal as { totalLow?: number; totalHigh?: number } | undefined;
      if (proposal) { dealValueLow += proposal.totalLow || 0; dealValueHigh += proposal.totalHigh || 0; }
    });

    const bestIndustry = Object.entries(industryCounts).sort((x, y) => y[1] - x[1])[0]?.[0] || '—';
    const topOpportunity = Object.entries(opportunityCounts).sort((x, y) => y[1] - x[1])[0]?.[0] || '—';

    setStats({
      totalLeads: leads.length, priorityA: a, priorityB: b, priorityC: c, newLeads: newL, contacted, replied, won,
      highPriority, bestIndustry, topOpportunity, dealValueLow, dealValueHigh,
    });
  }, [leads, leadPriorityCache]);

  const recentActivity = useMemo<ActivityEntry[]>(() => {
    const all: ActivityEntry[] = [];
    for (const l of leads) {
      for (const h of l.history || []) all.push({ leadId: l.id, businessName: l.businessName, event: h.event, at: h.at });
    }
    return all.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()).slice(0, 6);
  }, [leads]);

  const pct = (n: number) => (stats.totalLeads ? Math.round((n / stats.totalLeads) * 100) : 0);
  const donutGradient = `conic-gradient(
    var(--accent) 0deg ${pct(stats.priorityA) * 3.6}deg,
    var(--blue, #3b82f6) ${pct(stats.priorityA) * 3.6}deg ${(pct(stats.priorityA) + pct(stats.priorityB)) * 3.6}deg,
    var(--text-tertiary) ${(pct(stats.priorityA) + pct(stats.priorityB)) * 3.6}deg 360deg
  )`;

  // Average days from lead creation to first reaching a given status — only
  // answerable now that updateLead() logs "Status changed: X → Y" entries
  // to history (added alongside this); leads created before that change
  // simply have no matching entry and are excluded, not counted as zero.
  const avgDaysToStage = useMemo(() => {
    return (targetStatus: string): number | null => {
      const samples: number[] = [];
      for (const l of leads) {
        const created = new Date(l.createdDate).getTime();
        const entry = (l.history || []).find((h) => h.event.includes(`→ ${targetStatus}`));
        if (!entry) continue;
        const days = (new Date(entry.at).getTime() - created) / 86400000;
        if (days >= 0) samples.push(days);
      }
      if (!samples.length) return null;
      return Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 10) / 10;
    };
  }, [leads]);

  const funnelSteps = [
    { label: 'Total Leads', value: stats.totalLeads, color: 'linear-gradient(90deg, #7c3aed, #a855f7)', avgDays: null as number | null },
    { label: 'Contacted', value: stats.contacted, color: 'linear-gradient(90deg, #1d4ed8, #3b82f6)', avgDays: avgDaysToStage('Sent') },
    { label: 'Replied', value: stats.replied, color: 'linear-gradient(90deg, #059669, #22c55e)', avgDays: avgDaysToStage('Replied') },
    { label: 'Won', value: stats.won, color: 'linear-gradient(90deg, #c2410c, #f59e0b)', avgDays: avgDaysToStage('Won') },
  ];
  const maxFunnel = Math.max(stats.totalLeads, 1);

  const timeAgo = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="dashboard-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="welcome-header">
        <div>
          <h2>Welcome back 👋</h2>
          <p>Here's what's happening with your business today.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="badge badge-accent">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          <button className="btn-icon" onClick={() => refreshLeads()} title="Refresh">↻</button>
        </div>
      </div>

      <TodaysOpportunities />

      {/* Gradient KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-purple">
          <div className="kpi-icon">👥</div>
          <div className="kpi-label">Total Leads</div>
          <div className="kpi-value"><CountUp value={stats.totalLeads} /></div>
          <div className="kpi-sub">All leads in pipeline</div>
        </div>
        <div className="kpi-card kpi-green">
          <div className="kpi-icon">⭐</div>
          <div className="kpi-label">Priority A</div>
          <div className="kpi-value"><CountUp value={stats.priorityA} /></div>
          <div className="kpi-sub">High-value opportunities</div>
        </div>
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon">🆕</div>
          <div className="kpi-label">New Leads</div>
          <div className="kpi-value"><CountUp value={stats.newLeads} /></div>
          <div className="kpi-sub">Awaiting first contact</div>
        </div>
        <div className="kpi-card kpi-orange">
          <div className="kpi-icon">✉</div>
          <div className="kpi-label">Contacted</div>
          <div className="kpi-value"><CountUp value={stats.contacted} /></div>
          <div className="kpi-sub">Emails sent</div>
        </div>
        <div className="kpi-card kpi-pink">
          <div className="kpi-icon">💬</div>
          <div className="kpi-label">Replied</div>
          <div className="kpi-value"><CountUp value={stats.replied} /></div>
          <div className="kpi-sub">Positive responses</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', alignItems: 'stretch' }}>
        {/* Priority donut */}
        <div className="dashboard-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <h4>Lead Priority Breakdown</h4>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
            <div className="donut-chart" style={{ background: donutGradient }}>
              <div className="donut-chart-inner">
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Total</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.totalLeads}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--font-size-sm)' }}>
              <div><span style={{ color: 'var(--accent)' }}>●</span> Priority A — {stats.priorityA} ({pct(stats.priorityA)}%)</div>
              <div><span style={{ color: 'var(--blue, #3b82f6)' }}>●</span> Priority B — {stats.priorityB} ({pct(stats.priorityB)}%)</div>
              <div><span style={{ color: 'var(--text-tertiary)' }}>●</span> Priority C — {stats.priorityC} ({pct(stats.priorityC)}%)</div>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="dashboard-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <h4>Recent Activity</h4>
            <button className="btn-icon" onClick={() => setActiveModule('leads')} title="View all leads">View All</button>
          </div>
          {recentActivity.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-4)' }}>
              <div className="empty-icon">📭</div>
              <div className="empty-desc">No activity yet — scrape or scan a lead to get started.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recentActivity.map((a, i) => {
                const { icon, bg } = activityIcon(a.event);
                return (
                  <div key={i} className="activity-item" onClick={() => { selectLead(a.leadId); setActiveModule('leads'); }}>
                    <div className="activity-icon" style={{ background: bg, color: '#fff' }}>{icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{a.businessName}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.event}</div>
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{timeAgo(a.at)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Quick Actions</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
          <button className="quick-action-card" onClick={() => setActiveModule('browser')}>
            <div className="quick-action-icon" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}>➕</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Add Lead</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Scrape a new niche</div>
            </div>
          </button>
          <button className="quick-action-card" onClick={() => setActiveModule('email')}>
            <div className="quick-action-icon" style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)' }}>✉</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Send Email</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Reach out to leads</div>
            </div>
          </button>
          <button className="quick-action-card" onClick={() => setActiveModule('automations')}>
            <div className="quick-action-icon" style={{ background: 'linear-gradient(135deg, #c2410c, #f59e0b)' }}>⚡</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Automations</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Automate your workflow</div>
            </div>
          </button>
          <button className="quick-action-card" onClick={() => setActiveModule('leads')}>
            <div className="quick-action-icon" style={{ background: 'linear-gradient(135deg, #059669, #22c55e)' }}>👥</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>View All Leads</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Manage all leads</div>
            </div>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 'var(--space-3)' }}>
        {/* Funnel */}
        <div className="dashboard-card">
          <h4 style={{ marginBottom: 'var(--space-3)' }}>Lead Pipeline</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {funnelSteps.map((s) => (
              <div key={s.label} className="funnel-step" style={{ background: s.color, width: `${Math.max(20, (s.value / maxFunnel) * 100)}%`, margin: '0 auto' }}>
                <div style={{ fontWeight: 700 }}><CountUp value={s.value} /></div>
                <div style={{ fontSize: 'var(--font-size-xs)', opacity: 0.9 }}>
                  {s.label}{s.avgDays != null && ` · avg ${s.avgDays}d`}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* More stats */}
        <div className="dashboard-card">
          <h4 style={{ marginBottom: 'var(--space-3)' }}>More Stats</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>🔥 High-Priority Leads</span><strong style={{ color: 'var(--red)' }}>{stats.highPriority}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>🏆 Best Industry</span><strong>{stats.bestIndustry}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>🎯 Top Opportunity</span><strong>{stats.topOpportunity}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>💰 Est. Deal Value</span>
              <strong style={{ color: 'var(--accent)' }}>₹{stats.dealValueLow.toLocaleString('en-IN')}–₹{stats.dealValueHigh.toLocaleString('en-IN')}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
