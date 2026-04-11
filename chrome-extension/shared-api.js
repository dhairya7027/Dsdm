(function () {
  const DEFAULT_API_BASE = "https://dsdm.onrender.com/api";
  const AUTH_TOKEN_KEY = "sharedAuthToken";
  const AUTH_USERNAME_KEY = "sharedAuthUsername";
  const MIGRATION_KEY_PREFIX = "legacyMigratedFor_";
  let currentUser = null;

  async function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  async function storageSet(value) {
    return chrome.storage.local.set(value);
  }

  async function getApiBase() {
    return DEFAULT_API_BASE;
  }

  function normalizeApiBase(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return DEFAULT_API_BASE;
    }
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const trimmed = withProtocol.replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }

  async function setApiBase(nextBase) {
    // Backend URL is fixed for this extension build.
    return DEFAULT_API_BASE;
  }

  async function getAuthToken() {
    const data = await storageGet([AUTH_TOKEN_KEY]);
    return data[AUTH_TOKEN_KEY] || "";
  }

  async function setAuth(token, username) {
    currentUser = username ? { username } : null;
    await storageSet({
      [AUTH_TOKEN_KEY]: token || "",
      [AUTH_USERNAME_KEY]: username || ""
    });
  }

  async function clearAuth() {
    currentUser = null;
    await setAuth("", "");
  }

  function migrationKeyFor(username, apiBase) {
    const userPart = String(username || "").trim().toLowerCase();
    const basePart = String(apiBase || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return `${MIGRATION_KEY_PREFIX}${userPart}_${basePart}`;
  }

  function hasLegacyData(payload) {
    const hasCompanies = payload.companies && Object.keys(payload.companies).length > 0;
    const hasGeneratedEmails = payload.generatedEmails && Object.keys(payload.generatedEmails).length > 0;
    const hasGeneratedByFormat = payload.generatedEmailsByFormat && Object.keys(payload.generatedEmailsByFormat).length > 0;
    const hasApplied = payload.appliedCompanies && Object.keys(payload.appliedCompanies).length > 0;
    const hasCleanup = payload.cleanupCompanies && Object.keys(payload.cleanupCompanies).length > 0;
    const hasDomains = payload.companyDomains && Object.keys(payload.companyDomains).length > 0;
    const hasLog = Array.isArray(payload.applicationLog) && payload.applicationLog.length > 0;
    return hasCompanies || hasGeneratedEmails || hasGeneratedByFormat || hasApplied || hasCleanup || hasDomains || hasLog;
  }

  async function migrateLegacyDataIfNeeded(username) {
    const apiBase = await getApiBase();
    const key = migrationKeyFor(username, apiBase);
    const data = await storageGet([
      key,
      "companies",
      "generatedEmails",
      "generatedEmailsByFormat",
      "appliedCompanies",
      "appliedNames",
      "cleanupCompanies",
      "companyDomains",
      "applicationLog"
    ]);

    if (data[key] === true) {
      return;
    }

    const payload = {
      companies: data.companies || {},
      generatedEmails: data.generatedEmails || {},
      generatedEmailsByFormat: data.generatedEmailsByFormat || {},
      appliedCompanies: data.appliedCompanies || {},
      appliedNames: data.appliedNames || {},
      cleanupCompanies: data.cleanupCompanies || {},
      companyDomains: data.companyDomains || {},
      applicationLog: Array.isArray(data.applicationLog) ? data.applicationLog : []
    };

    if (!hasLegacyData(payload)) {
      await storageSet({ [key]: true });
      return;
    }

    await request("/migrate/legacy", {
      method: "POST",
      body: payload
    });

    // Mark completed but keep original local data untouched as backup.
    await storageSet({ [key]: true });
  }

  async function request(path, options = {}) {
    const { auth = true, method = "GET", body } = options;
    const base = await getApiBase();
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = await getAuthToken();
      if (!token) {
        throw new Error("Not signed in");
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      if (response.status === 401) {
        await clearAuth();
      }
      const msg = payload && payload.error ? payload.error : `Request failed (${response.status})`;
      throw new Error(msg);
    }

    return payload || {};
  }

  async function testConnection(baseOverride) {
    const base = baseOverride ? normalizeApiBase(baseOverride) : await getApiBase();
    const response = await fetch(`${base}/health`, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Backend health check failed (${response.status})`);
    }
    return true;
  }

  async function authStatus() {
    return request("/auth/status", { auth: false });
  }

  async function login(username, password) {
    const result = await request("/auth/login", {
      auth: false,
      method: "POST",
      body: {
        username: String(username || "").trim().toLowerCase(),
        password: String(password || "")
      }
    });
    await setAuth(result.token, result.username);
    currentUser = { username: result.username };
    return currentUser;
  }

  async function register(username, password) {
    const result = await request("/auth/register", {
      auth: false,
      method: "POST",
      body: {
        username: String(username || "").trim().toLowerCase(),
        password: String(password || "")
      }
    });
    await setAuth(result.token, result.username);
    currentUser = { username: result.username };
    return currentUser;
  }

  async function registerFirst(username, password) {
    const result = await request("/auth/register-first", {
      auth: false,
      method: "POST",
      body: {
        username: String(username || "").trim().toLowerCase(),
        password: String(password || "")
      }
    });
    await setAuth(result.token, result.username);
    currentUser = { username: result.username };
    return currentUser;
  }

  async function getMeIfSignedIn() {
    const token = await getAuthToken();
    if (!token) {
      return null;
    }
    try {
      const me = await request("/auth/me");
      currentUser = me;
      return me;
    } catch {
      return null;
    }
  }

  function promptForCredentials(titleText) {
    const username = prompt(`${titleText}\nUsername:`) || "";
    if (!username.trim()) {
      return null;
    }
    const password = prompt(`${titleText}\nPassword:`) || "";
    if (!password) {
      return null;
    }
    return { username: username.trim().toLowerCase(), password };
  }

  async function loginOrRegisterFlow() {
    for (;;) {
      const creds = promptForCredentials("Login");
      if (!creds) {
        throw new Error("Sign in cancelled");
      }

      try {
        const login = await request("/auth/login", {
          auth: false,
          method: "POST",
          body: creds
        });
        await setAuth(login.token, login.username);
        return;
      } catch (loginError) {
        const shouldRegister = confirm(
          `Login failed: ${loginError.message}\n\nCreate a new account with this username?`
        );
        if (!shouldRegister) {
          continue;
        }
        const register = await request("/auth/register", {
          auth: false,
          method: "POST",
          body: creds
        });
        await setAuth(register.token, register.username);
        return;
      }
    }
  }

  async function ensureSignedIn() {
    if (currentUser && currentUser.username) {
      return currentUser;
    }

    try {
      const me = await request("/auth/me");
      currentUser = me;
      return me;
    } catch {
      // fallthrough to interactive sign in
    }

    for (;;) {
      let status;
      try {
        status = await request("/auth/status", { auth: false });
      } catch (error) {
        const base = await getApiBase();
        throw new Error(`Cannot reach backend at ${base}. Update backend URL in Dashboard settings.`);
      }
      if (!status.hasUsers) {
        const creds = promptForCredentials("Create first account");
        if (!creds) {
          throw new Error("Sign in cancelled");
        }
        const register = await request("/auth/register-first", {
          auth: false,
          method: "POST",
          body: creds
        });
        await setAuth(register.token, register.username);
      } else {
        await loginOrRegisterFlow();
      }

      try {
        const me = await request("/auth/me");
        currentUser = me;
        return me;
      } catch (error) {
        alert(`Authentication failed: ${error.message}`);
      }
    }
  }

  async function logout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } finally {
      await clearAuth();
    }
  }

  async function addUser(username, password) {
    await ensureSignedIn();
    return request("/users", {
      method: "POST",
      body: { username: String(username || "").trim().toLowerCase(), password: String(password || "") }
    });
  }

  async function renameMe(username) {
    await ensureSignedIn();
    const result = await request("/users/me", {
      method: "PATCH",
      body: { username: String(username || "").trim().toLowerCase() }
    });
    currentUser = { username: result.username };
    return result;
  }

  async function getSnapshot() {
    await ensureSignedIn();
    return request("/snapshot");
  }

  async function upsertCompanyNames(company, names, domain) {
    await ensureSignedIn();
    return request("/companies/upsert-names", {
      method: "POST",
      body: { company, names, domain }
    });
  }

  async function renameCompany(oldName, newName) {
    await ensureSignedIn();
    return request("/companies/rename", {
      method: "POST",
      body: { oldName, newName }
    });
  }

  async function setCompanyDomain(company, domain) {
    await ensureSignedIn();
    return request("/companies/domain", {
      method: "POST",
      body: { company, domain }
    });
  }

  async function markCompanyApplied(company) {
    await ensureSignedIn();
    return request("/companies/applied", {
      method: "POST",
      body: { company }
    });
  }

  async function setCompanyCleanup(company, cleanupDone) {
    await ensureSignedIn();
    return request("/companies/cleanup", {
      method: "POST",
      body: { company, cleanupDone: cleanupDone === true }
    });
  }

  async function saveCompanyEmails(company, emails, format) {
    await ensureSignedIn();
    return request("/companies/emails", {
      method: "POST",
      body: { company, emails, format }
    });
  }

  async function removeInvalidEmails(company, invalidEmails) {
    await ensureSignedIn();
    return request("/companies/remove-invalid-emails", {
      method: "POST",
      body: { company, invalidEmails }
    });
  }

  async function deleteCompany(company) {
    await ensureSignedIn();
    return request(`/companies/${encodeURIComponent(company)}`, {
      method: "DELETE"
    });
  }

  window.SharedApi = {
    getApiBase,
    setApiBase,
    testConnection,
    authStatus,
    login,
    register,
    registerFirst,
    getMeIfSignedIn,
    ensureSignedIn,
    logout,
    addUser,
    renameMe,
    getSnapshot,
    upsertCompanyNames,
    renameCompany,
    setCompanyDomain,
    markCompanyApplied,
    setCompanyCleanup,
    saveCompanyEmails,
    removeInvalidEmails,
    deleteCompany
  };
})();
