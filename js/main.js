import { initAuth, onAuthReady, getCurrentUser, getDb } from "./auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
let unsubscribeCloudTasks = null;
let cloudSyncTimer = null;
let syncingFromCloud = false;
let appWired = false;
let unsubscribeCommunity = null;

const LS = {
  load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const priorityWeight = { high: 3, medium: 2, low: 1 };
const legacyPriority = (task) => {
  if (task.priority) return task.priority;
  if (Number(task.imp) && Number(task.urg)) return "high";
  if (Number(task.imp) || Number(task.urg)) return "medium";
  return "low";
};

const state = {
  tasks: LS.load("tasks_v1", []).map(normalizeTask),
  sections: LS.load("sections_v1", ["Inbox", "Work", "College", "Diet"]),
  settings: LS.load("settings_v1", { theme: "dark", waterInterval: 60 }),
  filters: { section: "All", query: "", status: "open", priority: "all", date: null, sort: "smart" },
  calendar: { y: new Date().getFullYear(), m: new Date().getMonth() },
  timers: { notify: {}, water: null }
};

function normalizeTask(task) {
  return {
    id: task.id || uid(),
    title: task.title || "Untitled task",
    due: task.due || null,
    section: task.section || "Inbox",
    category: task.category || "General",
    priority: legacyPriority(task),
    estimate: Number(task.estimate || task.estimateMins || 30),
    energy: task.energy || "normal",
    notify: Number(task.notify || 0),
    notifySent: Boolean(task.notifySent || false),
    preAlertSent: Boolean(task.preAlertSent || false),
    dueSent: Boolean(task.dueSent || false),
    repeat: task.repeat || "none",
    repeatEvery: Number(task.repeatEvery || 0),
    imp: Number(task.imp ?? (legacyPriority(task) === "low" ? 0 : 1)),
    urg: Number(task.urg ?? (legacyPriority(task) === "high" ? 1 : 0)),
    notes: task.notes || "",
    completed: Boolean(task.completed),
    completedAt: task.completedAt || null,
    createdAt: task.createdAt || new Date().toISOString()
  };
}

function saveTasks() {
  LS.save("tasks_v1", state.tasks);
  queueCloudTaskSync();
}

function saveSections() {
  LS.save("sections_v1", state.sections);
}

function saveSettings() {
  LS.save("settings_v1", state.settings);
}

function cloudTasksPath() {
  const user = getCurrentUser();
  if (!user || !getDb()) return null;
  return collection(getDb(), "users", user.uid, "tasks");
}

function queueCloudTaskSync() {
  if (syncingFromCloud || !getCurrentUser() || !getDb()) return;
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(syncAllTasksToCloud, 350);
}

async function syncAllTasksToCloud() {
  const user = getCurrentUser();
  const db = getDb();
  if (!user || !db) return;
  const batch = writeBatch(db);
  state.tasks.forEach((task) => {
    // Compute pre-alert time (in ISO) and include dueTime for clarity
    const dueTime = task.due || null;
    const preAlertTime = (dueTime && Number.isFinite(Number(task.notify)))
      ? new Date(new Date(dueTime).getTime() - Number(task.notify) * 60000).toISOString()
      : null;
    // When saving/updating, reset the sent flags so updated tasks can re-trigger
    const preAlertSent = task.preAlertSent === true ? false : false;
    const dueSent = task.dueSent === true ? false : false;
    batch.set(doc(db, "users", user.uid, "tasks", task.id), {
      title: task.title,
      description: task.notes || "",
      dueTime,
      preAlertTime,
      notify: Number(task.notify || 0),
      userEmail: user.email,
      preAlertSent,
      dueSent,
      completed: task.completed || false,
      priority: task.priority || 'medium',
      ownerId: user.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
  await batch.commit();
}

async function deleteCloudTask(id) {
  const user = getCurrentUser();
  const db = getDb();
  if (!user || !db) return;
  await deleteDoc(doc(db, "users", user.uid, "tasks", id));
}

function startCloudTaskListener() {
  const ref = cloudTasksPath();
  if (!ref) return;
  if (unsubscribeCloudTasks) unsubscribeCloudTasks();
  unsubscribeCloudTasks = onSnapshot(ref, (snapshot) => {
    if (snapshot.empty && state.tasks.length) {
      queueCloudTaskSync();
      return;
    }
    syncingFromCloud = true;
    state.tasks = snapshot.docs.map((item) => normalizeTask({ id: item.id, ...item.data() }));
    LS.save("tasks_v1", state.tasks);
    syncingFromCloud = false;
    renderAll();
    scheduleAllTaskNotifications();
  });
}

function startCommunityListener() {
  const db = getDb();
  if (!db) return;
  if (unsubscribeCommunity) unsubscribeCommunity();
  const q = query(collection(db, "community", "global", "messages"), orderBy("createdAt", "desc"), limit(50));
  unsubscribeCommunity = onSnapshot(q, (snapshot) => {
    const user = getCurrentUser();
    const messages = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).reverse();
    $("communityMessages").innerHTML = messages.map((message) => `
      <article class="message ${message.uid === user?.uid ? "mine" : ""}">
        <strong>${escapeHTML(message.displayName || message.email || "Verified user")}</strong>
        <p>${escapeHTML(message.text || "")}</p>
      </article>
    `).join("") || `<div class="empty-state">No messages yet. Start a focused discussion.</div>`;
    $("communityMessages").scrollTop = $("communityMessages").scrollHeight;
  });
}

async function sendCommunityMessage() {
  const user = getCurrentUser();
  const db = getDb();
  const text = $("communityInput").value.trim();
  if (!user || !db || !text) return;
  await addDoc(collection(db, "community", "global", "messages"), {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email,
    text,
    createdAt: serverTimestamp()
  });
  $("communityInput").value = "";
}

async function startScreenSharePreview() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert("Screen sharing is not supported in this browser.");
    return;
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const preview = $("screenPreview");
  preview.srcObject = stream;
  preview.classList.remove("hidden");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function localInputValue(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isToday(value) {
  return value && dateKey(value) === dateKey(new Date());
}

function dueLabel(task) {
  if (!task.due) return { text: "No due date", cls: "" };
  const due = new Date(task.due);
  const diff = due.getTime() - Date.now();
  if (diff < 0) return { text: `Overdue ${due.toLocaleDateString()}`, cls: "due-overdue" };
  if (diff < 60 * 60 * 1000) return { text: `${Math.max(1, Math.round(diff / 60000))}m left`, cls: "due-soon" };
  if (isToday(task.due)) return { text: `Today ${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, cls: "due-soon" };
  return { text: due.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), cls: "" };
}

function smartScore(task) {
  const due = task.due ? new Date(task.due).getTime() : Number.POSITIVE_INFINITY;
  const hours = Number.isFinite(due) ? (due - Date.now()) / 3600000 : 9999;
  const urgencyBoost = task.urg ? 40 : 0;
  const importanceBoost = task.imp ? 30 : 0;
  const priorityBoost = priorityWeight[task.priority] * 18;
  const dueBoost = hours < 0 ? 80 : Math.max(0, 48 - hours);
  return priorityBoost + urgencyBoost + importanceBoost + dueBoost;
}

function applyTheme() {
  document.documentElement.classList.toggle("light", state.settings.theme === "light");
}

async function ensurePermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission !== "denied") {
    try {
      return (await Notification.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return false;
}

function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Browser notification failures should not break task flow.
  }
}

function scheduleAllTaskNotifications() {
  Object.values(state.timers.notify).forEach(clearTimeout);
  state.timers.notify = {};
  const now = Date.now();

  state.tasks.filter((task) => !task.completed && task.due).forEach((task) => {
    const due = new Date(task.due).getTime();
    const minutes = Number(task.notify || 0);
    const alertAt = due - minutes * 60000;
    const delay = alertAt - now;
    if (minutes > 0 && delay > 0) {
      state.timers.notify[task.id] = setTimeout(() => {
        notify(`Task due soon: ${task.title}`, `${minutes} min before ${new Date(task.due).toLocaleString()}`);
      }, delay);
    }
  });

  updateNextUp();
}

function renderSections() {
  const list = $("sections");
  list.innerHTML = "";
  $("sectionCount").textContent = String(state.sections.length);

  state.sections.forEach((name, index) => {
    const row = document.createElement("div");
    row.className = "section-item";
    const count = state.tasks.filter((task) => task.section === name && !task.completed).length;
    row.innerHTML = `
      <div><strong>${escapeHTML(name)}</strong><span class="count-pill">${count}</span></div>
      <div class="section-actions">
        ${index > 0 ? `<button class="icon-btn ghost" data-act="rename" data-i="${index}" title="Rename">Edit</button>` : ""}
        ${index > 0 ? `<button class="icon-btn ghost" data-act="del" data-i="${index}" title="Delete">Del</button>` : ""}
      </div>
    `;
    list.appendChild(row);
  });

  const selectedSection = $("section").value || "Inbox";
  const filterSection = $("filterSection").value || "All";
  $("section").innerHTML = state.sections.map((name) => `<option>${escapeHTML(name)}</option>`).join("");
  $("filterSection").innerHTML = ["All", ...state.sections].map((name) => `<option>${escapeHTML(name)}</option>`).join("");
  $("section").value = state.sections.includes(selectedSection) ? selectedSection : "Inbox";
  $("filterSection").value = ["All", ...state.sections].includes(filterSection) ? filterSection : "All";
}

function filteredTasks() {
  const query = state.filters.query.trim().toLowerCase();
  const today = dateKey(new Date());
  const now = Date.now();

  return state.tasks
    .filter((task) => state.filters.section === "All" || task.section === state.filters.section)
    .filter((task) => state.filters.priority === "all" || task.priority === state.filters.priority)
    .filter((task) => {
      if (!query) return true;
      return [task.title, task.notes, task.section, task.category].join(" ").toLowerCase().includes(query);
    })
    .filter((task) => {
      if (state.filters.date) return task.due && dateKey(task.due) === state.filters.date;
      if (state.filters.status === "all") return true;
      if (state.filters.status === "done") return task.completed;
      if (state.filters.status === "today") return !task.completed && task.due && dateKey(task.due) === today;
      if (state.filters.status === "overdue") return !task.completed && task.due && new Date(task.due).getTime() < now;
      return !task.completed;
    })
    .sort((a, b) => {
      if (state.filters.sort === "due") return new Date(a.due || "2999-01-01") - new Date(b.due || "2999-01-01");
      if (state.filters.sort === "priority") return priorityWeight[b.priority] - priorityWeight[a.priority];
      if (state.filters.sort === "created") return new Date(b.createdAt) - new Date(a.createdAt);
      return Number(a.completed) - Number(b.completed) || smartScore(b) - smartScore(a);
    });
}

function taskTemplate(task, compact = false) {
  const due = dueLabel(task);
  const checked = task.completed ? "checked" : "";
  const notes = task.notes && !compact ? `<p class="task-notes">${escapeHTML(task.notes)}</p>` : "";
  return `
    ${compact ? "" : `<input type="checkbox" data-act="toggle" data-id="${task.id}" ${checked} />`}
    <div>
      <p class="task-title">${escapeHTML(task.title)}</p>
      ${notes}
      <div class="task-meta">
        <span class="priority-pill priority-${task.priority}">${task.priority}</span>
        <span class="chip">${escapeHTML(task.section)}</span>
        <span class="chip">${escapeHTML(task.category)}</span>
        <span class="chip">${task.estimate || 0}m</span>
        <span class="chip">${escapeHTML(task.energy)}</span>
        <span class="chip ${due.cls}">${due.text}</span>
      </div>
    </div>
    ${compact ? "" : `
      <div class="task-actions">
        <button class="btn ghost" data-act="edit" data-id="${task.id}">Edit</button>
        <button class="btn ghost" data-act="del" data-id="${task.id}">Delete</button>
      </div>
    `}
  `;
}

function renderTasks() {
  const list = $("taskList");
  const tasks = filteredTasks();
  list.innerHTML = "";
  $("clearDateBtn").classList.toggle("hidden", !state.filters.date);

  if (!tasks.length) {
    list.innerHTML = `<div class="empty-state">Nothing matches this view. Add a task or loosen the filters.</div>`;
  }

  const grouped = state.filters.status === "all" || state.filters.status === "open";
  const groups = grouped ? [
    ["Going on", tasks.filter((task) => !task.completed && task.due && isToday(task.due))],
    ["Pending", tasks.filter((task) => !task.completed && (!task.due || !isToday(task.due)))],
    ["Completed", tasks.filter((task) => task.completed)]
  ].filter(([, items]) => items.length) : [["Tasks", tasks]];

  groups.forEach(([label, items]) => {
    const heading = document.createElement("div");
    heading.className = "task-section-heading";
    heading.innerHTML = `<span>${label}</span><span class="count-pill">${items.length}</span>`;
    list.appendChild(heading);
    items.forEach((task) => renderTaskRow(list, task));
  });

  renderSections();
  renderStats();
  renderSuggestions();
  renderMatrixSlots();
  updateNextUp();
}

function renderTaskRow(list, task) {
    const row = document.createElement("article");
    row.className = `task${task.completed ? " completed" : ""}`;
    row.dataset.id = task.id;
    row.draggable = true;
    row.innerHTML = taskTemplate(task);
    list.appendChild(row);
}

function renderStats() {
  const open = state.tasks.filter((task) => !task.completed);
  const now = Date.now();
  const today = open.filter((task) => task.due && isToday(task.due));
  const overdue = open.filter((task) => task.due && new Date(task.due).getTime() < now);
  const focus = open
    .filter((task) => task.priority === "high" || task.imp || task.urg)
    .sort((a, b) => smartScore(b) - smartScore(a))
    .slice(0, 5);
  const focusMinutes = focus.reduce((sum, task) => sum + Number(task.estimate || 0), 0);

  $("statOpen").textContent = String(open.length);
  $("statToday").textContent = String(today.length);
  $("statOverdue").textContent = String(overdue.length);
  $("statFocus").textContent = `${focusMinutes}m`;
}

function reportWindow(range) {
  const end = new Date();
  const start = new Date(end);
  if (range === "daily") start.setHours(0, 0, 0, 0);
  if (range === "weekly") start.setDate(end.getDate() - 7);
  if (range === "monthly") start.setMonth(end.getMonth() - 1);
  if (range === "yearly") start.setFullYear(end.getFullYear() - 1);
  return { start, end };
}

function buildReport() {
  const range = $("reportRange")?.value || "daily";
  const { start, end } = reportWindow(range);
  const inRange = state.tasks.filter((task) => {
    const date = new Date(task.due || task.createdAt);
    return date >= start && date <= end;
  });
  const completed = inRange.filter((task) => task.completed);
  const open = inRange.filter((task) => !task.completed);
  const overdue = open.filter((task) => task.due && new Date(task.due).getTime() < Date.now());
  const estimated = inRange.reduce((sum, task) => sum + Number(task.estimate || 0), 0);
  const completionRate = inRange.length ? Math.round((completed.length / inRange.length) * 100) : 0;
  return { range, total: inRange.length, completed: completed.length, open: open.length, overdue: overdue.length, estimated, completionRate };
}

function renderReport() {
  const report = buildReport();
  const cards = [
    ["Completion", `${report.completionRate}%`, report.completionRate],
    ["Completed", report.completed, report.total ? Math.round((report.completed / report.total) * 100) : 0],
    ["Pending", report.open, report.total ? Math.round((report.open / report.total) * 100) : 0],
    ["Planned effort", `${report.estimated}m`, Math.min(100, Math.round(report.estimated / 6))]
  ];
  $("reportCards").innerHTML = cards.map(([label, value, percent]) => `
    <article class="report-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <div class="report-bar"><i style="width:${Math.max(4, percent)}%"></i></div>
    </article>
  `).join("");
}

function reportText() {
  const report = buildReport();
  return `Smart Todo ${report.range} report
Total tasks: ${report.total}
Completed: ${report.completed}
Pending: ${report.open}
Overdue: ${report.overdue}
Planned effort: ${report.estimated} minutes
Completion rate: ${report.completionRate}%`;
}

function downloadReport() {
  const blob = new Blob([reportText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `smart-todo-${$("reportRange").value}-report.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function emailReport() {
  const subject = encodeURIComponent(`Smart Todo ${$("reportRange").value} report`);
  const body = encodeURIComponent(reportText());
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

function renderSuggestions() {
  const box = $("suggestions");
  const open = state.tasks.filter((task) => !task.completed);
  const suggestions = [];
  const overdue = open.filter((task) => task.due && new Date(task.due).getTime() < Date.now()).length;
  const noDate = open.filter((task) => !task.due).length;
  const deep = open.filter((task) => task.energy === "deep").sort((a, b) => smartScore(b) - smartScore(a))[0];
  const next = open.sort((a, b) => smartScore(b) - smartScore(a))[0];

  if (next) suggestions.push(["Best next task", next.title, `${next.priority} priority in ${next.section}`]);
  if (overdue) suggestions.push(["Recover schedule", `${overdue} overdue task${overdue > 1 ? "s" : ""}`, "Clear, reschedule, or mark them done."]);
  if (noDate) suggestions.push(["Triage needed", `${noDate} task${noDate > 1 ? "s" : ""} without dates`, "Add deadlines to make smart sorting sharper."]);
  if (deep) suggestions.push(["Protect focus time", deep.title, `${deep.estimate || 30} minutes of deep work.`]);

  box.innerHTML = suggestions.slice(0, 3).map(([title, body, meta]) => `
    <article class="suggestion"><strong>${escapeHTML(title)}</strong>${escapeHTML(body)}<br><span>${escapeHTML(meta)}</span></article>
  `).join("") || `<article class="suggestion"><strong>All clear</strong>Your workspace is calm. Add a task when something needs a home.</article>`;
}

function renderMatrixSlots() {
  const groups = { Q11: [], Q10: [], Q01: [], Q00: [] };
  state.tasks.filter((task) => !task.completed).forEach((task) => {
    groups[`Q${Number(task.imp)}${Number(task.urg)}`].push(task);
  });

  Object.keys(groups).forEach((id) => {
    const quad = $(id);
    [...quad.querySelectorAll(".task")].forEach((node) => node.remove());
    groups[id].sort((a, b) => smartScore(b) - smartScore(a)).forEach((task) => {
      const node = document.createElement("article");
      node.className = "task";
      node.dataset.id = task.id;
      node.draggable = true;
      node.innerHTML = taskTemplate(task, true);
      quad.appendChild(node);
    });
  });
}

function renderCalendar() {
  const head = $("calHead");
  const grid = $("calGrid");
  const { y, m } = state.calendar;
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const startDay = (first.getDay() + 6) % 7;

  $("calLabel").textContent = `${first.toLocaleString([], { month: "long" })} ${y}`;
  head.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => `<div class="cal-cell">${day}</div>`).join("");
  grid.innerHTML = "";

  for (let i = 0; i < startDay; i += 1) {
    grid.appendChild(document.createElement("div"));
  }

  for (let day = 1; day <= days; day += 1) {
    const cell = document.createElement("button");
    const cellDate = dateKey(new Date(y, m, day));
    const items = state.tasks.filter((task) => task.due && dateKey(task.due) === cellDate);
    cell.className = `cal-cell${state.filters.date === cellDate ? " active" : ""}`;
    cell.innerHTML = `
      <div class="cal-day"><span>${day}</span><span>${items.length || ""}</span></div>
      <div class="cal-items">${items.slice(0, 3).map((task) => `<div class="cal-item">${escapeHTML(task.title)}</div>`).join("")}</div>
    `;
    cell.addEventListener("click", () => {
      state.filters.date = cellDate;
      $("filterStatus").value = "all";
      state.filters.status = "all";
      renderTasks();
      renderCalendar();
    });
    grid.appendChild(cell);
  }
}

function updateNextUp() {
  const next = state.tasks
    .filter((task) => !task.completed && task.due && new Date(task.due).getTime() > Date.now())
    .sort((a, b) => new Date(a.due) - new Date(b.due))[0];
  $("nextUp").textContent = next ? `Next: ${next.title} at ${new Date(next.due).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No upcoming tasks";
}

function getFormTask() {
  const title = $("title").value.trim();
  if (!title) {
    alert("Add a task title first.");
    return null;
  }
  return normalizeTask({
    id: $("saveBtn").dataset.editing || uid(),
    title,
    due: $("due").value || null,
    section: $("section").value,
    category: $("category").value,
    priority: $("priority").value,
    estimate: Number($("estimate").value || 30),
    energy: $("energy").value,
    notify: Number($("notify").value || 0),
    repeat: $("repeat").value,
    repeatEvery: Number($("repeatEvery").value || 0),
    imp: Number($("importance").value),
    urg: Number($("urgency").value),
    notes: $("notes").value.trim(),
    completed: false,
    createdAt: new Date().toISOString()
  });
}

function upsertTask() {
  const task = getFormTask();
  if (!task) return;
  // Ensure notifySent is reset so server will send the next scheduled reminder
  task.preAlertSent = false;
  task.dueSent = false;
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) state.tasks[index] = { ...state.tasks[index], ...task };
  else state.tasks.push(task);
  saveTasks();
  clearForm();
  renderAll();
  scheduleAllTaskNotifications();
}

function clearForm() {
  $("formTitle").textContent = "Add task";
  $("saveBtn").textContent = "Save task";
  $("saveBtn").dataset.editing = "";
  $("cancelEditBtn").classList.add("hidden");
  ["title", "due", "repeatEvery", "estimate", "notes"].forEach((id) => { $(id).value = ""; });
  $("section").value = state.sections.includes("Inbox") ? "Inbox" : state.sections[0];
  $("category").value = "General";
  $("priority").value = "medium";
  $("energy").value = "normal";
  $("notify").value = "10";
  $("repeat").value = "none";
  $("importance").value = "1";
  $("urgency").value = "1";
}

function editTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  $("formTitle").textContent = "Edit task";
  $("saveBtn").textContent = "Update task";
  $("saveBtn").dataset.editing = task.id;
  $("cancelEditBtn").classList.remove("hidden");
  $("title").value = task.title;
  $("due").value = task.due || "";
  $("section").value = task.section;
  $("category").value = task.category;
  $("priority").value = task.priority;
  $("estimate").value = task.estimate || "";
  $("energy").value = task.energy;
  $("notify").value = task.notify;
  $("repeat").value = task.repeat;
  $("repeatEvery").value = task.repeatEvery || "";
  $("importance").value = task.imp;
  $("urgency").value = task.urg;
  $("notes").value = task.notes || "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteTask(id) {
  state.tasks = state.tasks.filter((task) => task.id !== id);
  saveTasks();
  await deleteCloudTask(id);
  renderAll();
  scheduleAllTaskNotifications();
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.completed = !task.completed;
  if (task.completed) {
    task.completedAt = new Date().toISOString();
    showCompletionCelebration(task);
    if (task.repeat !== "none" && task.due) advanceRecurringTask(task);
  } else {
    task.completedAt = null;
  }
  saveTasks();
  renderAll();
  scheduleAllTaskNotifications();
}

function showCompletionCelebration(task) {
  document.querySelector(".celebration")?.remove();
  const toast = document.createElement("div");
  toast.className = "celebration";
  toast.innerHTML = `
    <strong>Great work! Take a 5-minute refresh break.</strong>
    <p>${escapeHTML(task.title)} completed. Breathe, hydrate, and return refreshed.</p>
  `;
  document.body.appendChild(toast);
  // confetti
  const colors = ["#ff6b6b","#ffd166","#6bf27d","#4a90e2","#b692ff"];
  for (let i = 0; i < 28; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-piece';
    c.style.left = `${Math.random() * 90 + 5}%`;
    c.style.top = `${Math.random() * 10 + 2}%`;
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.transform = `translateY(-20px) rotate(${Math.random()*360}deg)`;
    c.style.animationDelay = `${Math.random()*300}ms`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3000 + Math.random()*800);
  }
  window.setTimeout(() => toast.remove(), 5200);
}

function advanceRecurringTask(task) {
  const due = new Date(task.due).getTime();
  const step = task.repeat === "daily" ? 24 * 60 : task.repeat === "weekly" ? 7 * 24 * 60 : Number(task.repeatEvery || 0);
  if (!step) return;
  const clone = { ...task, id: uid(), completed: false, due: localInputValue(new Date(due + step * 60000)), createdAt: new Date().toISOString() };
  state.tasks.push(clone);
}

function parseQuickAdd(text) {
  let title = text.trim();
  const result = {
    title,
    due: null,
    section: "Inbox",
    category: "General",
    priority: "medium",
    estimate: 30,
    energy: "normal",
    notify: 10,
    repeat: "none",
    repeatEvery: 0,
    imp: 1,
    urg: 1,
    notes: "",
    completed: false
  };

  const sectionMatch = title.match(/#([\w-]+)/);
  if (sectionMatch) {
    const section = state.sections.find((item) => item.toLowerCase() === sectionMatch[1].toLowerCase());
    result.section = section || sectionMatch[1];
    if (!state.sections.includes(result.section)) {
      state.sections.push(result.section);
      saveSections();
    }
    title = title.replace(sectionMatch[0], "");
  }

  const priorityMatch = title.match(/!(high|medium|low)/i);
  if (priorityMatch) {
    result.priority = priorityMatch[1].toLowerCase();
    title = title.replace(priorityMatch[0], "");
  }

  const estimateMatch = title.match(/\b(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hour|hours)\b/i);
  if (estimateMatch) {
    const amount = Number(estimateMatch[1]);
    const unit = estimateMatch[2].toLowerCase();
    result.estimate = unit.startsWith("h") ? amount * 60 : amount;
    title = title.replace(estimateMatch[0], "");
  }

  const due = parseNaturalDue(title);
  if (due) {
    result.due = localInputValue(due.date);
    title = title.replace(due.phrase, "");
  }

  if (result.priority === "low") {
    result.imp = 0;
    result.urg = 0;
  } else if (result.priority === "medium") {
    result.imp = 1;
    result.urg = 0;
  }

  result.title = title.replace(/\s+/g, " ").trim() || text.trim();
  return normalizeTask({ ...result, id: uid(), createdAt: new Date().toISOString() });
}

function parseNaturalDue(text) {
  const now = new Date();
  const lower = text.toLowerCase();
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  const setTime = (date, fallbackHour = 9) => {
    let hour = fallbackHour;
    let minute = 0;
    if (timeMatch) {
      hour = Number(timeMatch[1]);
      minute = Number(timeMatch[2] || 0);
      if (timeMatch[3] === "pm" && hour < 12) hour += 12;
      if (timeMatch[3] === "am" && hour === 12) hour = 0;
    }
    date.setHours(hour, minute, 0, 0);
    return date;
  };

  if (lower.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { date: setTime(d), phrase: text.match(/tomorrow(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i)?.[0] || "tomorrow" };
  }
  if (lower.includes("today")) {
    const d = new Date(now);
    return { date: setTime(d, now.getHours() + 1), phrase: text.match(/today(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i)?.[0] || "today" };
  }
  if (lower.includes("next week")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return { date: setTime(d), phrase: text.match(/next week(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i)?.[0] || "next week" };
  }
  return null;
}

function quickAdd() {
  const value = $("quickAdd").value.trim();
  if (!value) return;
  state.tasks.push(parseQuickAdd(value));
  $("quickAdd").value = "";
  saveTasks();
  renderAll();
  scheduleAllTaskNotifications();
}

function addSection() {
  const name = $("newSectionName").value.trim();
  if (!name) return;
  if (state.sections.some((section) => section.toLowerCase() === name.toLowerCase())) {
    alert("That section already exists.");
    return;
  }
  state.sections.push(name);
  $("newSectionName").value = "";
  saveSections();
  renderSections();
}

function renameSection(index) {
  const current = state.sections[index];
  const name = prompt("Rename section", current);
  if (!name || name === current) return;
  state.sections[index] = name;
  state.tasks.forEach((task) => {
    if (task.section === current) task.section = name;
  });
  saveSections();
  saveTasks();
  renderAll();
}

function removeSection(index) {
  const name = state.sections[index];
  if (!confirm(`Delete "${name}"? Its tasks will move to Inbox.`)) return;
  state.sections.splice(index, 1);
  state.tasks.forEach((task) => {
    if (task.section === name) task.section = "Inbox";
  });
  saveSections();
  saveTasks();
  renderAll();
}

function startWater() {
  const minutes = Number($("waterInterval").value || 60);
  state.settings.waterInterval = minutes;
  saveSettings();
  if (state.timers.water) clearInterval(state.timers.water);
  ensurePermission();
  state.timers.water = setInterval(() => {
    notify("Hydration break", `Take a water break. Interval: ${minutes} minutes.`);
    $("waterStatus").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, minutes * 60000);
  $("waterStatus").textContent = "On";
}

function stopWater() {
  if (state.timers.water) clearInterval(state.timers.water);
  state.timers.water = null;
  $("waterStatus").textContent = "Off";
}

function exportJSON() {
  const data = JSON.stringify({ tasks: state.tasks, sections: state.sections, settings: state.settings }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "smart-todo-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      state.tasks = (data.tasks || []).map(normalizeTask);
      state.sections = data.sections || state.sections;
      state.settings = data.settings || state.settings;
      saveTasks();
      saveSections();
      saveSettings();
      applyTheme();
      renderAll();
      scheduleAllTaskNotifications();
    } catch {
      alert("Invalid JSON file.");
    }
  };
  reader.readAsText(file);
}

function setupDnD() {
  document.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".task");
    if (!row) return;
    event.dataTransfer.setData("text/plain", row.dataset.id);
  });

  document.querySelectorAll(".quad").forEach((quad) => {
    quad.addEventListener("dragover", (event) => {
      event.preventDefault();
      quad.classList.add("dragover");
    });
    quad.addEventListener("dragleave", () => quad.classList.remove("dragover"));
    quad.addEventListener("drop", (event) => {
      event.preventDefault();
      quad.classList.remove("dragover");
      const task = state.tasks.find((item) => item.id === event.dataTransfer.getData("text/plain"));
      if (!task) return;
      task.imp = Number(quad.dataset.i);
      task.urg = Number(quad.dataset.u);
      task.priority = task.imp && task.urg ? "high" : task.imp || task.urg ? "medium" : "low";
      saveTasks();
      renderAll();
    });
  });

  // Allow reordering tasks in the list via drag & drop
  const list = document.getElementById('taskList');
  if (list) {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const target = e.target.closest('.task');
      const taskIndex = state.tasks.findIndex(t => t.id === id);
      if (taskIndex === -1) return;
      const moving = state.tasks.splice(taskIndex,1)[0];
      if (!target) {
        state.tasks.push(moving);
      } else {
        const dropId = target.dataset.id;
        const dropIndex = state.tasks.findIndex(t => t.id === dropId);
        state.tasks.splice(dropIndex, 0, moving);
      }
      saveTasks();
      renderAll();
    });
  }
}

function switchView(view) {
  // hide all optional panels
  document.querySelectorAll('.panel.community-panel, .panel.matrix, .panel.calendar, .panel.insight-panel').forEach((el)=>el.classList.add('hidden'));
  // default show main panels
  if (view === 'community') {
    document.querySelector('.panel.community-panel')?.classList.remove('hidden');
  } else if (view === 'calendar') {
    document.querySelector('.panel.calendar')?.classList.remove('hidden');
  } else if (view === 'matrix') {
    document.querySelector('.panel.matrix')?.classList.remove('hidden');
  } else if (view === 'focus') {
    state.filters.query = '';
    state.filters.section = 'All';
    state.filters.status = 'open';
    state.filters.priority = 'high';
    renderAll();
  } else {
    // all
    document.querySelectorAll('.panel').forEach((el)=>el.classList.remove('hidden'));
  }
}

function recurrenceSweep() {
  let changed = false;
  const now = Date.now();
  state.tasks.forEach((task) => {
    if (!task.due || task.completed || task.repeat === "none") return;
    const due = new Date(task.due).getTime();
    const step = task.repeat === "daily" ? 24 * 60 : task.repeat === "weekly" ? 7 * 24 * 60 : Number(task.repeatEvery || 0);
    if (step > 0 && due <= now) {
      let next = due;
      while (next <= now) next += step * 60000;
      task.due = localInputValue(new Date(next));
      changed = true;
    }
  });
  if (changed) {
    saveTasks();
    renderAll();
    scheduleAllTaskNotifications();
  }
}

function renderAll() {
  renderSections();
  renderTasks();
  renderCalendar();
  renderReport();
}

function wire() {
  $("currentDate").textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  $("themeBtn").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    saveSettings();
    applyTheme();
  });
  $("exportBtn").addEventListener("click", exportJSON);
  $("importFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importJSON(file);
    event.target.value = "";
  });
  $("clearBtn").addEventListener("click", () => {
    if (confirm("Reset all local task data?")) {
      localStorage.clear();
      location.reload();
    }
  });

  $("quickAddBtn").addEventListener("click", quickAdd);
  $("quickAdd").addEventListener("keydown", (event) => {
    if (event.key === "Enter") quickAdd();
  });
  $("saveBtn").addEventListener("click", upsertTask);
  $("cancelEditBtn").addEventListener("click", clearForm);

  $("taskList").addEventListener("click", (event) => {
    const control = event.target.closest("button, input[type='checkbox']");
    if (!control) return;
    const id = control.dataset.id;
    const act = control.dataset.act || "toggle";
    if (act === "toggle") toggleTask(id);
    if (act === "edit") editTask(id);
    if (act === "del" && confirm("Delete this task?")) deleteTask(id);
  });

  $("search").addEventListener("input", (event) => {
    state.filters.query = event.target.value;
    renderTasks();
  });
  ["filterSection", "filterStatus", "filterPriority", "sortBy"].forEach((id) => {
    $(id).addEventListener("change", (event) => {
      const key = id.replace("filter", "").replace("sortBy", "sort").toLowerCase();
      if (id === "filterSection") state.filters.section = event.target.value;
      if (id === "filterStatus") state.filters.status = event.target.value;
      if (id === "filterPriority") state.filters.priority = event.target.value;
      if (id === "sortBy") state.filters.sort = event.target.value;
      renderTasks();
    });
  });
  $("clearDateBtn").addEventListener("click", () => {
    state.filters.date = null;
    renderAll();
  });

  $("addSectionBtn").addEventListener("click", addSection);
  $("newSectionName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addSection();
  });
  $("sections").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const index = Number(button.dataset.i);
    if (button.dataset.act === "rename") renameSection(index);
    if (button.dataset.act === "del") removeSection(index);
  });

  $("prevMonth").addEventListener("click", () => {
    const d = new Date(state.calendar.y, state.calendar.m - 1, 1);
    state.calendar.y = d.getFullYear();
    state.calendar.m = d.getMonth();
    renderCalendar();
  });
  $("nextMonth").addEventListener("click", () => {
    const d = new Date(state.calendar.y, state.calendar.m + 1, 1);
    state.calendar.y = d.getFullYear();
    state.calendar.m = d.getMonth();
    renderCalendar();
  });

  $("startWater").addEventListener("click", startWater);
  // Sidebar nav handlers
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view || 'all';
      switchView(view);
    });
  });
  $("stopWater").addEventListener("click", stopWater);
  $("reportRange").addEventListener("change", renderReport);
  $("downloadReportBtn").addEventListener("click", downloadReport);
  $("emailReportBtn").addEventListener("click", emailReport);
  $("sendCommunityBtn").addEventListener("click", () => sendCommunityMessage().catch((error) => alert(error.message)));
  $("communityInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendCommunityMessage().catch((error) => alert(error.message));
  });
  $("screenShareBtn").addEventListener("click", () => startScreenSharePreview().catch((error) => alert(error.message)));
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const view = button.dataset.view;
      const target = view === "calendar" ? $("calGrid") : view === "matrix" ? $("Q11") : view === "community" ? $("communityMessages") : view === "focus" ? $("suggestions") : $("taskList");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  setupDnD();
}

async function bootProtectedApp() {
  if (appWired) {
    startCloudTaskListener();
    startCommunityListener();
    return;
  }
  appWired = true;
  if (!state.tasks.length) {
    const now = new Date();
    const today = new Date(now);
    today.setHours(now.getHours() + 2, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 30, 0, 0);
    state.tasks = [
      normalizeTask({ id: uid(), title: "Plan the week in priority matrix", due: localInputValue(today), section: "Work", category: "Planning", priority: "high", estimate: 35, energy: "deep", notify: 10, imp: 1, urg: 1 }),
      normalizeTask({ id: uid(), title: "Prep healthy lunch", due: localInputValue(tomorrow), section: "Diet", category: "Meal", priority: "medium", estimate: 25, energy: "light", repeat: "daily", notify: 30, imp: 1, urg: 0 })
    ];
    saveTasks();
  }

  $("waterInterval").value = state.settings.waterInterval || 60;
  applyTheme();
  wire();
  clearForm();
  renderAll();
  await ensurePermission();
  scheduleAllTaskNotifications();
  setInterval(recurrenceSweep, 60000);
  startCloudTaskListener();
  startCommunityListener();
}

(async function init() {
  await initAuth();
  onAuthReady(() => {
    bootProtectedApp().catch(() => alert("Could not start your workspace. Refresh and try again."));
  });
})();
