let companiesState = {};
let generatedEmailsState = {};
let appliedCompaniesState = {};
let companyDomainsState = {};
let cleanupCompaniesState = {};
let applicationLogState = [];
let selectedCompanies = new Set();
let lastRendered = [];
let allNamesVisible = false;
let appliedTab = "not-applied";
let selectedDomain = "software";
let themeMode = "light";
let dailyAppliedStats = { date: "", count: 0 };
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
  value
    .map((name) => String(name).trim())
    .filter((name) => name.length > 0)
    .forEach((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(name);
    });
  return result;
}

function sanitizeCompanies(raw) {
  const cleaned = {};
  if (!raw || typeof raw !== "object") {
    return cleaned;
  }

  Object.keys(raw).forEach((company) => {
    const names = Array.isArray(raw[company]) ? raw[company] : [];
    const normalized = normalizeNames(names);
    const trimmedCompany = company.trim();
    if (trimmedCompany && normalized.length > 0) {
      cleaned[trimmedCompany] = normalized;
    }
  });

  return cleaned;
}

function sanitizeAppliedCompanies(raw, companies) {
  const cleaned = {};
  if (!raw || typeof raw !== "object") {
    return cleaned;
  }

  Object.keys(companies).forEach((company) => {
    if (raw[company] === true) {
      cleaned[company] = true;
    }
  });

  return cleaned;
}

function normalizeDomain(value) {
  const key = String(value || "").trim().toLowerCase();
  return DOMAIN_ORDER.includes(key) ? key : "software";
}

function sanitizeCompanyDomains(raw, companies) {
  const cleaned = {};
  Object.keys(companies).forEach((company) => {
    const incoming = raw && typeof raw === "object" ? raw[company] : null;
    cleaned[company] = normalizeDomain(incoming);
  });
  return cleaned;
}

function sanitizeCleanupCompanies(raw, companies) {
  const cleaned = {};
  if (!raw || typeof raw !== "object") {
    return cleaned;
  }

  Object.keys(companies).forEach((company) => {
    if (raw[company] === true) {
      cleaned[company] = true;
    }
  });

  return cleaned;
}

function sanitizeApplicationLog(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const company = String(entry.company || "").trim();
      const dateKey = String(entry.dateKey || "").trim();
      const timestamp = String(entry.timestamp || "").trim();
      const action = String(entry.action || "").trim().toLowerCase();
      if (!company || !dateKey || !timestamp || action !== "applied") {
        return null;
      }
      return { company, dateKey, timestamp, action: "applied" };
    })
    .filter(Boolean);
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

function allNames(companies) {
  return Object.values(companies).flatMap((names) => normalizeNames(names));
}

function updateStats(companies) {
  const companyEntries = Object.entries(companies);
  const names = allNames(companies);
  const uniqueNames = new Set(names.map((name) => name.toLowerCase()));

  document.getElementById("companiesCount").textContent = String(companyEntries.length);
  document.getElementById("namesCount").textContent = String(names.length);
  document.getElementById("uniqueNamesCount").textContent = String(uniqueNames.size);
  document.getElementById("selectedCompaniesCount").textContent = String(selectedCompanies.size);
  document.getElementById("dailyAppliedCount").textContent = String(dailyAppliedStats.count || 0);
}

function updateLastUpdated() {
  const stamp = new Date().toLocaleString();
  document.getElementById("lastUpdated").textContent = `Updated ${stamp}`;
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


function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureDailyAppliedStats() {
  const today = getTodayKey();
  if (!dailyAppliedStats || dailyAppliedStats.date !== today) {
    dailyAppliedStats = { date: today, count: 0 };
    return true;
  }
  if (!Number.isFinite(dailyAppliedStats.count) || dailyAppliedStats.count < 0) {
    dailyAppliedStats.count = 0;
    return true;
  }
  return false;
}

function appendApplicationLog(company) {
  const now = new Date();
  applicationLogState.push({
    company,
    dateKey: getTodayKey(),
    timestamp: now.toISOString(),
    action: "applied"
  });
}

function removeLatestApplicationLogForCompany(company) {
  let latestIndex = -1;
  let latestTime = -1;

  applicationLogState.forEach((entry, index) => {
    if (entry.company !== company || entry.action !== "applied") {
      return;
    }
    const time = new Date(entry.timestamp).getTime();
    if (Number.isFinite(time) && time > latestTime) {
      latestTime = time;
      latestIndex = index;
    }
  });

  if (latestIndex >= 0) {
    applicationLogState.splice(latestIndex, 1);
  }
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

function setCompanyApplied(company, applied) {
  if (applied) {
    appliedCompaniesState[company] = true;
  } else {
    delete appliedCompaniesState[company];
  }
}

function pruneAppliedCompanies() {
  appliedCompaniesState = sanitizeAppliedCompanies(appliedCompaniesState, companiesState);
}

function pruneCompanyDomains() {
  companyDomainsState = sanitizeCompanyDomains(companyDomainsState, companiesState);
}

function getCompanyDomain(company) {
  return normalizeDomain(companyDomainsState[company]);
}

function setCompanyDomain(company, domain) {
  companyDomainsState[company] = normalizeDomain(domain);
}

function isCompanyCleanupDone(company) {
  return cleanupCompaniesState[company] === true;
}

function setCompanyCleanupDone(company, done) {
  if (done) {
    cleanupCompaniesState[company] = true;
  } else {
    delete cleanupCompaniesState[company];
  }
}

function pruneCleanupCompanies() {
  cleanupCompaniesState = sanitizeCleanupCompanies(cleanupCompaniesState, companiesState);
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

function normalizeEmails(value) {
  return (Array.isArray(value) ? value : [])
    .map((email) => String(email).trim())
    .filter((email) => email.length > 0);
}

function pruneGeneratedEmails() {
  Object.keys(generatedEmailsState).forEach((company) => {
    if (!companiesState[company]) {
      delete generatedEmailsState[company];
    }
  });
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

  const domainCompanies = Object.keys(companiesState)
    .filter((company) => getCompanyDomain(company) === selectedDomain);
  const notAppliedCount = domainCompanies.filter((company) => !isCompanyApplied(company)).length;
  const appliedCount = domainCompanies.filter((company) => {
    return isCompanyApplied(company) && !isCompanyCleanupDone(company);
  }).length;
  const appliedCleanupCount = domainCompanies.filter((company) => {
    return isCompanyApplied(company) && isCompanyCleanupDone(company);
  }).length;

  notAppliedButton.classList.toggle("active", appliedTab === "not-applied");
  appliedButton.classList.toggle("active", appliedTab === "applied");
  appliedCleanupButton.classList.toggle("active", appliedTab === "applied-cleanup");
  notAppliedButton.textContent = `Not Applied (${notAppliedCount})`;
  appliedButton.textContent = `Applied (${appliedCount})`;
  appliedCleanupButton.textContent = `Applied + Cleanup (${appliedCleanupCount})`;
}

function renderCompanies(companies) {
  const dashboard = document.getElementById("dashboard");
  const searchValue = document.getElementById("searchInput").value.trim();
  const sortValue = document.getElementById("sortSelect").value;
  const entries = Object.entries(companies).map(([company, names]) => [
    company,
    normalizeNames(names)
  ]);

  selectedCompanies.forEach((company) => {
    if (!companies[company]) {
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
    const meta = document.createElement("div");
    meta.className = "meta";
    const savedEmails = normalizeEmails(generatedEmailsState[company]);
    const percent = names.length ? Math.round((savedEmails.length / names.length) * 100) : 0;
    ratioBadge.textContent = `${savedEmails.length}/${names.length} • ${percent}%`;
    const appliedStatus = isCompanyApplied(company) ? "Applied" : "Not Applied";
    meta.textContent = `${names.length} name(s) | ${appliedStatus} | ${savedEmails.length} saved email(s)`;
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
    const cleanupText = document.createElement("span");
    cleanupText.textContent = "Cleanup";
    cleanupSelection.appendChild(cleanupCheckbox);
    cleanupSelection.appendChild(cleanupText);

    top.appendChild(titleWrap);
    top.appendChild(actions);

    const cardControls = document.createElement("div");
    cardControls.className = "card-controls";
    cardControls.appendChild(selection);
    cardControls.appendChild(domainSelection);
    cardControls.appendChild(appliedSelection);
    cardControls.appendChild(cleanupSelection);

    const namesContainer = createNamesContainer(names);
    namesContainer.dataset.namesVisible = allNamesVisible ? "true" : "false";
    namesContainer.classList.toggle("hidden", !allNamesVisible);

    card.appendChild(top);
    card.appendChild(cardControls);
    card.appendChild(namesContainer);

    dashboard.appendChild(card);
    setCardNamesVisibility(card, allNamesVisible);

  });

  updateToggleAllNamesButton();
  updateDomainTabButtons();
  updateAppliedTabButtons();
}

async function persistCompanies() {
  ensureDailyAppliedStats();
  await chrome.storage.local.set({
    companies: companiesState,
    generatedEmails: generatedEmailsState,
    appliedCompanies: appliedCompaniesState,
    companyDomains: companyDomainsState,
    cleanupCompanies: cleanupCompaniesState,
    dailyAppliedStats,
    applicationLog: applicationLogState
  });
}

function mergeCompanies(target, source) {
  Object.entries(source).forEach(([company, names]) => {
    const existing = target[company] || [];
    const merged = normalizeNames([...existing, ...normalizeNames(names)]);
    if (merged.length > 0) {
      target[company] = merged;
    }
  });
}

async function handleCompanyAction(targetButton) {
  const action = targetButton.dataset.action;
  const card = targetButton.closest(".card");
  if (!card || !action) {
    return;
  }

  const company = card.dataset.company;
  const names = normalizeNames(companiesState[company] || []);
  const emails = normalizeEmails(generatedEmailsState[company]);

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
      alert("No saved emails for this company yet. Generate emails first.");
      return;
    }
    await navigator.clipboard.writeText(emails.join(", "));
    return;
  }

  if (action === "edit-names") {
    const input = prompt(
      "Edit names (one per line or comma-separated):",
      names.join("\n")
    );
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

    companiesState[company] = edited;
    // Existing generated emails may no longer match edited names.
    delete generatedEmailsState[company];
    await persistCompanies();
    updateStats(companiesState);
    renderCompanies(companiesState);
    updateLastUpdated();
    return;
  }

  if (action === "export") {
    const rows = ["Company,Name"];
    names.forEach((name) => {
      rows.push(`${escapeCSV(company)},${escapeCSV(name)}`);
    });
    downloadTextFile(
      `${company.toLowerCase().replace(/\s+/g, "-")}-names.csv`,
      rows.join("\n"),
      "text/csv"
    );
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

    const existing = companiesState[newName] || [];
    const merged = normalizeNames([...existing, ...names]);
    companiesState[newName] = merged;
    const existingEmails = normalizeEmails(generatedEmailsState[newName]);
    generatedEmailsState[newName] = [...new Set([...existingEmails, ...emails])];
    if (isCompanyApplied(company) || isCompanyApplied(newName)) {
      appliedCompaniesState[newName] = true;
    } else {
      delete appliedCompaniesState[newName];
    }
    if (isCompanyCleanupDone(company) || isCompanyCleanupDone(newName)) {
      cleanupCompaniesState[newName] = true;
    } else {
      delete cleanupCompaniesState[newName];
    }
    companyDomainsState[newName] = getCompanyDomain(company);
    delete companiesState[company];
    delete generatedEmailsState[company];
    delete appliedCompaniesState[company];
    delete cleanupCompaniesState[company];
    delete companyDomainsState[company];
    if (selectedCompanies.has(company)) {
      selectedCompanies.delete(company);
      selectedCompanies.add(newName);
    }
    await persistCompanies();
    updateStats(companiesState);
    renderCompanies(companiesState);
    updateLastUpdated();
    return;
  }

  if (action === "delete") {
    const shouldDelete = confirm(`Delete all names for "${company}"?`);
    if (!shouldDelete) {
      return;
    }
    delete companiesState[company];
    delete generatedEmailsState[company];
    delete appliedCompaniesState[company];
    delete cleanupCompaniesState[company];
    delete companyDomainsState[company];
    selectedCompanies.delete(company);
    await persistCompanies();
    updateStats(companiesState);
    renderCompanies(companiesState);
    updateLastUpdated();
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
    normalizeNames(names).forEach((name) => {
      rows.push(`${escapeCSV(company)},${escapeCSV(name)}`);
    });
  });

  downloadTextFile("linkedin-company-names.csv", rows.join("\n"), "text/csv");
}

function exportSelectedCsv() {
  const entries = [...selectedCompanies].map((company) => [
    company,
    companiesState[company] || []
  ]);
  if (!entries.length) {
    alert("No companies selected.");
    return;
  }

  const rows = ["Company,Name"];
  entries.forEach(([company, names]) => {
    normalizeNames(names).forEach((name) => {
      rows.push(`${escapeCSV(company)},${escapeCSV(name)}`);
    });
  });

  downloadTextFile("selected-company-names.csv", rows.join("\n"), "text/csv");
}

function exportJsonBackup() {
  const data = JSON.stringify(companiesState, null, 2);
  downloadTextFile("linkedin-companies-backup.json", data, "application/json");
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

  const incoming = sanitizeCompanies(parsed);
  if (!Object.keys(incoming).length) {
    alert("No valid company data found in JSON.");
    return;
  }

  const shouldReplace = confirm("Replace existing data? Press Cancel to merge instead.");
  if (shouldReplace) {
    companiesState = incoming;
    pruneGeneratedEmails();
    pruneAppliedCompanies();
    pruneCleanupCompanies();
    pruneCompanyDomains();
    selectedCompanies = new Set();
  } else {
    mergeCompanies(companiesState, incoming);
    pruneGeneratedEmails();
    pruneAppliedCompanies();
    pruneCleanupCompanies();
    pruneCompanyDomains();
  }

  await persistCompanies();
  updateStats(companiesState);
  renderCompanies(companiesState);
  updateLastUpdated();
}

async function clearAllData() {
  const shouldClear = confirm("Delete all companies and names?");
  if (!shouldClear) {
    return;
  }
  companiesState = {};
  generatedEmailsState = {};
  appliedCompaniesState = {};
  cleanupCompaniesState = {};
  companyDomainsState = {};
  selectedCompanies = new Set();
  await persistCompanies();
  updateStats(companiesState);
  renderCompanies(companiesState);
  updateLastUpdated();
}

function selectVisible() {
  lastRendered.forEach(([company]) => {
    selectedCompanies.add(company);
  });
  updateStats(companiesState);
  renderCompanies(companiesState);
}

function clearSelection() {
  selectedCompanies = new Set();
  updateStats(companiesState);
  renderCompanies(companiesState);
}

function toggleAllNamesVisibility() {
  allNamesVisible = !allNamesVisible;
  renderCompanies(companiesState);
}

async function deleteSelected() {
  if (!selectedCompanies.size) {
    alert("No companies selected.");
    return;
  }
  const shouldDelete = confirm("Delete all selected companies?");
  if (!shouldDelete) {
    return;
  }

  selectedCompanies.forEach((company) => {
    delete companiesState[company];
    delete generatedEmailsState[company];
    delete appliedCompaniesState[company];
    delete cleanupCompaniesState[company];
    delete companyDomainsState[company];
  });
  selectedCompanies = new Set();
  await persistCompanies();
  updateStats(companiesState);
  renderCompanies(companiesState);
  updateLastUpdated();
}

async function initDashboard() {
  const data = await chrome.storage.local.get([
    "companies",
    "generatedEmails",
    "appliedCompanies",
    "appliedNames",
    "cleanupCompanies",
    "companyDomains",
    "themeMode",
    "dailyAppliedStats",
    "applicationLog"
  ]);
  const originalCompanies = data.companies || {};
  companiesState = sanitizeCompanies(originalCompanies);
  generatedEmailsState = data.generatedEmails || {};
  const migratedAppliedCompanies = {};
  if (data.appliedNames && typeof data.appliedNames === "object") {
    Object.keys(companiesState).forEach((company) => {
      const source = data.appliedNames[company];
      if (source && typeof source === "object") {
        const hasAnyApplied = Object.values(source).some((value) => value === true);
        if (hasAnyApplied) {
          migratedAppliedCompanies[company] = true;
        }
      }
    });
  }
  appliedCompaniesState = sanitizeAppliedCompanies(
    { ...migratedAppliedCompanies, ...(data.appliedCompanies || {}) },
    companiesState
  );
  cleanupCompaniesState = sanitizeCleanupCompanies(data.cleanupCompanies || {}, companiesState);
  companyDomainsState = sanitizeCompanyDomains(data.companyDomains || {}, companiesState);
  applicationLogState = sanitizeApplicationLog(data.applicationLog || []);
  themeMode = data.themeMode === "dark" ? "dark" : "light";
  dailyAppliedStats = data.dailyAppliedStats || { date: "", count: 0 };
  const dailyStatsChanged = ensureDailyAppliedStats();
  pruneGeneratedEmails();
  pruneAppliedCompanies();
  pruneCleanupCompanies();
  pruneCompanyDomains();

  if (
    JSON.stringify(originalCompanies) !== JSON.stringify(companiesState) ||
    JSON.stringify(data.appliedCompanies || {}) !== JSON.stringify(appliedCompaniesState) ||
    JSON.stringify(data.cleanupCompanies || {}) !== JSON.stringify(cleanupCompaniesState) ||
    JSON.stringify(data.companyDomains || {}) !== JSON.stringify(companyDomainsState) ||
    JSON.stringify(data.applicationLog || []) !== JSON.stringify(applicationLogState) ||
    dailyStatsChanged
  ) {
    await persistCompanies();
  }

  updateStats(companiesState);
  applyThemeMode();
  renderCompanies(companiesState);
  updateLastUpdated();

  document.getElementById("searchInput").addEventListener("input", () => {
    renderCompanies(companiesState);
  });

  document.getElementById("sortSelect").addEventListener("change", () => {
    renderCompanies(companiesState);
  });

  document.querySelectorAll("[data-domain-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextDomain = normalizeDomain(button.dataset.domainTab);
      if (!nextDomain || nextDomain === selectedDomain) {
        return;
      }
      selectedDomain = nextDomain;
      renderCompanies(companiesState);
    });
  });

  document.querySelectorAll("[data-applied-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.appliedTab;
      if (!nextTab || nextTab === appliedTab) {
        return;
      }
      appliedTab = nextTab;
      renderCompanies(companiesState);
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
    } catch {
      alert("Action failed. Please try again.");
    }
  });

  document.getElementById("dashboard").addEventListener("change", async (event) => {
    const domainSelect = event.target.closest("select[data-action='set-company-domain']");
    if (domainSelect) {
      const company = domainSelect.dataset.company;
      if (company) {
        setCompanyDomain(company, domainSelect.value);
        await persistCompanies();
        renderCompanies(companiesState);
        updateLastUpdated();
      }
      return;
    }

    const appliedCheck = event.target.closest("input[data-action='mark-company-applied']");
    if (appliedCheck) {
      const company = appliedCheck.dataset.company;
      if (company) {
        const wasApplied = isCompanyApplied(company);
        setCompanyApplied(company, appliedCheck.checked);
        if (appliedCheck.checked && !wasApplied) {
          ensureDailyAppliedStats();
          dailyAppliedStats.count += 1;
          appendApplicationLog(company);
        } else if (!appliedCheck.checked && wasApplied) {
          ensureDailyAppliedStats();
          dailyAppliedStats.count = Math.max(0, (dailyAppliedStats.count || 0) - 1);
          removeLatestApplicationLogForCompany(company);
        }
        await persistCompanies();
        updateStats(companiesState);
        renderCompanies(companiesState);
        updateLastUpdated();
      }
      return;
    }

    const cleanupCheck = event.target.closest("input[data-action='mark-company-cleanup']");
    if (cleanupCheck) {
      const company = cleanupCheck.dataset.company;
      if (company) {
        setCompanyCleanupDone(company, cleanupCheck.checked);
        await persistCompanies();
        renderCompanies(companiesState);
        updateLastUpdated();
      }
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
    updateStats(companiesState);
    renderCompanies(companiesState);
  });

  document.getElementById("copyAllBtn").addEventListener("click", async () => {
    try {
      await copyAllNames();
    } catch {
      alert("Could not copy all names.");
    }
  });

  document.getElementById("exportAllBtn").addEventListener("click", exportAllCsv);
  document.getElementById("clearAllBtn").addEventListener("click", clearAllData);

  document.getElementById("selectVisibleBtn").addEventListener("click", selectVisible);
  document.getElementById("clearSelectionBtn").addEventListener("click", clearSelection);
  document.getElementById("toggleAllNamesBtn").addEventListener("click", toggleAllNamesVisibility);
  document.getElementById("copySelectedBtn").addEventListener("click", async () => {
    try {
      await copySelectedNames();
    } catch {
      alert("Could not copy selected names.");
    }
  });
  document.getElementById("exportSelectedBtn").addEventListener("click", exportSelectedCsv);
  document.getElementById("deleteSelectedBtn").addEventListener("click", deleteSelected);

  document.getElementById("exportJsonBtn").addEventListener("click", exportJsonBackup);
  document.getElementById("importJsonInput").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    await importJsonBackup(file);
    event.target.value = "";
  });

  document.getElementById("emailGenBtn").addEventListener("click", () => {
    const url = chrome.runtime.getURL("email-generator.html");
    window.open(url);
  });

  document.getElementById("sendEmailBtn").addEventListener("click", () => {
    const url = chrome.runtime.getURL("send-email.html");
    window.open(url);
  });
  document.getElementById("emailCleanupBtn").addEventListener("click", () => {
    const url = chrome.runtime.getURL("email-cleanup.html");
    window.open(url);
  });
  document.getElementById("statsPageBtn").addEventListener("click", () => {
    const url = chrome.runtime.getURL("stats.html");
    window.open(url);
  });

  document.getElementById("homeBtn").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("themeToggleBtn").addEventListener("click", toggleThemeMode);
}

initDashboard();
