// ============================================================
// Shared Types — used by both main and renderer processes
// ============================================================

export interface Lead {
  id: string;
  businessName: string;
  category?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  googleMapsUrl?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  tags: string[];
  priority: string;
  leadSource: string;
  createdDate: string;
  updatedDate: string;
  status: string;
  owner?: string | null;
  notes?: string | null;
  history: HistoryEntry[];
  customFields: Record<string, unknown>;
  dedupeKey?: string | null;
}

export interface HistoryEntry {
  at: string;
  event: string;
}

export interface LeadInput {
  businessName: string;
  category?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  googleMapsUrl?: string;
  rating?: number;
  reviewCount?: number;
  tags?: string[];
  priority?: string;
  leadSource?: string;
  status?: string;
  notes?: string;
  // Dedup policy override — defaults to true (match by shared website domain
  // as well as phone/Maps-ID/name). Turn off per-scrape for niches where
  // domain-sharing causes false-positive skips (franchises, directory sites,
  // multi-location businesses on one corporate domain).
  useDomainDedup?: boolean;
}

export interface RuleResult {
  priority: string;
  tags: string[];
  recommendedTemplate: string;
  revenueLow: number;
  revenueHigh: number;
  closeProbability: number;
}

export interface EmailAccountStatus {
  configured: boolean;
  email?: string;
}

export interface EmailCredentials {
  email: string;
  appPassword: string;
}

export type EmailProvider = 'gmail' | 'outlook' | 'imap';
export type EmailAuthType = 'oauth' | 'app_password';
export type EmailAccountStatusValue = 'ok' | 'error' | 'unverified';

export interface EmailAccount {
  id: string;
  email: string;
  provider: EmailProvider;
  authType: EmailAuthType;
  displayName?: string;
  signature?: string;
  imapHost?: string | null;
  imapPort?: number | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  status: EmailAccountStatusValue;
  lastError?: string;
  lastSyncUid?: number;
  dailySendCount?: number;
  dailySendDate?: string;
  createdAt?: string;
}

export interface AddEmailAccountInput {
  provider: EmailProvider;
  authType: EmailAuthType;
  email: string;
  appPassword?: string;
  displayName?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

export interface AddEmailAccountResult {
  ok: boolean;
  id?: string;
  verified?: boolean;
  error?: string;
}

export interface OAuthAppInfo {
  clientId: string;
  clientSecret?: string;
  source: 'built-in' | 'byoc';
}

export interface EmailSendPayload {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  inReplyTo?: string;
  references?: string;
  leadId?: string;
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
  messageId?: string;
  warning?: string;
  limitReached?: boolean;
  blacklisted?: boolean;
}

export interface EmailSyncResult {
  ok: boolean;
  newMessages?: Array<{ accountId: string; leadId: string | null; businessName?: string | null; fromAddr: string; subject: string; snippet: string; at: string }>;
  error?: string;
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

export interface EmailThread {
  threadId: string;
  accountId: string;
  leadId: string | null;
  subject: string;
  lastMessageAt: string;
  lastMsgId: string;
  fromAddr: string;
  toAddr: string;
  snippet: string;
  direction: 'inbound' | 'outbound';
  isRead: number;
  isStarred: number;
  folder: 'inbox' | 'archive' | 'trash' | 'spam';
  unreadCount: number;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  accountId: string;
  leadId: string | null;
  direction: 'inbound' | 'outbound';
  fromAddr: string;
  toAddr: string;
  subject: string;
  bodyText: string;
  snippet: string;
  messageId: string;
  inReplyTo: string;
  uid: number | null;
  status: string;
  at: string;
  isRead: number;
  isStarred: number;
  folder: 'inbox' | 'archive' | 'trash' | 'spam';
}

export type EmailFolder = 'inbox' | 'archive' | 'trash' | 'spam';

export type BrowserContextAction = 'scrapePage' | 'saveLead' | 'extractEmails' | 'extractPhones' | 'screenshot' | 'saveCompany' | 'sendToCrm';

export interface BrowserContextResult {
  action: BrowserContextAction;
  status: 'start' | 'done' | 'error';
  error?: string;
  extracted?: { ok: boolean; businessName?: string; website?: string; email?: string; phone?: string; description?: string; socialLinks?: string[] };
  captureResult?: { inserted?: boolean; id?: string; blacklisted?: boolean };
  emails?: string[];
  phones?: string[];
  filePath?: string;
  deep?: { ok: boolean; error?: string };
  queueResult?: { ok: boolean; error?: string };
}

export interface FollowUpRender {
  subject: string;
  body: string;
}

export interface LocationSpoof {
  enabled: boolean;
  lat: number;
  lng: number;
}

export interface HealthStatus {
  ok: boolean;
  results: HealthCheckResult[];
}

export interface HealthCheckResult {
  check: string;
  ok: boolean;
  detail: string;
}

export interface CaptureResult {
  inserted: boolean;
  duplicate?: boolean;
  blacklisted?: boolean;
  reason?: string;
  id?: string;
}

export interface BlacklistEntry {
  id: string;
  matchType: 'email' | 'domain' | 'phone';
  value: string;
  reason: string;
  createdDate: string;
}

export interface BlacklistInput {
  email?: string;
  domain?: string;
  phone?: string;
  reason?: string;
}

export interface DeepScanResult {
  scannedAt: string;
  error?: string;
  socialLinks?: string[];
  description?: string;
  openingHours?: unknown;
  categories?: string[];
  images?: string[];
  robotsTxt?: string;
  sitemapUrls?: string[];
  dns?: { a: string[]; mx: string[] };
  headers?: Record<string, string | string[] | undefined>;
  htmlPath?: string | null;
  screenshotPath?: string | null;
}

// The one shape every module (rules engine, templates, UI) reads —
// regardless of which site/source the raw data came from.
export interface EmailVerification {
  status: 'VALID' | 'INVALID' | 'UNKNOWN';
  reason: string;
}

export interface Business {
  name: string;
  industry: string;
  country: string;
  website: string;
  employees: number | null;
  emails: string[];
  phones: string[];
  services: string[];
  socials: string[];
  reviews: { rating: number | null; count: number };
  traffic: null; // no free/reliable source — always null, never fabricated
  technologies: string[];
  keywords: string[];
}

export type CheckStatus = 'PASS' | 'WARNING' | 'FAIL' | 'UNKNOWN';

export interface WebsiteCheck {
  check: string;
  status: CheckStatus;
  detail: string;
}

export interface WebsiteAnalysis {
  analyzedAt: string;
  checks: WebsiteCheck[];
  summary: Partial<Record<CheckStatus, number>>;
}

export interface BusinessAnswer {
  question: string;
  answer: boolean | number | string; // string is either a text value or literal 'UNKNOWN'
  detail: string;
  confidence: number; // 0-100
}

export interface BusinessProfile {
  analyzedAt: string;
  answers: BusinessAnswer[];
  maturity: { stars: number; confidencePercent: number };
}

export interface TechStack {
  detectedAt: string;
  categories: Record<string, string[]>;
  flat: { name: string; category: string }[];
}

export interface Opportunity {
  gap: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  potentialService: string;
  detail: string;
}

export interface ScoreResult {
  scoredAt: string;
  categories: Record<string, number>; // Website, SEO, Automation, Business Quality, Revenue Potential
  total: number;
  hits: { id: string; category: string; points: number; description: string }[];
  decision: string;
}

export interface ProposalService {
  name: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  gaps: string[];
  priceLow: number;
  priceHigh: number;
}

export interface Proposal {
  services: ProposalService[];
  totalLow: number;
  totalHigh: number;
  bundled: boolean;
  pitchSummary: string;
}

export interface QueueEntry {
  leadId: string;
  businessName: string;
  decision: string;
  proposal: Proposal;
  stage: 'queued' | 'pitch_generated' | 'sent' | 'waiting' | 'replied' | 'follow_up' | 'won';
  pitch: { subject: string; body: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkJobStatus {
  status: 'idle' | 'running' | 'done' | 'cancelled';
  total: number;
  completed: number;
  currentLead?: string | null;
  errors: { leadId: string; businessName: string; error: string }[];
  startedAt?: string;
  finishedAt?: string | null;
}

export interface EmailEnrichResult {
  ok: boolean;
  email?: string;
  guessed?: boolean;
  pagesChecked: number;
}

export interface Job {
  id: string;
  name: string;
  status: 'running' | 'queued' | 'paused' | 'completed' | 'failed' | 'needs-attention';
  progress: number;
  profile?: string;
  retries: number;
}

export interface AutomationConsoleState {
  jobs: Job[];
  queue: QueueItem[];
  alerts: AlertItem[];
}

export interface QueueItem {
  id: string;
  label: string;
  detail: string;
}

export interface AlertItem {
  id: string;
  label: string;
  severity: 'info' | 'warning' | 'success' | 'error';
}

export interface ConsoleAction {
  type: string;
  jobId?: string | null;
}

// Module metadata
export interface ModuleMeta {
  title: string;
  description: string;
  chips: string[];
}

export type ModuleName =
  | 'home'
  | 'dashboard'
  | 'browser'
  | 'leads'
  | 'automations'
  | 'rules'
  | 'files'
  | 'email'
  | 'settings'
  | 'search'
  | 'devtools'
  | 'jobs'
  | 'notifications';

export interface NewReply {
  leadId: string;
  businessName: string;
  snippet: string;
  fromAddress: string;
}

export interface ReplyCheckResult {
  checked: boolean;
  newReplies: NewReply[];
}

export interface Diagnostics {
  dbSizeBytes: number;
  dbPath: string;
  userDataDir: string;
  status: string;
  connectorPort: number | null;
  env: Record<string, string>;
  errors: Array<{ message: string; at: string }>;
}

// Theme
export type ThemeMode = 'dark' | 'light';
export type SpacingMode = 'comfortable' | 'compact';

export interface ThemeSettings {
  mode: ThemeMode;
  accentHue: number;
  accentSaturation: number;
  accentLightness: number;
  fontSize: number;
  spacing: SpacingMode;
}

// Settings
export interface AppSettings {
  theme: ThemeSettings;
  email?: EmailCredentials;
  locationSpoof?: LocationSpoof;
  shortcuts?: Record<string, string>;
  autoFollowUp?: boolean; // default false — auto-sending email is opt-in only
  webhookUrl?: string; // optional — POSTs { event: 'lead.captured', lead } here the moment a new lead is saved
}

// Nav item
export interface NavItem {
  id: ModuleName;
  label: string;
  icon: string;
  badge?: number;
}

// Toast
export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}
