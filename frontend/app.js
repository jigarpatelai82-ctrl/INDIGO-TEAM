// frontend/app.js — Core Client Application for INDIGO TEAM
const API = ""; // Same-origin relative path for Vercel and local development
let TOKEN = localStorage.getItem("td_token") || null;
let ME = JSON.parse(localStorage.getItem("td_me") || "null");

async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
  
  const res = await fetch(API + "/api" + path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {}

  if (!res.ok) {
    if (res.status === 401) {
      logout();
    }
    throw new Error((data && data.error) || "Request failed");
  }
  return data;
}

const MN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const DAYN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STANDARD_DAY_HOURS = 9;

function fmtMoney(n) {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}
function E(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function ym(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function DS(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Theme Management (Deep Slate & Cobalt, Light Indigo, Dark Obsidian)
function setTheme(name) {
  const valid = ["slate", "light", "dark"].includes(name) ? name : "slate";
  document.documentElement.setAttribute("data-theme", valid);
  localStorage.setItem("indigo_theme", valid);
  document.querySelectorAll(".theme-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.t === valid);
  });
}
function initTheme() {
  const current = localStorage.getItem("indigo_theme") || "slate";
  setTheme(current);
}

// Table sort & export utilities
const tableSortState = {};
function sortRows(tableKey, rows, defaultCol, defaultDir = 1) {
  const state = tableSortState[tableKey] || { col: defaultCol, dir: defaultDir };
  tableSortState[tableKey] = state;
  return [...rows].sort((a, b) => {
    let av = a[state.col], bv = b[state.col];
    if (typeof av === "string") {
      av = av.toLowerCase();
      bv = (bv || "").toString().toLowerCase();
    }
    if (av == null) av = "";
    if (bv == null) bv = "";
    if (av < bv) return -1 * state.dir;
    if (av > bv) return 1 * state.dir;
    return 0;
  });
}

function toggleSort(tableKey, col, rerenderFn) {
  const state = tableSortState[tableKey] || { col, dir: 1 };
  if (state.col === col) state.dir *= -1;
  else { state.col = col; state.dir = 1; }
  tableSortState[tableKey] = state;
  if (typeof rerenderFn === "function") rerenderFn();
}

function sortTh(tableKey, col, label) {
  const state = tableSortState[tableKey];
  const arrow = state && state.col === col ? (state.dir === 1 ? "▲" : "▼") : "";
  return `<th class="sortable" onclick='__sortClick("${tableKey}","${col}")'>${label}<span class="arrow">${arrow}</span></th>`;
}

const __tableRerender = {};
function __sortClick(tableKey, col) {
  toggleSort(tableKey, col, __tableRerender[tableKey]);
}

function exportCSV(filename, headers, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportPDF(title, headers, rows) {
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>${title}</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#1a1d24}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border:1px solid #ddd;padding:7px 10px;font-size:12px;text-align:left}
    th{background:#f4f5f8;font-weight:700}
    h2{margin:0}
    .meta{color:#888;font-size:11px;margin-top:4px}
  </style></head><body>
    <h2>${title}</h2>
    <div class="meta">Exported ${new Date().toLocaleString()}</div>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
}

// Global Search
let gsDebounce = null;
function onGlobalSearch(q) {
  clearTimeout(gsDebounce);
  const resultsEl = document.getElementById("globalSearchResults");
  if (!q || q.trim().length < 2) {
    resultsEl.classList.add("hidden");
    return;
  }
  gsDebounce = setTimeout(async () => {
    try {
      const r = await api("/search?q=" + encodeURIComponent(q.trim()));
      renderGlobalSearchResults(r);
    } catch (e) {}
  }, 250);
}

function renderGlobalSearchResults(r) {
  const resultsEl = document.getElementById("globalSearchResults");
  const groups = [
    { key: "projects", label: "Projects", icon: "📁", render: (p) => ({ main: `${p.project_no} · ${p.abbr}`, sub: p.name, action: `goToProject(${p.id})` }) },
    { key: "clients", label: "Clients", icon: "🏢", render: (c) => ({ main: c.name, sub: c.contact_person || c.email || "", action: `goToClient(${c.id})` }) },
    { key: "members", label: "Team", icon: "👤", render: (m) => ({ main: m.name, sub: "", action: `goToMember(${m.id})` }) },
    { key: "tasks", label: "Tasks", icon: "✅", render: (t) => ({ main: t.title, sub: `${t.member_name} · ${t.status}`, action: `goToTask(${t.id})` }) },
  ];
  const nonEmpty = groups.filter((g) => (r[g.key] || []).length);
  if (!nonEmpty.length) {
    resultsEl.innerHTML = `<div class="gs-empty">No matches found.</div>`;
    resultsEl.classList.remove("hidden");
    return;
  }
  resultsEl.innerHTML = nonEmpty.map((g) => `
    <div class="gs-group">
      <div class="gs-group-label">${g.label}</div>
      ${r[g.key].map((item) => {
        const d = g.render(item);
        return `<div class="gs-item" onclick="${d.action}"><span class="gs-icon">${g.icon}</span><span class="gs-main">${E(d.main)}</span><span class="gs-sub">${E(d.sub)}</span></div>`;
      }).join("")}
    </div>`).join("");
  resultsEl.classList.remove("hidden");
}

function closeGlobalSearch() {
  document.getElementById("globalSearchResults").classList.add("hidden");
  document.getElementById("globalSearchInput").value = "";
}

async function goToProject(id) {
  closeGlobalSearch();
  if (isAdmin()) {
    tab("projects");
    await loadProjects();
    renderProjects();
    openProject(id);
  }
}
async function goToClient(id) {
  closeGlobalSearch();
  if (isAdmin()) {
    tab("clients");
    await renderClients();
    openClient(id);
  }
}
function goToMember(id) {
  closeGlobalSearch();
  if (isAdmin()) tab("team");
}
function goToTask(id) {
  closeGlobalSearch();
  taskFilter = { status: "", member_id: "" };
  tab("tasks");
}

document.addEventListener("click", (e) => {
  const box = document.querySelector(".globalsearch");
  if (box && !box.contains(e.target)) {
    document.getElementById("globalSearchResults")?.classList.add("hidden");
  }
});

// Authentication
async function doLogin() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;
  const errEl = document.getElementById("loginErr");
  errEl.classList.add("hidden");

  try {
    const r = await api("/auth/login", { method: "POST", body: { username, password } });
    TOKEN = r.token;
    ME = r.user;
    localStorage.setItem("td_token", TOKEN);
    localStorage.setItem("td_me", JSON.stringify(ME));
    boot();
    if (ME.must_change_password) openChangePw(true);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

function logout() {
  TOKEN = null;
  ME = null;
  localStorage.removeItem("td_token");
  localStorage.removeItem("td_me");
  document.getElementById("appRoot").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
}

function openChangePw(forced) {
  document.getElementById("pwCurrent").value = "";
  document.getElementById("pwNew").value = "";
  document.getElementById("pwErr").classList.add("hidden");
  pwDlg.showModal();
}

async function savePassword() {
  const current_password = document.getElementById("pwCurrent").value;
  const new_password = document.getElementById("pwNew").value;
  const errEl = document.getElementById("pwErr");

  try {
    await api("/auth/change-password", { method: "POST", body: { current_password, new_password } });
    ME.must_change_password = false;
    localStorage.setItem("td_me", JSON.stringify(ME));
    pwDlg.close();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

// App State
let view = new Date();
view.setDate(1);
let members = [], projects = [], leaves = [], holidays = [], entries = [], days = [], clients = [];
let activeTab = "tasks";
const isAdmin = () => ME && ME.role === "admin";

async function boot() {
  initTheme();
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("hidden");
  const displayName = ME.member_name || ME.username;
  document.getElementById("whoami").textContent = displayName;
  const avatarEl = document.getElementById("userAvatar");
  if (avatarEl) avatarEl.textContent = (displayName || "U").slice(0, 1).toUpperCase();
  
  // Default landing screen after login is always "Projects & Tasks" for both admin and employee
  activeTab = "tasks";
  
  buildTabs();
  await loadMembers();
  await loadProjects();
  if (isAdmin()) await loadClients();
  renderCalToolbar();
  await loadMonth();
  tab("tasks");
  refreshNotifBadge();
  if (window.__notifInterval) clearInterval(window.__notifInterval);
  window.__notifInterval = setInterval(refreshNotifBadge, 5 * 60 * 1000);
}

async function refreshNotifBadge() {
  try {
    const list = await api("/notifications");
    const overdue = list.filter((t) => t.overdue).length;
    const acc = await api("/notifications/acceptance");
    const accCount = isAdmin()
      ? (acc.recentlyAccepted?.length || 0) + (acc.awaitingAcceptance?.length || 0)
      : (acc.needsAcceptance?.length || 0);
    const total = overdue + accCount;
    const badge = document.getElementById("notifCount");
    if (total > 0) {
      badge.textContent = total;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (e) {}
}

// My Day
async function renderMyDay() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  document.getElementById("mydayHeading").textContent = `${MN[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()} — ${DAYN[today.getDay()]}`;

  const notifs = await api("/notifications");
  const overdue = notifs.filter((n) => n.overdue);
  const acceptance = await api("/notifications/acceptance");

  let overdueHtml = overdue.length ? `
    <div class="taskcard" style="border-left:4px solid var(--danger);background:var(--danger-soft)">
      <b style="color:var(--danger-soft-text)">${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}${isAdmin() ? " across the team" : ""}</b>
      ${overdue.map((t) => `<div class="small">• ${E(t.title)} — ${E(t.member_name)} (was due ${t.due_date})</div>`).join("")}
      ${isAdmin() ? `<button style="margin-top:6px" onclick="sendOverdueEmails()">Send Email Alerts</button>` : ``}
    </div>` : `<p class="small">No overdue tasks. 🎉</p>`;

  let acceptanceHtml = "";
  if (isAdmin()) {
    if (acceptance.recentlyAccepted?.length) {
      acceptanceHtml += `<div class="taskcard" style="border-left:4px solid var(--success);background:var(--success-soft)">
        <b style="color:var(--success-soft-text)">${acceptance.recentlyAccepted.length} task acceptance${acceptance.recentlyAccepted.length > 1 ? "s" : ""} to review</b>
        ${acceptance.recentlyAccepted.map((t) => `<div class="small" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <span>✓ ${E(t.member_name)} accepted "${E(t.title)}"</span>
          <button onclick="ackAcceptance(${t.id})">Dismiss</button>
        </div>`).join("")}
      </div>`;
    }
    if (acceptance.awaitingAcceptance?.length) {
      acceptanceHtml += `<div class="taskcard" style="border-left:4px solid var(--warning);background:var(--warning-soft)">
        <b style="color:var(--warning-soft-text)">${acceptance.awaitingAcceptance.length} task${acceptance.awaitingAcceptance.length > 1 ? "s" : ""} not yet accepted (24h+)</b>
        ${acceptance.awaitingAcceptance.map((t) => `<div class="small">• ${E(t.title)} — ${E(t.member_name)}</div>`).join("")}
      </div>`;
    }
  } else if (acceptance.needsAcceptance?.length) {
    acceptanceHtml = `<div class="taskcard" style="border-left:4px solid var(--warning);background:var(--warning-soft)">
      <b style="color:var(--warning-soft-text)">${acceptance.needsAcceptance.length} task${acceptance.needsAcceptance.length > 1 ? "s" : ""} awaiting your acceptance</b>
      ${acceptance.needsAcceptance.map((t) => `<div class="small" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <span>${E(t.title)}${t.project_abbr ? " · " + E(t.project_abbr) : ""}</span>
        <button class="primary" onclick="acceptTask(${t.id})">✓ Accept</button>
      </div>`).join("")}
    </div>`;
  }
  document.getElementById("mydayOverdue").innerHTML = acceptanceHtml + overdueHtml;

  const logBtn = document.getElementById("mydayLogBtn");
  if (!isAdmin() && ME.member_id) {
    logBtn.textContent = "Log Today's Hours";
    logBtn.onclick = () => openTime(ME.member_id, todayStr);
    logBtn.classList.remove("hidden");
  } else {
    logBtn.classList.add("hidden");
  }

  const url = isAdmin() ? "/tasks?status=" : `/tasks?member_id=${ME.member_id}&status=`;
  const myTasks = (await api(url)).filter((t) => t.status !== "Completed");
  const dueToday = myTasks.filter((t) => t.due_date === todayStr);
  const upcoming = myTasks.filter((t) => t.due_date !== todayStr).slice(0, 10);

  function taskRow(t) {
    const isMine = !isAdmin() && String(ME.member_id) === String(t.assigned_to);
    return `<div class="taskcard prio${t.priority}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>${E(t.title)}</b>
        <span style="display:flex;gap:6px">${acceptanceBadge(t)}<span class="pill ${impClass[t.importance]}">${t.importance}</span></span>
      </div>
      <div class="meta">${isAdmin() ? `<span>👤 ${E(t.member_name)}</span>` : ""}${t.project_abbr ? `<span>📁 ${t.project_no ? E(t.project_no) + " · " : ""}${E(t.project_abbr)}</span>` : ""}<span>Priority ${t.priority}</span>${isAdmin() ? `<span>Est: ${t.estimated_hours || 0}h</span>` : ""}${t.due_date ? `<span>Due ${t.due_date}</span>` : ""}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${isMine && !t.accepted_at ? `<button class="primary" onclick="acceptTask(${t.id})">✓ Accept Task</button>` : ""}
        <select onchange="updateTaskStatus(${t.id}, this.value); renderMyDay()">${["Pending", "In Progress", "Completed", "On Hold"].map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
    </div>`;
  }

  document.getElementById("mydayTasks").innerHTML = `
    <h4>Due Today${dueToday.length ? ` (${dueToday.length})` : ""}</h4>
    ${dueToday.length ? dueToday.map(taskRow).join("") : `<p class="small">Nothing due today.</p>`}
    <h4 style="margin-top:16px">Other Open Tasks</h4>
    ${upcoming.length ? upcoming.map(taskRow).join("") : `<p class="small">Nothing else open.</p>`}
  `;
}

async function sendOverdueEmails() {
  const r = await api("/notifications/send-overdue-emails", { method: "POST" });
  alert(r.note || `Sent ${r.sent} alert email(s) to ${r.total_overdue_people} people.`);
}
async function ackAcceptance(taskId) {
  await api(`/tasks/${taskId}/ack-acceptance`, { method: "POST" });
  renderMyDay();
}

function buildTabs() {
  const tabs = isAdmin() ? [
    { id: "tasks", label: "✅ Projects & Tasks" },
    { id: "myday", label: "☀️ My Day" },
    { id: "cal", label: "🗓️ Whole Month" },
    { id: "projects", label: "📁 Projects & Budgets" },
    { id: "summary", label: "📊 Monthly Summary" },
    { id: "performance", label: "📈 Employee Performance" },
    { id: "team", label: "👥 Team Management" },
    { id: "clients", label: "🏢 Clients" },
    { id: "users", label: "🔑 Access / Logins" },
  ] : [
    { id: "tasks", label: "✅ Projects & Tasks" },
    { id: "myday", label: "☀️ My Day" },
    { id: "cal", label: "🗓️ My Timesheet" },
  ];
  const el = document.getElementById("mainTabs");
  el.innerHTML = tabs.map((t) => `<button id="btab-${t.id}" onclick="tab('${t.id}')">${t.label}</button>`).join("");
}

const TAB_META = {
  tasks: ["Projects & Tasks", "Assign work, track priority and importance, and monitor progress."],
  myday: ["My Day", "Your tasks and today's timesheet at a glance."],
  cal: ["Whole Month", "Team attendance, leave, and daily project hours for the selected month."],
  projects: ["Projects & Budgets", "Manage projects, team allocation, fees, and manhour budgets."],
  summary: ["Monthly Summary", "Hours used, remaining budget, and labour cost by project."],
  performance: ["Employee Performance", "Estimated vs. actual hours and efficiency by team member."],
  team: ["Team Management", "Add, rename, reorder, and set man-hour rates for your team."],
  clients: ["Clients", "Manage client accounts and the projects linked to each one."],
  users: ["Access & Login Management", "Manage user accounts, roles, and login permissions."],
};

const ADMIN_ONLY_TABS = ["projects", "summary", "performance", "team", "clients", "users"];

function tab(name) {
  if (!isAdmin() && ADMIN_ONLY_TABS.includes(name)) name = "tasks";
  activeTab = name;
  const meta = { ...TAB_META };
  if (!isAdmin()) {
    meta.cal = ["My Timesheet", "Your attendance, leave, and daily project hours for the selected month."];
    meta.tasks = ["Projects & Tasks", "Work assigned to you — track priority, importance, and progress."];
  }
  const ph = document.getElementById("pageHeadTitle"), phs = document.getElementById("pageHeadSubtitle");
  if (ph && meta[name]) { ph.textContent = meta[name][0]; phs.textContent = meta[name][1]; }
  
  ["myday", "cal", "projects", "summary", "tasks", "performance", "team", "clients", "users"].forEach((t) => {
    const sec = document.getElementById("tab-" + t);
    if (sec) sec.classList.toggle("hidden", t !== name);
    const btn = document.getElementById("btab-" + t);
    if (btn) btn.classList.toggle("active", t === name);
  });

  if (name === "myday") renderMyDay();
  if (name === "cal") renderCalendar();
  if (name === "projects") renderProjects();
  if (name === "summary") renderSummary();
  if (name === "tasks") renderTasks();
  if (name === "performance") renderPerformance();
  if (name === "team") renderTeam();
  if (name === "clients") renderClients();
  if (name === "users") renderUsers();
}

// Load data
async function loadMembers() { members = await api("/members"); }
async function loadProjects() { projects = await api("/projects"); }
async function loadClients() { clients = await api("/clients"); }
async function loadMonth() {
  const m = ym(view);
  const r = await api("/summary/month?month=" + m);
  leaves = r.leaves; holidays = r.holidays; entries = r.entries; days = r.days;
}

// Month navigation
function renderCalToolbar() {
  document.getElementById("calToolbar").innerHTML = `
    <button onclick="moveMonth(-1)">‹</button><div id="monthTitle" class="month" style="font-weight:700;font-size:14px;padding:0 8px;"></div><button onclick="moveMonth(1)">›</button><button onclick="todayBtn()">Today</button>
    <button class="primary" onclick="openLeave()">+ Leave</button>
    ${isAdmin() ? `<button onclick="backup()">Export Backup</button>` : ``}
  `;
}
async function moveMonth(delta) { view.setMonth(view.getMonth() + delta); await loadMonth(); renderCalendar(); }
async function todayBtn() { view = new Date(); view.setDate(1); await loadMonth(); renderCalendar(); }

// Calendar
function leaveClass(status) {
  return { "Leave": "leave", "Tentative": "tentative", "Half-Day": "half", "WFH": "wfh", "Official": "official" }[status] || "";
}
function leaveLabel(status) {
  return { "Leave": "LEAVE", "Tentative": "TENT.", "Half-Day": "HALF", "WFH": "WFH", "Official": "OFFICIAL", "Working-Day": "" }[status] || "";
}

function renderCalendar() {
  const y = view.getFullYear(), m = view.getMonth();
  document.getElementById("monthTitle").textContent = `${MN[m]} ${y}`;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const holMap = Object.fromEntries(holidays.map((h) => [h.date, h]));
  const leaveMap = {}; leaves.forEach((l) => leaveMap[l.member_id + "_" + l.date] = l);
  const entriesMap = {}; entries.forEach((e) => { const k = e.member_id + "_" + e.date; (entriesMap[k] = entriesMap[k] || []).push(e); });
  const dayMap = {}; days.forEach((d) => dayMap[d.member_id + "_" + d.date] = d);

  let head1 = `<tr><th class="name">Team Member</th>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = DS(y, m, d);
    const dow = new Date(y, m, d).getDay();
    const isHol = holMap[ds];
    head1 += `<th class="${isHol ? "holidayhead" : ""}" onclick="${isAdmin() ? `openHoliday('${ds}')` : ""}" title="${isHol ? E(isHol.name) : ""}">${d}<br><span style="font-weight:normal">${DAYN[dow]}</span></th>`;
  }
  head1 += `</tr>`;

  let body = "";
  const visibleMembers = isAdmin() ? members : members.filter((mm) => mm.id === ME.member_id);
  visibleMembers.forEach((mem) => {
    body += `<tr><td class="name">${E(mem.name)}</td>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = DS(y, m, d);
      const dow = new Date(y, m, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const hol = holMap[ds];
      const lv = leaveMap[mem.id + "_" + ds];
      const dayEntries = entriesMap[mem.id + "_" + ds] || [];
      const dayMeta = dayMap[mem.id + "_" + ds];
      const total = dayEntries.reduce((a, e) => a + e.hours, 0);

      let cls = "daycell", content = "";
      if (hol) {
        cls += " holiday"; content = `<b>HOLIDAY</b><br>${E(hol.name)}`;
      } else if (lv && lv.status && lv.status !== "Working-Day") {
        cls += " " + leaveClass(lv.status); content = `<b>${leaveLabel(lv.status)}</b>`;
      } else if (isWeekend && !(lv && lv.status === "Working-Day")) {
        cls += " weekend"; content = `WEEKEND`;
      } else if (dayEntries.length) {
        const st = total === STANDARD_DAY_HOURS ? "complete" : total < STANDARD_DAY_HOURS ? "under" : "over";
        cls += " " + st;
        content = dayEntries.map((e) => `<span class="entry">${E(e.abbr)} ${e.hours}h</span>`).join("") + `<span class="total">${total}/9</span>` + (dayMeta?.extra_remark ? `<span class="extra">!</span>` : "");
      }
      const cellTitle = dayEntries.length
        ? `${mem.name} — ${ds}\n` + dayEntries.map((e) => `${e.project_no ? e.project_no + " · " : ""}${e.abbr}: ${e.hours}h${e.narration ? " — " + e.narration : ""}`).join("\n") + (dayMeta?.extra_remark ? `\nAdditional-hours remark: ${dayMeta.extra_remark}` : "")
        : `${mem.name} — ${ds}`;
      body += `<td class="${cls}" onclick="openTime(${mem.id},'${ds}')" title="${E(cellTitle)}">${content}</td>`;
    }
    body += `</tr>`;
  });

  document.getElementById("calendar").innerHTML = head1 + body;
}

// Daily Timesheet
let currentDayRows = [];
async function openTime(memberId, dateStr) {
  if (!isAdmin() && ME.member_id !== memberId) return;
  document.getElementById("tm").value = memberId;
  document.getElementById("td").value = dateStr;
  const mem = members.find((x) => x.id === memberId);
  document.getElementById("timeTitle").textContent = `${mem?.name || "Member"} — ${dateStr}`;
  document.getElementById("timeErr").classList.add("hidden");
  const r = await api(`/timesheets/day?member_id=${memberId}&date=${dateStr}`);
  currentDayRows = r.entries.length
    ? r.entries.map((e) => ({ project_id: e.project_id, hours: e.hours, task_id: e.task_id || "", narration: e.narration || "" }))
    : [{ project_id: "", hours: "", task_id: "", narration: "" }];
  document.getElementById("extraRemark").value = r.extra_remark || "";
  renderTimeRows();
  timeDlg.showModal();
}

async function renderTimeRows() {
  let myTasks = [];
  try {
    myTasks = await api(`/tasks?member_id=${document.getElementById("tm").value}`);
  } catch (e) {}
  const projOpts = projects.map((p) => `<option value="${p.id}">${E(p.project_no)} · ${E(p.abbr)} — ${E(p.name)}</option>`).join("");
  const taskOpts = myTasks.map((t) => `<option value="${t.id}">${E(t.title)}</option>`).join("");

  document.getElementById("rows").innerHTML = currentDayRows.map((r, i) => `
    <div class="tsrow">
      <div class="tsrow-top">
        <select onchange="currentDayRows[${i}].project_id=this.value">
          <option value="">— select project (No. · Abbr — Name) —</option>${projOpts}
        </select>
        <input type="number" min="0" step=".25" placeholder="Hours" value="${r.hours}" oninput="currentDayRows[${i}].hours=this.value;updateTotal()">
        <button type="button" onclick="currentDayRows.splice(${i},1);renderTimeRows()" title="Remove">✕</button>
      </div>
      <div class="tsrow-sub">
        <select onchange="currentDayRows[${i}].task_id=this.value"><option value="">(no linked task)</option>${taskOpts}</select>
        <input type="text" placeholder="Narration — what was done in these hours" value="${E(r.narration || "")}" oninput="currentDayRows[${i}].narration=this.value">
      </div>
    </div>`).join("");

  currentDayRows.forEach((r, i) => {
    const rowEls = document.getElementById("rows").children[i];
    if (!rowEls) return;
    const selects = rowEls.querySelectorAll("select");
    if (selects[0]) selects[0].value = r.project_id || "";
    if (selects[1]) selects[1].value = r.task_id || "";
  });
  updateTotal();
}

function addRow() {
  currentDayRows.push({ project_id: "", hours: "", task_id: "", narration: "" });
  renderTimeRows();
}
function updateTotal() {
  const total = currentDayRows.reduce((a, r) => a + (+r.hours || 0), 0);
  const el = document.getElementById("dayTotal");
  el.textContent = `Total: ${total} / 9 hrs`;
  el.style.color = total === 9 ? "#16a34a" : total < 9 ? "#d97706" : "#dc2626";
  document.getElementById("extraArea").classList.toggle("hidden", total <= 9);
}

async function saveTime() {
  const member_id = +document.getElementById("tm").value, date = document.getElementById("td").value;
  const rows = currentDayRows.filter((r) => r.project_id && +r.hours > 0);
  const extra_remark = document.getElementById("extraRemark").value;
  const errEl = document.getElementById("timeErr");

  try {
    await api("/timesheets/day", { method: "PUT", body: { member_id, date, rows, extra_remark } });
    timeDlg.close();
    await loadMonth();
    renderCalendar();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

// Leave
function openLeave() {
  const memberOptions = isAdmin() ? members : members.filter((m) => m.id === ME.member_id);
  document.getElementById("lm").innerHTML = memberOptions.map((m) => `<option value="${m.id}">${E(m.name)}</option>`).join("");
  document.getElementById("lm").disabled = !isAdmin();
  if (!isAdmin() && ME.member_id) document.getElementById("lm").value = ME.member_id;
  document.getElementById("lf").value = "";
  document.getElementById("lt").value = "";
  document.getElementById("lr").value = "";
  document.getElementById("leaveErr").classList.add("hidden");
  leaveDlg.showModal();
}

async function saveLeave() {
  const body = {
    member_id: +document.getElementById("lm").value,
    from: document.getElementById("lf").value,
    to: document.getElementById("lt").value,
    status: document.getElementById("ls").value,
    remarks: document.getElementById("lr").value,
  };
  const errEl = document.getElementById("leaveErr");
  if (!body.from || !body.to) {
    errEl.textContent = "From and To dates required";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    await api("/leaves", { method: "POST", body });
    leaveDlg.close();
    await loadMonth();
    renderCalendar();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

// Holiday
function openHoliday(dateStr) {
  const existing = holidays.find((h) => h.date === dateStr);
  document.getElementById("holidayDate").value = dateStr;
  document.getElementById("holidayDateDisplay").value = dateStr;
  document.getElementById("holidayName").value = existing?.name || "";
  document.getElementById("holidayRemarks").value = existing?.remarks || "";
  document.getElementById("removeHolidayBtn").classList.toggle("hidden", !existing);
  holidayDlg.showModal();
}

async function saveHoliday() {
  const date = document.getElementById("holidayDate").value;
  const name = document.getElementById("holidayName").value.trim();
  const remarks = document.getElementById("holidayRemarks").value;
  if (!name) return;
  await api("/leaves/holidays", { method: "POST", body: { date, name, remarks } });
  holidayDlg.close();
  await loadMonth();
  renderCalendar();
}

async function removeHoliday() {
  const date = document.getElementById("holidayDate").value;
  await api("/leaves/holidays/" + date, { method: "DELETE" });
  holidayDlg.close();
  await loadMonth();
  renderCalendar();
}

// Projects & Budgets
__tableRerender.projects = renderProjects;
function renderProjects() {
  const sorted = sortRows("projects", projects, "project_no");
  const rows = sorted.map((p) => `
    <tr class="${p.status}" ondblclick="openProject(${p.id})">
      <td>${E(p.project_no)}</td><td>${E(p.abbr)}</td><td>${E(p.name)}</td>
      <td>${p.client_name ? E(p.client_name) : "—"}</td>
      <td>${fmtMoney(p.fee)}</td>
      <td>${p.members.map((m) => E(m.name)).join(", ") || "—"}</td>
      <td>${p.avg_rate ? fmtMoney(p.avg_rate) + "/hr" : "—"}</td>
      <td>${p.available_hours.toFixed(1)}${p.manual_hours > 0 ? " (manual)" : " (calc)"}</td>
      <td>${p.used_hours.toFixed(1)}</td>
      <td><b>${p.usage_pct.toFixed(0)}%</b></td>
      <td>${E(p.remarks || "")}</td>
      <td>${isAdmin() ? `<button onclick="openProject(${p.id})">Edit</button>` : ""}</td>
    </tr>`).join("");
  document.getElementById("projectTable").innerHTML = `
    <tr>${sortTh("projects","project_no","Project No.")}${sortTh("projects","abbr","Abbr.")}${sortTh("projects","name","Project")}${sortTh("projects","client_name","Client")}${sortTh("projects","fee","Fee")}<th>Selected Team</th>${sortTh("projects","avg_rate","Man-hour Rate")}${sortTh("projects","available_hours","Available Hrs")}${sortTh("projects","used_hours","Used Hrs")}${sortTh("projects","usage_pct","Usage %")}<th>Remarks</th><th></th></tr>${rows}`;
}

function exportProjects(fmt) {
  const headers = ["Project No.", "Abbr.", "Project", "Client", "Fee", "Team", "Man-hour Rate", "Available Hrs", "Used Hrs", "Usage %", "Remarks"];
  const rows = sortRows("projects", projects, "project_no").map((p) => [
    p.project_no, p.abbr, p.name, p.client_name || "", p.fee, p.members.map((m) => m.name).join("; "),
    p.avg_rate ? p.avg_rate.toFixed(0) : "", p.available_hours.toFixed(1), p.used_hours.toFixed(1),
    p.usage_pct.toFixed(0) + "%", p.remarks || ""
  ]);
  if (fmt === "csv") exportCSV("projects.csv", headers, rows);
  else exportPDF("Projects & Budgets", headers, rows);
}

function openProject(id) {
  const p = id ? projects.find((x) => x.id === id) : null;
  document.getElementById("pi").value = id || "";
  document.getElementById("pno").value = p?.project_no || "";
  document.getElementById("pabbr").value = p?.abbr || "";
  document.getElementById("pname").value = p?.name || "";
  document.getElementById("pfee").value = p?.fee || "";
  document.getElementById("pmanual").value = p?.manual_hours || "";
  document.getElementById("prem").value = p?.remarks || "";
  document.getElementById("projErr").classList.add("hidden");
  document.getElementById("pclient").innerHTML = `<option value="">— no client linked —</option>` + clients.map((c) => `<option value="${c.id}">${E(c.name)}</option>`).join("");
  document.getElementById("pclient").value = p?.client_id || "";
  const selected = new Set((p?.members || []).map((m) => m.id));
  document.getElementById("projectMembers").innerHTML = members.map((m) =>
    `<label><input type="checkbox" value="${m.id}" ${selected.has(m.id) ? "checked" : ""}> ${E(m.name)}</label>`).join("");
  projectDlg.showModal();
}

async function saveProject() {
  const id = document.getElementById("pi").value;
  const member_ids = [...document.querySelectorAll("#projectMembers input:checked")].map((x) => +x.value);
  const body = {
    project_no: document.getElementById("pno").value.trim(),
    abbr: document.getElementById("pabbr").value.trim(),
    name: document.getElementById("pname").value.trim(),
    fee: +document.getElementById("pfee").value || 0,
    manual_hours: +document.getElementById("pmanual").value || 0,
    remarks: document.getElementById("prem").value,
    client_id: document.getElementById("pclient").value || null,
    member_ids,
  };
  const errEl = document.getElementById("projErr");
  if (!body.project_no || !body.abbr || !body.name) {
    errEl.textContent = "Project Number, Abbreviation, and Name are required";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    if (id) await api("/projects/" + id, { method: "PUT", body });
    else await api("/projects", { method: "POST", body });
    projectDlg.close();
    await loadProjects();
    renderProjects();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

// Clients
__tableRerender.clients = renderClients;
async function renderClients() {
  await loadClients();
  const sorted = sortRows("clients", clients, "name");
  document.getElementById("clientTable").innerHTML = `
    <tr>${sortTh("clients","name","Name")}${sortTh("clients","contact_person","Contact Person")}${sortTh("clients","email","Email")}${sortTh("clients","phone","Phone")}<th>Linked Projects</th><th></th></tr>
    ${sorted.length ? sorted.map((c) => {
      const linkedCount = projects.filter((p) => p.client_id === c.id).length;
      return `<tr>
        <td><b>${E(c.name)}</b></td>
        <td>${E(c.contact_person || "—")}</td>
        <td>${E(c.email || "—")}</td>
        <td>${E(c.phone || "—")}</td>
        <td>${linkedCount} project${linkedCount === 1 ? "" : "s"}</td>
        <td><button onclick="openClient(${c.id})">Edit</button> <button class="danger" onclick="removeClient(${c.id})">Remove</button></td>
      </tr>`;
    }).join("") : `<tr><td colspan="6"><p class="small" style="padding:14px 0">No clients yet — click "+ Add Client" to add your first one.</p></td></tr>`}`;
}

function exportClients(fmt) {
  const headers = ["Name", "Contact Person", "Email", "Phone", "Linked Projects"];
  const rows = sortRows("clients", clients, "name").map((c) => [
    c.name, c.contact_person || "", c.email || "", c.phone || "", projects.filter((p) => p.client_id === c.id).length
  ]);
  if (fmt === "csv") exportCSV("clients.csv", headers, rows);
  else exportPDF("Clients", headers, rows);
}

function openClient(id) {
  const c = id ? clients.find((x) => x.id === id) : null;
  document.getElementById("ci").value = id || "";
  document.getElementById("cname").value = c?.name || "";
  document.getElementById("ccontact").value = c?.contact_person || "";
  document.getElementById("cphone").value = c?.phone || "";
  document.getElementById("cemail").value = c?.email || "";
  document.getElementById("caddress").value = c?.address || "";
  document.getElementById("cremarks").value = c?.remarks || "";
  document.getElementById("clientErr").classList.add("hidden");
  clientDlg.showModal();
}

async function saveClient() {
  const id = document.getElementById("ci").value;
  const body = {
    name: document.getElementById("cname").value.trim(),
    contact_person: document.getElementById("ccontact").value,
    phone: document.getElementById("cphone").value,
    email: document.getElementById("cemail").value,
    address: document.getElementById("caddress").value,
    remarks: document.getElementById("cremarks").value,
  };
  const errEl = document.getElementById("clientErr");
  if (!body.name) {
    errEl.textContent = "Client name is required";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    if (id) await api("/clients/" + id, { method: "PUT", body });
    else await api("/clients", { method: "POST", body });
    clientDlg.close();
    renderClients();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

async function removeClient(id) {
  if (!confirm("Remove this client? Projects already linked to them will keep their history but show no client.")) return;
  await api("/clients/" + id, { method: "DELETE" });
  renderClients();
}

function editRates() {
  document.getElementById("rateRows").innerHTML = members.map((m) => `
    <div class="form-group" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <label style="flex:1;margin:0">${E(m.name)}</label>
      <input type="number" min="0" step="1" style="width:130px" data-rate-id="${m.id}" value="${m.rate || ""}">
    </div>`).join("");
  rateDlg.showModal();
}

async function saveRates() {
  const inputs = [...document.querySelectorAll("[data-rate-id]")];
  for (const inp of inputs) {
    await api(`/members/${inp.dataset.rateId}/rate`, { method: "PUT", body: { rate: +inp.value || 0 } });
  }
  rateDlg.close();
  await loadMembers();
  await loadProjects();
  renderProjects();
}

// Monthly Summary
async function renderSummary() {
  const m = ym(view);
  window.__summaryCache = await api("/summary/projects?month=" + m);
  const data = window.__summaryCache;
  const totalMonthCost = data.reduce((a, p) => a + p.month_cost, 0);
  const overBudget = data.filter((p) => p.status === "red").length;
  document.getElementById("cards").innerHTML = `
    <div class="card"><div class="card-icon">📁</div><b>${data.length}</b>Active Projects</div>
    <div class="card"><div class="card-icon">💰</div><b>${fmtMoney(totalMonthCost)}</b>Est. Labour Cost — ${MN[view.getMonth()]} ${view.getFullYear()}</div>
    <div class="card"><div class="card-icon">⚠️</div><b>${overBudget}</b>Projects Above 75% Utilization</div>`;

  document.getElementById("chartMonthLabel").textContent = `${MN[view.getMonth()]} ${view.getFullYear()}`;
  document.getElementById("summaryChart").innerHTML = data.length ? `<div class="barchart">${
    data.map((p) => `<div class="barrow">
      <div class="barlabel" title="${E(p.name)}">${E(p.abbr)}</div>
      <div class="bartrack"><div class="barfill ${p.status}" style="width:${Math.min(100, p.usage_pct)}%"></div></div>
      <div class="barpct">${p.usage_pct.toFixed(0)}%</div>
    </div>`).join("")
  }</div>` : `<p class="small">No active projects to chart yet.</p>`;

  const sorted = sortRows("summary", data, "project_no");
  document.getElementById("summaryTable").innerHTML = `
    <tr>${sortTh("summary","project_no","Project No.")}${sortTh("summary","abbr","Abbr.")}${sortTh("summary","name","Project")}${sortTh("summary","month_hours","Month Hours")}${sortTh("summary","total_used","Total Used")}${sortTh("summary","available_hours","Available")}${sortTh("summary","remaining_hours","Remaining")}${sortTh("summary","usage_pct","Usage %")}${sortTh("summary","month_cost","Month Labour Cost")}</tr>
    ${sorted.map((p) => `<tr class="${p.status}">
      <td>${E(p.project_no)}</td><td>${E(p.abbr)}</td><td>${E(p.name)}</td>
      <td>${p.month_hours.toFixed(1)}</td><td>${p.total_used.toFixed(1)}</td>
      <td>${p.available_hours.toFixed(1)}</td><td>${p.remaining_hours.toFixed(1)}</td>
      <td><b>${p.usage_pct.toFixed(0)}%</b></td><td>${fmtMoney(p.month_cost)}</td>
    </tr>`).join("")}`;
}

function exportSummary(fmt) {
  const headers = ["Project No.", "Abbr.", "Project", "Month Hours", "Total Used", "Available", "Remaining", "Usage %", "Month Labour Cost"];
  const rows = sortRows("summary", window.__summaryCache || [], "project_no").map((p) => [
    p.project_no, p.abbr, p.name, p.month_hours.toFixed(1), p.total_used.toFixed(1), p.available_hours.toFixed(1),
    p.remaining_hours.toFixed(1), p.usage_pct.toFixed(0) + "%", p.month_cost.toFixed(0)
  ]);
  const label = `Monthly Summary — ${MN[view.getMonth()]} ${view.getFullYear()}`;
  if (fmt === "csv") exportCSV(`monthly-summary-${ym(view)}.csv`, headers, rows);
  else exportPDF(label, headers, rows);
}
__tableRerender.summary = renderSummary;

// Tasks
let taskFilter = { status: "", member_id: "" };
function renderTaskToolbar() {
  const memberOpts = isAdmin() ? `<option value="">All Team Members</option>` + members.map((m) => `<option value="${m.id}">${E(m.name)}</option>`).join("") : "";
  document.getElementById("taskToolbar").innerHTML = `
    ${isAdmin() ? `<button class="primary" onclick="openTask()">+ Assign Task</button>
    <select onchange="taskFilter.member_id=this.value;renderTasks()">${memberOpts}</select>` : ``}
    <select onchange="taskFilter.status=this.value;renderTasks()">
      <option value="">All Statuses</option><option>Pending</option><option>In Progress</option><option>Completed</option><option>On Hold</option>
    </select>`;
}

const impClass = { High: "impHigh", Medium: "impMedium", Low: "impLow" };
async function updateTaskStatus(id, status) {
  await api("/tasks/" + id, { method: "PUT", body: { status } });
  renderTasks();
}
async function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  await api("/tasks/" + id, { method: "DELETE" });
  renderTasks();
}

function openTask(id) {
  const t = id ? window.__taskCache?.find((x) => x.id === id) : null;
  document.getElementById("taskDlgTitle").textContent = id ? "Edit Task" : "Assign Task";
  document.getElementById("taskId").value = id || "";
  document.getElementById("tMember").innerHTML = members.map((m) => `<option value="${m.id}">${E(m.name)}</option>`).join("");
  document.getElementById("tProject").innerHTML = `<option value="">— none —</option>` + projects.map((p) => `<option value="${p.id}">${E(p.project_no)} · ${E(p.abbr)}</option>`).join("");
  document.getElementById("taskErr").classList.add("hidden");

  if (t) {
    document.getElementById("tTitle").value = t.title;
    document.getElementById("tDesc").value = t.description || "";
    document.getElementById("tMember").value = t.assigned_to;
    document.getElementById("tProject").value = t.project_id || "";
    document.getElementById("tPriority").value = t.priority;
    document.getElementById("tImportance").value = t.importance;
    document.getElementById("tEst").value = t.estimated_hours || "";
    document.getElementById("tDue").value = t.due_date || "";
  } else {
    document.getElementById("tTitle").value = "";
    document.getElementById("tDesc").value = "";
    document.getElementById("tPriority").value = "2";
    document.getElementById("tImportance").value = "Medium";
    document.getElementById("tEst").value = "";
    document.getElementById("tDue").value = "";
  }
  taskDlg.showModal();
}

async function saveTask() {
  const id = document.getElementById("taskId").value;
  const body = {
    title: document.getElementById("tTitle").value.trim(),
    description: document.getElementById("tDesc").value,
    assigned_to: +document.getElementById("tMember").value,
    project_id: document.getElementById("tProject").value || null,
    priority: +document.getElementById("tPriority").value,
    importance: document.getElementById("tImportance").value,
    estimated_hours: +document.getElementById("tEst").value || 0,
    due_date: document.getElementById("tDue").value || null,
  };
  const errEl = document.getElementById("taskErr");
  if (!body.title) {
    errEl.textContent = "Title required";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    if (id) await api("/tasks/" + id, { method: "PUT", body });
    else await api("/tasks", { method: "POST", body });
    taskDlg.close();
    renderTasks();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

async function renderTasks() {
  renderTaskToolbar();
  let url = "/tasks?";
  if (taskFilter.status) url += "status=" + encodeURIComponent(taskFilter.status) + "&";
  if (taskFilter.member_id) url += "member_id=" + taskFilter.member_id + "&";
  window.__taskCache = await api(url);
  const list = window.__taskCache;
  if (!list.length) {
    document.getElementById("taskList").innerHTML = `<p class="small">No tasks found.</p>`;
    return;
  }
  document.getElementById("taskList").innerHTML = list.map((t) => {
    const overdue = t.due_date && t.status !== "Completed" && new Date(t.due_date) < new Date(new Date().toDateString());
    const eff = t.efficiency_pct;
    const isMine = !isAdmin() && String(ME.member_id) === String(t.assigned_to);
    return `<div class="taskcard prio${t.priority}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>${E(t.title)}</b>
        <span style="display:flex;gap:6px">${acceptanceBadge(t)}<span class="pill ${impClass[t.importance]}">${t.importance}</span></span>
      </div>
      ${t.description ? `<div class="small" style="margin:4px 0">${E(t.description)}</div>` : ""}
      <div class="meta">
        <span>👤 ${E(t.member_name)}</span>
        ${t.project_abbr ? `<span>📁 ${t.project_no ? E(t.project_no) + " · " : ""}${E(t.project_abbr)}</span>` : ""}
        <span>Priority ${t.priority}</span>
        ${isAdmin() ? `<span>Est: ${t.estimated_hours || 0}h · Actual: ${t.actual_hours || 0}h${eff !== null ? ` · Efficiency: ${eff.toFixed(0)}%` : ""}</span>` : ""}
        ${t.due_date ? `<span style="${overdue ? "color:#dc2626;font-weight:bold" : ""}">Due ${t.due_date}${overdue ? " (overdue)" : ""}</span>` : ""}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${isMine && !t.accepted_at ? `<button class="primary" onclick="acceptTask(${t.id})">✓ Accept Task</button>` : ""}
        <select onchange="updateTaskStatus(${t.id}, this.value)">
          ${["Pending", "In Progress", "Completed", "On Hold"].map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        ${isAdmin() ? `<button onclick="openTask(${t.id})">Edit</button><button class="danger" onclick="deleteTask(${t.id})">Delete</button>` : ""}
      </div>
    </div>`;
  }).join("");
}

function acceptanceBadge(t) {
  if (t.accepted_at) return `<span class="badge badge-active" title="Accepted ${new Date(t.accepted_at).toLocaleString()}">✓ Accepted</span>`;
  return `<span class="badge badge-inactive" title="Employee hasn't accepted this task yet">Awaiting Acceptance</span>`;
}

async function acceptTask(id) {
  await api(`/tasks/${id}/accept`, { method: "POST" });
  if (activeTab === "tasks") renderTasks();
  if (activeTab === "myday") renderMyDay();
}

// Performance (admin)
async function renderPerformance() {
  const rows = await api("/tasks/reports/performance");
  document.getElementById("performanceTable").innerHTML = `
    <tr><th>Team Member</th><th>Total Tasks</th><th>Completed</th><th>Late</th><th>Est. Hrs (completed)</th><th>Actual Hrs (completed)</th><th>Efficiency %</th></tr>
    ${rows.map((r) => `<tr class="${r.efficiency_pct === null ? "" : r.efficiency_pct >= 100 ? "green" : r.efficiency_pct >= 75 ? "yellow" : "red"}">
      <td>${E(r.name)}</td><td>${r.total_tasks}</td><td>${r.completed_tasks}</td><td>${r.late_tasks}</td>
      <td>${r.total_estimated.toFixed(1)}</td><td>${r.total_actual.toFixed(1)}</td>
      <td>${r.efficiency_pct === null ? "—" : r.efficiency_pct.toFixed(0) + "%"}</td>
    </tr>`).join("")}`;
}

// Team Management (admin)
function renderTeam() {
  document.getElementById("teamTable").innerHTML = `
    <tr><th></th><th>Name</th><th>Man-hour Rate</th><th></th></tr>
    ${members.map((m, i) => `<tr draggable="true" data-id="${m.id}" ondragstart="dragStart(event,${m.id})" ondragover="event.preventDefault()" ondrop="dropOn(event,${m.id})">
      <td style="cursor:grab;padding-left:12px">☰</td>
      <td id="mname-${m.id}">${E(m.name)}</td>
      <td>${m.rate ? fmtMoney(m.rate) + "/hr" : "—"}</td>
      <td><button onclick="editMemberRate(${m.id})">Edit Rate</button> <button onclick="editMember(${m.id})">Edit Name</button> <button class="danger" onclick="removeMember(${m.id})">Remove</button></td>
    </tr>`).join("")}`;
}

function exportTeam(fmt) {
  const headers = ["Name", "Man-hour Rate"];
  const rows = members.map((m) => [m.name, m.rate ? m.rate.toFixed(0) : ""]);
  if (fmt === "csv") exportCSV("team.csv", headers, rows);
  else exportPDF("Team Management", headers, rows);
}

async function editMemberRate(id) {
  const m = members.find((x) => x.id === id);
  const val = prompt(`Man-hour rate for ${m.name} (₹ per hour):`, m.rate || "");
  if (val === null) return;
  const rate = +val;
  if (isNaN(rate) || rate < 0) {
    alert("Enter a valid non-negative number");
    return;
  }
  await api(`/members/${id}/rate`, { method: "PUT", body: { rate } });
  await loadMembers();
  renderTeam();
}

async function addMember() {
  const name = document.getElementById("newName").value.trim();
  if (!name) return;
  await api("/members", { method: "POST", body: { name } });
  document.getElementById("newName").value = "";
  await loadMembers();
  renderTeam();
}

async function editMember(id) {
  const m = members.find((x) => x.id === id);
  const name = prompt("Edit name (all historical data stays linked to this person):", m.name);
  if (!name || !name.trim()) return;
  await api("/members/" + id, { method: "PUT", body: { name: name.trim() } });
  await loadMembers();
  renderTeam();
  renderCalendar();
}

async function removeMember(id) {
  if (!confirm("Remove this team member from active lists? Historical records are kept.")) return;
  await api("/members/" + id, { method: "DELETE" });
  await loadMembers();
  renderTeam();
}

let dragId = null;
function dragStart(e, id) { dragId = id; }
async function dropOn(e, targetId) {
  e.preventDefault();
  if (dragId === null || dragId === targetId) return;
  const order = members.map((m) => m.id);
  const from = order.indexOf(dragId), to = order.indexOf(targetId);
  order.splice(from, 1);
  order.splice(to, 0, dragId);
  await api("/members/reorder/all", { method: "PUT", body: { order } });
  await loadMembers();
  renderTeam();
  renderCalendar();
}

// Access / Logins (admin)
__tableRerender.users = renderUsers;
async function renderUsers() {
  const all = await api("/auth/users");
  window.__userCache = all;

  const total = all.length,
    active = all.filter((u) => u.active).length,
    admins = all.filter((u) => u.role === "admin").length,
    disabled = total - active;

  document.getElementById("userStats").innerHTML = `
    <div class="statbox"><div class="statbox-top"><span class="l">Total Users</span></div><span class="n">${total}</span></div>
    <div class="statbox"><div class="statbox-top"><span class="l">Active</span></div><span class="n" style="color:var(--success);">${active}</span></div>
    <div class="statbox"><div class="statbox-top"><span class="l">Administrators</span></div><span class="n" style="color:var(--primary);">${admins}</span></div>
    <div class="statbox"><div class="statbox-top"><span class="l">Disabled</span></div><span class="n" style="color:var(--text-muted);">${disabled}</span></div>`;

  const q = (document.getElementById("userSearch")?.value || "").toLowerCase().trim();
  const filtered = q
    ? all.filter((u) => u.username.toLowerCase().includes(q) || (u.member_name || "").toLowerCase().includes(q))
    : all;
  const users = sortRows("users", filtered, "username");

  document.getElementById("userTable").innerHTML = `
    <tr>${sortTh("users","username","Username")}${sortTh("users","role","Role")}${sortTh("users","member_name","Linked Member")}${sortTh("users","active","Status")}<th></th></tr>
    ${users.length ? users.map((u) => `<tr>
      <td><b>👤 ${E(u.username)}</b>${u.email ? `<div class="small" style="color:var(--text-muted);font-size:11.5px">${E(u.email)}</div>` : ""}</td>
      <td><span class="badge ${u.role === "admin" ? "badge-admin" : "badge-employee"}">${u.role === "admin" ? "Administrator" : "Employee"}</span></td>
      <td>${u.member_name ? `<span style="font-weight:600">${E(u.member_name)}</span>` : `<span style="color:var(--text-light);font-style:italic">— None (Unlinked) —</span>`}</td>
      <td><span class="badge ${u.active ? "badge-active" : "badge-inactive"}"><span class="badge-dot"></span>${u.active ? "Active" : "Disabled"}</span></td>
      <td><div style="display:flex;gap:6px"><button class="btn-sm" onclick='openUserDlg(${JSON.stringify(u).replace(/'/g, "&#39;")})'>✏ Edit</button>
      ${u.active ? `<button class="danger btn-sm" onclick="disableUser(${u.id})">Disable</button>` : ""}</div></td>
    </tr>`).join("") : `<tr><td colspan="5"><p class="small" style="padding:14px 0">No users match "${E(q)}".</p></td></tr>`}`;
}

function exportUsers(fmt) {
  const headers = ["Username", "Role", "Linked Member", "Status"];
  const rows = sortRows("users", window.__userCache || [], "username").map((u) => [
    u.username, u.role, u.member_name || "", u.active ? "Active" : "Disabled"
  ]);
  if (fmt === "csv") exportCSV("access-logins.csv", headers, rows);
  else exportPDF("Access & Login Management", headers, rows);
}

function toggleUserMember() {
  // Member is always optional now for both roles
}

function openUserDlg(u) {
  document.getElementById("userId").value = u?.id || "";
  document.getElementById("uUsername").value = u?.username || "";
  document.getElementById("uUsername").disabled = !!u;
  document.getElementById("uPassword").value = "";
  document.getElementById("uEmail").value = u?.email || "";
  document.getElementById("uPwHint").textContent = u ? "(leave blank to keep current password)" : "";
  document.getElementById("uRole").value = u?.role || "employee";
  document.getElementById("uMember").innerHTML = `<option value="">— None (No linked team member) —</option>` + members.map((m) => `<option value="${m.id}">${E(m.name)}</option>`).join("");
  document.getElementById("uMember").value = u?.member_id ? String(u.member_id) : "";
  document.getElementById("uActive").checked = u ? !!u.active : true;
  document.getElementById("userErr").classList.add("hidden");
  userDlg.showModal();
}

async function saveUser() {
  const id = document.getElementById("userId").value;
  const role = document.getElementById("uRole").value;
  const memberVal = document.getElementById("uMember").value;
  const errEl = document.getElementById("userErr");
  const body = {
    username: document.getElementById("uUsername").value.trim(),
    password: document.getElementById("uPassword").value,
    role,
    member_id: memberVal ? Number(memberVal) : null,
    active: document.getElementById("uActive").checked,
    email: document.getElementById("uEmail").value.trim() || null,
  };
  try {
    if (id) await api("/auth/users/" + id, { method: "PUT", body });
    else {
      if (!body.password) {
        errEl.textContent = "Password required for new accounts";
        errEl.classList.remove("hidden");
        return;
      }
      await api("/auth/users", { method: "POST", body });
    }
    userDlg.close();
    renderUsers();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

async function disableUser(id) {
  if (!confirm("Disable this login?")) return;
  await api("/auth/users/" + id, { method: "DELETE" });
  renderUsers();
}

// Backup
async function backup() {
  const [membersAll, projectsAll, leavesAll, holidaysAll, timesheetsAll, tasksAll, usersAll] = await Promise.all([
    api("/members"),
    api("/projects"),
    api("/leaves"),
    api("/leaves/holidays/all"),
    api("/timesheets"),
    api("/tasks"),
    isAdmin() ? api("/auth/users") : Promise.resolve([]),
  ]);

  const blob = new Blob(
    [
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          members: membersAll,
          projects: projectsAll,
          leaves: leavesAll,
          holidays: holidaysAll,
          timesheets: timesheetsAll,
          tasks: tasksAll,
          users: usersAll,
        },
        null,
        2
      ),
    ],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `indigo-team-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

// Expose global handlers to window for HTML event attributes
Object.assign(window, {
  api, fmtMoney, E, ym, DS, setTheme, initTheme, sortRows, toggleSort, sortTh, __sortClick,
  exportCSV, exportPDF, onGlobalSearch, renderGlobalSearchResults, closeGlobalSearch,
  goToProject, goToClient, goToMember, goToTask, doLogin, logout,
  openChangePw, savePassword, boot, refreshNotifBadge, renderMyDay,
  sendOverdueEmails, ackAcceptance, buildTabs, tab,
  loadMembers, loadProjects, loadClients, loadMonth, renderCalToolbar,
  moveMonth, todayBtn, leaveClass, leaveLabel, renderCalendar,
  openTime, renderTimeRows, addRow, updateTotal, saveTime,
  openLeave, saveLeave, openHoliday, saveHoliday, removeHoliday,
  renderProjects, exportProjects, openProject, saveProject,
  renderClients, exportClients, openClient, saveClient, removeClient,
  editRates, saveRates, renderSummary, exportSummary,
  renderTaskToolbar, updateTaskStatus, deleteTask, openTask, saveTask,
  renderTasks, acceptanceBadge, acceptTask, renderPerformance,
  renderTeam, exportTeam, editMemberRate, addMember, editMember, removeMember,
  dragStart, dropOn, renderUsers, exportUsers, toggleUserMember,
  openUserDlg, saveUser, disableUser, backup
});

// Initialization
initTheme();
if (TOKEN && ME) {
  boot();
} else {
  document.getElementById("loginScreen").classList.remove("hidden");
}
