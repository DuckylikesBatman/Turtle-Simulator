"use strict";
// sql.js (SQLite compiled to WebAssembly) — runs entirely in the browser.
// Loaded via CDN in index.html before this file.

// ═══════════════════════════════════════════════════════════════
//  DATABASE (SQLite in the browser via sql.js)
//
//  Job: persist programs and run history using a real SQL database
//  that lives entirely in memory in the browser tab.
//
//  Two tables:
//    programs — user-saved programs (name + code)
//    runs     — automatic log of every code execution
//
//  sql.js works by compiling SQLite to WebAssembly.
//  _db is the single database instance used throughout the app.
// ═══════════════════════════════════════════════════════════════

// _db — the active SQLite database instance (null until dbInit() completes)
let _db = null;

// ── Schema ────────────────────────────────────────────────────
// The SQL used to create both tables when the database is first initialized.
// IF NOT EXISTS means it's safe to run this multiple times without error.
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
    result     TEXT    NOT NULL DEFAULT '',
    var_count  INTEGER NOT NULL DEFAULT 0,
    had_errors INTEGER NOT NULL DEFAULT 0,
    ran_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

// ── dbInit — initialize the database on page load ─────────────
// Loads the sql.js WebAssembly module from CDN, creates a new in-memory
// SQLite database, runs the schema SQL to create tables, then refreshes the UI.
// Returns a Promise so callers (main.js) can wait for it before running.
function dbInit() {
  return initSqlJs({
    locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}`
  }).then(SQL => {
    _db = new SQL.Database();   // creates a fresh empty database in memory
    _db.run(SCHEMA);            // create the tables
    dbRefreshUI();              // populate the saved programs and run history panels
  }).catch(err => {
    console.error('sql.js failed to load:', err);
    const el = document.getElementById('dbStatus');
    if (el) el.textContent = 'Database unavailable (CDN load failed).';
  });
}

// ── dbGetRaw — expose the database instance to sql_evaluator.js ──
// The SQL Interpreter needs direct access to run arbitrary SELECT queries.
function dbGetRaw() { return _db; }

// ── dbLogRun — automatically called after every program execution ─
// Inserts a record into the 'runs' table so every execution is tracked.
//   code      — the source code that was run
//   result    — the final variable values as a string (e.g. "a=10  b=5")
//   varCount  — how many variables were assigned
//   hadErrors — true if any parse or runtime errors occurred
function dbLogRun(code, result, varCount, hadErrors) {
  if (!_db) return; // silently skip if database didn't initialize
  _db.run(
    'INSERT INTO runs (code, result, var_count, had_errors) VALUES (?, ?, ?, ?)',
    [code, result || '', varCount, hadErrors ? 1 : 0]
  );
  _refreshRunHistory(); // update the run history panel immediately
}

// ── dbSaveProgram — save or overwrite a named program ────────
// Uses INSERT OR REPLACE so if a program with the same name already
// exists, it gets updated instead of causing a UNIQUE constraint error.
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
  _refreshSavedPrograms(); // re-render the saved programs list
}

// ── dbLoadProgram — load a saved program into the editor ─────
// Fetches the code by program id, puts it in the textarea, and runs it.
function dbLoadProgram(id) {
  if (!_db) return;
  const res = _db.exec('SELECT code FROM programs WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return;
  document.getElementById('code').value = res[0].values[0][0];
  run(); // run the loaded code immediately
}

// ── dbDeleteProgram — delete a saved program by id ───────────
function dbDeleteProgram(id) {
  if (!_db) return;
  _db.run('DELETE FROM programs WHERE id = ?', [id]);
  _refreshSavedPrograms(); // re-render the list
}

// ── _truncate — shortens a string for compact display in the UI ──
// Collapses all whitespace to single spaces first, then trims to n chars.
function _truncate(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── dbRefreshUI — re-render both database panels ──────────────
// Called once on init; also available for manual refresh.
function dbRefreshUI() {
  _refreshSavedPrograms();
  _refreshRunHistory();
}

// ── _refreshSavedPrograms — query and render the saved programs list ──
// Fetches all saved programs ordered by newest first.
// Renders each row with Load and Delete buttons.
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

// ── _refreshRunHistory — query and render the run history list ──
// Shows the 20 most recent runs, newest first.
// Each row shows the code preview, result, error/ok badge, and timestamp.
function _refreshRunHistory() {
  const el = document.getElementById('runHistory');
  if (!el || !_db) return;
  const res = _db.exec(
    'SELECT id, code, result, var_count, had_errors, ran_at FROM runs ORDER BY ran_at DESC LIMIT 20'
  );
  if (!res.length || !res[0].values.length) {
    el.innerHTML = '<em class="muted">No runs logged yet.</em>';
    return;
  }
  el.innerHTML = res[0].values.map(([id, code, result, vars, errs, ts]) =>
    `<div class="db-row">
      <span class="db-run-id">#${id}</span>
      <span class="db-code-preview">${escHtml(_truncate(code, 30))}</span>
      ${result ? `<span class="db-result-preview">${escHtml(_truncate(result, 28))}</span>` : ''}
      <span class="db-badge ${errs ? 'db-badge-err' : 'db-badge-ok'}">
        ${errs ? 'errors' : 'ok'}
      </span>
      <span class="db-badge db-badge-vars">${vars} var${vars !== 1 ? 's' : ''}</span>
      <span class="db-ts">${escHtml(ts)}</span>
    </div>`
  ).join('');
}
