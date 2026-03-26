let extractedNames = [];
const LAST_COMPANY_KEY = "lastCompanyName";
const JUNK_TOKENS = new Set([
  "MBA",
  "HR",
  "PHR",
  "SPHR",
  "CHRO",
  "CIPD",
  "SHRM",
  "SHRMCP",
  "SHRMSCP",
  "MSHRM",
  "BBA",
  "PGDM",
  "MS",
  "MA",
  "BA",
  "BSC",
  "MSC"
]);

function sanitizeName(name) {
  let cleaned = String(name)
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  // Remove trailing credentials/role acronyms like MBA, HR, SHRM-CP.
  const words = cleaned.split(" ");
  while (words.length > 1) {
    const rawToken = words[words.length - 1];
    const token = rawToken.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (!token || !JUNK_TOKENS.has(token)) {
      break;
    }
    words.pop();
  }

  return words.join(" ").trim();
}

function hasDotOrEmoji(value) {
  const raw = String(value);
  return raw.includes(".") || /[\p{Extended_Pictographic}]/gu.test(raw);
}

function isValidPersonName(name) {
  if (!name) {
    return false;
  }
  if (name.includes(".")) {
    return false;
  }
  if (!/^[A-Za-z\s'-]+$/.test(name)) {
    return false;
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return false;
  }
  return parts.every((part) => /^[A-Za-z][A-Za-z'-]*$/.test(part));
}

function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  names.forEach((name) => {
    if (hasDotOrEmoji(name)) {
      return;
    }
    const cleaned = sanitizeName(name);
    const key = cleaned.toLowerCase();
    if (!isValidPersonName(cleaned) || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(cleaned);
  });
  return result;
}

function extractNameFromLine(line) {
  const patterns = [
    /^(.+?)\s*•\s*(?:1st|2nd|3rd)\b/i,
    /^(.+?)\s*[-|]\s*(?:1st|2nd|3rd)\b/i,
    /^(.+?)\s+(?:1st|2nd|3rd)\s+degree\b/i
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function looksLikeStandaloneName(line) {
  if (!line) {
    return false;
  }
  if (/\b(1st|2nd|3rd|connection|follower)\b/i.test(line)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z\s'-]+$/.test(line);
}

function extractCandidates(lines) {
  const names = [];

  lines.forEach((line, index) => {
    const inlineName = extractNameFromLine(line);
    if (inlineName) {
      names.push(inlineName);
      return;
    }

    // Some copied LinkedIn layouts split name and connection degree across two lines.
    if (/\b(1st|2nd|3rd)\b/i.test(line) && index > 0) {
      const previous = lines[index - 1];
      if (looksLikeStandaloneName(previous)) {
        names.push(previous);
      }
    }
  });

  return names;
}

function normalizeCompanyName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function getCompanyName() {
  const rawCompany = document.getElementById("companyName").value;
  return normalizeCompanyName(rawCompany);
}

async function saveLastCompanyName(name) {
  await chrome.storage.local.set({ [LAST_COMPANY_KEY]: name });
}

async function loadLastCompanyName() {
  const data = await chrome.storage.local.get(LAST_COMPANY_KEY);
  const lastCompany = data[LAST_COMPANY_KEY] || "";
  if (lastCompany) {
    document.getElementById("companyName").value = lastCompany;
  }
}

async function saveCompanyNames(company, names) {
  const data = await chrome.storage.local.get("companies");
  const companies = data.companies || {};
  const existingNames = companies[company] || [];
  const mergedNames = uniqueNames([...existingNames, ...names]);
  companies[company] = mergedNames;
  await chrome.storage.local.set({ companies });
}

function renderResults(names, company) {
  const results = document.getElementById("results");
  const downloadBtn = document.getElementById("downloadBtn");

  results.innerHTML = "";

  const heading = document.createElement("h3");
  heading.textContent = `Extracted: ${names.length} name(s) for ${company}`;

  const outputBox = document.createElement("div");
  outputBox.className = "output-box";
  outputBox.textContent = names.join(", ");

  results.appendChild(heading);
  results.appendChild(outputBox);

  downloadBtn.hidden = names.length === 0;
}

async function extractNames() {
  const company = getCompanyName();
  if (!company) {
    alert("Enter a company name first.");
    return;
  }
  await saveLastCompanyName(company);

  const text = document.getElementById("inputText").value;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let names = extractCandidates(lines).filter((rawName) => {
    return !hasDotOrEmoji(rawName);
  }).map((rawName) => sanitizeName(rawName)).filter((name) => name.length > 2);

  names = uniqueNames(names);
  extractedNames = names;

  if (names.length > 0) {
    await saveCompanyNames(company, names);
  }

  renderResults(names, company);
}

async function copyNames() {
  if (!extractedNames.length) {
    alert("Extract names first");
    return;
  }

  try {
    await navigator.clipboard.writeText(extractedNames.join(", "));
    alert("Names copied!");
  } catch {
    alert("Could not copy to clipboard");
  }
}

function downloadCSV() {
  if (!extractedNames.length) {
    alert("Extract names first!");
    return;
  }

  const csv =
    "Name\n" +
    extractedNames
      .map((name) => `"${name.replace(/"/g, '""')}"`)
      .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `linkedin-names-${extractedNames.length}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function openDashboard() {
  const url = chrome.runtime.getURL("dashboard.html");
  window.open(url);
}

document.getElementById("extractBtn").addEventListener("click", extractNames);
document.getElementById("copyBtn").addEventListener("click", copyNames);
document.getElementById("downloadBtn").addEventListener("click", downloadCSV);
document.getElementById("dashboardBtn").addEventListener("click", openDashboard);
document.getElementById("companyName").addEventListener("blur", async () => {
  const company = getCompanyName();
  if (company) {
    await saveLastCompanyName(company);
  }
});

loadLastCompanyName();
