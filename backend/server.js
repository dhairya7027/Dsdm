const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 8787);
const DATABASE_URL = process.env.DATABASE_URL || "";
const STRICT_SSL = process.env.PG_STRICT_SSL === "true";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Point it to your Supabase Postgres URL.");
}

function normalizeDatabaseUrl(value) {
  const url = new URL(value);
  // We control TLS through the pg ssl object below.
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}

const pool = new Pool({
  connectionString: normalizeDatabaseUrl(DATABASE_URL),
  ssl: STRICT_SSL ? { rejectUnauthorized: true } : { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCompany(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeDomain(value) {
  const v = String(value || "").trim().toLowerCase();
  const allowed = new Set(["software", "quant", "marketing", "electrical"]);
  return allowed.has(v) ? v : "software";
}

function normalizeEmail(value) {
  return String(value || "").trim();
}

function companyKey(value) {
  return normalizeCompany(value).toLowerCase();
}

function nameKey(value) {
  return normalizeName(value).toLowerCase();
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
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, hash) {
  const [salt, stored] = String(hash || "").split(":");
  if (!salt || !stored) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(stored, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

async function q(text, params = []) {
  return pool.query(text, params);
}

async function initSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS companies (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      name_key TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL DEFAULT 'software',
      added_by_user_id BIGINT NOT NULL REFERENCES users(id),
      applied BOOLEAN NOT NULL DEFAULT FALSE,
      latest_applier_user_id BIGINT REFERENCES users(id),
      cleanup_done BOOLEAN NOT NULL DEFAULT FALSE,
      sus BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  // Add sus column if it doesn't exist (for existing deployments)
  await q(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS sus BOOLEAN NOT NULL DEFAULT FALSE`);

  await q(`
    CREATE TABLE IF NOT EXISTS company_names (
      id BIGSERIAL PRIMARY KEY,
      company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      UNIQUE(company_id, name_key)
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS generated_emails (
      id BIGSERIAL PRIMARY KEY,
      company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      email_key TEXT NOT NULL,
      format_key TEXT NOT NULL DEFAULT '',
      UNIQUE(company_id, email_key, format_key)
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS application_log (
      id BIGSERIAL PRIMARY KEY,
      company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id),
      timestamp TIMESTAMPTZ NOT NULL,
      date_key TEXT NOT NULL,
      action TEXT NOT NULL
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS kv_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Add indexes for performance
  await q(`CREATE INDEX IF NOT EXISTS idx_companies_name_key ON companies(name_key)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_companies_added_by_user_id ON companies(added_by_user_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_companies_applied ON companies(applied)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_companies_sus ON companies(sus)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_company_names_company_id ON company_names(company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_generated_emails_company_id ON generated_emails(company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_application_log_company_id ON application_log(company_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_application_log_user_id ON application_log(user_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_application_log_date_key ON application_log(date_key)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);

  await q(`
    INSERT INTO kv_meta(key, value)
    VALUES('data_version', '1')
    ON CONFLICT (key) DO NOTHING;
  `);
}

async function bumpDataVersion(client = null) {
  const runner = client || pool;
  await runner.query(`
    UPDATE kv_meta
    SET value = CAST(CAST(value AS BIGINT) + 1 AS TEXT)
    WHERE key = 'data_version'
  `);
}

async function getDataVersion() {
  const result = await q(`SELECT value FROM kv_meta WHERE key = 'data_version'`);
  return Number(result.rows[0] ? result.rows[0].value : 1);
}

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  await q(
    `INSERT INTO sessions(token, user_id, created_at) VALUES($1, $2, $3)`,
    [token, userId, nowIso()]
  );
  return token;
}

async function getSessionUser(token) {
  const result = await q(
    `
      SELECT u.id, u.username
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
    `,
    [token]
  );
  return result.rows[0] || null;
}

async function listUsers() {
  const result = await q(`SELECT username FROM users ORDER BY username ASC`);
  return result.rows.map((r) => r.username);
}

async function getCompanyByName(company) {
  const result = await q(
    `SELECT * FROM companies WHERE name_key = $1`,
    [companyKey(company)]
  );
  return result.rows[0] || null;
}

async function buildSnapshot(me) {
  const [users, companiesRes, namesRes, emailsRes, logRes, version] = await Promise.all([
    listUsers(),
    q(`
      SELECT
        c.id,
        c.name,
        c.domain,
        c.applied,
        c.cleanup_done,
        c.sus,
        ad.username AS added_by,
        lap.username AS latest_applier
      FROM companies c
      JOIN users ad ON ad.id = c.added_by_user_id
      LEFT JOIN users lap ON lap.id = c.latest_applier_user_id
      ORDER BY c.name ASC
    `),
    q(`
      SELECT cn.company_id, cn.name
      FROM company_names cn
      JOIN companies c ON c.id = cn.company_id
      ORDER BY c.name ASC, cn.name ASC
    `),
    q(`
      SELECT ge.company_id, ge.email, ge.format_key
      FROM generated_emails ge
      JOIN companies c ON c.id = ge.company_id
      ORDER BY c.name ASC, ge.email ASC
    `),
    q(`
      SELECT c.name AS company, a.date_key AS "dateKey", a.timestamp, a.action, u.username
      FROM application_log a
      JOIN companies c ON c.id = a.company_id
      JOIN users u ON u.id = a.user_id
      ORDER BY a.timestamp DESC
    `),
    getDataVersion()
  ]);

  const companyMap = {};
  companiesRes.rows.forEach((row) => {
    companyMap[row.id] = {
      company: row.name,
      names: [],
      domain: row.domain,
      addedBy: row.added_by,
      applied: row.applied === true,
      latestApplier: row.latest_applier || null,
      cleanupDone: row.cleanup_done === true,
      generatedEmails: [],
      generatedEmailsByFormat: {}
    };
  });

  namesRes.rows.forEach((row) => {
    const item = companyMap[row.company_id];
    if (item) {
      item.names.push(row.name);
    }
  });

  emailsRes.rows.forEach((row) => {
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
    version,
    me: { username: me.username },
    users,
    companies: Object.values(companyMap),
    applicationLog: logRes.rows
  };
}

async function authRequired(req, res, next) {
  try {
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing auth token" });
      return;
    }
    const token = auth.slice(7).trim();
    const user = await getSessionUser(token);
    if (!user) {
      res.status(401).json({ error: "Invalid auth token" });
      return;
    }
    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      res.status(500).json({ error: error.message });
    });
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/status", asyncRoute(async (_req, res) => {
  const result = await q(`SELECT COUNT(*)::bigint AS count FROM users`);
  res.json({ hasUsers: Number(result.rows[0].count) > 0 });
}));

app.post("/api/auth/register-first", asyncRoute(async (req, res) => {
  const countRes = await q(`SELECT COUNT(*)::bigint AS count FROM users`);
  if (Number(countRes.rows[0].count) > 0) {
    res.status(409).json({ error: "First user already exists" });
    return;
  }
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  if (!username || password.length < 4) {
    res.status(400).json({ error: "Username and password (min 4 chars) required" });
    return;
  }
  const ts = nowIso();
  const insert = await q(
    `
      INSERT INTO users(username, password_hash, created_at, updated_at)
      VALUES($1, $2, $3, $4)
      RETURNING id
    `,
    [username, hashPassword(password), ts, ts]
  );
  const token = await createSession(insert.rows[0].id);
  res.json({ token, username });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const result = await q(
    `SELECT id, username, password_hash FROM users WHERE username = $1`,
    [username]
  );
  const row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = await createSession(row.id);
  res.json({ token, username: row.username });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  if (!username || password.length < 4) {
    res.status(400).json({ error: "Username and password (min 4 chars) required" });
    return;
  }
  const exists = await q(`SELECT id FROM users WHERE username = $1`, [username]);
  if (exists.rows[0]) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }
  const ts = nowIso();
  const insert = await q(
    `
      INSERT INTO users(username, password_hash, created_at, updated_at)
      VALUES($1, $2, $3, $4)
      RETURNING id
    `,
    [username, hashPassword(password), ts, ts]
  );
  await bumpDataVersion();
  const token = await createSession(insert.rows[0].id);
  res.json({ token, username });
}));

app.post("/api/auth/logout", authRequired, asyncRoute(async (req, res) => {
  await q(`DELETE FROM sessions WHERE token = $1`, [req.token]);
  res.json({ ok: true });
}));

app.get("/api/auth/me", authRequired, asyncRoute(async (req, res) => {
  res.json({ username: req.user.username });
}));

app.post("/api/users", authRequired, asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  if (!username || password.length < 4) {
    res.status(400).json({ error: "Username and password (min 4 chars) required" });
    return;
  }
  const exists = await q(`SELECT id FROM users WHERE username = $1`, [username]);
  if (exists.rows[0]) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }
  const ts = nowIso();
  await q(
    `INSERT INTO users(username, password_hash, created_at, updated_at) VALUES($1, $2, $3, $4)`,
    [username, hashPassword(password), ts, ts]
  );
  await bumpDataVersion();
  res.json({ ok: true });
}));

app.patch("/api/users/me", authRequired, asyncRoute(async (req, res) => {
  const nextUsername = normalizeUsername(req.body.username);
  if (!nextUsername) {
    res.status(400).json({ error: "Username required" });
    return;
  }
  const conflict = await q(
    `SELECT id FROM users WHERE username = $1 AND id <> $2`,
    [nextUsername, req.user.id]
  );
  if (conflict.rows[0]) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }
  await q(`UPDATE users SET username = $1, updated_at = $2 WHERE id = $3`, [nextUsername, nowIso(), req.user.id]);
  await bumpDataVersion();
  res.json({ ok: true, username: nextUsername });
}));

app.get("/api/snapshot", authRequired, asyncRoute(async (req, res) => {
  res.json(await buildSnapshot(req.user));
}));

app.post("/api/companies/upsert-names", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(req.body.company);
  const names = Array.isArray(req.body.names) ? req.body.names.map(normalizeName).filter(Boolean) : [];
  const domain = normalizeDomain(req.body.domain);
  if (!companyName || names.length === 0) {
    res.status(400).json({ error: "Company and at least one name required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let companyRes = await client.query(`SELECT * FROM companies WHERE name_key = $1`, [companyKey(companyName)]);
    let company = companyRes.rows[0];
    if (!company) {
      const ts = nowIso();
      const insert = await client.query(
        `
          INSERT INTO companies(name, name_key, domain, added_by_user_id, applied, cleanup_done, created_at, updated_at)
          VALUES($1, $2, $3, $4, FALSE, FALSE, $5, $6)
          RETURNING *
        `,
        [companyName, companyKey(companyName), domain, req.user.id, ts, ts]
      );
      company = insert.rows[0];
    }

    for (const name of names) {
      await client.query(
        `
          INSERT INTO company_names(company_id, name, name_key)
          VALUES($1, $2, $3)
          ON CONFLICT (company_id, name_key) DO NOTHING
        `,
        [company.id, name, nameKey(name)]
      );
    }

    await client.query(`UPDATE companies SET updated_at = $1 WHERE id = $2`, [nowIso(), company.id]);
    await bumpDataVersion(client);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

app.post("/api/companies/rename", authRequired, asyncRoute(async (req, res) => {
  const oldName = normalizeCompany(req.body.oldName);
  const newName = normalizeCompany(req.body.newName);
  if (!oldName || !newName || oldName.toLowerCase() === newName.toLowerCase()) {
    res.status(400).json({ error: "Valid old and new names required" });
    return;
  }
  const oldCompany = await getCompanyByName(oldName);
  if (!oldCompany) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const existing = await getCompanyByName(newName);
  if (existing && existing.id !== oldCompany.id) {
    res.status(409).json({ error: "Target company already exists" });
    return;
  }
  await q(`UPDATE companies SET name = $1, name_key = $2, updated_at = $3 WHERE id = $4`, [
    newName,
    companyKey(newName),
    nowIso(),
    oldCompany.id
  ]);
  await bumpDataVersion();
  res.json({ ok: true });
}));

app.post("/api/companies/domain", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(req.body.company);
  const domain = normalizeDomain(req.body.domain);
  const company = await getCompanyByName(companyName);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  await q(`UPDATE companies SET domain = $1, updated_at = $2 WHERE id = $3`, [domain, nowIso(), company.id]);
  await bumpDataVersion();
  res.json({ ok: true });
}));

app.post("/api/companies/applied", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(req.body.company);
  const shouldApply = req.body.applied !== false;
  const company = await getCompanyByName(companyName);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if ((company.applied === true) === shouldApply) {
    res.json({ ok: true, unchanged: true });
    return;
  }

  const ts = nowIso();
  const action = shouldApply ? "applied" : "unapplied";
  await q(
    `
      UPDATE companies
      SET
        applied = $1,
        sus = CASE WHEN $1 THEN FALSE ELSE sus END,
        latest_applier_user_id = CASE WHEN $1 THEN $2 ELSE NULL END,
        cleanup_done = CASE WHEN $1 THEN cleanup_done ELSE FALSE END,
        updated_at = $3
      WHERE id = $4
    `,
    [shouldApply, req.user.id, ts, company.id]
  );
  await q(
    `
      INSERT INTO application_log(company_id, user_id, timestamp, date_key, action)
      VALUES($1, $2, $3, $4, $5)
    `,
    [company.id, req.user.id, ts, todayKey(), action]
  );
  await bumpDataVersion();
  res.json({ ok: true, applied: shouldApply });
}));

app.post("/api/companies/cleanup", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(req.body.company);
  const cleanupDone = req.body.cleanupDone === true;
  const company = await getCompanyByName(companyName);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if (cleanupDone && company.applied !== true) {
    res.status(400).json({ error: "Company must be applied before marking cleanup" });
    return;
  }
  await q(`UPDATE companies SET cleanup_done = $1, updated_at = $2 WHERE id = $3`, [cleanupDone, nowIso(), company.id]);
  await bumpDataVersion();
  res.json({ ok: true });
}));

app.post("/api/companies/sus", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(req.body.company);
  const isSus = req.body.sus === true;
  const company = await getCompanyByName(companyName);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if (company.sus === isSus) {
    res.json({ ok: true, unchanged: true });
    return;
  }

  const ts = nowIso();
  await q(
    `
      UPDATE companies
      SET
        sus = $1,
        applied = CASE WHEN $1 THEN FALSE ELSE applied END,
        cleanup_done = CASE WHEN $1 THEN FALSE ELSE cleanup_done END,
        updated_at = $2
      WHERE id = $3
    `,
    [isSus, ts, company.id]
  );
  await bumpDataVersion();
  res.json({ ok: true, sus: isSus });
}));

app.post("/api/companies/emails", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(req.body.company);
  const emails = Array.isArray(req.body.emails) ? req.body.emails.map(normalizeEmail).filter(Boolean) : [];
  const formatKey = String(req.body.format || "").trim();
  if (!companyName || emails.length === 0) {
    res.status(400).json({ error: "Company and emails required" });
    return;
  }
  const company = await getCompanyByName(companyName);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const email of emails) {
      await client.query(
        `
          INSERT INTO generated_emails(company_id, email, email_key, format_key)
          VALUES($1, $2, $3, $4)
          ON CONFLICT (company_id, email_key, format_key) DO NOTHING
        `,
        [company.id, email, emailKey(email), formatKey]
      );
      if (formatKey) {
        await client.query(
          `
            INSERT INTO generated_emails(company_id, email, email_key, format_key)
            VALUES($1, $2, $3, '')
            ON CONFLICT (company_id, email_key, format_key) DO NOTHING
          `,
          [company.id, email, emailKey(email)]
        );
      }
    }
    await client.query(`UPDATE companies SET updated_at = $1 WHERE id = $2`, [nowIso(), company.id]);
    await bumpDataVersion(client);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

app.post("/api/companies/remove-invalid-emails", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(req.body.company);
  const invalidEmails = Array.isArray(req.body.invalidEmails)
    ? req.body.invalidEmails.map(emailKey).filter(Boolean)
    : [];
  const company = await getCompanyByName(companyName);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if (!invalidEmails.length) {
    res.json({ ok: true, removed: 0 });
    return;
  }
  const result = await q(
    `DELETE FROM generated_emails WHERE company_id = $1 AND email_key = ANY($2::text[])`,
    [company.id, invalidEmails]
  );
  await q(`UPDATE companies SET updated_at = $1 WHERE id = $2`, [nowIso(), company.id]);
  await bumpDataVersion();
  res.json({ ok: true, removed: result.rowCount || 0 });
}));

app.delete("/api/companies/:companyName", authRequired, asyncRoute(async (req, res) => {
  const companyName = normalizeCompany(decodeURIComponent(req.params.companyName));
  const company = await getCompanyByName(companyName);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  await q(`DELETE FROM companies WHERE id = $1`, [company.id]);
  await bumpDataVersion();
  res.json({ ok: true });
}));

app.post("/api/migrate/legacy", authRequired, asyncRoute(async (req, res) => {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    async function upsertCompany(companyName, fallbackDomain = "software") {
      const found = await client.query(`SELECT * FROM companies WHERE name_key = $1`, [companyKey(companyName)]);
      if (found.rows[0]) {
        return found.rows[0];
      }
      const ts = nowIso();
      const inserted = await client.query(
        `
          INSERT INTO companies(name, name_key, domain, added_by_user_id, applied, cleanup_done, created_at, updated_at)
          VALUES($1, $2, $3, $4, FALSE, FALSE, $5, $6)
          RETURNING *
        `,
        [companyName, companyKey(companyName), normalizeDomain(fallbackDomain), req.user.id, ts, ts]
      );
      touched = true;
      migratedCompanies += 1;
      return inserted.rows[0];
    }

    for (const rawCompanyName of Object.keys(companiesRaw)) {
      const companyName = normalizeCompany(rawCompanyName);
      if (!companyName) {
        continue;
      }
      const names = Array.isArray(companiesRaw[rawCompanyName])
        ? companiesRaw[rawCompanyName].map(normalizeName).filter(Boolean)
        : [];
      const domain = normalizeDomain(domainsRaw[rawCompanyName]);
      const company = await upsertCompany(companyName, domain);

      if (company.domain !== domain) {
        await client.query(`UPDATE companies SET domain = $1, updated_at = $2 WHERE id = $3`, [domain, nowIso(), company.id]);
        touched = true;
      }

      for (const name of names) {
        const insertName = await client.query(
          `
            INSERT INTO company_names(company_id, name, name_key)
            VALUES($1, $2, $3)
            ON CONFLICT (company_id, name_key) DO NOTHING
          `,
          [company.id, name, nameKey(name)]
        );
        if ((insertName.rowCount || 0) > 0) {
          touched = true;
          migratedNames += 1;
        }
      }

      const appliedNamesSource = appliedNamesRaw[rawCompanyName];
      const hasAnyLegacyApplied = appliedNamesSource && typeof appliedNamesSource === "object"
        ? Object.values(appliedNamesSource).some((value) => value === true)
        : false;
      if ((appliedRaw[rawCompanyName] === true || hasAnyLegacyApplied) && company.applied !== true) {
        await client.query(
          `UPDATE companies SET applied = TRUE, latest_applier_user_id = $1, updated_at = $2 WHERE id = $3`,
          [req.user.id, nowIso(), company.id]
        );
        touched = true;
      }
      if (cleanupRaw[rawCompanyName] === true && company.cleanup_done !== true) {
        await client.query(`UPDATE companies SET cleanup_done = TRUE, updated_at = $1 WHERE id = $2`, [nowIso(), company.id]);
        touched = true;
      }
    }

    for (const rawCompanyName of Object.keys(generatedEmailsRaw)) {
      const companyName = normalizeCompany(rawCompanyName);
      if (!companyName) {
        continue;
      }
      const company = await upsertCompany(companyName, normalizeDomain(domainsRaw[rawCompanyName]));
      const emails = Array.isArray(generatedEmailsRaw[rawCompanyName])
        ? generatedEmailsRaw[rawCompanyName].map(normalizeEmail).filter(Boolean)
        : [];
      for (const email of emails) {
        const result = await client.query(
          `
            INSERT INTO generated_emails(company_id, email, email_key, format_key)
            VALUES($1, $2, $3, '')
            ON CONFLICT (company_id, email_key, format_key) DO NOTHING
          `,
          [company.id, email, emailKey(email)]
        );
        if ((result.rowCount || 0) > 0) {
          touched = true;
          migratedEmails += 1;
        }
      }
    }

    for (const rawCompanyName of Object.keys(generatedEmailsByFormatRaw)) {
      const companyName = normalizeCompany(rawCompanyName);
      if (!companyName) {
        continue;
      }
      const company = await upsertCompany(companyName, normalizeDomain(domainsRaw[rawCompanyName]));
      const byFormat = generatedEmailsByFormatRaw[rawCompanyName] && typeof generatedEmailsByFormatRaw[rawCompanyName] === "object"
        ? generatedEmailsByFormatRaw[rawCompanyName]
        : {};
      for (const formatKeyRaw of Object.keys(byFormat)) {
        const formatKey = String(formatKeyRaw || "").trim();
        const emails = Array.isArray(byFormat[formatKeyRaw])
          ? byFormat[formatKeyRaw].map(normalizeEmail).filter(Boolean)
          : [];
        for (const email of emails) {
          const result = await client.query(
            `
              INSERT INTO generated_emails(company_id, email, email_key, format_key)
              VALUES($1, $2, $3, $4)
              ON CONFLICT (company_id, email_key, format_key) DO NOTHING
            `,
            [company.id, email, emailKey(email), formatKey]
          );
          if ((result.rowCount || 0) > 0) {
            touched = true;
            migratedEmails += 1;
          }
          await client.query(
            `
              INSERT INTO generated_emails(company_id, email, email_key, format_key)
              VALUES($1, $2, $3, '')
              ON CONFLICT (company_id, email_key, format_key) DO NOTHING
            `,
            [company.id, email, emailKey(email)]
          );
        }
      }
    }

    for (const entry of logRaw) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const companyName = normalizeCompany(entry.company);
      const action = String(entry.action || "").trim().toLowerCase();
      if (!companyName || action !== "applied") {
        continue;
      }
      const company = await upsertCompany(companyName, normalizeDomain(domainsRaw[companyName]));
      const parsedTs = new Date(String(entry.timestamp || ""));
      const timestamp = Number.isFinite(parsedTs.getTime()) ? parsedTs.toISOString() : nowIso();
      const incomingDateKey = String(entry.dateKey || "").trim();
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(incomingDateKey) ? incomingDateKey : timestamp.slice(0, 10);

      const exists = await client.query(
        `
          SELECT id
          FROM application_log
          WHERE company_id = $1 AND user_id = $2 AND timestamp = $3 AND action = 'applied'
          LIMIT 1
        `,
        [company.id, req.user.id, timestamp]
      );
      if (exists.rows[0]) {
        continue;
      }

      await client.query(
        `
          INSERT INTO application_log(company_id, user_id, timestamp, date_key, action)
          VALUES($1, $2, $3, $4, 'applied')
        `,
        [company.id, req.user.id, timestamp, dateKey]
      );

      await client.query(
        `UPDATE companies SET applied = TRUE, latest_applier_user_id = $1, updated_at = $2 WHERE id = $3`,
        [req.user.id, nowIso(), company.id]
      );
      touched = true;
      migratedLogEvents += 1;
    }

    if (touched) {
      await bumpDataVersion(client);
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      touched,
      migratedCompanies,
      migratedNames,
      migratedEmails,
      migratedLogEvents
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

async function start() {
  await initSchema();
  app.listen(PORT, () => {
    console.log(`Shared backend running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
