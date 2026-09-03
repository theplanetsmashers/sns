(() => {
  "use strict";

  const STORAGE_KEY = "task-manager.tasks";
  const SYNC_CODE_KEY = "task-manager.syncCode";
  const SYNC_CODE_PATTERN = /^[A-Za-z0-9]{8,12}$/;
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCmt42aC4G5m94EAaASRcuD78LyCW5PlnY",
    authDomain: "task-manager-b419b.firebaseapp.com",
    projectId: "task-manager-b419b",
    storageBucket: "task-manager-b419b.firebasestorage.app",
    messagingSenderId: "528967500139",
    appId: "1:528967500139:web:cc66445b2559ba7cdacc2e",
  };

  const PRIORITY_LABEL = { low: "低", medium: "中", high: "高" };
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  const SPACE_LABEL = { work: "仕事", personal: "私用" };
  const SPACE_ICON = { work: "💼", personal: "🏠" };
  const RECUR_LABEL = { none: "なし", weekly: "毎週", monthly: "毎月" };

  const els = {
    form: document.getElementById("taskForm"),
    title: document.getElementById("taskTitle"),
    due: document.getElementById("taskDue"),
    time: document.getElementById("taskTime"),
    category: document.getElementById("taskCategory"),
    list: document.getElementById("taskList"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    sort: document.getElementById("sortSelect"),
    filterGroup: document.getElementById("filterStatus"),
    filterSpaceGroup: document.getElementById("filterSpace"),
    template: document.getElementById("taskItemTemplate"),
    statTotal: document.getElementById("statTotal"),
    statActive: document.getElementById("statActive"),
    statDone: document.getElementById("statDone"),
    statOverdue: document.getElementById("statOverdue"),
    addTaskBtn: document.getElementById("addTaskBtn"),
    popover: document.getElementById("addPopover"),
    popoverBackdrop: document.getElementById("popoverBackdrop"),
    closePopoverBtn: document.getElementById("closePopoverBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importFileInput: document.getElementById("importFileInput"),
    syncBtn: document.getElementById("syncBtn"),
    syncPopover: document.getElementById("syncPopover"),
    syncPopoverBackdrop: document.getElementById("syncPopoverBackdrop"),
    closeSyncPopoverBtn: document.getElementById("closeSyncPopoverBtn"),
    syncDisconnectedView: document.getElementById("syncDisconnectedView"),
    syncConnectedView: document.getElementById("syncConnectedView"),
    startSyncBtn: document.getElementById("startSyncBtn"),
    joinCodeInput: document.getElementById("joinCodeInput"),
    joinSyncBtn: document.getElementById("joinSyncBtn"),
    syncCodeText: document.getElementById("syncCodeText"),
    copySyncCodeBtn: document.getElementById("copySyncCodeBtn"),
    disconnectSyncBtn: document.getElementById("disconnectSyncBtn"),
  };

  function openPopover() {
    els.popover.classList.add("open");
    els.popoverBackdrop.classList.add("open");
    els.addTaskBtn.setAttribute("aria-expanded", "true");
    els.title.focus();
  }

  function closePopover() {
    els.popover.classList.remove("open");
    els.popoverBackdrop.classList.remove("open");
    els.addTaskBtn.setAttribute("aria-expanded", "false");
    els.addTaskBtn.focus();
  }

  els.addTaskBtn.addEventListener("click", () => {
    if (els.popover.classList.contains("open")) closePopover();
    else openPopover();
  });
  els.closePopoverBtn.addEventListener("click", closePopover);
  els.popoverBackdrop.addEventListener("click", closePopover);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.popover.classList.contains("open")) closePopover();
  });

  function createChoiceGroup(elId, defaultValue) {
    const groupEl = document.getElementById(elId);
    const buttons = Array.from(groupEl.querySelectorAll(".choice-btn"));
    const state = { value: defaultValue };

    function applyActive() {
      for (const b of buttons) b.classList.toggle("active", b.dataset.value === state.value);
    }

    groupEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".choice-btn");
      if (!btn || btn.disabled) return;
      state.value = btn.dataset.value;
      applyActive();
    });
    applyActive();

    return {
      get value() { return state.value; },
      set value(v) { state.value = v; applyActive(); },
      setDisabled(disabled) {
        for (const b of buttons) b.disabled = disabled;
      },
    };
  }

  const priorityChoice = createChoiceGroup("priorityChoice", "medium");
  const spaceChoice = createChoiceGroup("spaceChoice", "work");
  const recurChoice = createChoiceGroup("recurChoice", "none");

  let tasks = loadTasks();
  let filter = "active";
  let spaceFilter = "work";
  let sortBy = "due";
  let searchTerm = "";
  let dragSourceId = null;

  let syncCode = null;
  let syncPollTimer = null;
  let syncLastUpdatedAt = 0;
  const SYNC_POLL_MS = 4000;
  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

  function normalizeTask(t) {
    return { dueTime: "", space: "work", recur: "none", category: "", done: false, priority: "medium", ...t };
  }

  function loadTasks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeTask);
    } catch {
      return [];
    }
  }

  function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    if (syncCode) pushSyncSnapshot();
  }

  function generateSyncCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // --- Firestore REST helpers (plain HTTPS, no SDK — works over restrictive networks/proxies) ---

  function toFirestoreValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toFirestoreValue(val)])) } };
  }

  function fromFirestoreValue(v) {
    if (!v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
    if ("mapValue" in v) {
      const obj = {};
      for (const [k, val] of Object.entries(v.mapValue.fields || {})) obj[k] = fromFirestoreValue(val);
      return obj;
    }
    return null;
  }

  async function firestoreGetDoc(code) {
    const res = await fetch(`${FIRESTORE_BASE}/synced-lists/${encodeURIComponent(code)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`firestore get failed: ${res.status}`);
    const json = await res.json();
    return fromFirestoreValue({ mapValue: { fields: json.fields || {} } });
  }

  async function firestoreSetDoc(code, data) {
    const body = { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFirestoreValue(v)])) };
    const res = await fetch(`${FIRESTORE_BASE}/synced-lists/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`firestore set failed: ${res.status}`);
  }

  // --- sync orchestration ---

  function renderSyncView() {
    const connected = Boolean(syncCode);
    els.syncDisconnectedView.hidden = connected;
    els.syncConnectedView.hidden = !connected;
    els.syncBtn.classList.toggle("connected", connected);
    if (connected) els.syncCodeText.value = syncCode;
  }

  function stopSyncPolling() {
    if (syncPollTimer) clearInterval(syncPollTimer);
    syncPollTimer = null;
  }

  async function pollSync() {
    if (!syncCode) return;
    try {
      const remote = await firestoreGetDoc(syncCode);
      if (remote && Array.isArray(remote.tasks) && (remote.updatedAt || 0) > syncLastUpdatedAt) {
        tasks = remote.tasks.map(normalizeTask);
        syncLastUpdatedAt = remote.updatedAt || 0;
        render();
      }
    } catch {
      // transient network hiccup — silently retry on the next poll
    }
  }

  function startSyncPolling() {
    stopSyncPolling();
    syncPollTimer = setInterval(pollSync, SYNC_POLL_MS);
  }

  async function pushSyncSnapshot() {
    if (!syncCode) return;
    const stamp = Date.now();
    try {
      await firestoreSetDoc(syncCode, { tasks, updatedAt: stamp });
      syncLastUpdatedAt = stamp;
    } catch {
      showToast("同期に失敗しました");
    }
  }

  async function connectSync(rawCode, { silent } = {}) {
    const code = rawCode.trim().toUpperCase();
    if (!SYNC_CODE_PATTERN.test(code)) {
      showToast("コードは英数字8〜12文字で入力してください");
      return;
    }
    stopSyncPolling();
    syncCode = code;
    localStorage.setItem(SYNC_CODE_KEY, code);
    renderSyncView();

    try {
      const remote = await firestoreGetDoc(code);
      if (remote && Array.isArray(remote.tasks)) {
        tasks = remote.tasks.map(normalizeTask);
        syncLastUpdatedAt = remote.updatedAt || 0;
        render();
      } else {
        await firestoreSetDoc(code, { tasks, updatedAt: Date.now() });
        syncLastUpdatedAt = Date.now();
      }
      if (!silent) showToast(`同期コード ${code} に接続しました`);
    } catch {
      showToast("同期サーバーに接続できませんでした。インターネット接続を確認してください。");
    }

    startSyncPolling();
  }

  function disconnectSync() {
    stopSyncPolling();
    syncCode = null;
    localStorage.removeItem(SYNC_CODE_KEY);
    renderSyncView();
    showToast("同期を解除しました");
  }

  function uid() {
    return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function todayISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function isOverdue(task) {
    if (task.done || !task.due) return false;
    if (task.dueTime) return new Date(`${task.due}T${task.dueTime}`).getTime() < Date.now();
    return task.due < todayISO();
  }

  function addTask({ title, due, dueTime, recur, priority, space, category }) {
    tasks.push({
      id: uid(),
      title: title.trim(),
      due: due || "",
      dueTime: due ? dueTime || "" : "",
      recur: due ? recur || "none" : "none",
      priority: priority || "medium",
      space: space || "work",
      category: (category || "").trim(),
      done: false,
      createdAt: Date.now(),
    });
    saveTasks();
    render();
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function advanceDue(due, recur) {
    const [y, m, d] = due.split("-").map(Number);
    if (recur === "weekly") {
      return toISODate(new Date(y, m - 1, d + 7));
    }
    if (recur === "monthly") {
      let ny = y;
      let nm = m + 1;
      if (nm > 12) { nm = 1; ny += 1; }
      const lastDay = new Date(ny, nm, 0).getDate();
      return toISODate(new Date(ny, nm - 1, Math.min(d, lastDay)));
    }
    return due;
  }

  function showToast(message) {
    let toast = document.getElementById("appToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "appToast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function updateTask(id, patch) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    saveTasks();
    render();
  }

  function deleteTask(id) {
    tasks = tasks.filter((x) => x.id !== id);
    saveTasks();
    render();
  }

  function reorder(sourceId, targetId) {
    const from = tasks.findIndex((x) => x.id === sourceId);
    const to = tasks.findIndex((x) => x.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const [moved] = tasks.splice(from, 1);
    tasks.splice(to, 0, moved);
    saveTasks();
    render();
  }

  function getVisibleTasks() {
    let result = tasks.filter((t) => {
      if (filter === "active" && t.done) return false;
      if (filter === "done" && !t.done) return false;
      if (spaceFilter !== "all" && t.space !== spaceFilter) return false;
      if (searchTerm) {
        const haystack = `${t.title} ${t.category}`.toLowerCase();
        if (!haystack.includes(searchTerm)) return false;
      }
      return true;
    });

    if (sortBy === "due") {
      const dueKey = (t) => `${t.due || "9999-99-99"}T${t.dueTime || "00:00"}`;
      result = result.slice().sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
    } else if (sortBy === "priority") {
      result = result.slice().sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    } else {
      result = result.slice().sort((a, b) => a.createdAt - b.createdAt);
    }
    return result;
  }

  function formatDue(task) {
    if (!task.due) return "";
    const [, m, d] = task.due.split("-");
    return task.dueTime ? `${m}/${d} ${task.dueTime}` : `${m}/${d}`;
  }

  function render() {
    const visible = getVisibleTasks();
    els.list.innerHTML = "";
    els.empty.hidden = visible.length > 0;

    for (const task of visible) {
      const node = els.template.content.firstElementChild.cloneNode(true);
      node.dataset.id = task.id;
      node.classList.toggle("done", task.done);
      node.classList.toggle("overdue", isOverdue(task));

      const checkbox = node.querySelector(".task-done-checkbox");
      checkbox.checked = task.done;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && task.due && task.recur && task.recur !== "none") {
          const nextDue = advanceDue(task.due, task.recur);
          updateTask(task.id, { due: nextDue });
          showToast(`「${task.title}」の次回期限を ${formatDue({ due: nextDue, dueTime: task.dueTime })} に更新しました`);
        } else {
          updateTask(task.id, { done: checkbox.checked });
        }
      });

      const titleEl = node.querySelector(".task-title");
      titleEl.textContent = task.title;

      const badge = node.querySelector(".priority-badge");
      badge.textContent = PRIORITY_LABEL[task.priority];
      badge.classList.add(`priority-${task.priority}`);

      const spaceBadge = node.querySelector(".space-badge");
      spaceBadge.textContent = `${SPACE_ICON[task.space]} ${SPACE_LABEL[task.space]}`;
      spaceBadge.classList.add(`space-${task.space}`);

      const categoryEl = node.querySelector(".task-category");
      categoryEl.textContent = task.category ? `# ${task.category}` : "";

      const dueEl = node.querySelector(".task-due");
      dueEl.textContent = formatDue(task);
      dueEl.classList.toggle("overdue", isOverdue(task));

      const recurEl = node.querySelector(".task-recur");
      recurEl.textContent = task.recur && task.recur !== "none" ? `🔁 ${RECUR_LABEL[task.recur]}` : "";

      node.querySelector(".edit-btn").addEventListener("click", () => startEdit(node, task));
      node.querySelector(".delete-btn").addEventListener("click", () => requestDelete(node, task));

      node.addEventListener("dragstart", () => {
        dragSourceId = task.id;
        node.classList.add("dragging");
      });
      node.addEventListener("dragend", () => node.classList.remove("dragging"));
      node.addEventListener("dragover", (e) => e.preventDefault());
      node.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragSourceId) reorder(dragSourceId, task.id);
        dragSourceId = null;
      });

      els.list.appendChild(node);
    }

    els.statTotal.textContent = tasks.length;
    els.statActive.textContent = tasks.filter((t) => !t.done).length;
    els.statDone.textContent = tasks.filter((t) => t.done).length;
    els.statOverdue.textContent = tasks.filter(isOverdue).length;
  }

  function startEdit(node, task) {
    const body = node.querySelector(".task-body");
    body.innerHTML = "";

    const form = document.createElement("form");
    form.className = "edit-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "edit-title-input";
    titleInput.maxLength = 200;
    titleInput.required = true;
    titleInput.value = task.title;

    const dtRow = document.createElement("div");
    dtRow.className = "edit-datetime-row";

    const dueInput = document.createElement("input");
    dueInput.type = "date";
    dueInput.className = "edit-due-input";
    dueInput.value = task.due || "";

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.className = "edit-time-input";
    timeInput.value = task.dueTime || "";
    timeInput.disabled = !task.due;

    dueInput.addEventListener("input", () => {
      timeInput.disabled = !dueInput.value;
      if (!dueInput.value) timeInput.value = "";
    });

    dtRow.append(dueInput, timeInput);

    const actions = document.createElement("div");
    actions.className = "edit-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "edit-save-btn";
    saveBtn.textContent = "保存";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "edit-cancel-btn";
    cancelBtn.textContent = "キャンセル";
    cancelBtn.addEventListener("click", () => render());

    actions.append(saveBtn, cancelBtn);
    form.append(titleInput, dtRow, actions);
    body.appendChild(form);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      if (!title) return;
      const due = dueInput.value;
      const patch = { title, due, dueTime: due ? timeInput.value : "" };
      if (!due) patch.recur = "none";
      updateTask(task.id, patch);
    });

    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") render();
    });

    titleInput.focus();
    titleInput.select();
  }

  function requestDelete(node, task) {
    const actions = node.querySelector(".task-actions");
    actions.innerHTML = "";
    actions.classList.add("confirming");

    const label = document.createElement("span");
    label.className = "confirm-label";
    label.textContent = "削除する？";

    const yesBtn = document.createElement("button");
    yesBtn.type = "button";
    yesBtn.className = "icon-btn confirm-yes";
    yesBtn.title = "削除を確定";
    yesBtn.textContent = "✔";
    yesBtn.addEventListener("click", () => deleteTask(task.id));

    const noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.className = "icon-btn confirm-no";
    noBtn.title = "キャンセル";
    noBtn.textContent = "✕";
    noBtn.addEventListener("click", () => render());

    actions.append(label, yesBtn, noBtn);
  }

  function syncDueDependentFields() {
    const hasDue = Boolean(els.due.value);
    els.time.disabled = !hasDue;
    recurChoice.setDisabled(!hasDue);
    if (!hasDue) {
      els.time.value = "";
      recurChoice.value = "none";
    }
  }
  els.due.addEventListener("input", syncDueDependentFields);
  syncDueDependentFields();

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!els.title.value.trim()) return;
    addTask({
      title: els.title.value,
      due: els.due.value,
      dueTime: els.time.value,
      recur: recurChoice.value,
      priority: priorityChoice.value,
      space: spaceChoice.value,
      category: els.category.value,
    });
    els.form.reset();
    priorityChoice.value = "medium";
    spaceChoice.value = "work";
    syncDueDependentFields();
    closePopover();
  });

  els.filterGroup.addEventListener("change", () => {
    filter = els.filterGroup.value;
    render();
  });

  els.filterSpaceGroup.addEventListener("change", () => {
    spaceFilter = els.filterSpaceGroup.value;
    render();
  });

  els.search.addEventListener("input", () => {
    searchTerm = els.search.value.trim().toLowerCase();
    render();
  });

  els.sort.addEventListener("change", () => {
    sortBy = els.sort.value;
    render();
  });

  function exportTasks() {
    const payload = { app: "task-manager", exportedAt: new Date().toISOString(), tasks };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tasks-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("タスクをエクスポートしました");
  }

  els.exportBtn.addEventListener("click", exportTasks);
  els.importBtn.addEventListener("click", () => els.importFileInput.click());

  els.importFileInput.addEventListener("change", async () => {
    const file = els.importFileInput.files[0];
    els.importFileInput.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : Array.isArray(parsed.tasks) ? parsed.tasks : null;
      if (!imported) throw new Error("invalid format");
      tasks = imported.map((t) => normalizeTask({ ...t, id: t.id || uid() }));
      saveTasks();
      render();
      showToast(`${tasks.length}件のタスクをインポートしました（既存のタスクは置き換えられました）`);
    } catch {
      showToast("インポートに失敗しました。ファイル形式を確認してください。");
    }
  });

  function openSyncPopover() {
    els.syncPopover.classList.add("open");
    els.syncPopoverBackdrop.classList.add("open");
    els.syncBtn.setAttribute("aria-expanded", "true");
    renderSyncView();
  }

  function closeSyncPopover() {
    els.syncPopover.classList.remove("open");
    els.syncPopoverBackdrop.classList.remove("open");
    els.syncBtn.setAttribute("aria-expanded", "false");
    els.syncBtn.focus();
  }

  els.syncBtn.addEventListener("click", () => {
    if (els.syncPopover.classList.contains("open")) closeSyncPopover();
    else openSyncPopover();
  });
  els.closeSyncPopoverBtn.addEventListener("click", closeSyncPopover);
  els.syncPopoverBackdrop.addEventListener("click", closeSyncPopover);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.syncPopover.classList.contains("open")) closeSyncPopover();
  });

  els.startSyncBtn.addEventListener("click", () => connectSync(generateSyncCode()));

  els.joinSyncBtn.addEventListener("click", () => {
    if (!els.joinCodeInput.value.trim()) return;
    connectSync(els.joinCodeInput.value);
    els.joinCodeInput.value = "";
  });

  els.syncCodeText.addEventListener("click", () => els.syncCodeText.select());

  els.copySyncCodeBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(syncCode);
      showToast("コピーしました");
    } catch {
      els.syncCodeText.select();
      showToast("コピーできませんでした。表示中のコードを手動で選択してください。");
    }
  });

  els.disconnectSyncBtn.addEventListener("click", disconnectSync);

  render();

  const savedSyncCode = localStorage.getItem(SYNC_CODE_KEY);
  if (savedSyncCode) connectSync(savedSyncCode, { silent: true });
})();
