"use strict";
// sql.js (SQLite compiled to WebAssembly) — runs entirely in the browser.
// Loaded via CDN in index.html before this file.

let _db = null;

// ── Schema ───────────────────────────────────────────────
//   programs : named, user-saved programs
//   runs     : every execution automatically logged
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS programs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL UNIQUE,
    code     TEXT    NOT NULL,
    saved_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT    NOT NULL,
    var_count  INTEGER NOT NULL DEFAULT 0,
    had_errors INTEGER NOT NULL DEFAULT 0,
    ran_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

// ── Init (called once on page load) ──────────────────────
function dbInit() {
  return initSqlJs({
    locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}`
  }).then(SQL => {
    _db = new SQL.Database();
    _db.run(SCHEMA);
    dbRefreshUI();
  }).catch(err => {
    console.error('sql.js failed to load:', err);
    const el = document.getElementById('dbStatus');
    if (el) el.textContent = 'Database unavailable (CDN load failed).';
  });
}

// ── Log a run ─────────────────────────────────────────────
function dbLogRun(code, varCount, hadErrors) {
  if (!_db) return;
  _db.run(
    'INSERT INTO runs (code, var_count, had_errors) VALUES (?, ?, ?)',
    [code, varCount, hadErrors ? 1 : 0]
  );
  _refreshRunHistory();
}

// ── Save / load / delete programs ────────────────────────
function dbSaveProgram(name, code) {
  if (!_db) return;
  if (!name.trim()) { alert('Enter a name for the program.'); return; }
  try {
    _db.run(
      'INSERT OR REPLACE INTO programs (name, code, saved_at) VALUES (?, ?, datetime(\'now\'))',
      [name.trim(), code]
    );
  } catch (e) {
    alert('Save failed: ' + e.message);
    return;
  }
  _refreshSavedPrograms();
}

function dbLoadProgram(id) {
  if (!_db) return;
  const res = _db.exec('SELECT code FROM programs WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return;
  document.getElementById('code').value = res[0].values[0][0];
  run();
}

function dbDeleteProgram(id) {
  if (!_db) return;
  _db.run('DELETE FROM programs WHERE id = ?', [id]);
  _refreshSavedPrograms();
}

// ── Execute arbitrary SQL (SQL console) ──────────────────
function dbExecuteQuery() {
  const sql = document.getElementById('sqlInput').value.trim();
  const out = document.getElementById('sqlResults');
  if (!sql) return;
  if (!_db) { out.textContent = 'Database not ready.'; return; }
  try {
    const results = _db.exec(sql);
    if (!results.length) {
      out.innerHTML = '<em class="muted">Query ran successfully (no rows returned).</em>';
      // Refresh panels in case the query mutated data
      dbRefreshUI();
      return;
    }
    out.innerHTML = results.map(r => _renderTable(r.columns, r.values)).join('<br>');
    dbRefreshUI();
  } catch (e) {
    out.innerHTML = `<span class="db-err">${escHtml(e.message)}</span>`;
  }
}

// ── Internal render helpers ───────────────────────────────
function _renderTable(cols, rows) {
  if (!rows.length)
    return `<em class="muted">(0 rows)</em>`;
  const head = cols.map(c => `<th>${escHtml(String(c))}</th>`).join('');
  const body = rows.map(r =>
    `<tr>${r.map(v => `<td>${escHtml(v === null ? 'NULL' : String(v))}</td>`).join('')}</tr>`
  ).join('');
  return `<table class="db-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function _truncate(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── UI refresh ────────────────────────────────────────────
function dbRefreshUI() {
  _refreshSavedPrograms();
  _refreshRunHistory();
}

function _refreshSavedPrograms() {
  const el = document.getElementById('savedPrograms');
  if (!el || !_db) return;
  const res = _db.exec('SELECT id, name, saved_at FROM programs ORDER BY saved_at DESC');
  if (!res.length || !res[0].values.length) {
    el.innerHTML = '<em class="muted">No saved programs yet.</em>';
    return;
  }
  el.innerHTML = res[0].values.map(([id, name, ts]) =>
    `<div class="db-row">
      <span class="db-prog-name">${escHtml(name)}</span>
      <span class="db-ts">${escHtml(ts)}</span>
      <button class="db-btn" onclick="dbLoadProgram(${id})">Load</button>
      <button class="db-btn db-btn-del" onclick="dbDeleteProgram(${id})">Del</button>
    </div>`
  ).join('');
}

function _refreshRunHistory() {
  const el = document.getElementById('runHistory');
  if (!el || !_db) return;
  const res = _db.exec(
    'SELECT id, code, var_count, had_errors, ran_at FROM runs ORDER BY ran_at DESC LIMIT 20'
  );
  if (!res.length || !res[0].values.length) {
    el.innerHTML = '<em class="muted">No runs logged yet.</em>';
    return;
  }
  el.innerHTML = res[0].values.map(([id, code, vars, errs, ts]) =>
    `<div class="db-row">
      <span class="db-run-id">#${id}</span>
      <span class="db-code-preview">${escHtml(_truncate(code, 38))}</span>
      <span class="db-badge ${errs ? 'db-badge-err' : 'db-badge-ok'}">
        ${errs ? 'errors' : 'ok'}
      </span>
      <span class="db-badge db-badge-vars">${vars} var${vars !== 1 ? 's' : ''}</span>
      <span class="db-ts">${escHtml(ts)}</span>
    </div>`
  ).join('');
}
