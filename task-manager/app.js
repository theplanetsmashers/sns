(() => {
  "use strict";

  const STORAGE_KEY = "task-manager.tasks";

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
  let filter = "all";
  let spaceFilter = "all";
  let sortBy = "created";
  let searchTerm = "";
  let dragSourceId = null;

  function loadTasks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((t) => ({ dueTime: "", space: "work", recur: "none", ...t }));
    } catch {
      return [];
    }
  }

  function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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

  render();
})();
