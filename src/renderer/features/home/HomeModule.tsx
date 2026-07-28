import { useEffect, useMemo } from 'react';
import { Users, Globe, Mail, Zap, Clock, type LucideIcon } from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import { useLeadsStore } from '../../stores/leads.store';
import { PageHeader } from '../../components/ui';
import type { ModuleName } from '@shared/types';

interface QuickLink {
  id: ModuleName;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const QUICK_LINKS: QuickLink[] = [
  { id: 'leads', label: 'Leads', desc: 'Manage your pipeline', icon: Users },
  { id: 'browser', label: 'Browser + Scraper', desc: 'Research and extract data', icon: Globe },
  { id: 'email', label: 'Email', desc: 'Send and track outreach', icon: Mail },
  { id: 'automations', label: 'Automations', desc: 'Run background workflows', icon: Zap },
  { id: 'jobs', label: 'Jobs', desc: 'Monitor running tasks', icon: Clock },
];

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

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function HomeModule() {
  const { setActiveModule } = useUIStore();
  const { leads, leadPriorityCache, refreshLeads, selectLead } = useLeadsStore();

  useEffect(() => {
    refreshLeads();
  }, [refreshLeads]);

  const recentActivity = useMemo<ActivityEntry[]>(() => {
    const all: ActivityEntry[] = [];
    for (const l of leads) {
      for (const h of l.history || []) all.push({ leadId: l.id, businessName: l.businessName, event: h.event, at: h.at });
    }
    return all.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()).slice(0, 5);
  }, [leads]);

  // "Next actions" — new leads not yet contacted, highest close probability first.
  const nextActions = useMemo(() => {
    const closeProb = (id: string) => leadPriorityCache[id]?.ruled?.closeProbability ?? 0;
    return leads
      .filter((l) => l.status === 'New' || !l.status)
      .sort((a, b) => closeProb(b.id) - closeProb(a.id))
      .slice(0, 5)
      .map((l) => ({ ...l, closeProbability: leadPriorityCache[l.id]?.ruled?.closeProbability as number | undefined }));
  }, [leads, leadPriorityCache]);

  const goToLead = (leadId: string) => {
    selectLead(leadId);
    setActiveModule('leads');
  };

  return (
    <div className="home-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader title="Welcome to Agency OS" description="Here's what needs your attention." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div className="dashboard-card">
          <h4 style={{ marginBottom: 'var(--space-3)' }}>Next Actions</h4>
          {nextActions.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>Nothing awaiting first contact.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {nextActions.map((l) => (
                <button
                  key={l.id}
                  onClick={() => goToLead(l.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer' }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>{l.businessName}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Awaiting first contact</div>
                  </div>
                  {l.closeProbability != null && (
                    <span className="badge badge-accent">{l.closeProbability}%</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-card">
          <h4 style={{ marginBottom: 'var(--space-3)' }}>Recent Activity</h4>
          {recentActivity.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>No recent activity.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {recentActivity.map((a, i) => {
                const { icon, bg } = activityIcon(a.event);
                return (
                  <button
                    key={i}
                    onClick={() => goToLead(a.leadId)}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', textAlign: 'left', background: 'transparent', border: 'none', padding: 'var(--space-1) 0', cursor: 'pointer' }}
                  >
                    <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', background: bg, flexShrink: 0, fontSize: 12 }}>{icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.businessName}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{a.event}</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{timeAgo(a.at)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div>
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Shortcuts</h4>
        <div className="dashboard-grid">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.id}
                className="quick-action-card"
                onClick={() => setActiveModule(link.id)}
              >
                <div className="quick-action-icon" style={{ background: 'linear-gradient(135deg, var(--accent), var(--cyan))' }}>
                  <Icon size={16} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{link.label}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{link.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
