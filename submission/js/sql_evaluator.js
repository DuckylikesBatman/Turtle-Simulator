"use strict";
// Depends on: sql_lexer.js, sql_parser.js, database.js (dbGetRaw), main.js (escHtml)

// ═══════════════════════════════════════════════════════════════
//  SQL EVALUATOR (Evaluation for the SQL Interpreter)
//
//  Job: execute a SqlSelectNode AST against the real SQLite database.
//
//  Instead of passing the query directly to SQLite, it:
//    1. Fetches the whole table from SQLite
//    2. Filters rows in JavaScript (WHERE)
//    3. Sorts rows in JavaScript (ORDER BY)
//    4. Limits rows in JavaScript (LIMIT)
//    5. Projects columns in JavaScript (SELECT col1, col2)
//
//  Doing it in JavaScript (not pure SQL) makes every step visible
//  in the pipeline UI — tokens, AST, and evaluated results.
// ═══════════════════════════════════════════════════════════════

// TABLE_SCHEMA — defines the known tables and their column order
// Used to validate column names and build result objects from raw rows
const TABLE_SCHEMA = {
  runs:     ['id', 'code', 'result', 'var_count', 'had_errors', 'ran_at'],
  programs: ['id', 'name', 'code', 'saved_at'],
};

// ── SqlEvaluator ──────────────────────────────────────────────
// Executes a SqlSelectNode against the live SQLite database (_db).
class SqlEvaluator {
  constructor(db) { this._db = db; }

  // _fetchTable — loads all rows from a table as an array of plain objects
  // Each object maps column name → value, e.g. { id: 1, code: "a=5;", ... }
  // Throws if the table name is not in TABLE_SCHEMA (unknown table)
  _fetchTable(name) {
    if (!TABLE_SCHEMA[name])
      throw new SqlError(`Unknown table '${name}'. Available: ${Object.keys(TABLE_SCHEMA).join(', ')}`);
    const res  = this._db.exec(`SELECT * FROM ${name}`); // fetch everything
    const cols = TABLE_SCHEMA[name];
    if (!res.length) return { cols, rows: [] }; // table exists but is empty
    // sql.js returns { columns: [...], values: [[...], [...]] }
    // Convert each value array to a named object for easy column access
    const rows = res[0].values.map(r => {
      const obj = {};
      res[0].columns.forEach((c, i) => { obj[c] = r[i]; });
      return obj;
    });
    return { cols: res[0].columns, rows };
  }

  // _match — tests whether a single row satisfies a WHERE condition node
  // Handles SqlAnd (both sides must match) and SqlCond (single comparison)
  _match(row, node) {
    if (node.type === 'SqlAnd')
      return this._match(row, node.left) && this._match(row, node.right);
    const rowVal = row[node.col];
    if (rowVal === undefined) throw new SqlError(`Unknown column '${node.col}'`);
    const v = node.val; // the value from the WHERE clause
    switch (node.op) {
      // '=' and '!=' do both strict string comparison and loose numeric comparison
      // so "1" = 1 works as expected for integer columns stored as strings
      case '=':  return String(rowVal) === String(v) || rowVal == v;
      case '!=': return String(rowVal) !== String(v) && rowVal != v;
      // Numeric comparisons: both sides are coerced to numbers
      case '>':  return Number(rowVal) >  Number(v);
      case '<':  return Number(rowVal) <  Number(v);
      case '>=': return Number(rowVal) >= Number(v);
      case '<=': return Number(rowVal) <= Number(v);
    }
    return false;
  }

  // eval — the main execution method
  // Takes a SqlSelectNode and returns { columns: string[], rows: any[][] }
  // suitable for rendering as an HTML table.
  eval(ast) {
    // Step 1: fetch all rows from the table
    let { cols: allCols, rows } = this._fetchTable(ast.from);

    // Step 2: apply WHERE filter (if present)
    if (ast.where)   rows = rows.filter(r => this._match(r, ast.where));

    // Step 3: sort rows (if ORDER BY present)
    // Strings are sorted with localeCompare; numbers with subtraction
    if (ast.orderBy) {
      const { col, dir } = ast.orderBy;
      rows.sort((a, b) => {
        const av = a[col], bv = b[col];
        const cmp = isNaN(Number(av))
          ? String(av).localeCompare(String(bv)) // string sort
          : Number(av) - Number(bv);              // numeric sort
        return dir === 'DESC' ? -cmp : cmp;       // reverse for DESC
      });
    }

    // Step 4: apply LIMIT (if present)
    if (ast.limit !== null) rows = rows.slice(0, ast.limit);

    // Step 5: project to requested columns (SELECT * or specific columns)
    const outCols = ast.cols[0] === '*' ? allCols : ast.cols;
    // Validate that every requested column actually exists in the table
    outCols.forEach(c => {
      if (!allCols.includes(c))
        throw new SqlError(`Unknown column '${c}' in table '${ast.from}'`);
    });

    return {
      columns: outCols,
      // Map each row to an ordered array of values for the selected columns
      rows: rows.map(r => outCols.map(c => r[c] !== undefined ? r[c] : null)),
    };
  }
}

// ── UI helpers ────────────────────────────────────────────────

// _sqlTokClass — returns a CSS class for a SQL token badge
// (controls the badge color in the Lexical Analysis panel)
function _sqlTokClass(type) {
  const KW = ['SELECT','FROM','WHERE','ORDER','BY','ASC','DESC','LIMIT','AND','OR'];
  if (KW.includes(type))  return 'tok-sql-keyword';
  if (type === 'IDENT')   return 'tok-sql-ident';
  if (type === 'NUMBER')  return 'tok-sql-number';
  if (type === 'STRING')  return 'tok-sql-string';
  if (type === 'STAR')    return 'tok-sql-star';
  if (type === 'COMMA')   return 'tok-sql-punct';
  return 'tok-sql-op'; // operators: = != > < >= <=
}

// _renderSqlTokens — builds the HTML badge string for the token stream panel
function _renderSqlTokens(tokens) {
  return tokens
    .filter(t => t.type !== SQL_TT.EOF) // hide the EOF token from display
    .map(t => {
      const val = t.value !== null
        ? `<small class="tok-val">${escHtml(String(t.value))}</small>` : '';
      return `<span class="tok ${_sqlTokClass(t.type)}">${t.type}${val}</span>`;
    }).join('');
}

// _renderSqlTable — renders query results as an HTML table
// Shows "(0 rows)" when the result set is empty
function _renderSqlTable(columns, rows) {
  if (!rows.length) return '<em class="muted">(0 rows)</em>';
  const head = columns.map(c => `<th>${escHtml(String(c))}</th>`).join('');
  const body = rows.map(r =>
    `<tr>${r.map(v => `<td>${escHtml(v === null ? 'NULL' : String(v))}</td>`).join('')}</tr>`
  ).join('');
  return `<table class="db-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── runSqlInterp — the "Run" button handler for the SQL section ──
// Runs all 3 SQL pipeline stages and updates the three SQL output panels:
//   Stage 1 → token badges
//   Stage 2 → AST text
//   Stage 3 → results table
function runSqlInterp() {
  const src    = document.getElementById('sqlInterpInput').value.trim();
  const tokOut = document.getElementById('sqlInterpTokens');
  const astOut = document.getElementById('sqlInterpAST');
  const resOut = document.getElementById('sqlInterpResults');

  // Show loading placeholders while processing
  tokOut.innerHTML   = '<em class="muted">…</em>';
  astOut.textContent = '…';
  resOut.innerHTML   = '<em class="muted">…</em>';

  if (!src) return;

  // Stage 1: Lex — tokenize the SQL string
  let tokens;
  try {
    tokens = new SqlLexer(src).tokenize();
  } catch (e) {
    tokOut.innerHTML = `<span class="db-err">${escHtml(e.message)}</span>`;
    return; // stop if lexing fails — can't parse without tokens
  }
  tokOut.innerHTML = _renderSqlTokens(tokens);

  // Stage 2: Parse — build the SQL AST
  let ast;
  try {
    ast = new SqlParser(tokens).parse();
  } catch (e) {
    astOut.textContent = e.message;
    return; // stop if parsing fails — can't evaluate without an AST
  }
  astOut.textContent = prettySqlAST(ast);

  // Stage 3: Evaluate — execute against the live SQLite database
  const db = dbGetRaw(); // get the database instance from database.js
  if (!db) { resOut.innerHTML = '<span class="db-err">Database not ready yet.</span>'; return; }
  try {
    const { columns, rows } = new SqlEvaluator(db).eval(ast);
    resOut.innerHTML = _renderSqlTable(columns, rows);
  } catch (e) {
    resOut.innerHTML = `<span class="db-err">${escHtml(e.message)}</span>`;
  }
}

// ── SQL Examples dropdown ─────────────────────────────────────
// Pre-written example SQL queries shown in the dropdown.
// Selecting one loads it into the SQL textarea and runs it immediately.
const SQL_EXAMPLES = [
  { label: 'All runs (latest first)',
    code:  'SELECT * FROM runs ORDER BY ran_at DESC LIMIT 10' },
  { label: 'Last 5 results',
    code:  'SELECT id, code, result FROM runs ORDER BY ran_at DESC LIMIT 5' },
  { label: 'Clean runs only',
    code:  'SELECT * FROM runs WHERE had_errors = 0 ORDER BY ran_at DESC' },
  { label: 'Runs with errors',
    code:  'SELECT id, code, had_errors FROM runs WHERE had_errors = 1' },
  { label: 'Runs with more than 2 variables',
    code:  'SELECT * FROM runs WHERE var_count > 2' },
  { label: 'Most variables first',
    code:  'SELECT id, code, var_count FROM runs ORDER BY var_count DESC LIMIT 10' },
  { label: 'All saved programs',
    code:  'SELECT * FROM programs ORDER BY saved_at DESC' },
  { label: 'Programs by name',
    code:  'SELECT id, name, saved_at FROM programs ORDER BY name ASC' },
];

// Populate the SQL examples dropdown on page load
(function initSqlExamples() {
  const sel = document.getElementById('sqlExampleSelect');
  SQL_EXAMPLES.forEach((ex, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = ex.label;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', e => {
    if (e.target.value === '') return;
    document.getElementById('sqlInterpInput').value = SQL_EXAMPLES[+e.target.value].code;
    e.target.value = ''; // reset so same option can be selected again
    runSqlInterp();
  });
})();

// Ctrl+Enter (or Cmd+Enter) triggers runSqlInterp() from the SQL textarea
document.getElementById('sqlInterpInput')?.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSqlInterp(); }
});
