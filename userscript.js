// ==UserScript==
// @name         Microsoft To Do - completion date
// @namespace    local.mstodo.completion-date
// @version      2.1
// @match        https://to-do.live.com/*
// @match        https://to-do.office.com/*
// @match        https://todo.microsoft.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async () => {
  'use strict';

  const CLASS = 'todo-completed-date';

  let datesByTitle = new Map();

  const normalize = s =>
    String(s ?? '').replace(/\s+/g, ' ').trim();

  const pad = n =>
    String(n).padStart(2, '0');

  function formatCompletedAt(value) {
    let iso = value.date_time.replace(/\.(\d{3})\d+/, '.$1');

    if (
      value.time_zone === 'UTC' &&
      !/[zZ]$|[+-]\d\d:\d\d$/.test(iso)
    ) {
      iso += 'Z';
    }

    const d = new Date(iso);

    return (
      `${pad(d.getDate())}.` +
      `${pad(d.getMonth() + 1)}.` +
      `${d.getFullYear()}`
    );
  }

  async function getTodoDbName() {
    const dbs = await indexedDB.databases();

    for (const info of dbs) {
      if (!info.name) continue;

      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(info.name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });

      const hasTasks =
        db.objectStoreNames.contains('tasks');

      db.close();

      if (hasTasks) {
        return info.name;
      }
    }

    throw new Error('Microsoft To Do DB not found');
  }

  async function loadDates() {
    const dbName = await getTodoDbName();

    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

    const tasks = await new Promise((resolve, reject) => {
      const r = db
        .transaction('tasks', 'readonly')
        .objectStore('tasks')
        .getAll();

      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

    db.close();

    const map = new Map();

    for (const task of tasks) {
      if (
        !task.completed ||
        !task.completed_at?.date_time ||
        !task.title
      ) {
        continue;
      }

      const title = normalize(task.title);
      const date = formatCompletedAt(task.completed_at);

      const existing = map.get(title);

      if (existing) {
        existing.push(date);
      } else {
        map.set(title, [date]);
      }
    }

    datesByTitle = map;

    console.log(
      '[TODO-DATE]',
      tasks.length,
      'tasks loaded'
    );
  }

  function renderRow(row) {
    if (!(row instanceof Element)) return;
    if (!row.matches('.taskItem')) return;

    const titleEl =
      row.querySelector('.taskItem-title');

    if (!titleEl) return;

    const title =
      normalize(titleEl.textContent);

    const matches =
      datesByTitle.get(title);

    const existing =
      row.querySelector(`.${CLASS}`);

    // Don't guess if duplicate completed tasks
    // have exactly the same title.
    if (!matches || matches.length !== 1) {
      existing?.remove();
      return;
    }

    if (existing) {
      if (existing.textContent !== matches[0]) {
        existing.textContent = matches[0];
      }

      return;
    }

    const badge =
      document.createElement('span');

    badge.className = CLASS;
    badge.textContent = matches[0];

    (titleEl.parentElement ?? titleEl)
      .appendChild(badge);
  }

  function renderTree(node) {
    if (!(node instanceof Element)) return;

    if (node.matches('.taskItem')) {
      renderRow(node);
    }

    for (const row of node.querySelectorAll('.taskItem')) {
      renderRow(row);
    }
  }

  function renderAll() {
    for (const row of document.querySelectorAll('.taskItem')) {
      renderRow(row);
    }
  }

  const style =
    document.createElement('style');

  style.textContent = `
    .${CLASS} {
      margin-left: 10px;
      opacity: .6;
      font-size: 11px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
  `;

  document.head.appendChild(style);

  await loadDates();

  // One full scan on startup.
  renderAll();

  // Afterwards process only DOM that Microsoft added.
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        renderTree(node);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  window.__todoDates = {
    async reload() {
      await loadDates();
      renderAll();
    },

    render: renderAll,

    dates() {
      return datesByTitle;
    }
  };
})();
