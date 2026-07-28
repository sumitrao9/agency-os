import { useState, useEffect, useCallback, useMemo } from 'react';
import ipc from '../lib/ipc';
import { useLeadsStore } from '../stores/leads.store';
import { useUIStore } from '../stores/ui.store';
import type { Lead, EmailAccount, EmailThread, EmailMessage, EmailFolder } from '@shared/types';

const FOLDERS: { key: EmailFolder; label: string; icon: string }[] = [
  { key: 'inbox', label: 'Inbox', icon: '📥' },
  { key: 'archive', label: 'Archive', icon: '🗄' },
  { key: 'spam', label: 'Spam', icon: '⚠' },
  { key: 'trash', label: 'Trash', icon: '🗑' },
];

const TEMPLATE_KEYS = ['no-website', 'outdated-website', 'missing-contact', 'low-reviews', 'general'] as const;
const FOLLOWUP_STAGES = ['nudge', 'breakup'] as const;
type EmailTab = 'compose' | 'inbox' | 'analytics';

interface LastReply { snippet: string; receivedAt: string; subject: string; }

export default function EmailModule() {
  const { leads, refreshLeads, leadPriorityCache, updateLeadInStore } = useLeadsStore();
  const { addToast, composeLeadId, setComposeLeadId } = useUIStore();
  const [tab, setTab] = useState<EmailTab>('compose');
  const [checkingReplies, setCheckingReplies] = useState(false);

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [email, setEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);
  const [sendCount, setSendCount] = useState({ count: 0, warnAt: 0, hardStopAt: 0 });

  const status = useMemo(() => {
    const active = accounts.find((a) => a.id === selectedAccountId) || accounts[0];
    return { configured: !!active && active.status !== 'error', email: active?.email };
  }, [accounts, selectedAccountId]);

  // Compose state
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [templateKey, setTemplateKey] = useState<string>('general');
  const [followUpStage, setFollowUpStage] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fromName, setFromName] = useState(() => localStorage.getItem('from-name') || '');
  const [rendering, setRendering] = useState(false);
  const [sending, setSending] = useState(false);

  const emailableLeads = useMemo(() => leads.filter((l) => l.email), [leads]);
  const selectedLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const loadStatus = useCallback(async () => {
    try {
      const list = await ipc.listEmailAccounts();
      setAccounts(list);
      setSelectedAccountId((prev) => (prev && list.some((a) => a.id === prev)) ? prev : (list[0]?.id || ''));
    } catch {
      // Account list falls back to empty ("Not configured").
    }
  }, []);

  useEffect(() => { loadStatus(); refreshLeads(); }, [loadStatus, refreshLeads]);

  // This component fetches its own account list once on mount, so an
  // account added/signed-in from Settings (a separate, independently-mounted
  // component) would otherwise never be reflected here until a full app
  // reload — the "Send is disabled, says Not configured, even though I just
  // signed in" bug. Settings broadcasts this event after any account change.
  useEffect(() => {
    const onAccountsChanged = () => loadStatus();
    window.addEventListener('agencyos:accounts-changed', onAccountsChanged);
    return () => window.removeEventListener('agencyos:accounts-changed', onAccountsChanged);
  }, [loadStatus]);

  useEffect(() => {
    if (!selectedAccountId) { setSendCount({ count: 0, warnAt: 0, hardStopAt: 0 }); return; }
    ipc.getSendCount(selectedAccountId).then(setSendCount).catch(() => {});
  }, [selectedAccountId]);

  // One-click "Email" from the Leads panel jumps here pre-targeting that lead.
  useEffect(() => {
    if (composeLeadId) {
      setSelectedLeadId(composeLeadId);
      setComposeLeadId(null);
    }
  }, [composeLeadId, setComposeLeadId]);

  // When a lead is picked, default to the template its rules recommend.
  useEffect(() => {
    if (!selectedLeadId) return;
    const recommended = leadPriorityCache[selectedLeadId]?.ruled?.recommendedTemplate;
    if (recommended && (TEMPLATE_KEYS as readonly string[]).includes(recommended)) {
      setTemplateKey(recommended);
    }
  }, [selectedLeadId, leadPriorityCache]);

  const handleAddAccount = async () => {
    if (!email || !appPassword) {
      setSaveStatus('Enter both fields');
      return;
    }
    if (savingCreds) return; // already in flight — the button below is disabled too, this just guards double-invocation
    setSavingCreds(true);
    setSaveStatus('Verifying...');
    try {
      const result = await ipc.addEmailAccount({ provider: 'gmail', authType: 'app_password', email, appPassword, displayName: email });
      if (result.ok) {
        setSaveStatus(result.verified ? '✓ Added & verified' : `✓ Added (verify failed: ${result.error || 'unknown'})`);
        setAppPassword('');
        setEmail('');
        loadStatus();
        window.dispatchEvent(new CustomEvent('agencyos:accounts-changed'));
      } else {
        setSaveStatus(`✗ ${result.error}`);
      }
    } catch (e) {
      setSaveStatus(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingCreds(false);
    }
  };

  const handleRemoveAccount = async (id: string) => {
    await ipc.removeEmailAccount(id);
    loadStatus();
  };

  const handleRender = useCallback(async () => {
    if (!selectedLead) return;
    setRendering(true);
    try {
      const rendered = followUpStage
        ? await ipc.renderFollowUp(followUpStage, selectedLead as Lead)
        : await ipc.renderTemplate(templateKey, selectedLead as Lead);
      setSubject(rendered.subject || '');
      setBody(rendered.body || '');
    } catch (e) {
      addToast(`Could not render template: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setRendering(false);
    }
  }, [selectedLead, templateKey, followUpStage, addToast]);

  // Re-render the preview whenever the lead/template/stage changes.
  useEffect(() => { handleRender(); }, [handleRender]);

  const handleSend = async () => {
    if (!selectedAccountId) {
      addToast('Add an email account first.', 'warning');
      return;
    }
    if (!selectedLead?.email) {
      addToast('Pick a lead with an email address first.', 'warning');
      return;
    }
    if (!subject.trim() && !body.trim()) {
      addToast('Nothing to send — the subject and body are both empty.', 'warning');
      return;
    }
    setSending(true);
    try {
      const result = await ipc.sendEmail(selectedAccountId, selectedLead.email, subject, body, fromName, undefined, undefined, selectedLead.id);
      if (result.ok) {
        localStorage.setItem('from-name', fromName);
        addToast(`Sent to ${selectedLead.email}`, 'success');
        if (result.warning) addToast(result.warning, 'warning', 8000);
        // Reflect outreach in the pipeline immediately, then persist.
        updateLeadInStore(selectedLead.id, { status: 'Sent' });
        await ipc.updateLead(selectedLead.id, { status: 'Sent' });
        setSendCount(await ipc.getSendCount(selectedAccountId));
      } else {
        addToast(result.error || 'Send failed', 'error', 8000);
      }
    } catch (e) {
      addToast(`Send failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000);
    } finally {
      setSending(false);
    }
  };

  const limitPct = sendCount.hardStopAt ? (sendCount.count / sendCount.hardStopAt) * 100 : 0;
  const nearLimit = sendCount.warnAt > 0 && sendCount.count >= sendCount.warnAt;

  const handleCheckReplies = async () => {
    setCheckingReplies(true);
    try {
      const result = await ipc.checkReplies();
      if (result.newReplies.length) {
        result.newReplies.forEach((r) => addToast(`${r.businessName} replied`, 'success'));
        refreshLeads();
      } else {
        addToast('No new replies', 'info');
      }
      loadThreads();
    } catch (e) {
      addToast(`Reply check failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setCheckingReplies(false);
    }
  };

  // --- Real inbox: threads/messages backed by the threads/messages tables ---
  const [folder, setFolder] = useState<EmailFolder>('inbox');
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([]);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const list = await ipc.listThreads({ folder, search: searchQuery.trim() || undefined });
      setThreads(list);
    } catch {
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, [folder, searchQuery]);

  useEffect(() => { if (tab === 'inbox') loadThreads(); }, [tab, loadThreads]);

  const displayedThreads = useMemo(() => {
    let list = unreadOnly ? threads.filter((t) => t.unreadCount > 0) : threads;
    list = [...list].sort((a, b) => {
      const diff = new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      return sortOrder === 'newest' ? diff : -diff;
    });
    return list;
  }, [threads, unreadOnly, sortOrder]);

  const selectedThread = useMemo(() => threads.find((t) => t.threadId === selectedThreadId) || null, [threads, selectedThreadId]);

  const openThread = useCallback(async (t: EmailThread) => {
    setSelectedThreadId(t.threadId);
    try {
      const msgs = await ipc.getThreadMessages(t.threadId);
      setThreadMessages(msgs);
    } catch {
      setThreadMessages([]);
    }
    if (t.unreadCount > 0) {
      await ipc.markThreadRead(t.threadId, true);
      setThreads((prev) => prev.map((x) => x.threadId === t.threadId ? { ...x, unreadCount: 0, isRead: 1 } : x));
    }
  }, []);

  const handleStarThread = async (t: EmailThread, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !t.isStarred;
    await ipc.starMessage(t.lastMsgId, next);
    setThreads((prev) => prev.map((x) => x.threadId === t.threadId ? { ...x, isStarred: next ? 1 : 0 } : x));
  };

  const handleMoveThread = async (t: EmailThread, targetFolder: EmailFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    await ipc.moveThread(t.threadId, targetFolder);
    setThreads((prev) => prev.filter((x) => x.threadId !== t.threadId));
    if (selectedThreadId === t.threadId) { setSelectedThreadId(''); setThreadMessages([]); }
    addToast(targetFolder === 'trash' ? 'Moved to Trash' : targetFolder === 'archive' ? 'Archived' : `Moved to ${targetFolder}`, 'success');
  };

  const handleReplyToThread = () => {
    if (!selectedThread) return;
    const lead = selectedThread.leadId ? leads.find((l) => l.id === selectedThread.leadId) : null;
    if (lead) setSelectedLeadId(lead.id);
    setFollowUpStage('');
    setTemplateKey('general');
    setSubject(selectedThread.subject?.startsWith('Re:') ? selectedThread.subject : `Re: ${selectedThread.subject || ''}`);
    setBody('');
    setTab('compose');
  };

  const analytics = useMemo(() => {
    const sentCount = leads.filter((l) => (l.history || []).some((h) => /email sent/i.test(h.event))).length;
    const repliedCount = leads.filter((l) => l.customFields?.lastReply || l.status === 'Replied' || l.status === 'Interested').length;
    const replyRate = sentCount > 0 ? Math.round((repliedCount / sentCount) * 100) : 0;
    const autoFollowUps = leads.filter((l) => l.customFields?.followUpStage).length;
    return { sentCount, repliedCount, replyRate, autoFollowUps };
  }, [leads]);

  return (
    <div className="email-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="module-header">
        <div className="module-header-info">
          <h2>Email</h2>
          <p>Send outreach and follow-ups to your leads</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {(['compose', 'inbox', 'analytics'] as EmailTab[]).map((t) => (
            <button
              key={t}
              className={`btn-secondary ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
              style={tab === t ? { borderColor: 'var(--accent-border)', color: 'var(--accent)' } : undefined}
            >
              {t === 'compose' ? '✉ Compose' : t === 'inbox' ? `📥 Inbox${threads.some((x) => x.unreadCount > 0) ? ` (${threads.reduce((n, x) => n + (x.unreadCount > 0 ? 1 : 0), 0)})` : ''}` : '📊 Analytics'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'inbox' && (
        <div className="dashboard-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', borderBottom: '1px solid var(--border-glass)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
              {FOLDERS.map((f) => (
                <button
                  key={f.key}
                  className="btn-secondary"
                  onClick={() => { setFolder(f.key); setSelectedThreadId(''); setThreadMessages([]); }}
                  style={folder === f.key ? { borderColor: 'var(--accent-border)', color: 'var(--accent)' } : undefined}
                >
                  {f.icon} {f.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flex: 1, minWidth: 220, maxWidth: 420 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search subject, sender…"
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
              </label>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
                style={{ height: 28, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 var(--space-2)' }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <button className="btn-secondary" onClick={handleCheckReplies} disabled={checkingReplies}>
                {checkingReplies ? '⟳' : '↻'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', minHeight: 420 }}>
            {/* Thread list */}
            <div style={{ width: 360, borderRight: '1px solid var(--border-glass)', overflowY: 'auto', maxHeight: 560 }}>
              {threadsLoading ? (
                <div style={{ padding: 'var(--space-3)', color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>
              ) : displayedThreads.length === 0 ? (
                <div className="empty-state" style={{ padding: 'var(--space-4)' }}>
                  <div className="empty-icon">📭</div>
                  <div className="empty-title">No emails here</div>
                  <div className="empty-desc">{folder === 'inbox' ? 'Replies detected via sync (or "↻") will show up here.' : `Nothing in ${folder}.`}</div>
                </div>
              ) : (
                displayedThreads.map((t) => {
                  const lead = t.leadId ? leads.find((l) => l.id === t.leadId) : null;
                  const unread = t.unreadCount > 0;
                  return (
                    <div
                      key={t.threadId}
                      onClick={() => openThread(t)}
                      style={{
                        padding: 'var(--space-2) var(--space-3)', cursor: 'pointer',
                        borderBottom: '1px solid var(--border-glass)',
                        background: selectedThreadId === t.threadId ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <strong style={{ fontWeight: unread ? 700 : 500, fontSize: 'var(--font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {lead?.businessName || (t.direction === 'outbound' ? t.toAddr : t.fromAddr)}
                        </strong>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{new Date(t.lastMessageAt).toLocaleDateString()}</span>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: unread ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: unread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.subject || '(no subject)'}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.snippet}</div>
                        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                          <button className="btn-icon" title="Star" onClick={(e) => handleStarThread(t, e)} style={{ color: t.isStarred ? 'var(--yellow)' : 'var(--text-tertiary)' }}>{t.isStarred ? '★' : '☆'}</button>
                          {folder !== 'archive' && <button className="btn-icon" title="Archive" onClick={(e) => handleMoveThread(t, 'archive', e)}>🗄</button>}
                          {folder !== 'spam' && <button className="btn-icon" title="Spam" onClick={(e) => handleMoveThread(t, 'spam', e)}>⚠</button>}
                          {folder !== 'trash' && <button className="btn-icon" title="Trash" onClick={(e) => handleMoveThread(t, 'trash', e)}>🗑</button>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message view */}
            <div style={{ flex: 1, padding: 'var(--space-3)', overflowY: 'auto', maxHeight: 560 }}>
              {!selectedThread ? (
                <div className="empty-state" style={{ padding: 'var(--space-4)' }}>
                  <div className="empty-icon">✉️</div>
                  <div className="empty-title">Select an email</div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                    <h4 style={{ margin: 0 }}>{selectedThread.subject || '(no subject)'}</h4>
                    <button className="btn-primary" onClick={handleReplyToThread}>↩ Reply</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {threadMessages.map((m) => (
                      <div key={m.id} style={{ padding: 'var(--space-3)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                          <span>{m.direction === 'outbound' ? `To: ${m.toAddr}` : `From: ${m.fromAddr}`}</span>
                          <span>{new Date(m.at).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>{m.bodyText || m.snippet}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="dashboard-card">
          <h4 style={{ marginBottom: 'var(--space-3)' }}>Outreach Performance</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{analytics.sentCount}</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Leads emailed</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--green)' }}>{analytics.repliedCount}</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Replied</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--accent)' }}>{analytics.replyRate}%</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Reply rate</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{sendCount.count}</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Sent today</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{analytics.autoFollowUps}</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>In follow-up sequence</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'compose' && (
      <>
      {/* Accounts */}
      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-2)' }}>Email Accounts</h4>
        {accounts.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>Not configured — add an account below.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {accounts.map((a) => (
              <div
                key={a.id}
                onClick={() => setSelectedAccountId(a.id)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: `1px solid ${a.id === selectedAccountId ? 'var(--accent-border)' : 'var(--border-glass)'}`,
                }}
              >
                <div>
                  <span style={{ color: a.status === 'ok' ? 'var(--green)' : a.status === 'error' ? 'var(--red)' : 'var(--text-tertiary)' }}>
                    {a.status === 'ok' ? '✓' : a.status === 'error' ? '✗' : '·'}
                  </span>{' '}
                  {a.email} <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>({a.provider}/{a.authType})</span>
                </div>
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleRemoveAccount(a.id); }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {status.configured && sendCount.hardStopAt > 0 && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: nearLimit ? 'var(--yellow)' : 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>
              Daily sends ({status.email}): {sendCount.count}/{sendCount.hardStopAt}
              {nearLimit ? ' — approaching the safe daily limit' : ''}
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.min(limitPct, 100)}%`, background: nearLimit ? 'var(--yellow)' : 'var(--accent)' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Compose */}
      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Compose</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="field-group">
            <label>Lead</label>
            <select
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              style={{ height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 var(--space-2)' }}
            >
              <option value="">
                {emailableLeads.length ? 'Select a lead…' : 'No leads with an email address yet'}
              </option>
              {emailableLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.businessName} — {l.email}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className="field-group" style={{ flex: 1, minWidth: 200 }}>
              <label>Template</label>
              <select
                value={templateKey}
                onChange={(e) => { setTemplateKey(e.target.value); setFollowUpStage(''); }}
                disabled={!!followUpStage}
                style={{ height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 var(--space-2)' }}
              >
                {TEMPLATE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="field-group" style={{ flex: 1, minWidth: 200 }}>
              <label>Follow-up stage</label>
              <select
                value={followUpStage}
                onChange={(e) => setFollowUpStage(e.target.value)}
                style={{ height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 var(--space-2)' }}
              >
                <option value="">Not a follow-up</option>
                {FOLLOWUP_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field-group" style={{ flex: 1, minWidth: 200 }}>
              <label>From name</label>
              <input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Your name"
              />
            </div>
          </div>

          <div className="field-group">
            <label>Subject</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={rendering ? 'Rendering…' : 'Subject'} />
          </div>

          <div className="field-group">
            <label>Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder={rendering ? 'Rendering…' : 'Email body'}
              style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: 'var(--space-2)', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={handleSend} disabled={sending || !status.configured || !selectedLead?.email}>
              {sending ? 'Sending…' : '✉ Send'}
            </button>
            <button className="btn-secondary" onClick={handleRender} disabled={!selectedLead || rendering}>
              ↻ Reset to template
            </button>
            {!status.configured && (
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>
                Configure SMTP below before sending.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Add account (App Password path; OAuth is Settings > Integrations) */}
      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Add Account (App Password)</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="field-group">
            <label>Email Address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" />
          </div>
          <div className="field-group">
            <label>App Password</label>
            <input type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="app-specific password" />
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
            Use an app-specific password (Gmail: {' '}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">generate one here</a>
            ) — not your regular password. For OAuth sign-in (recommended, no app password needed), see Settings &gt; Integrations.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button className="btn-primary" onClick={handleAddAccount} disabled={savingCreds}>{savingCreds ? '⟳ Verifying…' : 'Add & Verify'}</button>
            {saveStatus && <span style={{ fontSize: 'var(--font-size-sm)' }}>{saveStatus}</span>}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
