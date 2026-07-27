// ============================================================
// IPC Bridge API — typed wrapper around window.agencyOS
// ============================================================

import type {
  Lead,
  LeadInput,
  RuleResult,
  EmailAccountStatus,
  SendEmailResult,
  RenderedEmail,
  FollowUpRender,
  LocationSpoof,
  HealthStatus,
  CaptureResult,
  EmailEnrichResult,
  AutomationConsoleState,
  ConsoleAction,
  ThemeSettings,
  AppSettings,
  Diagnostics,
  ReplyCheckResult,
  NewReply,
  BlacklistEntry,
  BlacklistInput,
  DeepScanResult,
  Business,
  WebsiteAnalysis,
  BusinessProfile,
  TechStack,
  Opportunity,
  ScoreResult,
  Proposal,
  QueueEntry,
  BulkJobStatus,
} from '@shared/types';

export interface DownloadUpdate {
  id: string; filename: string; url: string;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  receivedBytes: number; totalBytes: number; savePath: string; done?: boolean;
}

export interface AgencyOSAPI {
  // Leads
  getAllLeads(): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | null>;
  captureLead(input: LeadInput): Promise<CaptureResult>;
  updateLead(id: string, data: Partial<Lead>): Promise<void>;
  deleteLead(id: string): Promise<void>;

  // Rules
  applyRules(lead: Lead): Promise<RuleResult>;
  applyRulesBatch(leads: Lead[]): Promise<RuleResult[]>;

  // Email
  getEmailAccountStatus(): Promise<EmailAccountStatus>;
  saveEmailCredentials(email: string, appPassword: string): Promise<{ ok: boolean; encrypted?: boolean; error?: string }>;
  sendEmail(to: string, subject: string, body: string, fromName: string, inReplyTo?: string, references?: string, leadId?: string): Promise<SendEmailResult>;
  renderTemplate(templateName: string, lead: Lead): Promise<RenderedEmail>;
  renderFollowUp(stage: string, lead: Lead): Promise<FollowUpRender>;

  // Location spoof
  saveLocationSpoof(config: LocationSpoof): Promise<void>;
  getLocationSpoof(): Promise<LocationSpoof | null>;

  // Health
  getHealth(): Promise<HealthStatus | null>;

  // Enrichment
  enrichEmail(leadId: string, website: string): Promise<EmailEnrichResult>;

  // Automation
  getAutomationConsoleState(): Promise<AutomationConsoleState>;
  applyAutomationConsoleAction(action: ConsoleAction): Promise<AutomationConsoleState>;

  // Email send count
  getSendCount(): Promise<{ date: string; count: number; warnAt: number; hardStopAt: number }>;

  // Theme/Settings
  getThemeSettings(): Promise<ThemeSettings>;
  saveThemeSettings(settings: ThemeSettings): Promise<void>;
  getAppSettings(): Promise<AppSettings>;
  saveAppSettings(settings: Partial<AppSettings>): Promise<void>;
  getLaunchAtStartup(): Promise<boolean>;
  setLaunchAtStartup(enabled: boolean): Promise<boolean>;
  checkForUpdates(): Promise<unknown>;
  installUpdateNow(): Promise<void>;
  onUpdaterStatus(callback: (payload: { state: string; version?: string; percent?: number; message?: string }) => void): () => void;

  // Diagnostics
  getDiagnostics(): Promise<Diagnostics>;

  // Replies
  checkReplies(): Promise<ReplyCheckResult>;
  onNewReplies(callback: (replies: NewReply[]) => void): () => void;

  // Files
  exportLeadsCsv(leadIds?: string[]): Promise<{ ok: boolean; filePath?: string; count?: number; error?: string }>;
  importLeadsCsv(): Promise<{ ok: boolean; count?: number; inserted?: number; error?: string }>;

  // Blacklist / do-not-contact
  addToBlacklist(entry: BlacklistInput): Promise<{ ok: boolean; error?: string }>;
  removeFromBlacklist(id: string): Promise<{ ok: boolean }>;
  getBlacklist(): Promise<BlacklistEntry[]>;
  checkBlacklist(query: { email?: string; website?: string; phone?: string }): Promise<BlacklistEntry | null>;

  // Deep scan
  deepScan(leadId: string, website: string): Promise<{ ok: boolean; deepScan?: DeepScanResult; websiteAnalysis?: WebsiteAnalysis; businessProfile?: BusinessProfile; techStack?: TechStack; opportunities?: Opportunity[]; scoring?: ScoreResult; proposal?: Proposal; autoNote?: string; error?: string }>;
  getNormalizedBusiness(leadId: string): Promise<Business | null>;
  getLeadScreenshot(leadId: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  extractLeadFromUrl(url: string): Promise<{ ok: boolean; businessName?: string; website?: string; email?: string; phone?: string; description?: string; socialLinks?: string[]; error?: string }>;
  pickExtensionFolder(): Promise<{ ok: boolean; extension?: { id: string; name: string; version: string; path: string }; error?: string }>;
  listExtensions(): Promise<{ id: string; name: string; version: string; path: string }[]>;
  removeExtension(id: string): Promise<{ ok: boolean; error?: string }>;
  setBrowserProxy(partition: string, proxyRules: string): Promise<{ ok: boolean; error?: string }>;
  showDownloadInFolder(savePath: string): Promise<{ ok: boolean }>;
  onDownloadUpdate(callback: (update: DownloadUpdate) => void): () => void;

  // Action queue
  getActionQueue(): Promise<QueueEntry[]>;
  advanceQueueStage(leadId: string, stage: string): Promise<QueueEntry | { ok: boolean; error?: string }>;
  generatePitch(leadId: string): Promise<{ ok: boolean; pitch?: { subject: string; body: string }; error?: string }>;
  addToQueue(leadId: string): Promise<{ ok: boolean; entry?: QueueEntry; error?: string }>;
  openExternal(url: string): Promise<{ ok: boolean; error?: string }>;

  // Bulk operations
  bulkStartDeepScan(leadIds: string[], force?: boolean): Promise<{ ok: boolean; error?: string }>;
  bulkStatus(): Promise<BulkJobStatus>;
  bulkCancel(): Promise<{ ok: boolean }>;
  bulkDelete(leadIds: string[]): Promise<{ ok: boolean; count?: number }>;
  bulkTag(leadIds: string[], tag: string): Promise<{ ok: boolean; count?: number }>;

  // Custom window chrome
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  windowIsMaximized(): Promise<boolean>;
}

export interface ScraperScripts {
  dismissCookieBanner: string;
  autoScroll: string;
  hover: string;
  scrapePage: string;
  clickLoadMore: string;
  pan: (direction: string) => string;
  zoomIn: string;
  zoomOut: string;
  detectCaptcha: string;
}

export interface ScraperUtils {
  buildSearchUrl(source: string, niche: string, location: string): string | null;
}

declare global {
  interface Window {
    agencyOS?: AgencyOSAPI;
    scraperScripts?: ScraperScripts;
    scraperUtils?: ScraperUtils;
  }
}

class IpcBridge {
  get api(): AgencyOSAPI {
    return window.agencyOS ?? ({} as AgencyOSAPI);
  }

  get scraperScripts(): ScraperScripts {
    return window.scraperScripts ?? ({} as ScraperScripts);
  }

  get scraperUtils(): ScraperUtils {
    return window.scraperUtils ?? ({} as ScraperUtils);
  }

  // Leads
  async getAllLeads(): Promise<Lead[]> { return this.api.getAllLeads?.() ?? []; }
  async getLead(id: string): Promise<Lead | null> { return this.api.getLead?.(id) ?? null; }
  async captureLead(input: LeadInput): Promise<CaptureResult> { return this.api.captureLead?.(input) ?? { inserted: false }; }
  async updateLead(id: string, data: Partial<Lead>): Promise<void> { return this.api.updateLead?.(id, data); }
  async deleteLead(id: string): Promise<void> { return this.api.deleteLead?.(id); }

  // Rules
  async applyRules(lead: Lead): Promise<RuleResult> { return this.api.applyRules?.(lead) ?? { priority: 'C', tags: [], recommendedTemplate: 'default', revenueLow: 0, revenueHigh: 0, closeProbability: 0 }; }
  async applyRulesBatch(leads: Lead[]): Promise<RuleResult[]> { return this.api.applyRulesBatch?.(leads) ?? []; }

  // Email
  async getEmailAccountStatus(): Promise<EmailAccountStatus> { return this.api.getEmailAccountStatus?.() ?? { configured: false }; }
  async saveEmailCredentials(email: string, appPassword: string): Promise<{ ok: boolean; encrypted?: boolean; error?: string }> { return this.api.saveEmailCredentials?.(email, appPassword) ?? { ok: false, error: 'Not available' }; }
  async sendEmail(to: string, subject: string, body: string, fromName: string, inReplyTo?: string, references?: string, leadId?: string): Promise<SendEmailResult> { return this.api.sendEmail?.(to, subject, body, fromName, inReplyTo, references, leadId) ?? { ok: false, error: 'Not available' }; }
  async renderTemplate(templateName: string, lead: Lead): Promise<RenderedEmail> { return this.api.renderTemplate?.(templateName, lead) ?? { subject: '', body: '' }; }
  async renderFollowUp(stage: string, lead: Lead): Promise<FollowUpRender> { return this.api.renderFollowUp?.(stage, lead) ?? { subject: '', body: '' }; }

  // Location spoof
  async saveLocationSpoof(config: LocationSpoof): Promise<void> { return this.api.saveLocationSpoof?.(config); }
  async getLocationSpoof(): Promise<LocationSpoof | null> { return this.api.getLocationSpoof?.() ?? null; }

  // Health
  async getHealth(): Promise<HealthStatus | null> { return this.api.getHealth?.() ?? null; }

  // Enrichment
  async enrichEmail(leadId: string, website: string): Promise<EmailEnrichResult> { return this.api.enrichEmail?.(leadId, website) ?? { ok: false, pagesChecked: 0 }; }

  // Automation
  async getAutomationConsoleState(): Promise<AutomationConsoleState> { return this.api.getAutomationConsoleState?.() ?? { jobs: [], queue: [], alerts: [] }; }
  async applyAutomationConsoleAction(action: ConsoleAction): Promise<AutomationConsoleState> { return this.api.applyAutomationConsoleAction?.(action) ?? { jobs: [], queue: [], alerts: [] }; }

  // Email send count
  async getSendCount(): Promise<{ date: string; count: number; warnAt: number; hardStopAt: number }> {
    return this.api.getSendCount?.() ?? { date: '', count: 0, warnAt: 0, hardStopAt: 0 };
  }

  // Theme/Settings
  async getThemeSettings(): Promise<ThemeSettings> { return this.api.getThemeSettings?.() ?? { mode: 'dark', accentHue: 140, accentSaturation: 100, accentLightness: 70, fontSize: 13, spacing: 'comfortable' }; }
  async saveThemeSettings(settings: ThemeSettings): Promise<void> { return this.api.saveThemeSettings?.(settings); }
  async getAppSettings(): Promise<AppSettings> { return this.api.getAppSettings?.() ?? { theme: { mode: 'dark', accentHue: 140, accentSaturation: 100, accentLightness: 70, fontSize: 13, spacing: 'comfortable' } }; }
  async saveAppSettings(settings: Partial<AppSettings>): Promise<void> { return this.api.saveAppSettings?.(settings); }
  async getLaunchAtStartup(): Promise<boolean> { return (await this.api.getLaunchAtStartup?.()) ?? false; }
  async setLaunchAtStartup(enabled: boolean): Promise<boolean> { return (await this.api.setLaunchAtStartup?.(enabled)) ?? false; }
  async checkForUpdates(): Promise<unknown> { return this.api.checkForUpdates?.(); }
  async installUpdateNow(): Promise<void> { return this.api.installUpdateNow?.(); }
  onUpdaterStatus(callback: (payload: { state: string; version?: string; percent?: number; message?: string }) => void): () => void {
    return this.api.onUpdaterStatus?.(callback) ?? (() => {});
  }

  // Replies
  async checkReplies(): Promise<ReplyCheckResult> {
    return this.api.checkReplies?.() ?? { checked: false, newReplies: [] };
  }
  onNewReplies(callback: (replies: NewReply[]) => void): () => void {
    return this.api.onNewReplies?.(callback) ?? (() => {});
  }

  // Diagnostics
  async getDiagnostics(): Promise<Diagnostics> {
    return this.api.getDiagnostics?.() ?? {
      dbSizeBytes: 0, dbPath: '', userDataDir: '', status: 'unknown',
      connectorPort: null, env: {}, errors: [],
    };
  }

  // Files
  async exportLeadsCsv(leadIds?: string[]): Promise<{ ok: boolean; filePath?: string; count?: number; error?: string }> {
    return this.api.exportLeadsCsv?.(leadIds) ?? { ok: false, error: 'Not available' };
  }
  async importLeadsCsv(): Promise<{ ok: boolean; count?: number; inserted?: number; error?: string }> {
    return this.api.importLeadsCsv?.() ?? { ok: false, error: 'Not available' };
  }

  // Blacklist / do-not-contact
  async addToBlacklist(entry: BlacklistInput): Promise<{ ok: boolean; error?: string }> {
    return this.api.addToBlacklist?.(entry) ?? { ok: false, error: 'Not available' };
  }
  async removeFromBlacklist(id: string): Promise<{ ok: boolean }> {
    return this.api.removeFromBlacklist?.(id) ?? { ok: false };
  }
  async getBlacklist(): Promise<BlacklistEntry[]> {
    return this.api.getBlacklist?.() ?? [];
  }
  async checkBlacklist(query: { email?: string; website?: string; phone?: string }): Promise<BlacklistEntry | null> {
    return this.api.checkBlacklist?.(query) ?? null;
  }

  async deepScan(leadId: string, website: string): Promise<{ ok: boolean; deepScan?: DeepScanResult; websiteAnalysis?: WebsiteAnalysis; businessProfile?: BusinessProfile; techStack?: TechStack; opportunities?: Opportunity[]; scoring?: ScoreResult; proposal?: Proposal; autoNote?: string; error?: string }> {
    return this.api.deepScan?.(leadId, website) ?? { ok: false, error: 'Not available' };
  }
  async getNormalizedBusiness(leadId: string): Promise<Business | null> {
    return this.api.getNormalizedBusiness?.(leadId) ?? null;
  }
  async getLeadScreenshot(leadId: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
    return this.api.getLeadScreenshot?.(leadId) ?? { ok: false, error: 'Not available' };
  }
  async extractLeadFromUrl(url: string): Promise<{ ok: boolean; businessName?: string; website?: string; email?: string; phone?: string; description?: string; socialLinks?: string[]; error?: string }> {
    return this.api.extractLeadFromUrl?.(url) ?? { ok: false, error: 'Not available' };
  }
  async pickExtensionFolder(): Promise<{ ok: boolean; extension?: { id: string; name: string; version: string; path: string }; error?: string }> {
    return this.api.pickExtensionFolder?.() ?? { ok: false, error: 'Not available' };
  }
  async listExtensions(): Promise<{ id: string; name: string; version: string; path: string }[]> {
    return this.api.listExtensions?.() ?? [];
  }
  async removeExtension(id: string): Promise<{ ok: boolean; error?: string }> {
    return this.api.removeExtension?.(id) ?? { ok: false, error: 'Not available' };
  }
  async setBrowserProxy(partition: string, proxyRules: string): Promise<{ ok: boolean; error?: string }> {
    return this.api.setBrowserProxy?.(partition, proxyRules) ?? { ok: false, error: 'Not available' };
  }
  async showDownloadInFolder(savePath: string): Promise<{ ok: boolean }> {
    return this.api.showDownloadInFolder?.(savePath) ?? { ok: false };
  }
  onDownloadUpdate(callback: (update: DownloadUpdate) => void): () => void {
    return this.api.onDownloadUpdate?.(callback) ?? (() => {});
  }

  async getActionQueue(): Promise<QueueEntry[]> {
    return this.api.getActionQueue?.() ?? [];
  }
  async advanceQueueStage(leadId: string, stage: string): Promise<QueueEntry | { ok: boolean; error?: string }> {
    return this.api.advanceQueueStage?.(leadId, stage) ?? { ok: false, error: 'Not available' };
  }
  async generatePitch(leadId: string): Promise<{ ok: boolean; pitch?: { subject: string; body: string }; error?: string }> {
    return this.api.generatePitch?.(leadId) ?? { ok: false, error: 'Not available' };
  }
  async addToQueue(leadId: string): Promise<{ ok: boolean; entry?: QueueEntry; error?: string }> {
    return this.api.addToQueue?.(leadId) ?? { ok: false, error: 'Not available' };
  }
  async openExternal(url: string): Promise<{ ok: boolean; error?: string }> {
    return this.api.openExternal?.(url) ?? { ok: false, error: 'Not available' };
  }

  async bulkStartDeepScan(leadIds: string[], force?: boolean): Promise<{ ok: boolean; error?: string }> {
    return this.api.bulkStartDeepScan?.(leadIds, force) ?? { ok: false, error: 'Not available' };
  }
  async bulkStatus(): Promise<BulkJobStatus> {
    return this.api.bulkStatus?.() ?? { status: 'idle', total: 0, completed: 0, errors: [] };
  }
  async bulkCancel(): Promise<{ ok: boolean }> {
    return this.api.bulkCancel?.() ?? { ok: false };
  }
  async bulkDelete(leadIds: string[]): Promise<{ ok: boolean; count?: number }> {
    return this.api.bulkDelete?.(leadIds) ?? { ok: false };
  }
  async bulkTag(leadIds: string[], tag: string): Promise<{ ok: boolean; count?: number }> {
    return this.api.bulkTag?.(leadIds, tag) ?? { ok: false };
  }

  windowMinimize(): void { this.api.windowMinimize?.(); }
  windowMaximize(): void { this.api.windowMaximize?.(); }
  windowClose(): void { this.api.windowClose?.(); }
  async windowIsMaximized(): Promise<boolean> { return this.api.windowIsMaximized?.() ?? false; }
}

export const ipc = new IpcBridge();
export default ipc;
