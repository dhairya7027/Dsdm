let generatedEmailsState = {};
let generatedEmailsByFormatState = {};
let gmailComposeSettings = {};
let emailTemplatesState = [];
let emailTemplateSettings = {};
let currentEmails = [];

const FORMAT_LABELS = {
  "first.last": "first.last@company.com",
  firstlast: "firstlast@company.com",
  first: "first@company.com",
  last: "last@company.com",
  flast: "flast@company.com",
  lfirst: "lfirst@company.com",
  "last.firsti": "last.firsti@company.com",
  "first.lasti": "first.lasti@company.com",
  firstl: "firstl@company.com",
  lastf: "lastf@company.com"
};

function uniqueEmails(emails) {
  const seen = new Set();
  const result = [];
  emails.forEach((email) => {
    const cleaned = String(email).trim();
    if (!cleaned) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(cleaned);
  });
  return result;
}

function sanitizeTemplates(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const id = String(item.id || "").trim();
      const name = String(item.name || "").trim();
      const subject = String(item.subject || "");
      const body = String(item.body || "");
      if (!id || !name) {
        return null;
      }
      return { id, name, subject, body };
    })
    .filter(Boolean);
}

async function persistTemplates() {
  await chrome.storage.local.set({
    emailTemplates: emailTemplatesState,
    emailTemplateSettings
  });
}

function getTemplateById(templateId) {
  return emailTemplatesState.find((template) => template.id === templateId) || null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceCompanyPlaceholder(text, company) {
  return String(text).replace(/\{\{\s*company\s*\}\}/gi, company || "");
}

function makeCompanyDynamic(text, company) {
  if (!company) {
    return String(text);
  }
  const pattern = new RegExp(escapeRegex(company), "gi");
  return String(text).replace(pattern, "{{company}}");
}

function renderTemplateOptions() {
  const select = document.getElementById("templateSelect");
  const previous = emailTemplateSettings.selectedTemplateId || "";
  select.innerHTML = "";

  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Custom (no template)";
  select.appendChild(custom);

  emailTemplatesState
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      select.appendChild(option);
    });

  const hasPrevious = [...select.options].some((option) => option.value === previous);
  select.value = hasPrevious ? previous : "";
}

function applySelectedTemplate() {
  const company = getSelectedCompany();
  const templateId = document.getElementById("templateSelect").value;
  emailTemplateSettings.selectedTemplateId = templateId;
  const template = getTemplateById(templateId);
  if (!template) {
    return;
  }

  document.getElementById("templateNameInput").value = template.name;
  document.getElementById("subjectInput").value = replaceCompanyPlaceholder(template.subject, company);
  document.getElementById("bodyInput").value = replaceCompanyPlaceholder(template.body, company);
}

async function handleTemplateSelectChange() {
  applySelectedTemplate();
  await persistTemplates();
}

async function saveNewTemplate() {
  const company = getSelectedCompany();
  const name = document.getElementById("templateNameInput").value.trim();
  if (!name) {
    alert("Enter a template name.");
    return;
  }

  const subjectRaw = document.getElementById("subjectInput").value;
  const bodyRaw = document.getElementById("bodyInput").value;
  const template = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    subject: makeCompanyDynamic(subjectRaw, company),
    body: makeCompanyDynamic(bodyRaw, company)
  };

  emailTemplatesState.push(template);
  emailTemplateSettings.selectedTemplateId = template.id;
  await persistTemplates();
  renderTemplateOptions();
  applySelectedTemplate();
  document.getElementById("statusNote").textContent = `Saved template "${template.name}".`;
}

async function updateSelectedTemplate() {
  const selectedId = document.getElementById("templateSelect").value;
  if (!selectedId) {
    alert("Select a template to update.");
    return;
  }
  const template = getTemplateById(selectedId);
  if (!template) {
    alert("Template not found.");
    return;
  }

  const company = getSelectedCompany();
  const name = document.getElementById("templateNameInput").value.trim() || template.name;
  template.name = name;
  template.subject = makeCompanyDynamic(document.getElementById("subjectInput").value, company);
  template.body = makeCompanyDynamic(document.getElementById("bodyInput").value, company);

  emailTemplateSettings.selectedTemplateId = template.id;
  await persistTemplates();
  renderTemplateOptions();
  applySelectedTemplate();
  document.getElementById("statusNote").textContent = `Updated template "${template.name}".`;
}

async function deleteSelectedTemplate() {
  const selectedId = document.getElementById("templateSelect").value;
  if (!selectedId) {
    alert("Select a template to delete.");
    return;
  }
  const template = getTemplateById(selectedId);
  if (!template) {
    return;
  }
  const shouldDelete = confirm(`Delete template "${template.name}"?`);
  if (!shouldDelete) {
    return;
  }

  emailTemplatesState = emailTemplatesState.filter((item) => item.id !== selectedId);
  emailTemplateSettings.selectedTemplateId = "";
  await persistTemplates();
  renderTemplateOptions();
  document.getElementById("statusNote").textContent = "Template deleted.";
}

function getSelectedCompany() {
  return document.getElementById("companySelect").value;
}

function getSelectedFormatFilter() {
  return document.getElementById("formatFilterSelect").value;
}

function getCompaniesWithEmails() {
  const all = new Set();
  Object.keys(generatedEmailsState).forEach((company) => {
    const emails = generatedEmailsState[company];
    if (Array.isArray(emails) && emails.length > 0) {
      all.add(company);
    }
  });
  Object.keys(generatedEmailsByFormatState).forEach((company) => {
    const byFormat = generatedEmailsByFormatState[company] || {};
    const hasAny = Object.keys(byFormat).some((key) => {
      return Array.isArray(byFormat[key]) && byFormat[key].length > 0;
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

  const companies = getCompaniesWithEmails();

  if (!companies.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No generated emails found";
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

function renderFormatOptions(company) {
  const select = document.getElementById("formatFilterSelect");
  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All formats";
  select.appendChild(allOption);

  const byFormat = generatedEmailsByFormatState[company] || {};
  const formatKeys = Object.keys(byFormat)
    .filter((format) => Array.isArray(byFormat[format]) && byFormat[format].length > 0)
    .sort((a, b) => a.localeCompare(b));

  formatKeys.forEach((format) => {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = FORMAT_LABELS[format] || format;
    select.appendChild(option);
  });
}

function getEmailsForCompanyAndFormat(company, format) {
  if (!company) {
    return [];
  }

  const byFormat = generatedEmailsByFormatState[company] || {};

  if (format !== "all") {
    return uniqueEmails(byFormat[format] || []);
  }

  const fromAll = Array.isArray(generatedEmailsState[company])
    ? generatedEmailsState[company]
    : [];
  const fromFormats = Object.keys(byFormat).flatMap((key) => byFormat[key] || []);
  return uniqueEmails([...fromAll, ...fromFormats]);
}

function renderEmailsForSelection() {
  const company = getSelectedCompany();
  const format = getSelectedFormatFilter();
  const emails = getEmailsForCompanyAndFormat(company, format);

  currentEmails = emails;

  const list = document.getElementById("emailList");
  list.innerHTML = "";

  emails.forEach((email) => {
    const row = document.createElement("div");
    row.className = "email-row";
    row.textContent = email;
    list.appendChild(row);
  });

  document.getElementById("emailCount").textContent = String(emails.length);
  const label = format === "all" ? "all formats" : (FORMAT_LABELS[format] || format);
  document.getElementById("statusNote").textContent = emails.length
    ? `Loaded ${emails.length} email(s) for ${label}`
    : "No emails available for this selection.";
}

async function persistGmailSettings() {
  await chrome.storage.local.set({ gmailComposeSettings });
}

async function handleGmailAccountChange() {
  const account = document.getElementById("gmailAccountSelect").value;
  gmailComposeSettings.account = account;
  await persistGmailSettings();
}

function getGmailBaseUrl(accountValue) {
  if (accountValue === "current") {
    return "https://mail.google.com/mail/";
  }
  return `https://mail.google.com/mail/u/${accountValue}/`;
}

function buildGmailComposeUrl(recipients, recipientMode, subject, body, accountValue) {
  const params = new URLSearchParams();
  params.set("ui", "2");
  params.set("view", "cm");
  params.set(recipientMode, recipients.join(","));
  if (subject) {
    params.set("su", subject);
  }
  if (body) {
    params.set("body", body);
  }
  return `${getGmailBaseUrl(accountValue)}?${params.toString()}`;
}

function openGmailDrafts() {
  if (!currentEmails.length) {
    alert("No generated emails available for this selection.");
    return;
  }

  const recipientMode = document.getElementById("recipientMode").value;
  const company = getSelectedCompany();
  const subject = replaceCompanyPlaceholder(document.getElementById("subjectInput").value.trim(), company);
  const body = replaceCompanyPlaceholder(document.getElementById("bodyInput").value, company);
  const accountValue = document.getElementById("gmailAccountSelect").value;
  const batchInput = Number(document.getElementById("batchSize").value);
  const batchSize = Number.isFinite(batchInput) && batchInput > 0
    ? Math.min(Math.floor(batchInput), 100)
    : 100;

  const batches = [];
  for (let i = 0; i < currentEmails.length; i += batchSize) {
    batches.push(currentEmails.slice(i, i + batchSize));
  }

  batches.forEach((batch) => {
    const url = buildGmailComposeUrl(batch, recipientMode, subject, body, accountValue);
    window.open(url, "_blank");
  });

  document.getElementById("statusNote").textContent =
    `Opened ${batches.length} Gmail draft tab(s) with up to ${batchSize} recipient(s) each.`;
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
  anchor.download = "send-emails.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const data = await chrome.storage.local.get([
    "generatedEmails",
    "generatedEmailsByFormat",
    "gmailComposeSettings",
    "emailTemplates",
    "emailTemplateSettings"
  ]);
  generatedEmailsState = data.generatedEmails || {};
  generatedEmailsByFormatState = data.generatedEmailsByFormat || {};
  gmailComposeSettings = data.gmailComposeSettings || { account: "current" };
  emailTemplatesState = sanitizeTemplates(data.emailTemplates || []);
  emailTemplateSettings = data.emailTemplateSettings || { selectedTemplateId: "" };

  renderCompanyOptions();
  const company = getSelectedCompany();
  if (company) {
    renderFormatOptions(company);
    renderEmailsForSelection();
  }

  const gmailAccountSelect = document.getElementById("gmailAccountSelect");
  const savedAccount = gmailComposeSettings.account || "current";
  const hasSavedAccount = [...gmailAccountSelect.options].some(
    (option) => option.value === savedAccount
  );
  gmailAccountSelect.value = hasSavedAccount ? savedAccount : "current";
  renderTemplateOptions();
  applySelectedTemplate();

  document.getElementById("companySelect").addEventListener("change", () => {
    renderFormatOptions(getSelectedCompany());
    renderEmailsForSelection();
    applySelectedTemplate();
  });
  document.getElementById("formatFilterSelect").addEventListener("change", renderEmailsForSelection);
  document.getElementById("gmailAccountSelect").addEventListener("change", handleGmailAccountChange);
  document.getElementById("templateSelect").addEventListener("change", handleTemplateSelectChange);
  document.getElementById("saveTemplateBtn").addEventListener("click", saveNewTemplate);
  document.getElementById("updateTemplateBtn").addEventListener("click", updateSelectedTemplate);
  document.getElementById("deleteTemplateBtn").addEventListener("click", deleteSelectedTemplate);
  document.getElementById("openDraftsBtn").addEventListener("click", openGmailDrafts);
  document.getElementById("copyBtn").addEventListener("click", copyEmails);
  document.getElementById("exportBtn").addEventListener("click", exportEmails);
  document.getElementById("backBtn").addEventListener("click", () => {
    const url = chrome.runtime.getURL("dashboard.html");
    window.location.href = url;
  });
}

init();
