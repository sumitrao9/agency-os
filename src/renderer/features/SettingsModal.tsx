import { useState, useEffect } from 'react';
import { useUIStore } from '../stores/ui.store';
import ipc from '../lib/ipc';
import type { ThemeMode, SpacingMode, EmailAccount } from '@shared/types';

export default function SettingsModal() {
  const {
    settingsOpen, setSettingsOpen,
    themeMode, setThemeMode,
    accentHue, accentSaturation, accentLightness, setAccentColor,
    fontSize, setFontSize,
    spacing, setSpacing,
  } = useUIStore();

  const [localHue, setLocalHue] = useState(accentHue);
  const [localSat, setLocalSat] = useState(accentSaturation);
  const [localLight, setLocalLight] = useState(accentLightness);
  const [localFontSize, setLocalFontSize] = useState(fontSize);
  const [autoFollowUp, setAutoFollowUp] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);

  // Integrations: OAuth apps (Google/Microsoft) + provider status.
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleSource, setGoogleSource] = useState<'built-in' | 'byoc'>('built-in');
  const [msClientId, setMsClientId] = useState('');
  const [msClientSecret, setMsClientSecret] = useState('');
  const [msSource, setMsSource] = useState<'built-in' | 'byoc'>('built-in');
  const [integrationsAccounts, setIntegrationsAccounts] = useState<EmailAccount[]>([]);
  const [oauthStatus, setOauthStatus] = useState('');

  useEffect(() => {
    if (settingsOpen) {
      setLocalHue(accentHue);
      setLocalSat(accentSaturation);
      setLocalLight(accentLightness);
      setLocalFontSize(fontSize);
      ipc.getAppSettings().then((s) => { setAutoFollowUp(!!s.autoFollowUp); setWebhookUrl(s.webhookUrl || ''); }).catch(() => {});
      ipc.getLaunchAtStartup().then(setLaunchAtStartup).catch(() => {});
      ipc.getOAuthApp('google').then((a) => { setGoogleClientId(a.clientId || ''); setGoogleSource(a.source); }).catch(() => {});
      ipc.getOAuthApp('microsoft').then((a) => { setMsClientId(a.clientId || ''); setMsSource(a.source); }).catch(() => {});
      ipc.listEmailAccounts().then(setIntegrationsAccounts).catch(() => {});
    }
  }, [settingsOpen, accentHue, accentSaturation, accentLightness, fontSize]);

  const handleSaveGoogleOAuth = async () => {
    await ipc.saveOAuthApp('google', googleClientId.trim(), googleClientSecret.trim());
    setGoogleClientSecret('');
    const a = await ipc.getOAuthApp('google');
    setGoogleSource(a.source);
  };

  const handleSaveMsOAuth = async () => {
    await ipc.saveOAuthApp('microsoft', msClientId.trim(), msClientSecret.trim());
    setMsClientSecret('');
    const a = await ipc.getOAuthApp('microsoft');
    setMsSource(a.source);
  };

  const handleSignIn = async (provider: 'google' | 'microsoft') => {
    setOauthStatus(`Opening ${provider === 'google' ? 'Google' : 'Microsoft'} sign-in…`);
    try {
      const result = await ipc.startEmailOAuth(provider);
      if (result.ok) {
        setOauthStatus('✓ Account connected');
        ipc.listEmailAccounts().then(setIntegrationsAccounts).catch(() => {});
        // EmailModule fetches its own account list once on mount and has no
        // way to know a new account just got added from here — broadcast so
        // it (and anything else showing account status) can refetch live
        // instead of only picking this up on the next full app reload.
        window.dispatchEvent(new CustomEvent('agencyos:accounts-changed'));
      } else {
        setOauthStatus(`✗ ${result.error}`);
      }
    } catch (e) {
      setOauthStatus(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleToggleLaunchAtStartup = async () => {
    const next = !launchAtStartup;
    setLaunchAtStartup(next);
    const actual = await ipc.setLaunchAtStartup(next);
    setLaunchAtStartup(actual);
  };

  const handleSaveWebhook = async () => {
    setWebhookSaving(true);
    try {
      const current = await ipc.getAppSettings();
      await ipc.saveAppSettings({ ...current, webhookUrl: webhookUrl.trim() });
    } finally {
      setWebhookSaving(false);
    }
  };

  const handleToggleAutoFollowUp = async () => {
    const next = !autoFollowUp;
    setAutoFollowUp(next);
    // settings:save overwrites the whole file — merge onto the current
    // saved settings so this toggle never clobbers unrelated fields.
    const current = await ipc.getAppSettings();
    await ipc.saveAppSettings({ ...current, autoFollowUp: next });
  };

  const handleApply = () => {
    setAccentColor(localHue, localSat, localLight);
    setFontSize(localFontSize);
    setSettingsOpen(false);
  };

  if (!settingsOpen) return null;

  return (
    <div className="modal-overlay open" onClick={() => setSettingsOpen(false)}>
      <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="btn-icon" onClick={() => setSettingsOpen(false)}>✕</button>
        </div>

        <div className="settings-content">
          {/* Theme */}
          <div className="settings-section">
            <h3>Theme</h3>
            <div className="settings-row">
              <label>Mode</label>
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${themeMode === 'dark' ? 'active' : ''}`}
                  onClick={() => setThemeMode('dark' as ThemeMode)}
                >
                  Dark
                </button>
                <button
                  className={`toggle-btn ${themeMode === 'light' ? 'active' : ''}`}
                  onClick={() => setThemeMode('light' as ThemeMode)}
                >
                  Light
                </button>
              </div>
            </div>
          </div>

          {/* Accent Color */}
          <div className="settings-section">
            <h3>Accent Color</h3>
            <div className="settings-row">
              <label>Hue</label>
              <input
                type="range"
                min="0"
                max="360"
                value={localHue}
                onChange={(e) => setLocalHue(parseInt(e.target.value))}
                className="range-slider"
              />
              <span className="range-value">{localHue}°</span>
            </div>
            <div className="settings-row">
              <label>Saturation</label>
              <input
                type="range"
                min="0"
                max="100"
                value={localSat}
                onChange={(e) => setLocalSat(parseInt(e.target.value))}
                className="range-slider"
              />
              <span className="range-value">{localSat}%</span>
            </div>
            <div className="settings-row">
              <label>Lightness</label>
              <input
                type="range"
                min="20"
                max="90"
                value={localLight}
                onChange={(e) => setLocalLight(parseInt(e.target.value))}
                className="range-slider"
              />
              <span className="range-value">{localLight}%</span>
            </div>
            <div className="color-preview" style={{ background: `hsl(${localHue}, ${localSat}%, ${localLight}%)` }} />
          </div>

          {/* Font Size */}
          <div className="settings-section">
            <h3>Font Size</h3>
            <div className="settings-row">
              <label>Base Size</label>
              <input
                type="range"
                min="11"
                max="18"
                step="1"
                value={localFontSize}
                onChange={(e) => setLocalFontSize(parseInt(e.target.value))}
                className="range-slider"
              />
              <span className="range-value">{localFontSize}px</span>
            </div>
          </div>

          {/* Startup */}
          <div className="settings-section">
            <h3>Startup</h3>
            <div className="settings-row">
              <label>Launch AgencyOS at login</label>
              <button
                className={`toggle-btn ${launchAtStartup ? 'active' : ''}`}
                onClick={handleToggleLaunchAtStartup}
                title="When on, AgencyOS starts automatically when you log into Windows."
              >
                {launchAtStartup ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Automation */}
          <div className="settings-section">
            <h3>Automation</h3>
            <div className="settings-row">
              <label>Auto follow-up sequences</label>
              <button
                className={`toggle-btn ${autoFollowUp ? 'active' : ''}`}
                onClick={handleToggleAutoFollowUp}
                title="When on, leads with no reply get an automatic nudge after 4 days and a breakup email after 10 days — capped at 15 sends/day and respecting your daily send limit and do-not-contact list."
              >
                {autoFollowUp ? 'On' : 'Off'}
              </button>
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              Off by default. When on: auto-sends a nudge 4 days after a lead goes untouched, then a breakup email at 10 days — never a third message. Runs at most once per ~20h, respects your daily send cap and blacklist.
            </p>
            <div className="settings-row" style={{ marginTop: 'var(--space-3)' }}>
              <label>Webhook URL</label>
              <input
                type="text"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                onBlur={handleSaveWebhook}
                placeholder="https://hooks.zapier.com/... (optional)"
                style={{ flex: 1 }}
              />
              {webhookSaving && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Saving…</span>}
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              Empty by default. When set, every newly captured lead (scraper, browser extract, or import) is POSTed here as JSON the moment it's saved — feed it into Zapier/Make/n8n or any CRM's webhook intake with zero manual export.
            </p>
          </div>

          {/* Integrations */}
          <div className="settings-section">
            <h3>Integrations</h3>

            <h4 style={{ margin: 'var(--space-2) 0 var(--space-1)' }}>Google OAuth</h4>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', margin: '0 0 4px' }}>
              Currently using {googleSource === 'byoc' ? 'your own Client ID/Secret' : "AgencyOS's built-in app (recommended)"}.
            </p>
            <div className="settings-row">
              <label>Client ID</label>
              <input type="text" value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} placeholder="Leave blank to use built-in" style={{ flex: 1 }} autoComplete="off" name="google-oauth-client-id" />
            </div>
            <div className="settings-row">
              <label>Client Secret</label>
              <input type="password" value={googleClientSecret} onChange={(e) => setGoogleClientSecret(e.target.value)} placeholder="Leave blank to keep current" style={{ flex: 1 }} autoComplete="new-password" name="google-oauth-client-secret" />
            </div>
            <div className="settings-row" style={{ gap: 'var(--space-2)' }}>
              <button className="btn-secondary" onClick={handleSaveGoogleOAuth}>Save</button>
              <button className="btn-primary" onClick={() => handleSignIn('google')}>Sign in with Google</button>
            </div>

            <h4 style={{ margin: 'var(--space-3) 0 var(--space-1)' }}>Microsoft OAuth</h4>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', margin: '0 0 4px' }}>
              Currently using {msSource === 'byoc' ? 'your own Client ID/Secret' : "AgencyOS's built-in app (recommended)"}.
            </p>
            <div className="settings-row">
              <label>Client ID</label>
              <input type="text" value={msClientId} onChange={(e) => setMsClientId(e.target.value)} placeholder="Leave blank to use built-in" style={{ flex: 1 }} autoComplete="off" name="ms-oauth-client-id" />
            </div>
            <div className="settings-row">
              <label>Client Secret</label>
              <input type="password" value={msClientSecret} onChange={(e) => setMsClientSecret(e.target.value)} placeholder="Leave blank to keep current" style={{ flex: 1 }} autoComplete="new-password" name="ms-oauth-client-secret" />
            </div>
            <div className="settings-row" style={{ gap: 'var(--space-2)' }}>
              <button className="btn-secondary" onClick={handleSaveMsOAuth}>Save</button>
              <button className="btn-primary" onClick={() => handleSignIn('microsoft')}>Sign in with Microsoft</button>
            </div>

            {oauthStatus && <p style={{ fontSize: 'var(--font-size-xs)', margin: '4px 0' }}>{oauthStatus}</p>}

            <h4 style={{ margin: 'var(--space-3) 0 var(--space-1)' }}>Provider Status</h4>
            {integrationsAccounts.length === 0 ? (
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>No email accounts connected yet — use the Email module or sign in above.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {integrationsAccounts.map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)' }}>
                    <span>{a.email} ({a.provider}/{a.authType})</span>
                    <span style={{ color: a.status === 'ok' ? 'var(--green)' : a.status === 'error' ? 'var(--red)' : 'var(--text-tertiary)' }}>{a.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Spacing */}
          <div className="settings-section">
            <h3>Density</h3>
            <div className="settings-row">
              <label>Layout</label>
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${spacing === 'comfortable' ? 'active' : ''}`}
                  onClick={() => setSpacing('comfortable' as SpacingMode)}
                >
                  Comfortable
                </button>
                <button
                  className={`toggle-btn ${spacing === 'compact' ? 'active' : ''}`}
                  onClick={() => setSpacing('compact' as SpacingMode)}
                >
                  Compact
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => setSettingsOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
