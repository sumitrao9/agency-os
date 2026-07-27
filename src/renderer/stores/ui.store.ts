import { create } from 'zustand';
import type { ThemeMode, SpacingMode, ModuleName, ThemeSettings } from '@shared/types';
import ipc from '../lib/ipc';

interface UIState {
  // Theme
  themeMode: ThemeMode;
  accentHue: number;
  accentSaturation: number;
  accentLightness: number;
  fontSize: number;
  spacing: SpacingMode;

  // Layout
  sidebarCollapsed: boolean;
  activeModule: ModuleName;
  rightPanelTab: 'jobs' | 'devtools';
  rightPanelOpen: boolean;

  // One-click "Email" from Leads jumps to the Email module pre-targeting this lead.
  composeLeadId: string | null;
  setComposeLeadId: (leadId: string | null) => void;

  // Modals
  commandPaletteOpen: boolean;
  globalSearchOpen: boolean;
  settingsOpen: boolean;

  // Notifications
  toasts: Array<{ id: string; message: string; type: 'success' | 'error' | 'info' | 'warning'; duration?: number }>;

  // Actions
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (h: number, s: number, l: number) => void;
  setFontSize: (size: number) => void;
  setSpacing: (spacing: SpacingMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveModule: (module: ModuleName) => void;
  setRightPanelTab: (tab: 'jobs' | 'devtools') => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setGlobalSearchOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  applyThemeSettings: (settings: ThemeSettings) => void;

  // Toasts
  addToast: (message: string, type: 'success' | 'error' | 'info' | 'warning', duration?: number) => string;
  removeToast: (id: string) => void;
}

let toastCounter = 0;

// Theme lives in two places on purpose: localStorage is a synchronous cache
// so the first paint uses the right theme, and theme.json (via IPC) is the
// durable store that survives a cleared cache. Writes are fire-and-forget —
// a failed disk write must never block the UI from updating.
function persistTheme(state: Pick<UIState, 'themeMode' | 'accentHue' | 'accentSaturation' | 'accentLightness' | 'fontSize' | 'spacing'>) {
  void ipc.saveThemeSettings({
    mode: state.themeMode,
    accentHue: state.accentHue,
    accentSaturation: state.accentSaturation,
    accentLightness: state.accentLightness,
    fontSize: state.fontSize,
    spacing: state.spacing,
  }).catch(() => { /* disk write is best-effort; localStorage already holds it */ });
}

function applyThemeToDom(s: ThemeSettings) {
  const root = document.documentElement;
  root.setAttribute('data-theme', s.mode);
  root.setAttribute('data-spacing', s.spacing);
  root.style.setProperty('--accent-h', String(s.accentHue));
  root.style.setProperty('--accent-s', `${s.accentSaturation}%`);
  root.style.setProperty('--accent-l', `${s.accentLightness}%`);
  root.style.setProperty('--font-size-base', `${s.fontSize}px`);
}

export const useUIStore = create<UIState>((set, get) => ({
  // Default theme
  themeMode: 'dark',
  accentHue: 140,
  accentSaturation: 100,
  accentLightness: 70,
  fontSize: 13,
  spacing: 'comfortable',

  // Layout defaults
  sidebarCollapsed: false,
  activeModule: 'dashboard',
  composeLeadId: null,
  rightPanelTab: 'jobs',
  rightPanelOpen: false,

  // Modals
  commandPaletteOpen: false,
  globalSearchOpen: false,
  settingsOpen: false,

  toasts: [],

  setThemeMode: (mode) => {
    set({ themeMode: mode });
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('theme-mode', mode);
    persistTheme(get());
  },

  setAccentColor: (h, s, l) => {
    set({ accentHue: h, accentSaturation: s, accentLightness: l });
    document.documentElement.style.setProperty('--accent-h', String(h));
    document.documentElement.style.setProperty('--accent-s', `${s}%`);
    document.documentElement.style.setProperty('--accent-l', `${l}%`);
    localStorage.setItem('accent-h', String(h));
    localStorage.setItem('accent-s', String(s));
    localStorage.setItem('accent-l', String(l));
    persistTheme(get());
  },

  setFontSize: (size) => {
    set({ fontSize: size });
    document.documentElement.style.setProperty('--font-size-base', `${size}px`);
    localStorage.setItem('font-size', String(size));
    persistTheme(get());
  },

  setSpacing: (spacing) => {
    set({ spacing });
    document.documentElement.setAttribute('data-spacing', spacing);
    localStorage.setItem('spacing', spacing);
    persistTheme(get());
  },

  // Applies settings loaded from disk: updates state, DOM and the
  // localStorage cache, but deliberately does not write back to disk.
  applyThemeSettings: (s) => {
    set({
      themeMode: s.mode,
      accentHue: s.accentHue,
      accentSaturation: s.accentSaturation,
      accentLightness: s.accentLightness,
      fontSize: s.fontSize,
      spacing: s.spacing,
    });
    applyThemeToDom(s);
    localStorage.setItem('theme-mode', s.mode);
    localStorage.setItem('accent-h', String(s.accentHue));
    localStorage.setItem('accent-s', String(s.accentSaturation));
    localStorage.setItem('accent-l', String(s.accentLightness));
    localStorage.setItem('font-size', String(s.fontSize));
    localStorage.setItem('spacing', s.spacing);
  },

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setActiveModule: (module) => set({ activeModule: module }),
  setComposeLeadId: (leadId) => set({ composeLeadId: leadId }),

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),

  // These three overlays are mutually exclusive — opening one closes the
  // other two here, at the single point every call site goes through,
  // rather than requiring every caller (sidebar, topbar, command palette,
  // keyboard shortcuts) to remember to close the others themselves. Without
  // this, opening Settings while Search was already open left both mounted
  // and stacked on screen simultaneously.
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open, ...(open ? { globalSearchOpen: false, settingsOpen: false } : {}) }),
  setGlobalSearchOpen: (open) => set({ globalSearchOpen: open, ...(open ? { commandPaletteOpen: false, settingsOpen: false } : {}) }),
  setSettingsOpen: (open) => set({ settingsOpen: open, ...(open ? { commandPaletteOpen: false, globalSearchOpen: false } : {}) }),

  addToast: (message, type, duration = 4000) => {
    const id = `toast-${++toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration }],
    }));
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
