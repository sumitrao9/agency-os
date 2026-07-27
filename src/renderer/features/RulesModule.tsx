import { useState, useEffect } from 'react';
import { useLeadsStore } from '../stores/leads.store';

export default function RulesModule() {
  const { leads, leadPriorityCache, refreshLeads } = useLeadsStore();
  const [stats, setStats] = useState({ a: 0, b: 0, c: 0 });

  useEffect(() => {
    refreshLeads();
  }, [refreshLeads]);

  useEffect(() => {
    let a = 0, b = 0, c = 0;
    leads.forEach(l => {
      const cached = leadPriorityCache[l.id];
      const p = cached?.ruled?.priority || l.priority || 'B';
      if (p === 'A') a++;
      else if (p === 'B') b++;
      else c++;
    });
    setStats({ a, b, c });
  }, [leads, leadPriorityCache]);

  return (
    <div className="rules-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="module-header">
        <div className="module-header-info">
          <h2>Rules Engine</h2>
          <p>Deterministic lead scoring and priority assignment</p>
        </div>
      </div>

      {/* Priority Distribution */}
      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Priority Distribution</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <div className="dashboard-stat">
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.a}</div>
            <div className="stat-label">Priority A</div>
            <div className="stat-detail">High opportunity</div>
          </div>
          <div className="dashboard-stat">
            <div className="stat-value" style={{ color: 'var(--blue)' }}>{stats.b}</div>
            <div className="stat-label">Priority B</div>
            <div className="stat-detail">Moderate opportunity</div>
          </div>
          <div className="dashboard-stat">
            <div className="stat-value" style={{ color: 'var(--text-tertiary)' }}>{stats.c}</div>
            <div className="stat-label">Priority C</div>
            <div className="stat-detail">Low priority</div>
          </div>
        </div>
      </div>

      {/* Rule Definitions */}
      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Active Rules</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {[
            { id: 'website-missing', desc: 'No website detected', tag: 'No Website' },
            { id: 'website-present', desc: 'Has a website', tag: 'Has Website' },
            { id: 'phone-missing', desc: 'No phone number', tag: 'No Phone' },
            { id: 'low-reviews', desc: 'Less than 20 reviews', tag: 'Low Reviews' },
            { id: 'high-reviews', desc: '150+ reviews', tag: 'High Reviews' },
            { id: 'no-email', desc: 'No email found', tag: 'No Email Found' },
            { id: 'no-ssl', desc: 'Website missing SSL', tag: 'No SSL' },
            { id: 'not-mobile-friendly', desc: 'Website not mobile-friendly', tag: 'Not Mobile-Friendly' },
          ].map(rule => (
            <div key={rule.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-hover)' }}>
              <span className="tag">{rule.tag}</span>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{rule.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
