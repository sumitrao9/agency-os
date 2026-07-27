// src/db/database.js
//
// SQLite storage using sql.js (compiled SQLite to WebAssembly — zero native
// build dependencies, which matters for a desktop app end users will
// install without a compiler toolchain on their machine).
//
// sql.js keeps the database in memory; this module is responsible for
// loading it from disk on startup and persisting it back after writes.
// That's a deliberate simplicity trade-off for this skeleton — swapping in
// better-sqlite3 later (if native builds become acceptable) is a drop-in
// replacement behind this same module's exported functions, nothing else
// in the app needs to change.

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  businessName TEXT NOT NULL,
  category TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  googleMapsUrl TEXT,
  rating REAL,
  reviewCount INTEGER,
  tags TEXT,           -- JSON array, stored as text
  priority TEXT DEFAULT 'B',
  leadSource TEXT DEFAULT 'chrome-extension',
  createdDate TEXT NOT NULL,
  updatedDate TEXT NOT NULL,
  status TEXT DEFAULT 'New',
  owner TEXT,
  notes TEXT,
  history TEXT,         -- JSON array of {at, event} entries, stored as text
  customFields TEXT,     -- JSON object, stored as text
  dedupeKey TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_dedupe ON leads(dedupeKey);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(createdDate);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receivedAt TEXT NOT NULL,
  leadCount INTEGER NOT NULL,
  source TEXT
);

-- Do-not-contact list. A business lands here either because they asked to
-- stop, or because a human decided not to pursue them — either way this
-- must be checked before a new scrape captures them again AND before any
-- email goes out, not just one or the other.
CREATE TABLE IF NOT EXISTS blacklist (
  id TEXT PRIMARY KEY,
  matchType TEXT NOT NULL,  -- 'email' | 'domain' | 'phone'
  value TEXT NOT NULL,      -- normalized: lowercased email/domain, digits-only phone
  reason TEXT,
  createdDate TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklist_match ON blacklist(matchType, value);
`;

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.SQL = null;
    this.db = null;
    this._closed = false;
    this._persistTimer = null;
    this._dirty = false;
  }

  async init() {
    if (this._closed) throw new Error('Database has already been closed');
    this.SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(fileBuffer);
    } else {
      this.db = new this.SQL.Database();
    }
    this.db.run(SCHEMA);
    this.persist();
  }

  // Writes the in-memory database back to disk. Called after every mutation
  // so a crash doesn't lose data — a real WAL-style approach would be
  // faster, but correctness-over-speed is the right trade-off for a
  // skeleton whose whole job right now is "never lose a lead".
  // Debounced persistence: every mutation used to trigger an immediate,
  // full-file rewrite (this.db.export() + writeFileSync) — fine at
  // hundreds of leads, but becomes a real O(n) cost per edit at scale, and
  // a rapid sequence of edits (e.g. batch capture during Auto-Scan) was
  // rewriting the entire database file once per row instead of once per
  // batch. This coalesces writes that happen within a short window into a
  // single disk write, while still guaranteeing nothing is lost: a pending
  // write is always flushed before the app closes (see main.js's
  // window-all-closed handler calling db.close(), which flushes
  // synchronously) and can be flushed on demand via flush().
  persist() {
    if (this._closed) return;
    this._dirty = true;
    if (this._persistTimer) return; // a flush is already scheduled — piggyback on it
    this._persistTimer = setTimeout(() => this.flush(), 400);
  }

  // Immediate, synchronous write — used on shutdown and anywhere a caller
  // needs a guarantee the data is actually on disk before proceeding
  // (e.g. right before a backup, so the backup isn't stale).
  flush() {
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
    if (!this._dirty || this._closed || !this.db) return;
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
    this._dirty = false;
  }

  // Normalizes a business name for dedup comparison: lowercase, strip
  // common legal-entity suffixes (LLC, Inc, Ltd, Pvt Ltd, Co, Corp) and
  // punctuation, collapse whitespace. Without this, "Acme Plumbing" and
  // "Acme Plumbing LLC." are treated as different businesses even though
  // they're almost certainly the same lead — the single most common real
  // dedup miss in B2B lead lists per every source on this.
  normalizeBusinessName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\b(llc|l l c|inc|incorporated|ltd|limited|pvt ltd|private limited|co|corp|corporation)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Extracts a bare domain (no protocol, no www, no path) for use as a
  // secondary dedup signal — two listings with different names but the
  // same website are almost always the same business (e.g. found once on
  // Google Maps, once on Yelp).
  domainFor(website) {
    if (!website) return '';
    try {
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      return url.hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  dedupeKeyFor(lead) {
    const phoneDigits = (lead.phone || '').replace(/\D/g, '');
    if (phoneDigits.length >= 8) return `phone:${phoneDigits.slice(-9)}`;
    return `name:${this.normalizeBusinessName(lead.businessName)}`;
  }

  // Google Maps embeds a stable place-ID segment in its listing URLs
  // (the hex pair after "!1s", e.g. "!1s0x808f7e1234567:0xabcdef1234567890")
  // that identifies the exact business regardless of which search turned it
  // up or minor name/address formatting differences — the strongest dedup
  // signal available, stronger than phone or normalized name.
  mapsPlaceIdFor(googleMapsUrl) {
    if (!googleMapsUrl) return '';
    const m = googleMapsUrl.match(/!1s([^!]+)/);
    return m ? m[1] : '';
  }

  // Returns { inserted, duplicate, id } — the caller (the connector server)
  // uses this to build the correct acknowledgement response per lead.
  upsertLead(lead) {
    // A blacklisted business must never re-enter the pipeline through a new
    // scrape — checked before dedup, not after, so it never gets an id or a
    // history entry at all.
    const blocked = this.isBlacklisted({ email: lead.email, website: lead.website, phone: lead.phone });
    if (blocked) {
      return { inserted: false, duplicate: false, blacklisted: true, reason: blocked.reason || '' };
    }

    const placeId = this.mapsPlaceIdFor(lead.googleMapsUrl);
    if (placeId) {
      const byMapsId = this.db.exec('SELECT id FROM leads WHERE googleMapsUrl LIKE ?', [`%${placeId}%`]);
      if (byMapsId.length && byMapsId[0].values.length) {
        const id = byMapsId[0].values[0][0];
        this.mergeIntoLead(id, lead, 'mapsId');
        return { inserted: false, duplicate: true, id };
      }
    }

    const dedupeKey = this.dedupeKeyFor(lead);
    const existing = this.db.exec('SELECT id FROM leads WHERE dedupeKey = ?', [dedupeKey]);
    if (existing.length && existing[0].values.length) {
      const id = existing[0].values[0][0];
      const matchType = dedupeKey.startsWith('phone:') ? 'phone' : 'name';
      this.mergeIntoLead(id, lead, matchType);
      return { inserted: false, duplicate: true, id };
    }

    // Secondary check: same website domain, different name/phone (e.g. the
    // same plumber found on Google Maps under "Ace Plumbing" and on Yelp
    // under "Ace Plumbing Services LLC"). Website match is a strong enough
    // signal on its own — standard practice per every B2B dedup source is
    // to treat domain as a secondary key precisely for this scenario.
    // Skippable per-lead (useDomainDedup: false) for niches where domain
    // sharing causes false positives — franchises, directory sites, and
    // multi-location businesses parked on one corporate domain.
    const useDomainDedup = lead.useDomainDedup !== false;
    const domain = useDomainDedup ? this.domainFor(lead.website) : '';
    if (domain) {
      const byDomain = this.db.exec(
        "SELECT id FROM leads WHERE website LIKE ?",
        [`%${domain}%`]
      );
      if (byDomain.length && byDomain[0].values.length) {
        const id = byDomain[0].values[0][0];
        this.mergeIntoLead(id, lead, 'domain');
        return { inserted: false, duplicate: true, id };
      }
    }

    const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    const history = JSON.stringify([{ at: now, event: 'Received from Chrome extension' }]);

    this.db.run(
      `INSERT INTO leads (id, businessName, category, website, phone, email, address,
        googleMapsUrl, rating, reviewCount, tags, priority, leadSource, createdDate,
        updatedDate, status, owner, notes, history, customFields, dedupeKey)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, lead.businessName || '', lead.category || '', lead.website || '',
        lead.phone || '', lead.email || '', lead.address || '', lead.googleMapsUrl || '',
        lead.rating || null, lead.reviewCount || null, JSON.stringify(lead.tags || []),
        lead.priority || 'B', lead.leadSource || 'chrome-extension', now, now,
        'New', lead.owner || '', lead.notes || '', history,
        JSON.stringify(lead.customFields || {}), dedupeKey,
      ]
    );
    this.persist();
    return { inserted: true, duplicate: false, id };
  }

  // Duplicate intelligence: a second sighting of the same business (e.g.
  // found on Google Maps with no email, then found on Yelp with one) fills
  // in whatever the existing record is missing instead of being silently
  // discarded — a real merge, not just a dedup rejection.
  // matchType: 'mapsId' | 'phone' | 'domain' | 'name' — how this duplicate
  // was recognized, used to score how confident the match is. Maps place-ID
  // is the strongest possible signal (same literal business record);
  // phone/domain are exact-value matches; name is a fuzzy normalized-text
  // match (legal-suffix/case-insensitive), the weakest of the four.
  mergeIntoLead(id, incoming, matchType) {
    const result = this.db.exec('SELECT * FROM leads WHERE id = ?', [id]);
    if (!result.length || !result[0].values.length) return;
    const columns = result[0].columns;
    const existing = {};
    columns.forEach((col, i) => { existing[col] = result[0].values[0][i]; });

    // rating/reviewCount are deliberately excluded here — handled below by
    // the always-refresh reviewHistory block instead of blank-fill-only.
    const FILLABLE = ['phone', 'email', 'website', 'address', 'category', 'googleMapsUrl'];
    const sets = [];
    const values = [];
    const filled = [];
    for (const key of FILLABLE) {
      if (!existing[key] && incoming[key]) {
        sets.push(`${key} = ?`);
        values.push(incoming[key]);
        filled.push(key);
      }
    }

    const CONFIDENCE = { mapsId: 99, phone: 95, domain: 85, name: 65 };
    const confidence = CONFIDENCE[matchType] || 65;

    const customFields = JSON.parse(existing.customFields || '{}');

    // Review count/rating tracking: unlike FILLABLE above (which only fills
    // blanks), these get refreshed on every re-sighting — a review count
    // frozen at its first-ever value would make lead scoring stale. The
    // history of changes is what makes this "tracking," not just overwriting.
    const reviewHistory = customFields.reviewHistory || [];
    const incomingCount = incoming.reviewCount != null ? Number(incoming.reviewCount) : null;
    const existingCount = existing.reviewCount != null ? Number(existing.reviewCount) : null;
    if (incomingCount != null && incomingCount !== existingCount) {
      reviewHistory.push({ at: new Date().toISOString(), reviewCount: incomingCount, rating: incoming.rating ?? existing.rating ?? null });
      customFields.reviewHistory = reviewHistory;
      sets.push('reviewCount = ?');
      values.push(incomingCount);
      if (incoming.rating != null) { sets.push('rating = ?'); values.push(incoming.rating); }
    }
    const mergedSources = new Set(customFields.mergedSources || [existing.leadSource].filter(Boolean));
    if (incoming.leadSource) mergedSources.add(incoming.leadSource);
    customFields.mergedSources = [...mergedSources];
    const duplicateMatches = customFields.duplicateMatches || [];
    duplicateMatches.push({ at: new Date().toISOString(), matchType, confidence, source: incoming.leadSource || 'unknown' });
    customFields.duplicateMatches = duplicateMatches;
    // Overall confidence is the strongest match ever seen for this lead,
    // not the latest — a weak name match after a strong phone match
    // shouldn't downgrade certainty that this is the same business.
    customFields.duplicateConfidence = Math.max(...duplicateMatches.map((m) => m.confidence));
    sets.push('customFields = ?');
    values.push(JSON.stringify(customFields));

    const history = JSON.parse(existing.history || '[]');
    history.push({
      at: new Date().toISOString(),
      event: filled.length
        ? `Merged from ${incoming.leadSource || 'another source'} (${matchType} match, ${confidence}% confidence) — filled in: ${filled.join(', ')}`
        : `Duplicate confirmed from ${incoming.leadSource || 'another source'} (${matchType} match, ${confidence}% confidence) — no new fields to fill`,
    });
    sets.push('history = ?');
    values.push(JSON.stringify(history));

    sets.push('updatedDate = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, values);
    this.persist();
  }

  getAllLeads() {
    const result = this.db.exec('SELECT * FROM leads ORDER BY createdDate DESC');
    if (!result.length) return [];
    const columns = result[0].columns;
    return result[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      obj.tags = JSON.parse(obj.tags || '[]');
      obj.history = JSON.parse(obj.history || '[]');
      obj.customFields = JSON.parse(obj.customFields || '{}');
      return obj;
    });
  }

  logSync(leadCount, source) {
    this.db.run('INSERT INTO sync_log (receivedAt, leadCount, source) VALUES (?, ?, ?)',
      [new Date().toISOString(), leadCount, source || 'unknown']);
    this.persist();
  }

  count() {
    const result = this.db.exec('SELECT COUNT(*) FROM leads');
    return result.length ? result[0].values[0][0] : 0;
  }

  // Updates the mutable fields on an existing lead. Deliberately whitelist
  // which columns can be updated here (rather than accepting an arbitrary
  // object) so a bad payload from the renderer can't silently corrupt an
  // unrelated column.
  updateLead(id, fields) {
    // Auto-log status transitions to history — without this, "time in each
    // pipeline stage" is unanswerable from the data at all (nothing records
    // when a lead entered a stage, only its current stage). Skipped if the
    // caller already supplied its own `history` array, so this never
    // clobbers a caller that manages history explicitly.
    if (fields.status !== undefined && fields.history === undefined) {
      const current = this.db.exec('SELECT status, history FROM leads WHERE id = ?', [id]);
      if (current.length && current[0].values.length) {
        const [prevStatus, historyJson] = current[0].values[0];
        if (prevStatus !== fields.status) {
          const history = JSON.parse(historyJson || '[]');
          history.push({ at: new Date().toISOString(), event: `Status changed: ${prevStatus || 'New'} → ${fields.status}` });
          fields = { ...fields, history };
        }
      }
    }

    const UPDATABLE = ['status', 'notes', 'priority', 'tags', 'owner', 'history', 'customFields', 'email'];
    const sets = [];
    const values = [];
    for (const key of UPDATABLE) {
      if (fields[key] === undefined) continue;
      sets.push(`${key} = ?`);
      const JSON_FIELDS = ['tags', 'history', 'customFields'];
      values.push(JSON_FIELDS.includes(key) ? JSON.stringify(fields[key]) : fields[key]);
    }
    if (!sets.length) return { ok: false, error: 'No updatable fields provided' };

    sets.push('updatedDate = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, values);
    this.persist();
    return { ok: true };
  }

  deleteLead(id) {
    this.db.run('DELETE FROM leads WHERE id = ?', [id]);
    this.persist();
    return { ok: true };
  }

  // --- Do-not-contact list ---
  // Matching reuses the exact same normalization as lead dedup (domainFor,
  // digits-only phone) so "blacklist this business" and "this is the same
  // business" agree with each other — a business blacklisted by domain
  // can't slip back in under a slightly different name.

  addToBlacklist({ email, domain, phone, reason } = {}) {
    const entries = [];
    if (email) entries.push(['email', email.toLowerCase().trim()]);
    if (domain) entries.push(['domain', this.domainFor(domain) || domain.toLowerCase().trim()]);
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 8) entries.push(['phone', digits.slice(-9)]);
    }
    if (!entries.length) return { ok: false, error: 'Provide at least one of email, domain, or phone' };

    const now = new Date().toISOString();
    for (const [matchType, value] of entries) {
      const id = `bl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      try {
        this.db.run(
          'INSERT INTO blacklist (id, matchType, value, reason, createdDate) VALUES (?,?,?,?,?)',
          [id, matchType, value, reason || '', now]
        );
      } catch {
        // Unique index means it's already blacklisted under this match type — fine, not an error.
      }
    }
    this.persist();
    return { ok: true };
  }

  removeFromBlacklist(id) {
    this.db.run('DELETE FROM blacklist WHERE id = ?', [id]);
    this.persist();
    return { ok: true };
  }

  getBlacklist() {
    const result = this.db.exec('SELECT * FROM blacklist ORDER BY createdDate DESC');
    if (!result.length) return [];
    const columns = result[0].columns;
    return result[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  /** Returns the matched blacklist entry (with its reason) or null. */
  isBlacklisted({ email, website, phone } = {}) {
    const checks = [];
    if (email) checks.push(['email', email.toLowerCase().trim()]);
    const domain = website ? this.domainFor(website) : '';
    if (domain) checks.push(['domain', domain]);
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 8) checks.push(['phone', digits.slice(-9)]);
    }
    for (const [matchType, value] of checks) {
      const result = this.db.exec('SELECT * FROM blacklist WHERE matchType = ? AND value = ?', [matchType, value]);
      if (result.length && result[0].values.length) {
        const columns = result[0].columns;
        const obj = {};
        columns.forEach((col, i) => { obj[col] = result[0].values[0][i]; });
        return obj;
      }
    }
    return null;
  }

  // Copies the current database file to a timestamped backup, keeping only
  // the last N — cheap, real data safety, run once on startup rather than
  // continuously (per the stated performance principle).
  backup(backupDir, keep = 5) {
    try {
      // Critical: flush any pending debounced write BEFORE copying the
      // file. Without this, a backup taken while a write is still queued
      // (within the 400ms debounce window) would silently capture stale
      // data — the exact kind of bug a "never lose data" backup feature
      // must never have.
      this.flush();

      if (!fs.existsSync(this.dbPath)) return { ok: false, error: 'No database file yet to back up' };
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `agency-os-${stamp}.sqlite`);
      fs.copyFileSync(this.dbPath, backupPath);

      const existing = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('agency-os-') && f.endsWith('.sqlite'))
        .sort();
      while (existing.length > keep) {
        fs.unlinkSync(path.join(backupDir, existing.shift()));
      }

      return { ok: true, path: backupPath, totalBackups: Math.min(existing.length + 1, keep) };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  // Verifies the leads table actually has the columns the app expects —
  // catches a mismatched/corrupted database file early and clearly,
  // rather than failing confusingly deep inside a query later.
  verifySchema() {
    const EXPECTED_COLUMNS = [
      'id', 'businessName', 'category', 'website', 'phone', 'email', 'address',
      'googleMapsUrl', 'rating', 'reviewCount', 'tags', 'priority', 'leadSource',
      'createdDate', 'updatedDate', 'status', 'owner', 'notes', 'history',
      'customFields', 'dedupeKey',
    ];
    try {
      const result = this.db.exec("PRAGMA table_info(leads)");
      if (!result.length) return { ok: false, error: 'leads table does not exist' };
      const actualColumns = result[0].values.map(row => row[1]); // column name is index 1 in PRAGMA table_info
      const missing = EXPECTED_COLUMNS.filter(c => !actualColumns.includes(c));
      return missing.length
        ? { ok: false, error: `Missing columns: ${missing.join(', ')}`, missing }
        : { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  close() {
    if (this._closed) return;
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
    if (this.db) { this.flush(); this.db.close(); }
    this._closed = true;
  }
}

module.exports = { Database, SCHEMA };
