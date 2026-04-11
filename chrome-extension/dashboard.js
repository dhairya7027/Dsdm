let companiesState = {};
let generatedEmailsState = {};
let generatedEmailsByFormatState = {};
let appliedCompaniesState = {};
let companyDomainsState = {};
let cleanupCompaniesState = {};
let companyAddedByState = {};
let companyLatestApplierState = {};
let applicationLogState = [];
let usersState = [];
let meUsername = "";
let selectedCompanies = new Set();
let lastRendered = [];
let allNamesVisible = false;
let appliedTab = "not-applied";
let selectedDomain = "software";
let themeMode = "light";
let snapshotVersion = 0;
let pollTimer = null;
const SNAPSHOT_CACHE_KEY = "dashboardSnapshotCache";

const DOMAIN_ORDER = ["software", "quant", "marketing", "electrical"];
const DOMAIN_LABELS = {
  software: "Software",
  quant: "Quant",
  marketing: "Marketing",
  electrical: "Electrical"
};

function normalizeNames(value) {
  const seen = new Set();
  const result = [];
  (Array.isArray(value) ? value : [])
    .map((name) => String(name).trim())
    .filter((name) => name.length > 0)
    .forEach((name) => {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(name);
      }
    });
  return result;
}

function normalizeEmails(value) {
  return (Array.isArray(value) ? value : [])
    .map((email) => String(email).trim())
    .filter((email) => email.length > 0);
}

function normalizeDomain(value) {
  const key = String(value || "").trim().toLowerCase();
  return DOMAIN_ORDER.includes(key) ? key : "software";
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function allNames(companies) {
  return Object.values(companies).flatMap((names) => normalizeNames(names));
}

function applyThemeMode() {
  const isDark = themeMode === "dark";
  document.body.classList.toggle("dark-mode", isDark);
  const button = document.getElementById("themeToggleBtn");
  if (button) {
    button.textContent = isDark ? "Light Mode" : "Dark Mode";
  }
}

async function toggleThemeMode() {
  themeMode = themeMode === "dark" ? "light" : "dark";
  applyThemeMode();
  await chrome.storage.local.set({ themeMode });
}

function updateLastUpdated() {
  const stamp = new Date().toLocaleString();
  document.getElementById("lastUpdated").textContent = `Updated ${stamp}`;
}

function computeDailyAppliedCount() {
  const today = getTodayKey();
  const statusByCompany = new Map();
  applicationLogState
    .filter((entry) => entry.dateKey === today && (entry.action === "applied" || entry.action === "unapplied"))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .forEach((entry) => {
      if (!entry.company) {
        return;
      }
      statusByCompany.set(entry.company, entry.action === "applied");
    });
  let count = 0;
  statusByCompany.forEach((isApplied) => {
    if (isApplied) {
      count += 1;
    }
  });
  return count;
}

function updateStats() {
  const companyEntries = Object.entries(companiesState);
  const names = allNames(companiesState);
  const uniqueNames = new Set(names.map((name) => name.toLowerCase()));
  document.getElementById("companiesCount").textContent = String(companyEntries.length);
  document.getElementById("namesCount").textContent = String(names.length);
  document.getElementById("uniqueNamesCount").textContent = String(uniqueNames.size);
  document.getElementById("selectedCompaniesCount").textContent = String(selectedCompanies.size);
  document.getElementById("dailyAppliedCount").textContent = String(computeDailyAppliedCount());
}

function updateCurrentUserLabel() {
  const node = document.getElementById("currentUserLabel");
  if (node) {
    node.textContent = `User: ${meUsername || "-"}`;
  }
}

function showAuthGate(subtitle) {
  const authGate = document.getElementById("authGate");
  const appShell = document.getElementById("appShell");
  const authSubtitle = document.getElementById("authSubtitle");
  if (authSubtitle && subtitle) {
    authSubtitle.textContent = subtitle;
  }
  if (authGate) {
    authGate.classList.remove("hidden");
  }
  if (appShell) {
    appShell.classList.add("hidden");
  }
  setAuthError("");
}

function showAppShell() {
  const authGate = document.getElementById("authGate");
  const appShell = document.getElementById("appShell");
  if (authGate) {
    authGate.classList.add("hidden");
  }
  if (appShell) {
    appShell.classList.remove("hidden");
  }
}

function setAuthBusy(busy) {
  const loginBtn = document.getElementById("authLoginBtn");
  const registerBtn = document.getElementById("authRegisterBtn");
  const username = document.getElementById("authUsername");
  const password = document.getElementById("authPassword");
  if (loginBtn) {
    loginBtn.disabled = busy;
    loginBtn.textContent = busy ? "Please wait..." : "Login";
  }
  if (registerBtn) {
    registerBtn.disabled = busy;
  }
  if (username) {
    username.disabled = busy;
  }
  if (password) {
    password.disabled = busy;
  }
}

function setAuthError(message) {
  const node = document.getElementById("authError");
  if (!node) {
    return;
  }
  const text = String(message || "").trim();
  node.textContent = text;
  node.classList.toggle("hidden", !text);
}

function updateToggleAllNamesButton() {
  const button = document.getElementById("toggleAllNamesBtn");
  if (!button) {
    return;
  }
  button.textContent = allNamesVisible ? "Hide All Names" : "Show All Names";
}

function setCardNamesVisibility(card, visible) {
  const namesContainer = card.querySelector(".names");
  const toggleButton = card.querySelector("button[data-action='toggle']");
  if (!namesContainer || !toggleButton) {
    return;
  }
  namesContainer.dataset.namesVisible = visible ? "true" : "false";
  namesContainer.classList.toggle("hidden", !visible);
  toggleButton.textContent = visible ? "Hide Names" : "Show Names";
}

function sortEntries(entries, sortValue) {
  if (sortValue === "company-desc") {
    entries.sort((a, b) => b[0].localeCompare(a[0]));
    return;
  }
  if (sortValue === "names-desc") {
    entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    return;
  }
  if (sortValue === "names-asc") {
    entries.sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
    return;
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
}

function filterEntries(entries, query) {
  if (!query) {
    return entries;
  }
  const lowered = query.toLowerCase();
  return entries.filter(([company, names]) => {
    if (company.toLowerCase().includes(lowered)) {
      return true;
    }
    return names.some((name) => name.toLowerCase().includes(lowered));
  });
}

function isCompanyApplied(company) {
  return appliedCompaniesState[company] === true;
}

function isCompanyCleanupDone(company) {
  return cleanupCompaniesState[company] === true;
}

function getCompanyDomain(company) {
  return normalizeDomain(companyDomainsState[company]);
}

function filterByAppliedTab(entries) {
  if (appliedTab === "applied-cleanup") {
    return entries.filter(([company]) => isCompanyApplied(company) && isCompanyCleanupDone(company));
  }
  if (appliedTab === "applied") {
    return entries.filter(([company]) => isCompanyApplied(company) && !isCompanyCleanupDone(company));
  }
  return entries.filter(([company]) => !isCompanyApplied(company));
}

function filterByDomain(entries) {
  return entries.filter(([company]) => getCompanyDomain(company) === selectedDomain);
}

function updateDomainTabButtons() {
  DOMAIN_ORDER.forEach((domain) => {
    const button = document.querySelector(`[data-domain-tab="${domain}"]`);
    if (!button) {
      return;
    }
    const count = Object.keys(companiesState).filter((company) => getCompanyDomain(company) === domain).length;
    button.classList.toggle("active", selectedDomain === domain);
    button.textContent = `${DOMAIN_LABELS[domain]} (${count})`;
  });
}

function updateAppliedTabButtons() {
  const notAppliedButton = document.getElementById("notAppliedTabBtn");
  const appliedButton = document.getElementById("appliedTabBtn");
  const appliedCleanupButton = document.getElementById("appliedCleanupTabBtn");
  if (!notAppliedButton || !appliedButton || !appliedCleanupButton) {
    return;
  }
  const domainCompanies = Object.keys(companiesState).filter((company) => getCompanyDomain(company) === selectedDomain);
  const notAppliedCount = domainCompanies.filter((company) => !isCompanyApplied(company)).length;
  const appliedCount = domainCompanies.filter((company) => isCompanyApplied(company) && !isCompanyCleanupDone(company)).length;
  const appliedCleanupCount = domainCompanies.filter((company) => isCompanyApplied(company) && isCompanyCleanupDone(company)).length;
  notAppliedButton.classList.toggle("active", appliedTab === "not-applied");
  appliedButton.classList.toggle("active", appliedTab === "applied");
  appliedCleanupButton.classList.toggle("active", appliedTab === "applied-cleanup");
  notAppliedButton.textContent = `Not Applied (${notAppliedCount})`;
  appliedButton.textContent = `Applied (${appliedCount})`;
  appliedCleanupButton.textContent = `Applied + Cleanup (${appliedCleanupCount})`;
}

function createNamesContainer(names) {
  const namesContainer = document.createElement("div");
  namesContainer.className = "names";
  names.forEach((name) => {
    const pill = document.createElement("span");
    pill.className = "name-pill";
    pill.textContent = name;
    namesContainer.appendChild(pill);
  });
  return namesContainer;
}

function escapeCSV(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderUserStats() {
  const host = document.getElementById("userStats");
  if (!host) {
    return;
  }
  const appliedCounts = {};
  const recentLogByCompany = {};

  // Build a quick lookup from log for companies missing latestApplier.
  applicationLogState.forEach((entry) => {
    if (entry.action !== "applied") {
      return;
    }
    const company = String(entry.company || "").trim();
    const username = String(entry.username || "").trim();
    if (!company || !username || recentLogByCompany[company]) {
      return;
    }
    recentLogByCompany[company] = username;
  });

  Object.keys(companiesState).forEach((company) => {
    if (!isCompanyApplied(company)) {
      return;
    }

    let username = String(companyLatestApplierState[company] || "").trim();
    if (!username) {
      username = String(recentLogByCompany[company] || "").trim();
    }
    // If there is only one user in this workspace, attribute missing values to that user.
    if (!username && usersState.length === 1) {
      username = usersState[0];
    }
    if (!username) {
      return;
    }

    appliedCounts[username] = (appliedCounts[username] || 0) + 1;
  });

  const rows = usersState.map((username) => ({
    username,
    applied: appliedCounts[username] || 0
  })).sort((a, b) => b.applied - a.applied || a.username.localeCompare(b.username));

  host.innerHTML = "";
  if (!rows.length) {
    host.innerHTML = `<div class="empty">No users found.</div>`;
    return;
  }

  rows.forEach((row) => {
    const card = document.createElement("article");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-label">${row.username === meUsername ? "You" : "User"}</div>
      <div class="meta">${row.username}</div>
      <div class="stat-value">${row.applied}</div>
    `;
    host.appendChild(card);
  });
}

function renderCompanies() {
  const dashboard = document.getElementById("dashboard");
  const searchValue = document.getElementById("searchInput").value.trim();
  const sortValue = document.getElementById("sortSelect").value;
  const entries = Object.entries(companiesState).map(([company, names]) => [company, normalizeNames(names)]);

  selectedCompanies.forEach((company) => {
    if (!companiesState[company]) {
      selectedCompanies.delete(company);
    }
  });

  sortEntries(entries, sortValue);
  const searched = filterEntries(entries, searchValue);
  const byDomain = filterByDomain(searched);
  const filtered = filterByAppliedTab(byDomain);
  lastRendered = filtered;

  if (!filtered.length) {
    const hasAnyDomainCompanies = entries.some(([company]) => getCompanyDomain(company) === selectedDomain);
    const message = !entries.length
      ? "No company data saved yet."
      : (!hasAnyDomainCompanies
        ? `No companies in ${DOMAIN_LABELS[selectedDomain]} yet.`
        : (appliedTab === "applied"
          ? "No applied companies match your search."
          : (appliedTab === "applied-cleanup"
            ? "No applied and cleaned companies match your search."
            : "No not-applied companies match your search.")));
    dashboard.innerHTML = `<div class="empty">${message}</div>`;
    updateDomainTabButtons();
    updateAppliedTabButtons();
    return;
  }

  dashboard.innerHTML = "";

  filtered.forEach(([company, names]) => {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.company = company;
    if (selectedCompanies.has(company)) {
      card.classList.add("selected");
    }
    if (isCompanyApplied(company)) {
      card.classList.add("applied");
    }

    const top = document.createElement("div");
    top.className = "card-top";

    const titleWrap = document.createElement("div");
    titleWrap.className = "card-title-wrap";
    titleWrap.dataset.cardToggle = "true";
    const title = document.createElement("h2");
    title.className = "company-title";
    title.textContent = company;

    const ratioBadge = document.createElement("span");
    ratioBadge.className = "ratio-badge";
    const emails = normalizeEmails(generatedEmailsState[company]);
    const percent = names.length ? Math.round((emails.length / names.length) * 100) : 0;
    ratioBadge.textContent = `${emails.length}/${names.length} • ${percent}%`;

    const meta = document.createElement("div");
    meta.className = "meta";
    const appliedStatus = isCompanyApplied(company) ? "Applied" : "Not Applied";
    const addedBy = companyAddedByState[company] || "-";
    const latestApplier = companyLatestApplierState[company] || "-";
    meta.textContent = `${names.length} name(s) | ${appliedStatus} | Added by: ${addedBy} | Latest applier: ${latestApplier}`;
    titleWrap.appendChild(title);
    titleWrap.appendChild(ratioBadge);
    titleWrap.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.innerHTML = `
      <button class="mini-btn" data-action="toggle">Show Names</button>
      <button class="mini-btn" data-action="copy">Copy</button>
      <button class="mini-btn" data-action="edit-names">Edit Names</button>
      <button class="mini-btn" data-action="copy-emails">Copy Emails</button>
      <button class="mini-btn" data-action="export">Export CSV</button>
      <button class="mini-btn" data-action="rename">Rename</button>
      <button class="mini-btn delete" data-action="delete">Delete</button>
    `;

    const selection = document.createElement("label");
    selection.className = "selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.action = "select";
    checkbox.dataset.company = company;
    checkbox.checked = selectedCompanies.has(company);
    const selectionText = document.createElement("span");
    selectionText.textContent = "Selected";
    selection.appendChild(checkbox);
    selection.appendChild(selectionText);

    const domainSelection = document.createElement("label");
    domainSelection.className = "selection";
    const domainText = document.createElement("span");
    domainText.textContent = "Domain";
    const domainSelect = document.createElement("select");
    domainSelect.className = "domain-select";
    domainSelect.dataset.action = "set-company-domain";
    domainSelect.dataset.company = company;
    DOMAIN_ORDER.forEach((domain) => {
      const option = document.createElement("option");
      option.value = domain;
      option.textContent = DOMAIN_LABELS[domain];
      domainSelect.appendChild(option);
    });
    domainSelect.value = getCompanyDomain(company);
    domainSelection.appendChild(domainText);
    domainSelection.appendChild(domainSelect);

    const appliedSelection = document.createElement("label");
    appliedSelection.className = "selection";
    const appliedCheckbox = document.createElement("input");
    appliedCheckbox.type = "checkbox";
    appliedCheckbox.dataset.action = "mark-company-applied";
    appliedCheckbox.dataset.company = company;
    appliedCheckbox.checked = isCompanyApplied(company);
    const appliedText = document.createElement("span");
    appliedText.textContent = "Applied";
    appliedSelection.appendChild(appliedCheckbox);
    appliedSelection.appendChild(appliedText);

    const cleanupSelection = document.createElement("label");
    cleanupSelection.className = "selection";
    const cleanupCheckbox = document.createElement("input");
    cleanupCheckbox.type = "checkbox";
    cleanupCheckbox.dataset.action = "mark-company-cleanup";
    cleanupCheckbox.dataset.company = company;
    cleanupCheckbox.checked = isCompanyCleanupDone(company);
    cleanupCheckbox.disabled = !isCompanyApplied(company);
    const cleanupText = document.createElement("span");
    cleanupText.textContent = "Cleanup";
    cleanupSelection.appendChild(cleanupCheckbox);
    cleanupSelection.appendChild(cleanupText);

    const namesContainer = createNamesContainer(names);
    namesContainer.dataset.namesVisible = allNamesVisible ? "true" : "false";
    namesContainer.classList.toggle("hidden", !allNamesVisible);

    top.appendChild(titleWrap);
    top.appendChild(actions);
    const controls = document.createElement("div");
    controls.className = "card-controls";
    controls.appendChild(selection);
    controls.appendChild(domainSelection);
    controls.appendChild(appliedSelection);
    controls.appendChild(cleanupSelection);

    card.appendChild(top);
    card.appendChild(controls);
    card.appendChild(namesContainer);
    dashboard.appendChild(card);
    setCardNamesVisibility(card, allNamesVisible);
  });

  updateToggleAllNamesButton();
  updateDomainTabButtons();
  updateAppliedTabButtons();
}

function applySnapshot(snapshot) {
  const companies = {};
  const generatedEmails = {};
  const generatedByFormat = {};
  const applied = {};
  const domains = {};
  const cleanup = {};
  const addedBy = {};
  const latestApplier = {};

  (snapshot.companies || []).forEach((item) => {
    const company = String(item.company || "").trim();
    if (!company) {
      return;
    }
    companies[company] = normalizeNames(item.names || []);
    generatedEmails[company] = normalizeEmails(item.generatedEmails || []);
    generatedByFormat[company] = item.generatedEmailsByFormat || {};
    domains[company] = normalizeDomain(item.domain);
    if (item.applied === true) {
      applied[company] = true;
    }
    if (item.cleanupDone === true) {
      cleanup[company] = true;
    }
    addedBy[company] = item.addedBy || "-";
    latestApplier[company] = item.latestApplier || null;
  });

  companiesState = companies;
  generatedEmailsState = generatedEmails;
  generatedEmailsByFormatState = generatedByFormat;
  appliedCompaniesState = applied;
  companyDomainsState = domains;
  cleanupCompaniesState = cleanup;
  companyAddedByState = addedBy;
  companyLatestApplierState = latestApplier;
  usersState = Array.isArray(snapshot.users) ? snapshot.users : [];
  meUsername = snapshot.me && snapshot.me.username ? snapshot.me.username : "";
  applicationLogState = Array.isArray(snapshot.applicationLog) ? snapshot.applicationLog : [];
  snapshotVersion = Number(snapshot.version || snapshotVersion || 0);

  updateCurrentUserLabel();
  updateStats();
  renderUserStats();
  renderCompanies();
  updateLastUpdated();
}

async function refreshSnapshot(force = false) {
  const snapshot = await SharedApi.getSnapshot();
  const nextVersion = Number(snapshot.version || 0);
  if (!force && snapshotVersion && nextVersion === snapshotVersion) {
    return;
  }
  applySnapshot(snapshot);
  await chrome.storage.local.set({ [SNAPSHOT_CACHE_KEY]: snapshot });
}

async function handleCompanyAction(button) {
  const action = button.dataset.action;
  const card = button.closest(".card");
  if (!card || !action) {
    return;
  }
  const company = card.dataset.company;
  const names = normalizeNames(companiesState[company] || []);
  const emails = normalizeEmails(generatedEmailsState[company] || []);

  if (action === "toggle") {
    const namesContainer = card.querySelector(".names");
    const visible = namesContainer && namesContainer.dataset.namesVisible === "true";
    setCardNamesVisibility(card, !visible);
    return;
  }

  if (action === "copy") {
    await navigator.clipboard.writeText(names.join(", "));
    return;
  }

  if (action === "copy-emails") {
    if (!emails.length) {
      alert("No saved emails for this company yet.");
      return;
    }
    await navigator.clipboard.writeText(emails.join(", "));
    return;
  }

  if (action === "edit-names") {
    const input = prompt("Edit names (one per line or comma-separated):", names.join("\n"));
    if (input === null) {
      return;
    }
    const edited = normalizeNames(
      input
        .split(/[\n,]/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
    );
    if (!edited.length) {
      alert("At least one valid name is required.");
      return;
    }
    await SharedApi.upsertCompanyNames(company, edited, getCompanyDomain(company));
    await refreshSnapshot(true);
    return;
  }

  if (action === "export") {
    const rows = ["Company,Name"];
    names.forEach((name) => rows.push(`${escapeCSV(company)},${escapeCSV(name)}`));
    downloadTextFile(`${company.toLowerCase().replace(/\s+/g, "-")}-names.csv`, rows.join("\n"), "text/csv");
    return;
  }

  if (action === "rename") {
    const newNameRaw = prompt("New company name:", company);
    if (!newNameRaw) {
      return;
    }
    const newName = newNameRaw.trim();
    if (!newName || newName === company) {
      return;
    }
    await SharedApi.renameCompany(company, newName);
    await refreshSnapshot(true);
    return;
  }

  if (action === "delete") {
    const shouldDelete = confirm(`Delete all names for "${company}" permanently?`);
    if (!shouldDelete) {
      return;
    }
    await SharedApi.deleteCompany(company);
    selectedCompanies.delete(company);
    await refreshSnapshot(true);
  }
}

async function copyAllNames() {
  const names = allNames(companiesState);
  if (!names.length) {
    alert("No names available.");
    return;
  }
  await navigator.clipboard.writeText(names.join(", "));
}

async function copySelectedNames() {
  const selected = [...selectedCompanies];
  if (!selected.length) {
    alert("No companies selected.");
    return;
  }
  const names = selected.flatMap((company) => normalizeNames(companiesState[company] || []));
  if (!names.length) {
    alert("No names available for selection.");
    return;
  }
  await navigator.clipboard.writeText(names.join(", "));
}

function exportAllCsv() {
  const entries = Object.entries(companiesState);
  if (!entries.length) {
    alert("No company data to export.");
    return;
  }
  const rows = ["Company,Name"];
  entries.forEach(([company, names]) => {
    names.forEach((name) => rows.push(`${escapeCSV(company)},${escapeCSV(name)}`));
  });
  downloadTextFile("linkedin-company-names.csv", rows.join("\n"), "text/csv");
}

function exportSelectedCsv() {
  const entries = [...selectedCompanies].map((company) => [company, companiesState[company] || []]);
  if (!entries.length) {
    alert("No companies selected.");
    return;
  }
  const rows = ["Company,Name"];
  entries.forEach(([company, names]) => {
    names.forEach((name) => rows.push(`${escapeCSV(company)},${escapeCSV(name)}`));
  });
  downloadTextFile("selected-company-names.csv", rows.join("\n"), "text/csv");
}

function exportJsonBackup() {
  // Export the full extension storage so nothing is lost during migration/debug.
  chrome.storage.local.get(null, (fullStorage) => {
    if (chrome.runtime.lastError) {
      alert(`Export failed: ${chrome.runtime.lastError.message}`);
      return;
    }
    try {
      const data = JSON.stringify(fullStorage || {}, null, 2);
      downloadTextFile("linkedin-full-storage-backup.json", data, "application/json");
      alert("Backup downloaded: linkedin-full-storage-backup.json");
    } catch (error) {
      alert(`Export failed: ${error.message}`);
    }
  });
}

async function importJsonBackup(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert("Invalid JSON file.");
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    alert("No valid company data found in JSON.");
    return;
  }

  // Support both old backup shape ({Company: [names]}) and full storage backup ({ companies: {...}, ... }).
  const sourceCompanies = parsed.companies && typeof parsed.companies === "object"
    ? parsed.companies
    : parsed;
  const entries = Object.entries(sourceCompanies).filter(([, names]) => Array.isArray(names));
  if (!entries.length) {
    alert("No valid company data found in JSON.");
    return;
  }
  for (const [company, names] of entries) {
    const normalized = normalizeNames(names);
    if (!company.trim() || !normalized.length) {
      continue;
    }
    await SharedApi.upsertCompanyNames(company, normalized, "software");
  }
  await refreshSnapshot(true);
}

async function clearAllData() {
  const allCompanies = Object.keys(companiesState);
  if (!allCompanies.length) {
    return;
  }
  const shouldClear = confirm("Delete all companies and names permanently?");
  if (!shouldClear) {
    return;
  }
  for (const company of allCompanies) {
    await SharedApi.deleteCompany(company);
  }
  selectedCompanies = new Set();
  await refreshSnapshot(true);
}

function selectVisible() {
  lastRendered.forEach(([company]) => selectedCompanies.add(company));
  updateStats();
  renderCompanies();
}

function clearSelection() {
  selectedCompanies = new Set();
  updateStats();
  renderCompanies();
}

function toggleAllNamesVisibility() {
  allNamesVisible = !allNamesVisible;
  renderCompanies();
}

async function deleteSelected() {
  if (!selectedCompanies.size) {
    alert("No companies selected.");
    return;
  }
  const shouldDelete = confirm("Delete all selected companies permanently?");
  if (!shouldDelete) {
    return;
  }
  for (const company of [...selectedCompanies]) {
    await SharedApi.deleteCompany(company);
  }
  selectedCompanies = new Set();
  await refreshSnapshot(true);
}

async function handleLogout() {
  await SharedApi.logout();
  meUsername = "";
  updateCurrentUserLabel();
  showAuthGate("Signed out. Please sign in to continue.");

  try {
    const status = await SharedApi.authStatus();
    if (status && status.hasUsers === false) {
      showAuthGate("Create the first account to continue.");
    }
  } catch {
    showAuthGate("Cannot reach backend right now. Please try again.");
  }
}

async function loadCachedSnapshotIfAvailable() {
  const data = await chrome.storage.local.get([SNAPSHOT_CACHE_KEY]);
  const snapshot = data[SNAPSHOT_CACHE_KEY];
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  try {
    applySnapshot(snapshot);
  } catch (error) {
    console.warn("Invalid cached snapshot, ignoring.", error);
  }
}

async function enterDashboardForUser(me) {
  meUsername = me && me.username ? me.username : "";
  updateCurrentUserLabel();
  showAppShell();
  await loadCachedSnapshotIfAvailable();
  await refreshSnapshot(true);
}

async function bootstrapAuth() {
  setAuthError("");
  try {
    const me = await SharedApi.getMeIfSignedIn();
    if (me && me.username) {
      await enterDashboardForUser(me);
      return;
    }
  } catch {
    // continue to auth screen
  }

  try {
    const status = await SharedApi.authStatus();
    if (status && status.hasUsers === false) {
      showAuthGate("Create the first account to continue.");
    } else {
      showAuthGate("Sign in to open your dashboard.");
    }
  } catch {
    showAuthGate("Cannot reach backend right now. Check connection and try again.");
  }
}

async function submitAuth(mode) {
  const usernameInput = document.getElementById("authUsername");
  const passwordInput = document.getElementById("authPassword");
  const username = String((usernameInput && usernameInput.value) || "").trim().toLowerCase();
  const password = String((passwordInput && passwordInput.value) || "");

  if (!username || !password) {
    setAuthError("Enter username and password.");
    return;
  }

  setAuthBusy(true);
  setAuthError("");
  try {
    const status = await SharedApi.authStatus();
    let me;
    if (status && status.hasUsers === false) {
      me = await SharedApi.registerFirst(username, password);
    } else if (mode === "register") {
      me = await SharedApi.register(username, password);
    } else {
      me = await SharedApi.login(username, password);
    }
    if (passwordInput) {
      passwordInput.value = "";
    }
    await enterDashboardForUser(me);
  } catch (error) {
    setAuthError(error.message || "Authentication failed.");
  } finally {
    setAuthBusy(false);
  }
}

async function initDashboard() {
  const data = await chrome.storage.local.get(["themeMode"]);
  themeMode = data.themeMode === "dark" ? "dark" : "light";
  applyThemeMode();
  showAuthGate("Checking your session...");

  const authForm = document.getElementById("authForm");
  const authRegisterBtn = document.getElementById("authRegisterBtn");
  if (authForm) {
    authForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAuth("login").catch((error) => setAuthError(error.message));
    });
  }
  if (authRegisterBtn) {
    authRegisterBtn.addEventListener("click", () => {
      submitAuth("register").catch((error) => setAuthError(error.message));
    });
  }

  document.getElementById("searchInput").addEventListener("input", renderCompanies);
  document.getElementById("sortSelect").addEventListener("change", renderCompanies);
  document.querySelectorAll("[data-domain-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextDomain = normalizeDomain(button.dataset.domainTab);
      if (nextDomain !== selectedDomain) {
        selectedDomain = nextDomain;
        renderCompanies();
      }
    });
  });
  document.querySelectorAll("[data-applied-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.appliedTab;
      if (nextTab && nextTab !== appliedTab) {
        appliedTab = nextTab;
        renderCompanies();
      }
    });
  });

  document.getElementById("dashboard").addEventListener("click", async (event) => {
    const cardToggle = event.target.closest("[data-card-toggle='true']");
    if (cardToggle && !event.target.closest("button")) {
      const card = cardToggle.closest(".card");
      if (card) {
        const namesContainer = card.querySelector(".names");
        const visible = namesContainer && namesContainer.dataset.namesVisible === "true";
        setCardNamesVisibility(card, !visible);
      }
      return;
    }
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    try {
      await handleCompanyAction(button);
    } catch (error) {
      alert(`Action failed: ${error.message}`);
    }
  });

  document.getElementById("dashboard").addEventListener("change", async (event) => {
    const domainSelect = event.target.closest("select[data-action='set-company-domain']");
    if (domainSelect) {
      await SharedApi.setCompanyDomain(domainSelect.dataset.company, domainSelect.value);
      await refreshSnapshot(true);
      return;
    }

    const appliedCheck = event.target.closest("input[data-action='mark-company-applied']");
    if (appliedCheck) {
      await SharedApi.markCompanyApplied(appliedCheck.dataset.company, appliedCheck.checked);
      await refreshSnapshot(true);
      return;
    }

    const cleanupCheck = event.target.closest("input[data-action='mark-company-cleanup']");
    if (cleanupCheck) {
      if (!isCompanyApplied(cleanupCheck.dataset.company) && cleanupCheck.checked) {
        cleanupCheck.checked = false;
        alert("Mark company as applied first, then enable cleanup.");
        return;
      }
      await SharedApi.setCompanyCleanup(cleanupCheck.dataset.company, cleanupCheck.checked);
      await refreshSnapshot(true);
      return;
    }

    const checkbox = event.target.closest("input[data-action='select']");
    if (!checkbox) {
      return;
    }
    const company = checkbox.dataset.company;
    if (checkbox.checked) {
      selectedCompanies.add(company);
    } else {
      selectedCompanies.delete(company);
    }
    updateStats();
  });

  document.getElementById("copyAllBtn").addEventListener("click", () => copyAllNames().catch(() => alert("Could not copy all names.")));
  document.getElementById("exportAllBtn").addEventListener("click", exportAllCsv);
  document.getElementById("clearAllBtn").addEventListener("click", () => clearAllData().catch((e) => alert(e.message)));
  document.getElementById("selectVisibleBtn").addEventListener("click", selectVisible);
  document.getElementById("clearSelectionBtn").addEventListener("click", clearSelection);
  document.getElementById("toggleAllNamesBtn").addEventListener("click", toggleAllNamesVisibility);
  document.getElementById("copySelectedBtn").addEventListener("click", () => copySelectedNames().catch(() => alert("Could not copy selected names.")));
  document.getElementById("exportSelectedBtn").addEventListener("click", exportSelectedCsv);
  document.getElementById("deleteSelectedBtn").addEventListener("click", () => deleteSelected().catch((e) => alert(e.message)));
  document.getElementById("exportJsonBtn").addEventListener("click", exportJsonBackup);
  document.getElementById("importJsonInput").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    await importJsonBackup(file);
    event.target.value = "";
  });

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => handleLogout().catch((e) => alert(e.message)));
  }
  const currentUserBtn = document.getElementById("currentUserBtn");
  if (currentUserBtn) {
    currentUserBtn.addEventListener("click", () => alert(`Signed in as ${meUsername}`));
  }

  document.getElementById("emailGenBtn").addEventListener("click", () => {
    window.open(chrome.runtime.getURL("email-generator.html"));
  });
  document.getElementById("sendEmailBtn").addEventListener("click", () => {
    window.open(chrome.runtime.getURL("send-email.html"));
  });
  document.getElementById("emailCleanupBtn").addEventListener("click", () => {
    window.open(chrome.runtime.getURL("email-cleanup.html"));
  });
  document.getElementById("statsPageBtn").addEventListener("click", () => {
    window.open(chrome.runtime.getURL("stats.html"));
  });
  document.getElementById("homeBtn").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("themeToggleBtn").addEventListener("click", toggleThemeMode);

  pollTimer = setInterval(() => {
    const appShell = document.getElementById("appShell");
    if (!appShell || appShell.classList.contains("hidden")) {
      return;
    }
    refreshSnapshot(false).catch(() => {});
  }, 5000);

  await bootstrapAuth();
}

initDashboard().catch((error) => {
  alert(`Dashboard init failed: ${error.message}`);
});
