(() => {
  "use strict";

  const STORAGE_KEY = "task-manager.tasks";
  const THEME_KEY = "task-manager.theme";

  const PRIORITY_LABEL = { low: "低", medium: "中", high: "高" };
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

  const els = {
    form: document.getElementById("taskForm"),
    title: document.getElementById("taskTitle"),
    due: document.getElementById("taskDue"),
    priority: document.getElementById("taskPriority"),
    category: document.getElementById("taskCategory"),
    list: document.getElementById("taskList"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    sort: document.getElementById("sortSelect"),
    filterGroup: document.getElementById("filterStatus"),
    template: document.getElementById("taskItemTemplate"),
    themeToggle: document.getElementById("themeToggle"),
    statTotal: document.getElementById("statTotal"),
    statActive: document.getElementById("statActive"),
    statDone: document.getElementById("statDone"),
    statOverdue: document.getElementById("statOverdue"),
  };

  let tasks = loadTasks();
  let filter = "all";
  let sortBy = "created";
  let searchTerm = "";
  let dragSourceId = null;

  function loadTasks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
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
    return !task.done && task.due && task.due < todayISO();
  }

  function addTask({ title, due, priority, category }) {
    tasks.push({
      id: uid(),
      title: title.trim(),
      due: due || "",
      priority: priority || "medium",
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
      if (searchTerm) {
        const haystack = `${t.title} ${t.category}`.toLowerCase();
        if (!haystack.includes(searchTerm)) return false;
      }
      return true;
    });

    if (sortBy === "due") {
      result = result.slice().sort((a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99"));
    } else if (sortBy === "priority") {
      result = result.slice().sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    } else {
      result = result.slice().sort((a, b) => a.createdAt - b.createdAt);
    }
    return result;
  }

  function formatDue(due) {
    if (!due) return "";
    const [y, m, d] = due.split("-");
    return `📅 ${m}/${d}`;
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

      const categoryEl = node.querySelector(".task-category");
      categoryEl.textContent = task.category ? `🏷 ${task.category}` : "";

      const dueEl = node.querySelector(".task-due");
      dueEl.textContent = formatDue(task.due);
      dueEl.classList.toggle("overdue", isOverdue(task));

      node.querySelector(".edit-btn").addEventListener("click", () => startEdit(node, task));
      node.querySelector(".delete-btn").addEventListener("click", () => {
        if (confirm(`「${task.title}」を削除しますか？`)) deleteTask(task.id);
      });

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
    input.style.cssText = "width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-weight:600;";
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

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!els.title.value.trim()) return;
    addTask({
      title: els.title.value,
      due: els.due.value,
      priority: els.priority.value,
      category: els.category.value,
    });
    els.form.reset();
    els.priority.value = "medium";
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
    else document.documentElement.removeAttribute("data-theme");
  }

  els.themeToggle.addEventListener("click", () => {
    const current = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  applyTheme(localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light");
  render();
})();
