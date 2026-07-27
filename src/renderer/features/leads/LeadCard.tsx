import type { Lead, Opportunity, TechStack, ScoreResult, RuleResult } from '@shared/types';

interface LeadCardProps {
  lead: Lead;
  ruled?: RuleResult;
  selected: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  checked: boolean;
  onEmail: () => void;
  onOpenWebsite: () => void;
  onCopyContact: () => void;
  onOpenMaps: () => void;
  onCopyColdEmail: () => void;
  onOpenLinkedIn: (url: string) => void;
}

const SEVERITY_COLOR: Record<string, string> = { HIGH: 'var(--red)', MEDIUM: 'var(--yellow, orange)', LOW: 'var(--text-tertiary)' };

export default function LeadCard({ lead, ruled, selected, onSelect, onToggleCheck, checked, onEmail, onOpenWebsite, onCopyContact, onOpenMaps, onCopyColdEmail, onOpenLinkedIn }: LeadCardProps) {
  const scoring = lead.customFields?.scoring as ScoreResult | undefined;
  const techStack = lead.customFields?.techStack as TechStack | undefined;
  const opportunities = (lead.customFields?.opportunities as Opportunity[] | undefined) || [];
  const score = scoring?.total;
  const pct = score ?? 0;
  const initials = (lead.businessName || '?').trim().slice(0, 2).toUpperCase();
  const lastScanned = (lead.customFields?.deepScan as { scannedAt?: string } | undefined)?.scannedAt;

  const healthColor = score == null ? 'var(--text-tertiary)' : score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--yellow, orange)' : 'var(--red)';
  const healthDot = score == null ? '⚪' : score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';

  // Both derived from deep-scan data already on the lead — checkWebsiteQuality()
  // marks `checked:false` when the site timed out/failed to load (dead or
  // parked), and verifyEmail() only returns VALID when the domain actually
  // has mail servers. No new detection logic, just surfacing what's there.
  const websiteQuality = lead.customFields?.websiteQuality as { checked?: boolean; hasSSL?: boolean } | undefined;
  const websiteStatus = !lead.website ? null : !websiteQuality?.checked ? 'unreachable' : websiteQuality.hasSSL ? 'live' : 'live-no-ssl';
  const websiteIcon = websiteStatus === 'live' ? '🟢' : websiteStatus === 'live-no-ssl' ? '🟡' : websiteStatus === 'unreachable' ? '🔴' : null;

  const emailVerification = lead.customFields?.emailVerification as { status?: 'VALID' | 'INVALID' | 'UNKNOWN' } | undefined;
  const emailIcon = !lead.email ? null : emailVerification?.status === 'VALID' ? '🟢' : emailVerification?.status === 'INVALID' ? '🔴' : '🟡';

  // Only a real, deep-scan-discovered LinkedIn URL — never a guessed/search link.
  const socialLinks = (lead.customFields?.deepScan as { socialLinks?: string[] } | undefined)?.socialLinks || [];
  const linkedinUrl = socialLinks.find((u) => /linkedin\.com/i.test(u));

  return (
    <div
      className="dashboard-card lead-card"
      onClick={onSelect}
      style={{ cursor: 'pointer', border: selected ? '1px solid var(--accent-border)' : undefined, position: 'relative' }}
    >
      <div style={{ position: 'absolute', top: 'var(--space-2)', left: 'var(--space-2)' }} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggleCheck} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 700, fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.businessName}</div>
          {lead.rating != null && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
              {'★'.repeat(Math.round(Number(lead.rating) || 0))} {lead.rating} ({lead.reviewCount || 0})
            </div>
          )}
        </div>

        {score != null && (
          <div
            title={`Lead score: ${score}/100`}
            style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              background: `conic-gradient(${healthColor} ${pct * 3.6}deg, var(--bg-elevated) 0deg)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
              {score}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: 'var(--font-size-xs)' }}>
        <span className={`badge ${lead.website ? 'badge-green' : 'badge-red'}`} title={websiteStatus === 'unreachable' ? 'Unreachable on last deep scan' : websiteStatus === 'live-no-ssl' ? 'Live, no SSL' : websiteStatus === 'live' ? 'Live, SSL OK' : undefined}>
          {websiteIcon ? `${websiteIcon} ` : '🌐 '}{lead.website ? 'Website' : 'No site'}
        </span>
        <span className={`badge ${lead.email ? 'badge-green' : 'badge-red'}`} title={emailVerification?.status === 'VALID' ? 'Domain has mail servers' : emailVerification?.status === 'INVALID' ? 'No mail servers found — likely undeliverable' : undefined}>
          {emailIcon ? `${emailIcon} ` : '✉ '}{lead.email ? 'Email' : 'No email'}
        </span>
        <span className={`badge ${lead.phone ? 'badge-green' : 'badge-red'}`}>📞 {lead.phone ? 'Phone' : 'No phone'}</span>
      </div>

      {ruled && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: 'var(--font-size-xs)' }}>
          <span className={`badge badge-${ruled.closeProbability >= 80 ? 'green' : ruled.closeProbability >= 50 ? 'yellow' : 'accent'}`} title="Close probability">
            {ruled.closeProbability}% close
          </span>
          <span className="badge" style={{ background: 'transparent', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)' }} title="Estimated revenue range">
            {ruled.revenueLow.toLocaleString()}–{ruled.revenueHigh.toLocaleString()}
          </span>
        </div>
      )}

      {!!techStack?.flat?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'var(--space-2)' }}>
          {techStack.flat.slice(0, 4).map((t) => (
            <span key={t.name} className="badge badge-accent" style={{ fontSize: 10 }}>{t.name}</span>
          ))}
        </div>
      )}

      {!!opportunities.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'var(--space-2)' }}>
          {opportunities.slice(0, 2).map((o) => (
            <span key={o.gap} className="badge" style={{ background: 'transparent', border: `1px solid ${SEVERITY_COLOR[o.severity]}`, color: SEVERITY_COLOR[o.severity], fontSize: 10 }}>
              {o.gap}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
          {healthDot} {lastScanned ? `Scanned ${new Date(lastScanned).toLocaleDateString()}` : 'Not scanned yet'}
        </span>
        <div className="lead-card-actions" style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn-icon" title="Email" onClick={onEmail} disabled={!lead.email}>✉</button>
          <button className="btn-icon" title="Website" onClick={onOpenWebsite} disabled={!lead.website}>🌐</button>
          <button className="btn-icon" title="Copy contact" onClick={onCopyContact}>📋</button>
          <button className="btn-icon" title="Copy cold email (subject + body) to clipboard" onClick={onCopyColdEmail} disabled={!lead.email}>📝</button>
          <button className="btn-icon" title="Maps" onClick={onOpenMaps}>📍</button>
          {linkedinUrl && (
            <button className="btn-icon" title="Open LinkedIn" onClick={() => onOpenLinkedIn(linkedinUrl)}>💼</button>
          )}
        </div>
      </div>
    </div>
  );
}
