let companiesState = {};
let emailDomains = {};
let currentEmails = [];
let appliedCompaniesState = {};

function applyThemeMode(themeMode) {
  document.body.classList.toggle("dark-mode", themeMode === "dark");
}

function uniqueEmails(emails) {
  const seen = new Set();
  const result = [];
  emails.forEach((email) => {
    const cleaned = String(email).trim();
    if (!cleaned) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  });
  return result;
}

function normalizeName(name) {
  return String(name).trim();
}

function parseName(fullName) {
  const parts = normalizeName(fullName).split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  const f = first[0] || "";
  const l = last[0] || "";
  return { first, last, f, l };
}

function formatEmail(vars, format, domain, caseMode) {
  const base = caseMode === "lower" ? "lower" : "original";
  const first = base === "lower" ? vars.first.toLowerCase() : vars.first;
  const last = base === "lower" ? vars.last.toLowerCase() : vars.last;
  const f = base === "lower" ? vars.f.toLowerCase() : vars.f;
  const l = base === "lower" ? vars.l.toLowerCase() : vars.l;

  let local;
  if (format === "first.last") {
    local = `${first}.${last}`;
  } else if (format === "first_last") {
    local = `${first}_${last}`;
  } else if (format === "firstlast") {
    local = `${first}${last}`;
  } else if (format === "first") {
    local = `${first}`;
  } else if (format === "last") {
    local = `${last}`;
  } else if (format === "flast") {
    local = `${f}${last}`;
  } else if (format === "last.firsti") {
    local = `${last}.${f}`;
  } else if (format === "first.lasti") {
    local = `${first}.${l}`;
  } else if (format === "firstl") {
    local = `${first}${l}`;
  } else if (format === "lastf") {
    local = `${last}${f}`;
  } else if (format === "f.last") {
    local = `${f}.${last}`;
  } else if (format === "l.first") {
    local = `${l}.${first}`;
  } else if (format === "lfirst") {
    local = `${l}${first}`;
  } else {
    local = `${first}.${last}`;
  }

  const normalizedDomain = base === "lower" ? domain.toLowerCase() : domain;
  return `${local}@${normalizedDomain}`;
}

function updateCounts(generated, skipped) {
  document.getElementById("generatedCount").textContent = String(generated);
  document.getElementById("skippedCount").textContent = String(skipped);
}

function renderEmailList(emails) {
  const list = document.getElementById("emailList");
  list.innerHTML = "";
  if (!emails.length) {
    document.getElementById("outputNote").textContent = "No emails generated yet.";
    return;
  }
  document.getElementById("outputNote").textContent = `Showing ${emails.length} emails`;
  emails.forEach((email) => {
    const row = document.createElement("div");
    row.className = "email-row";
    row.textContent = email;
    list.appendChild(row);
  });
}

function loadCompanyOptions() {
  const select = document.getElementById("companySelect");
  select.innerHTML = "";
  const companies = Object.keys(companiesState)
    .filter((company) => appliedCompaniesState[company] !== true)
    .sort((a, b) => a.localeCompare(b));

  if (!companies.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No non-applied companies available";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  companies.forEach((company) => {
    const option = document.createElement("option");
    option.value = company;
    option.textContent = company;
    select.appendChild(option);
  });
}

function getSelectedCompany() {
  return document.getElementById("companySelect").value;
}

function setDomainForCompany(company) {
  document.getElementById("domainInput").value = emailDomains[company] || "";
}

function handleCompanyChange() {
  const company = getSelectedCompany();
  if (company) {
    setDomainForCompany(company);
  }
}

async function handleDomainChange() {
  const company = getSelectedCompany();
  const domain = document.getElementById("domainInput").value.trim();
  if (!company) {
    return;
  }
  emailDomains[company] = domain;
  await chrome.storage.local.set({ emailDomainsByCompany: emailDomains });
}

async function generateEmails() {
  const company = getSelectedCompany();
  const domain = document.getElementById("domainInput").value.trim();
  const format = document.getElementById("formatSelect").value;
  const caseMode = document.getElementById("caseSelect").value;

  if (!company) {
    alert("Select a company first.");
    return;
  }
  if (!domain) {
    alert("Enter a domain (example: company.com).");
    return;
  }

  const names = companiesState[company] || [];
  const emails = [];
  let skipped = 0;
  names.forEach((name) => {
    const vars = parseName(name);
    if (!vars) {
      skipped += 1;
      return;
    }
    emails.push(formatEmail(vars, format, domain, caseMode));
  });

  currentEmails = uniqueEmails(emails);
  updateCounts(currentEmails.length, skipped);
  renderEmailList(currentEmails);
  await SharedApi.saveCompanyEmails(company, currentEmails, format);
}

async function copyEmails() {
  if (!currentEmails.length) {
    alert("No emails to copy.");
    return;
  }
  await navigator.clipboard.writeText(currentEmails.join(", "));
}

function exportEmails() {
  if (!currentEmails.length) {
    alert("No emails to export.");
    return;
  }
  const rows = ["Email"];
  currentEmails.forEach((email) => rows.push(`"${email.replace(/"/g, '""')}"`));
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "generated-emails.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function applySnapshot(snapshot) {
  const companies = {};
  const applied = {};
  (snapshot.companies || []).forEach((item) => {
    const company = String(item.company || "").trim();
    if (!company) {
      return;
    }
    companies[company] = Array.isArray(item.names) ? item.names : [];
    if (item.applied === true) {
      applied[company] = true;
    }
  });
  companiesState = companies;
  appliedCompaniesState = applied;
}

async function init() {
  const data = await chrome.storage.local.get(["themeMode", "emailDomainsByCompany"]);
  applyThemeMode(data.themeMode === "dark" ? "dark" : "light");
  emailDomains = data.emailDomainsByCompany || {};
  await SharedApi.ensureSignedIn();
  const snapshot = await SharedApi.getSnapshot();
  applySnapshot(snapshot);

  loadCompanyOptions();
  const company = getSelectedCompany();
  if (company) {
    setDomainForCompany(company);
  }

  document.getElementById("companySelect").addEventListener("change", handleCompanyChange);
  document.getElementById("domainInput").addEventListener("blur", () => handleDomainChange().catch(() => {}));
  document.getElementById("domainInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleDomainChange().catch(() => {});
    }
  });
  document.getElementById("generateBtn").addEventListener("click", () => generateEmails().catch((e) => alert(e.message)));
  document.getElementById("copyBtn").addEventListener("click", () => copyEmails().catch(() => alert("Could not copy emails.")));
  document.getElementById("exportBtn").addEventListener("click", exportEmails);
  document.getElementById("openSendEmailBtn").addEventListener("click", () => {
    window.open(chrome.runtime.getURL("send-email.html"));
  });
  document.getElementById("backBtn").addEventListener("click", () => {
    window.location.href = chrome.runtime.getURL("dashboard.html");
  });
}

init().catch((error) => alert(`Init failed: ${error.message}`));
