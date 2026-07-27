import { useState, useEffect } from 'react';
import { useUIStore } from '../stores/ui.store';
import ipc from '../lib/ipc';
import type { ThemeMode, SpacingMode } from '@shared/types';

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

  useEffect(() => {
    if (settingsOpen) {
      setLocalHue(accentHue);
      setLocalSat(accentSaturation);
      setLocalLight(accentLightness);
      setLocalFontSize(fontSize);
      ipc.getAppSettings().then((s) => { setAutoFollowUp(!!s.autoFollowUp); setWebhookUrl(s.webhookUrl || ''); }).catch(() => {});
      ipc.getLaunchAtStartup().then(setLaunchAtStartup).catch(() => {});
    }
  }, [settingsOpen, accentHue, accentSaturation, accentLightness, fontSize]);

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
