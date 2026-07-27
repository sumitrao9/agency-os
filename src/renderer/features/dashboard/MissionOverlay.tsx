import { useState, useEffect } from 'react';

const MISSION_KEY = 'agency-os-mission-dismissed';

export default function MissionOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(MISSION_KEY);
    if (!dismissed) {
      setVisible(true);
    }
  }, []);

  const handleDismiss = (action: string) => {
    localStorage.setItem(MISSION_KEY, action);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="mission-overlay">
      <div className="mission-card">
        <div className="mission-icon">◉</div>
        <h2>Welcome to Agency OS</h2>
        <p className="mission-subtitle">
          Your personal operating system for running and growing your service business.
        </p>

        <div className="mission-steps">
          <div className="mission-step">
            <div className="step-number">1</div>
            <div className="step-content">
              <div className="step-title">Configure Email</div>
              <div className="step-desc">Set up your Gmail SMTP to start sending outreach</div>
            </div>
          </div>
          <div className="mission-step">
            <div className="step-number">2</div>
            <div className="step-content">
              <div className="step-title">Import or Capture Leads</div>
              <div className="step-desc">Use the browser or Chrome extension to find leads</div>
            </div>
          </div>
          <div className="mission-step">
            <div className="step-number">3</div>
            <div className="step-content">
              <div className="step-title">Score & Prioritize</div>
              <div className="step-desc">The rules engine automatically scores each lead</div>
            </div>
          </div>
          <div className="mission-step">
            <div className="step-number">4</div>
            <div className="step-content">
              <div className="step-title">Send Outreach</div>
              <div className="step-desc">Use email templates to reach out to high-priority leads</div>
            </div>
          </div>
        </div>

        <div className="mission-actions">
          <button className="btn-primary" onClick={() => handleDismiss('started')}>
            Get Started
          </button>
          <button className="btn-secondary" onClick={() => handleDismiss('skip')}>
            Skip — I know what I'm doing
          </button>
        </div>
      </div>
    </div>
  );
}
