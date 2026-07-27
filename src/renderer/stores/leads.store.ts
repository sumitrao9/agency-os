import { create } from 'zustand';
import type { Lead, RuleResult } from '@shared/types';
import { ipc } from '../lib/ipc';

interface LeadsState {
  leads: Lead[];
  selectedLeadId: string | null;
  leadPriorityCache: Record<string, { updatedDate: string; ruled: RuleResult }>;
  searchQuery: string;
  statusFilter: string;
  priorityFilter: string;
  loading: boolean;

  // Actions
  setLeads: (leads: Lead[]) => void;
  refreshLeads: () => Promise<void>;
  selectLead: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: string) => void;
  setPriorityFilter: (filter: string) => void;
  updateLeadInStore: (id: string, data: Partial<Lead>) => void;
  getSelectedLead: () => Lead | null;
  getCachedRule: (leadId: string) => RuleResult | null;
  refreshPriorityCache: () => Promise<void>;
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: [],
  selectedLeadId: null,
  leadPriorityCache: {},
  searchQuery: '',
  statusFilter: '',
  priorityFilter: '',
  loading: false,

  setLeads: (leads) => set({ leads }),

  refreshLeads: async () => {
    try {
      set({ loading: true });
      const freshLeads = await ipc.getAllLeads();
      set({ leads: freshLeads, loading: false });

      // Recompute priority cache for new/changed leads
      const cache = get().leadPriorityCache;
      const needsRuling = freshLeads.filter((l) => {
        const cached = cache[l.id];
        return !cached || cached.updatedDate !== l.updatedDate;
      });

      if (needsRuling.length > 0) {
        const ruled = await ipc.applyRulesBatch(needsRuling);
        needsRuling.forEach((l, i) => {
          cache[l.id] = { updatedDate: l.updatedDate, ruled: ruled[i] };
        });

        // Clean up stale cache entries
        const currentIds = new Set(freshLeads.map((l) => l.id));
        for (const id of Object.keys(cache)) {
          if (!currentIds.has(id)) delete cache[id];
        }

        set({ leadPriorityCache: { ...cache } });
      }
    } catch (e) {
      console.error('Failed to refresh leads:', e);
      set({ loading: false });
    }
  },

  selectLead: (id) => set({ selectedLeadId: id }),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setPriorityFilter: (filter) => set({ priorityFilter: filter }),

  updateLeadInStore: (id, data) => {
    set((state) => ({
      leads: state.leads.map((l) => (l.id === id ? { ...l, ...data } : l)),
    }));
  },

  getSelectedLead: () => {
    const state = get();
    return state.leads.find((l) => l.id === state.selectedLeadId) ?? null;
  },

  getCachedRule: (leadId) => {
    const cache = get().leadPriorityCache[leadId];
    return cache?.ruled ?? null;
  },

  refreshPriorityCache: async () => {
    const state = get();
    if (state.leads.length === 0) return;
    const cache = state.leadPriorityCache;
    const needsRuling = state.leads.filter((l) => {
      const cached = cache[l.id];
      return !cached || cached.updatedDate !== l.updatedDate;
    });

    if (needsRuling.length > 0) {
      const ruled = await ipc.applyRulesBatch(needsRuling);
      needsRuling.forEach((l, i) => {
        cache[l.id] = { updatedDate: l.updatedDate, ruled: ruled[i] };
      });
      set({ leadPriorityCache: { ...cache } });
    }
  },
}));
