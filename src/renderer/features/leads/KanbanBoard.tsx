import { useState } from 'react';
import type { Lead, ScoreResult } from '@shared/types';
import { useLeadsStore } from '../../stores/leads.store';

interface KanbanBoardProps {
  leads: Lead[];
  onStatusChange: (leadId: string, status: string) => void;
  onSelect: (leadId: string) => void;
}

// Native HTML5 drag-and-drop — no drag-drop library needed for one board
// with 8 fixed columns; dnd-kit etc. would be real overkill here.
const COLUMNS = ['New', 'Qualified', 'Sent', 'Replied', 'Interested', 'Call Scheduled', 'Won', 'Lost'];

const COLUMN_COLOR: Record<string, string> = {
  New: 'var(--blue, #3b82f6)', Qualified: 'var(--accent)', Sent: 'var(--yellow, #f59e0b)',
  Replied: 'var(--green)', Interested: 'var(--green)', 'Call Scheduled': 'var(--accent)',
  Won: 'var(--green)', Lost: 'var(--red)',
};

export default function KanbanBoard({ leads, onStatusChange, onSelect }: KanbanBoardProps) {
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const columnLeads = (status: string) => leads.filter((l) => (l.status || 'New') === status);

  return (
    <div style={{ flex: 1, display: 'flex', gap: 'var(--space-2)', overflow: 'auto', paddingBottom: 'var(--space-2)' }}>
      {COLUMNS.map((col) => {
        const items = columnLeads(col);
        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(col); }}
            onDragLeave={() => setDragOverCol((c) => (c === col ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCol(null);
              if (dragLeadId) onStatusChange(dragLeadId, col);
              setDragLeadId(null);
            }}
            style={{
              width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-2)',
              background: dragOverCol === col ? 'var(--accent-bg)' : 'var(--bg-elevated)',
              border: dragOverCol === col ? '1px dashed var(--accent-border)' : '1px solid var(--border-glass)',
              transition: 'all var(--anim-fast)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLUMN_COLOR[col] }} />
              <strong style={{ fontSize: 'var(--font-size-sm)' }}>{col}</strong>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{items.length}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflowY: 'auto', minHeight: 40 }}>
              {items.map((lead) => {
                const score = (lead.customFields?.scoring as ScoreResult | undefined)?.total;
                const closeProbability = useLeadsStore.getState().leadPriorityCache[lead.id]?.ruled?.closeProbability;
                return (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragLeadId(lead.id)}
                    onDragEnd={() => setDragLeadId(null)}
                    onClick={() => onSelect(lead.id)}
                    className="dashboard-card"
                    style={{ padding: 'var(--space-2)', cursor: 'grab', opacity: dragLeadId === lead.id ? 0.5 : 1 }}
                  >
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lead.businessName}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{lead.category || '—'}</span>
                      {score != null && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)' }}>{score}</span>}
                    </div>
                    {closeProbability != null && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className={`badge badge-${closeProbability >= 80 ? 'green' : closeProbability >= 50 ? 'yellow' : 'accent'}`}
                          style={{ fontSize: 10 }}
                          title="Close probability"
                        >
                          {closeProbability}% close
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', textAlign: 'center', padding: 'var(--space-3) 0' }}>Empty</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
