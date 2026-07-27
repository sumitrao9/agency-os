import { useMemo } from 'react';
import { useLeadsStore } from '../../stores/leads.store';
import { useUIStore } from '../../stores/ui.store';
import type { Lead, ScoreResult, Opportunity, Proposal, BusinessProfile } from '@shared/types';

// The decisions worth acting on today — mirrors QUEUE_ELIGIBLE_DECISIONS in
// src/main/appRuntime.js so "today's list" and "the action queue" always
// agree on what counts as actionable.
const ACTIONABLE_DECISIONS = new Set(['Call today', 'Email today', 'Priority', 'Good lead']);
const CLOSED_STATUSES = new Set(['Won', 'Lost']);

function lastContactedLabel(lead: Lead): string {
  const sent = (lead.history || []).filter((h) => /sent|contacted/i.test(h.event));
  if (!sent.length) return 'Never';
  return new Date(sent[sent.length - 1].at).toLocaleDateString();
}

function reasonsFor(lead: Lead, opportunities: Opportunity[], profile: BusinessProfile | undefined): string[] {
  const reasons: string[] = [];
  const rating = lead.rating != null ? Number(lead.rating) : null;
  const reviewCount = lead.reviewCount || 0;
  if (rating != null && rating >= 4.5 && reviewCount >= 20) reasons.push('Great reviews');
  else if (reviewCount >= 50) reasons.push('Well-established presence');
  if (lead.email) reasons.push('Email found');
  const hiring = profile?.answers?.find((a) => a.question === 'Hiring?');
  if (hiring?.answer === true) reasons.push('Actively hiring');
  for (const o of opportunities.slice(0, 2)) reasons.push(o.gap);
  if (lastContactedLabel(lead) === 'Never') reasons.push('Last contacted: Never');
  return reasons.slice(0, 5);
}

export default function TodaysOpportunities() {
  const { leads, selectLead } = useLeadsStore();
  const { setActiveModule } = useUIStore();

  const top25 = useMemo(() => {
    return leads
      .filter((l) => {
        if (CLOSED_STATUSES.has(l.status)) return false;
        const scoring = l.customFields?.scoring as ScoreResult | undefined;
        return scoring && ACTIONABLE_DECISIONS.has(scoring.decision);
      })
      .sort((a, b) => {
        const sa = (a.customFields?.scoring as ScoreResult | undefined)?.total || 0;
        const sb = (b.customFields?.scoring as ScoreResult | undefined)?.total || 0;
        return sb - sa;
      })
      .slice(0, 25);
  }, [leads]);

  if (!top25.length) return null;

  return (
    <div className="dashboard-card" style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h4>🎯 Today's Top {top25.length}</h4>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Ranked by lead score — highest opportunity first</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 480, overflow: 'auto' }}>
        {top25.map((lead, i) => {
          const scoring = lead.customFields?.scoring as ScoreResult | undefined;
          const opportunities = (lead.customFields?.opportunities as Opportunity[] | undefined) || [];
          const proposal = lead.customFields?.proposal as Proposal | undefined;
          const profile = lead.customFields?.businessProfile as BusinessProfile | undefined;
          const stars = Math.max(1, Math.min(5, Math.round((scoring?.total || 0) / 20)));
          const service = proposal?.services?.[0]?.name || 'General Audit';

          return (
            <div
              key={lead.id}
              onClick={() => { selectLead(lead.id); setActiveModule('leads'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-glass)', cursor: 'pointer', transition: 'all var(--anim-fast)',
              }}
            >
              <div style={{ width: 24, fontWeight: 700, color: 'var(--text-tertiary)', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {lead.businessName}
                  <span style={{ color: 'var(--accent)', fontSize: 11 }}>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                  {reasonsFor(lead, opportunities, profile).join(' · ')}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="badge badge-accent">{scoring?.decision}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>{service}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
