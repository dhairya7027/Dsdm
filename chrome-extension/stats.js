const DOMAIN_LABELS = {
  software: "Software",
  quant: "Quant",
  marketing: "Marketing",
  electrical: "Electrical"
};
let applicationLogState = [];
let companyDomainsState = {};

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function keyDaysAgo(daysAgo) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function groupByDate(log) {
  const byDate = {};
  log.forEach((entry) => {
    if (!byDate[entry.dateKey]) {
      byDate[entry.dateKey] = new Set();
    }
    byDate[entry.dateKey].add(entry.company);
  });
  return byDate;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = String(value);
  }
}

function renderTopStats(log, byDate) {
  const today = getTodayKey();
  const todayCount = byDate[today] ? byDate[today].size : 0;
  const sevenDayKeys = Array.from({ length: 7 }, (_, i) => keyDaysAgo(i));
  const sevenDayCount = sevenDayKeys.reduce((sum, key) => {
    const value = byDate[key] ? byDate[key].size : 0;
    return sum + value;
  }, 0);
  const uniqueCompanies = new Set(log.map((entry) => entry.company));

  setText("appliedTodayCount", todayCount);
  setText("applied7DayCount", sevenDayCount);
  setText("uniqueCompaniesCount", uniqueCompanies.size);
  setText("totalEventsCount", log.length);
}

function renderDailyBars(byDate) {
  const host = document.getElementById("dailyBars");
  host.innerHTML = "";
  const keys = Object.keys(byDate).sort((a, b) => a.localeCompare(b));
  if (!keys.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No daily application data yet.";
    host.appendChild(empty);
    return;
  }
  const values = keys.map((key) => (byDate[key] ? byDate[key].size : 0));
  const max = Math.max(1, ...values);

  keys.forEach((key, index) => {
    const value = values[index];
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = key.slice(5);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${(value / max) * 100}%`;
    track.appendChild(fill);

    const count = document.createElement("div");
    count.className = "bar-value";
    count.textContent = String(value);

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(count);
    host.appendChild(row);
  });
}

function renderDailyTable(byDate) {
  const body = document.getElementById("dailyTableBody");
  body.innerHTML = "";

  const keys = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  if (!keys.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="empty" colspan="3">No apply history yet.</td>`;
    body.appendChild(row);
    return;
  }

  keys.forEach((key) => {
    const companies = [...byDate[key]].sort((a, b) => a.localeCompare(b));
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${key}</td>
      <td>${companies.length}</td>
      <td>${companies.join(", ")}</td>
    `;
    body.appendChild(row);
  });
}

function renderRecentTable(log, companyDomains) {
  const body = document.getElementById("recentTableBody");
  body.innerHTML = "";

  if (!log.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="empty" colspan="3">No apply events yet.</td>`;
    body.appendChild(row);
    return;
  }

  const sorted = log
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  sorted.forEach((entry) => {
    const domainKey = String(companyDomains[entry.company] || "").toLowerCase();
    const domain = DOMAIN_LABELS[domainKey] || "-";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(entry.timestamp).toLocaleString()}</td>
      <td>${entry.company}</td>
      <td>${domain}</td>
    `;
    body.appendChild(row);
  });
}

function rerender() {
  const byDate = groupByDate(applicationLogState);
  renderTopStats(applicationLogState, byDate);
  renderDailyBars(byDate);
  renderDailyTable(byDate);
  renderRecentTable(applicationLogState, companyDomainsState);
}

async function init() {
  const data = await chrome.storage.local.get(["applicationLog", "companyDomains"]);
  applicationLogState = sanitizeApplicationLog(data.applicationLog || []);
  companyDomainsState = data.companyDomains || {};
  rerender();

  document.getElementById("backBtn").addEventListener("click", () => {
    const url = chrome.runtime.getURL("dashboard.html");
    window.location.href = url;
  });
}

init();
