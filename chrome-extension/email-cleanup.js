let generatedEmailsState = {};
let generatedEmailsByFormatState = {};
let extractedInvalidEmails = [];

function applyThemeMode(themeMode) {
  document.body.classList.toggle("dark-mode", themeMode === "dark");
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function uniqueEmails(emails) {
  const seen = new Set();
  const result = [];
  emails.forEach((email) => {
    const cleaned = String(email).trim();
    if (!cleaned) {
      return;
    }
    const key = normalizeEmail(cleaned);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(cleaned);
  });
  return result;
}

function getCompaniesWithStoredEmails() {
  const all = new Set();
  Object.keys(generatedEmailsState).forEach((company) => {
    const emails = generatedEmailsState[company];
    if (Array.isArray(emails) && emails.length > 0) {
      all.add(company);
    }
  });
  Object.keys(generatedEmailsByFormatState).forEach((company) => {
    const byFormat = generatedEmailsByFormatState[company] || {};
    const hasAny = Object.keys(byFormat).some((format) => {
      return Array.isArray(byFormat[format]) && byFormat[format].length > 0;
    });
    if (hasAny) {
      all.add(company);
    }
  });
  return [...all].sort((a, b) => a.localeCompare(b));
}

function renderCompanyOptions() {
  const select = document.getElementById("companySelect");
  select.innerHTML = "";
  const companies = getCompaniesWithStoredEmails();

  if (!companies.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No companies with stored emails";
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

function renderExtractedEmails(emails) {
  const list = document.getElementById("emailList");
  list.innerHTML = "";
  emails.forEach((email) => {
    const row = document.createElement("div");
    row.className = "email-row";
    row.textContent = email;
    list.appendChild(row);
  });
}

function updateCounts(invalid, removed, notFound, remaining) {
  document.getElementById("invalidCount").textContent = String(invalid);
  document.getElementById("removedCount").textContent = String(removed);
  document.getElementById("notFoundCount").textContent = String(notFound);
  document.getElementById("remainingCount").textContent = String(remaining);
}

function extractInvalidEmails(text) {
  const found = new Set();

  // Common Gmail bounce pattern:
  // "Your message wasn't delivered to user@domain.com because ..."
  const deliveredPattern = /wasn['’]?t delivered to\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  let match;
  while ((match = deliveredPattern.exec(text)) !== null) {
    found.add(normalizeEmail(match[1]));
  }

  // Fallback for variants containing "Address not found ... to user@domain.com"
  const addressNotFoundPattern = /address not found[\s\S]{0,240}?to\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  while ((match = addressNotFoundPattern.exec(text)) !== null) {
    found.add(normalizeEmail(match[1]));
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

function parseInvalidEmailsFromInput() {
  const text = document.getElementById("bounceInput").value;
  extractedInvalidEmails = extractInvalidEmails(text);
  renderExtractedEmails(extractedInvalidEmails);
  updateCounts(extractedInvalidEmails.length, 0, 0, 0);
  document.getElementById("statusNote").textContent = extractedInvalidEmails.length
    ? `Extracted ${extractedInvalidEmails.length} invalid email(s).`
    : "No invalid emails found in pasted text.";
}

async function removeInvalidForCompany() {
  const company = document.getElementById("companySelect").value;
  if (!company) {
    alert("Select a company first.");
    return;
  }

  if (!extractedInvalidEmails.length) {
    parseInvalidEmailsFromInput();
  }

  if (!extractedInvalidEmails.length) {
    alert("No invalid emails extracted.");
    return;
  }

  const invalidSet = new Set(extractedInvalidEmails.map((email) => normalizeEmail(email)));
  const existingCompanyEmails = uniqueEmails(generatedEmailsState[company] || []);
  const existingSet = new Set(existingCompanyEmails.map((email) => normalizeEmail(email)));

  const removedEmails = [];
  const remainingEmails = existingCompanyEmails.filter((email) => {
    const isInvalid = invalidSet.has(normalizeEmail(email));
    if (isInvalid) {
      removedEmails.push(email);
      return false;
    }
    return true;
  });
  generatedEmailsState[company] = remainingEmails;

  const byFormat = generatedEmailsByFormatState[company] || {};
  Object.keys(byFormat).forEach((format) => {
    const emails = uniqueEmails(byFormat[format] || []);
    byFormat[format] = emails.filter((email) => !invalidSet.has(normalizeEmail(email)));
  });
  generatedEmailsByFormatState[company] = byFormat;

  await chrome.storage.local.set({
    generatedEmails: generatedEmailsState,
    generatedEmailsByFormat: generatedEmailsByFormatState
  });

  const removedCount = removedEmails.length;
  const notFoundCount = extractedInvalidEmails.filter((email) => !existingSet.has(normalizeEmail(email))).length;
  updateCounts(extractedInvalidEmails.length, removedCount, notFoundCount, remainingEmails.length);
  document.getElementById("statusNote").textContent =
    `Removed ${removedCount} invalid email(s) from ${company}. ${notFoundCount} not found.`;
}

async function copyExtractedEmails() {
  if (!extractedInvalidEmails.length) {
    alert("No extracted emails to copy.");
    return;
  }
  await navigator.clipboard.writeText(extractedInvalidEmails.join(", "));
}

async function init() {
  const data = await chrome.storage.local.get([
    "generatedEmails",
    "generatedEmailsByFormat",
    "themeMode"
  ]);
  generatedEmailsState = data.generatedEmails || {};
  generatedEmailsByFormatState = data.generatedEmailsByFormat || {};
  applyThemeMode(data.themeMode === "dark" ? "dark" : "light");
  renderCompanyOptions();
  updateCounts(0, 0, 0, 0);

  document.getElementById("parseBtn").addEventListener("click", parseInvalidEmailsFromInput);
  document.getElementById("removeBtn").addEventListener("click", removeInvalidForCompany);
  document.getElementById("copyBtn").addEventListener("click", copyExtractedEmails);
  document.getElementById("backBtn").addEventListener("click", () => {
    const url = chrome.runtime.getURL("dashboard.html");
    window.location.href = url;
  });
}

init();
