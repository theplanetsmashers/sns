(() => {
  "use strict";

  const STORAGE_KEY = "task-manager.tasks";
  const THEME_KEY = "task-manager.theme";

  const PRIORITY_LABEL = { low: "低", medium: "中", high: "高" };
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  const SPACE_LABEL = { work: "仕事", personal: "私用" };
  const SPACE_ICON = { work: "💼", personal: "🏠" };

  const els = {
    form: document.getElementById("taskForm"),
    title: document.getElementById("taskTitle"),
    due: document.getElementById("taskDue"),
    time: document.getElementById("taskTime"),
    priority: document.getElementById("taskPriority"),
    space: document.getElementById("taskSpace"),
    category: document.getElementById("taskCategory"),
    list: document.getElementById("taskList"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    sort: document.getElementById("sortSelect"),
    filterGroup: document.getElementById("filterStatus"),
    filterSpaceGroup: document.getElementById("filterSpace"),
    template: document.getElementById("taskItemTemplate"),
    themeToggle: document.getElementById("themeToggle"),
    statTotal: document.getElementById("statTotal"),
    statActive: document.getElementById("statActive"),
    statDone: document.getElementById("statDone"),
    statOverdue: document.getElementById("statOverdue"),
  };

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
      return parsed.map((t) => ({ dueTime: "", space: "work", ...t }));
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

  function addTask({ title, due, dueTime, priority, space, category }) {
    tasks.push({
      id: uid(),
      title: title.trim(),
      due: due || "",
      dueTime: due ? dueTime || "" : "",
      priority: priority || "medium",
      space: space || "work",
      category: (category || "").trim(),
      done: false,
      createdAt: Date.now(),
    });
    saveTasks();
    render();
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

      const checkbox = node.querySelector(".task-done-checkbox");
      checkbox.checked = task.done;
      checkbox.addEventListener("change", () => updateTask(task.id, { done: checkbox.checked }));

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
    const titleEl = node.querySelector(".task-title");
    const input = document.createElement("input");
    input.type = "text";
    input.value = task.title;
    input.maxLength = 200;
    input.className = "edit-title-input";
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const value = input.value.trim();
      if (value) updateTask(task.id, { title: value });
      else render();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") render();
    });
    input.addEventListener("blur", commit);
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

  function syncTimeAvailability() {
    const hasDue = Boolean(els.due.value);
    els.time.disabled = !hasDue;
    if (!hasDue) els.time.value = "";
  }
  els.due.addEventListener("input", syncTimeAvailability);
  syncTimeAvailability();

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!els.title.value.trim()) return;
    addTask({
      title: els.title.value,
      due: els.due.value,
      dueTime: els.time.value,
      priority: els.priority.value,
      space: els.space.value,
      category: els.category.value,
    });
    els.form.reset();
    els.priority.value = "medium";
    els.space.value = "work";
    syncTimeAvailability();
    els.title.focus();
  });

  els.filterGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    filter = btn.dataset.filter;
    for (const b of els.filterGroup.querySelectorAll(".filter-btn")) {
      b.classList.toggle("active", b === btn);
    }
    render();
  });

  els.filterSpaceGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    spaceFilter = btn.dataset.space;
    for (const b of els.filterSpaceGroup.querySelectorAll(".filter-btn")) {
      b.classList.toggle("active", b === btn);
    }
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

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  }

  els.themeToggle.addEventListener("click", () => {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = stored || (prefersDark ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  try {
    applyTheme(localStorage.getItem(THEME_KEY));
  } catch {
    applyTheme(null);
  }
  render();
})();
