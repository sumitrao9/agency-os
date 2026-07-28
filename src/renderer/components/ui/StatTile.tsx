import * as React from 'react';

export type StatTileAccent = 'purple' | 'green' | 'blue' | 'orange' | 'pink';

interface StatTileProps {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent: StatTileAccent;
}

export default function StatTile({ icon, label, value, sub, accent }: StatTileProps) {
  return (
    <div className={`kpi-card kpi-${accent}`}>
      {icon && <div className="kpi-icon">{icon}</div>}
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
