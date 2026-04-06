const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'shared.db');
const app = express();
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

aapp();

function aapp() {
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  initSchema();
  mountRoutes();
  app.listen(PORT, () => {
    console.log(`Shared backend running on http://localhost:${PORT}`);
  });
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_key TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL DEFAULT 'software',
      added_by_user_id INTEGER NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0,
      latest_applier_user_id INTEGER,
      cleanup_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (added_by_user_id) REFERENCES users(id),
      FOREIGN KEY (latest_applier_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS company_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      UNIQUE(company_id, name_key),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generated_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      email_key TEXT NOT NULL,
      format_key TEXT NOT NULL DEFAULT '',
      UNIQUE(company_id, email_key, format_key),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS application_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      date_key TEXT NOT NULL,
      action TEXT NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS kv_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO kv_meta(key, value) VALUES('data_version', '1');
  `);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCompany(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeDomain(value) {
  const v = String(value || '').trim().toLowerCase();
  const allowed = new Set(['software', 'quant', 'marketing', 'electrical']);
  return allowed.has(v) ? v : 'software';
}

function normalizeEmail(value) {
  return String(value || '').trim();
}

function nameKey(value) {
  return normalizeName(value).toLowerCase();
}

function companyKey(value) {
  return normalizeCompany(value).toLowerCase();
}

function usernameKey(value) {
  return normalizeUsername(value);
}

function emailKey(value) {
  return normalizeEmail(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, hash) {
  const [salt, stored] = String(hash || '').split(':');
  if (!salt || !stored) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function bumpDataVersion() {
  db.prepare(`
    UPDATE kv_meta
    SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    WHERE key = 'data_version'
  `).run();
}

function getDataVersion() {
  const row = db.prepare(`SELECT value FROM kv_meta WHERE key = 'data_version'`).get();
  return Number(row ? row.value : 1);
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare(`INSERT INTO sessions(token, user_id, created_at) VALUES(?, ?, ?)`).run(token, userId, nowIso());
  return token;
}

function getSessionUser(token) {
  return db.prepare(`
    SELECT u.id, u.username
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
}

function authRequired(req, res, next) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }
  const token = auth.slice(7).trim();
  const user = getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid auth token' });
    return;
  }
  req.token = token;
  req.user = user;
  next();
}

function listUsers() {
  return db.prepare(`SELECT username FROM users ORDER BY username ASC`).all().map((r) => r.username);
}

function getCompanyByName(company) {
  return db.prepare(`SELECT * FROM companies WHERE name_key = ?`).get(companyKey(company));
}

function buildSnapshot(me) {
  const users = listUsers();
  const companiesRows = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.domain,
      c.applied,
      c.cleanup_done,
      ad.username AS added_by,
      lap.username AS latest_applier
    FROM companies c
    JOIN users ad ON ad.id = c.added_by_user_id
    LEFT JOIN users lap ON lap.id = c.latest_applier_user_id
    ORDER BY c.name COLLATE NOCASE ASC
  `).all();

  const namesRows = db.prepare(`
    SELECT cn.company_id, cn.name
    FROM company_names cn
    JOIN companies c ON c.id = cn.company_id
    ORDER BY c.name COLLATE NOCASE ASC, cn.name COLLATE NOCASE ASC
  `).all();

  const emailsRows = db.prepare(`
    SELECT ge.company_id, ge.email, ge.format_key
    FROM generated_emails ge
    JOIN companies c ON c.id = ge.company_id
    ORDER BY c.name COLLATE NOCASE ASC, ge.email COLLATE NOCASE ASC
  `).all();

  const logRows = db.prepare(`
    SELECT c.name AS company, a.date_key AS dateKey, a.timestamp, a.action, u.username
    FROM application_log a
    JOIN companies c ON c.id = a.company_id
    JOIN users u ON u.id = a.user_id
    ORDER BY a.timestamp DESC
  `).all();

  const companyMap = {};
  companiesRows.forEach((row) => {
    companyMap[row.id] = {
      company: row.name,
      names: [],
      domain: row.domain,
      addedBy: row.added_by,
      applied: row.applied === 1,
      latestApplier: row.latest_applier || null,
      cleanupDone: row.cleanup_done === 1,
      generatedEmails: [],
      generatedEmailsByFormat: {}
    };
  });

  namesRows.forEach((row) => {
    const item = companyMap[row.company_id];
    if (item) {
      item.names.push(row.name);
    }
  });

  emailsRows.forEach((row) => {
    const item = companyMap[row.company_id];
    if (!item) {
      return;
    }
    item.generatedEmails.push(row.email);
    if (row.format_key) {
      if (!item.generatedEmailsByFormat[row.format_key]) {
        item.generatedEmailsByFormat[row.format_key] = [];
      }
      item.generatedEmailsByFormat[row.format_key].push(row.email);
    }
  });

  return {
    version: getDataVersion(),
    me: { username: me.username },
    users,
    companies: Object.values(companyMap),
    applicationLog: logRows
  };
}

function mountRoutes() {
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/auth/status', (_req, res) => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    res.json({ hasUsers: Number(row.count) > 0 });
  });

  app.post('/api/auth/register-first', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (Number(count) > 0) {
      res.status(409).json({ error: 'First user already exists' });
      return;
    }

    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    if (!username || password.length < 4) {
      res.status(400).json({ error: 'Username and password (min 4 chars) required' });
      return;
    }

    const ts = nowIso();
    const result = db.prepare(`
      INSERT INTO users(username, password_hash, created_at, updated_at)
      VALUES(?, ?, ?, ?)
    `).run(username, hashPassword(password), ts, ts);

    const token = createSession(result.lastInsertRowid);
    res.json({ token, username });
  });

  app.post('/api/auth/login', (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = createSession(row.id);
    res.json({ token, username: row.username });
  });

  app.post('/api/auth/register', (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    if (!username || password.length < 4) {
      res.status(400).json({ error: 'Username and password (min 4 chars) required' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const ts = nowIso();
    const result = db.prepare(`
      INSERT INTO users(username, password_hash, created_at, updated_at)
      VALUES(?, ?, ?, ?)
    `).run(username, hashPassword(password), ts, ts);
    bumpDataVersion();
    const token = createSession(result.lastInsertRowid);
    res.json({ token, username });
  });

  app.post('/api/auth/logout', authRequired, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authRequired, (req, res) => {
    res.json({ username: req.user.username });
  });

  app.post('/api/users', authRequired, (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    if (!username || password.length < 4) {
      res.status(400).json({ error: 'Username and password (min 4 chars) required' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const ts = nowIso();
    db.prepare(`
      INSERT INTO users(username, password_hash, created_at, updated_at)
      VALUES(?, ?, ?, ?)
    `).run(username, hashPassword(password), ts, ts);
    bumpDataVersion();
    res.json({ ok: true });
  });

  app.patch('/api/users/me', authRequired, (req, res) => {
    const nextUsername = normalizeUsername(req.body.username);
    if (!nextUsername) {
      res.status(400).json({ error: 'Username required' });
      return;
    }

    const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(nextUsername, req.user.id);
    if (conflict) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?').run(nextUsername, nowIso(), req.user.id);
    bumpDataVersion();
    res.json({ ok: true, username: nextUsername });
  });

  app.get('/api/snapshot', authRequired, (req, res) => {
    res.json(buildSnapshot(req.user));
  });

  app.post('/api/migrate/legacy', authRequired, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const companiesRaw = body.companies && typeof body.companies === "object" ? body.companies : {};
    const generatedEmailsRaw = body.generatedEmails && typeof body.generatedEmails === "object" ? body.generatedEmails : {};
    const generatedEmailsByFormatRaw = body.generatedEmailsByFormat && typeof body.generatedEmailsByFormat === "object"
      ? body.generatedEmailsByFormat
      : {};
    const appliedRaw = body.appliedCompanies && typeof body.appliedCompanies === "object" ? body.appliedCompanies : {};
    const appliedNamesRaw = body.appliedNames && typeof body.appliedNames === "object" ? body.appliedNames : {};
    const cleanupRaw = body.cleanupCompanies && typeof body.cleanupCompanies === "object" ? body.cleanupCompanies : {};
    const domainsRaw = body.companyDomains && typeof body.companyDomains === "object" ? body.companyDomains : {};
    const logRaw = Array.isArray(body.applicationLog) ? body.applicationLog : [];

    let touched = false;
    let migratedCompanies = 0;
    let migratedNames = 0;
    let migratedEmails = 0;
    let migratedLogEvents = 0;

    const upsertCompany = (companyName, fallbackDomain = "software") => {
      let company = getCompanyByName(companyName);
      if (!company) {
        const ts = nowIso();
        const result = db.prepare(`
          INSERT INTO companies(name, name_key, domain, added_by_user_id, applied, cleanup_done, created_at, updated_at)
          VALUES(?, ?, ?, ?, 0, 0, ?, ?)
        `).run(companyName, companyKey(companyName), normalizeDomain(fallbackDomain), req.user.id, ts, ts);
        company = db.prepare("SELECT * FROM companies WHERE id = ?").get(result.lastInsertRowid);
        touched = true;
        migratedCompanies += 1;
      }
      return company;
    };

    const tx = db.transaction(() => {
      Object.keys(companiesRaw).forEach((rawCompanyName) => {
        const companyName = normalizeCompany(rawCompanyName);
        if (!companyName) {
          return;
        }
        const names = Array.isArray(companiesRaw[rawCompanyName])
          ? companiesRaw[rawCompanyName].map(normalizeName).filter(Boolean)
          : [];
        const domain = normalizeDomain(domainsRaw[rawCompanyName]);
        const company = upsertCompany(companyName, domain);

        if (company.domain !== domain) {
          db.prepare("UPDATE companies SET domain = ?, updated_at = ? WHERE id = ?")
            .run(domain, nowIso(), company.id);
          touched = true;
        }

        names.forEach((name) => {
          const result = db.prepare(`
            INSERT OR IGNORE INTO company_names(company_id, name, name_key)
            VALUES(?, ?, ?)
          `).run(company.id, name, nameKey(name));
          if (result.changes > 0) {
            touched = true;
            migratedNames += 1;
          }
        });

        if (appliedRaw[rawCompanyName] === true && company.applied !== 1) {
          db.prepare("UPDATE companies SET applied = 1, latest_applier_user_id = ?, updated_at = ? WHERE id = ?")
            .run(req.user.id, nowIso(), company.id);
          touched = true;
        }
        if (company.applied !== 1 && appliedNamesRaw[rawCompanyName] && typeof appliedNamesRaw[rawCompanyName] === "object") {
          const hasAnyApplied = Object.values(appliedNamesRaw[rawCompanyName]).some((value) => value === true);
          if (hasAnyApplied) {
            db.prepare("UPDATE companies SET applied = 1, latest_applier_user_id = ?, updated_at = ? WHERE id = ?")
              .run(req.user.id, nowIso(), company.id);
            touched = true;
          }
        }
        if (cleanupRaw[rawCompanyName] === true && company.cleanup_done !== 1) {
          db.prepare("UPDATE companies SET cleanup_done = 1, updated_at = ? WHERE id = ?")
            .run(nowIso(), company.id);
          touched = true;
        }
      });

      Object.keys(generatedEmailsRaw).forEach((rawCompanyName) => {
        const companyName = normalizeCompany(rawCompanyName);
        if (!companyName) {
          return;
        }
        const company = upsertCompany(companyName, normalizeDomain(domainsRaw[rawCompanyName]));
        const emails = Array.isArray(generatedEmailsRaw[rawCompanyName])
          ? generatedEmailsRaw[rawCompanyName].map(normalizeEmail).filter(Boolean)
          : [];
        emails.forEach((email) => {
          const result = db.prepare(`
            INSERT OR IGNORE INTO generated_emails(company_id, email, email_key, format_key)
            VALUES(?, ?, ?, '')
          `).run(company.id, email, emailKey(email));
          if (result.changes > 0) {
            touched = true;
            migratedEmails += 1;
          }
        });
      });

      Object.keys(generatedEmailsByFormatRaw).forEach((rawCompanyName) => {
        const companyName = normalizeCompany(rawCompanyName);
        if (!companyName) {
          return;
        }
        const company = upsertCompany(companyName, normalizeDomain(domainsRaw[rawCompanyName]));
        const byFormat = generatedEmailsByFormatRaw[rawCompanyName] && typeof generatedEmailsByFormatRaw[rawCompanyName] === "object"
          ? generatedEmailsByFormatRaw[rawCompanyName]
          : {};
        Object.keys(byFormat).forEach((formatKeyRaw) => {
          const formatKey = String(formatKeyRaw || "").trim();
          const emails = Array.isArray(byFormat[formatKeyRaw]) ? byFormat[formatKeyRaw].map(normalizeEmail).filter(Boolean) : [];
          emails.forEach((email) => {
            const result = db.prepare(`
              INSERT OR IGNORE INTO generated_emails(company_id, email, email_key, format_key)
              VALUES(?, ?, ?, ?)
            `).run(company.id, email, emailKey(email), formatKey);
            if (result.changes > 0) {
              touched = true;
              migratedEmails += 1;
            }
            db.prepare(`
              INSERT OR IGNORE INTO generated_emails(company_id, email, email_key, format_key)
              VALUES(?, ?, ?, '')
            `).run(company.id, email, emailKey(email));
          });
        });
      });

      logRaw.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        const companyName = normalizeCompany(entry.company);
        const action = String(entry.action || "").trim().toLowerCase();
        if (!companyName || action !== "applied") {
          return;
        }
        const company = upsertCompany(companyName, normalizeDomain(domainsRaw[companyName]));
        const parsedTs = new Date(String(entry.timestamp || ""));
        const timestamp = Number.isFinite(parsedTs.getTime()) ? parsedTs.toISOString() : nowIso();
        const incomingDateKey = String(entry.dateKey || "").trim();
        const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(incomingDateKey)
          ? incomingDateKey
          : timestamp.slice(0, 10);

        const existing = db.prepare(`
          SELECT id
          FROM application_log
          WHERE company_id = ? AND user_id = ? AND timestamp = ? AND action = 'applied'
        `).get(company.id, req.user.id, timestamp);
        if (existing) {
          return;
        }

        db.prepare(`
          INSERT INTO application_log(company_id, user_id, timestamp, date_key, action)
          VALUES(?, ?, ?, ?, 'applied')
        `).run(company.id, req.user.id, timestamp, dateKey);

        db.prepare("UPDATE companies SET applied = 1, latest_applier_user_id = ?, updated_at = ? WHERE id = ?")
          .run(req.user.id, nowIso(), company.id);

        touched = true;
        migratedLogEvents += 1;
      });

      if (touched) {
        bumpDataVersion();
      }
    });

    tx();
    res.json({
      ok: true,
      touched,
      migratedCompanies,
      migratedNames,
      migratedEmails,
      migratedLogEvents
    });
  });

  app.post('/api/companies/upsert-names', authRequired, (req, res) => {
    const companyName = normalizeCompany(req.body.company);
    const names = Array.isArray(req.body.names) ? req.body.names.map(normalizeName).filter(Boolean) : [];
    const domain = normalizeDomain(req.body.domain);

    if (!companyName || names.length === 0) {
      res.status(400).json({ error: 'Company and at least one name required' });
      return;
    }

    const tx = db.transaction(() => {
      let company = getCompanyByName(companyName);
      if (!company) {
        const ts = nowIso();
        const result = db.prepare(`
          INSERT INTO companies(name, name_key, domain, added_by_user_id, applied, cleanup_done, created_at, updated_at)
          VALUES(?, ?, ?, ?, 0, 0, ?, ?)
        `).run(companyName, companyKey(companyName), domain, req.user.id, ts, ts);
        company = db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid);
      }

      names.forEach((name) => {
        db.prepare(`
          INSERT OR IGNORE INTO company_names(company_id, name, name_key)
          VALUES(?, ?, ?)
        `).run(company.id, name, nameKey(name));
      });

      db.prepare('UPDATE companies SET updated_at = ? WHERE id = ?').run(nowIso(), company.id);
      bumpDataVersion();
    });

    tx();
    res.json({ ok: true });
  });

  app.post('/api/companies/rename', authRequired, (req, res) => {
    const oldName = normalizeCompany(req.body.oldName);
    const newName = normalizeCompany(req.body.newName);

    if (!oldName || !newName || oldName.toLowerCase() === newName.toLowerCase()) {
      res.status(400).json({ error: 'Valid old and new names required' });
      return;
    }

    const oldCompany = getCompanyByName(oldName);
    if (!oldCompany) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const existing = getCompanyByName(newName);
    if (existing && existing.id !== oldCompany.id) {
      res.status(409).json({ error: 'Target company already exists' });
      return;
    }

    db.prepare('UPDATE companies SET name = ?, name_key = ?, updated_at = ? WHERE id = ?')
      .run(newName, companyKey(newName), nowIso(), oldCompany.id);
    bumpDataVersion();
    res.json({ ok: true });
  });

  app.post('/api/companies/domain', authRequired, (req, res) => {
    const companyName = normalizeCompany(req.body.company);
    const domain = normalizeDomain(req.body.domain);
    const company = getCompanyByName(companyName);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    db.prepare('UPDATE companies SET domain = ?, updated_at = ? WHERE id = ?').run(domain, nowIso(), company.id);
    bumpDataVersion();
    res.json({ ok: true });
  });

  app.post('/api/companies/applied', authRequired, (req, res) => {
    const companyName = normalizeCompany(req.body.company);
    const company = getCompanyByName(companyName);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    if (company.applied === 1) {
      res.json({ ok: true, alreadyApplied: true });
      return;
    }

    const ts = nowIso();
    db.prepare('UPDATE companies SET applied = 1, latest_applier_user_id = ?, updated_at = ? WHERE id = ?')
      .run(req.user.id, ts, company.id);
    db.prepare(`
      INSERT INTO application_log(company_id, user_id, timestamp, date_key, action)
      VALUES(?, ?, ?, ?, 'applied')
    `).run(company.id, req.user.id, ts, todayKey());
    bumpDataVersion();
    res.json({ ok: true });
  });

  app.post('/api/companies/cleanup', authRequired, (req, res) => {
    const companyName = normalizeCompany(req.body.company);
    const cleanupDone = req.body.cleanupDone === true;
    const company = getCompanyByName(companyName);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    db.prepare('UPDATE companies SET cleanup_done = ?, updated_at = ? WHERE id = ?')
      .run(cleanupDone ? 1 : 0, nowIso(), company.id);
    bumpDataVersion();
    res.json({ ok: true });
  });

  app.post('/api/companies/emails', authRequired, (req, res) => {
    const companyName = normalizeCompany(req.body.company);
    const emails = Array.isArray(req.body.emails) ? req.body.emails.map(normalizeEmail).filter(Boolean) : [];
    const formatKey = String(req.body.format || '').trim();

    if (!companyName || emails.length === 0) {
      res.status(400).json({ error: 'Company and emails required' });
      return;
    }

    const company = getCompanyByName(companyName);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const tx = db.transaction(() => {
      emails.forEach((email) => {
        db.prepare(`
          INSERT OR IGNORE INTO generated_emails(company_id, email, email_key, format_key)
          VALUES(?, ?, ?, ?)
        `).run(company.id, email, emailKey(email), formatKey);
        if (formatKey) {
          db.prepare(`
            INSERT OR IGNORE INTO generated_emails(company_id, email, email_key, format_key)
            VALUES(?, ?, ?, '')
          `).run(company.id, email, emailKey(email));
        }
      });
      db.prepare('UPDATE companies SET updated_at = ? WHERE id = ?').run(nowIso(), company.id);
      bumpDataVersion();
    });

    tx();
    res.json({ ok: true });
  });

  app.post('/api/companies/remove-invalid-emails', authRequired, (req, res) => {
    const companyName = normalizeCompany(req.body.company);
    const invalidEmails = Array.isArray(req.body.invalidEmails)
      ? req.body.invalidEmails.map(emailKey).filter(Boolean)
      : [];
    const company = getCompanyByName(companyName);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    if (!invalidEmails.length) {
      res.json({ ok: true, removed: 0 });
      return;
    }

    const placeholders = invalidEmails.map(() => '?').join(',');
    const result = db.prepare(`
      DELETE FROM generated_emails
      WHERE company_id = ? AND email_key IN (${placeholders})
    `).run(company.id, ...invalidEmails);
    db.prepare('UPDATE companies SET updated_at = ? WHERE id = ?').run(nowIso(), company.id);
    bumpDataVersion();
    res.json({ ok: true, removed: result.changes });
  });

  app.delete('/api/companies/:companyName', authRequired, (req, res) => {
    const companyName = normalizeCompany(decodeURIComponent(req.params.companyName));
    const company = getCompanyByName(companyName);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    db.prepare('DELETE FROM companies WHERE id = ?').run(company.id);
    bumpDataVersion();
    res.json({ ok: true });
  });
}
