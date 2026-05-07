"use strict";
// Depends on: lexer.js, parser.js, evaluator.js

// ═══════════════════════════════════════════════════════════════
//  MAIN (UI Orchestration)
//
//  Job: wire up the UI — buttons, panels, and the full pipeline.
//  This file calls the Lexer, Parser, and Evaluator in sequence,
//  then renders the results in the correct HTML elements.
// ═══════════════════════════════════════════════════════════════

// ── Built-in example programs ────────────────────────────────
// These populate the "Examples" dropdown. Each has a label (shown
// in the dropdown) and the code that gets loaded into the editor.
const EXAMPLES = [
  { label: 'Basic: assignment + division',
    code:  'a=10; b=5; c= a div b;' },
  { label: 'Grouped expressions',
    code:  'a=4; b=3; c=8; res= (a add b) sub (c div a);' },
  { label: 'All five arithmetic operators',
    code:  'x=10; y=3; s= x add y; d= x sub y; p= x mult y; q= x div y; r= x mod y;' },
  { label: 'Power operator (pow)',
    code:  'base=2; exp=10; result= base pow exp; sq= 5 pow 2;' },
  { label: 'Built-in functions',
    code:  'a= sqrt(144); b= abs(-7); c= floor(3.9); d= ceil(3.1);' },
  { label: 'print( ) output',
    code:  'a=7; b=2; print(a mod b); print(a mult b);' },
  { label: 'Floating point',
    code:  'pi=3.14; r=5.0; area= pi mult (r mult r);' },
  { label: 'Unary minus',
    code:  'a=10; neg= -a; b= neg add 3;' },
  { label: 'Comparisons (gt, lt, eq)',
    code:  'x=10; y=5; big= x gt y; small= x lt y; same= x eq y;' },
  { label: 'if statement',
    code:  'score=85;\nif (score gt 59) {\n  print(score);\n  grade= score div 10;\n}' },
  { label: 'while loop',
    code:  'i=1; total=0;\nwhile (i lt 6) {\n  total= total add i;\n  i= i add 1;\n}\nprint(total);' },
  { label: 'for loop',
    code:  'total=0;\nfor (i = 1 to 5) {\n  total= total add i;\n}\nprint(total);' },
  { label: 'for loop: factorial',
    code:  'n=6; result=1;\nfor (i = 2 to n) {\n  result= result mult i;\n}\nprint(result);' },
  { label: 'Comments (#)',
    code:  '# compute area of a circle\npi=3.14159; r=6;\narea= pi mult (r mult r); # pi*r^2\nprint(area);' },
  { label: 'Error: variable not declared',
    code:  'aa=4; b=5; da=3; ans= bb div aa;' },
  { label: 'Error: divide by zero',
    code:  'a= 10 div 0;' },
  { label: 'Error: system symbol',
    code:  'div=5; b=3;' },
  { label: 'Multi-error recovery',
    code:  'a=5; b= ghost add 1; d= a div 0; e= a add 2;' },
];

// ── Utility helpers ───────────────────────────────────────────

// formatNum — same formatting as Evaluator._fmt; used in the UI for display
function formatNum(v) {
  return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(10)).toString();
}

// escHtml — escapes HTML special characters so user-provided text
// can be injected into innerHTML without risk of XSS
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Token badges ──────────────────────────────────────────────
// renderTokens — renders each token as a colored badge in the token panel.
// Each badge shows the token type, its value (if any), and the column position.
// CSS classes like tok-number, tok-ident etc. provide the different colors.
function renderTokens(tokens) {
  const el = document.getElementById('tokenOut');
  if (!tokens.length) { el.innerHTML = '<em class="muted">No tokens</em>'; return; }
  el.innerHTML = tokens.map(t => {
    const val = t.value !== null
      ? `<small class="tok-val">${escHtml(String(t.value))}</small>` : '';
    const pos = `<small class="tok-pos">@${t.col}</small>`;
    return `<span class="tok tok-${t.type.toLowerCase()}">${t.type}${val}${pos}</span>`;
  }).join('');
}

// ── Error display with source pointer ─────────────────────────
// showErrors — displays error messages with a ^^^ pointer under
// the exact column in the source where the error occurred.
// Works across multi-line source by counting line lengths.
function showErrors(errors, src) {
  if (!errors.length) return;
  const lines = src.split('\n');
  document.getElementById('errOut').innerHTML = errors.map(e => {
    let html = `<div class="err-msg">${escHtml(e.message)}</div>`;
    if (e.col !== undefined) {
      // Find which line contains the error column
      let remaining = e.col, lineIdx = 0, lineStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) { lineIdx = i; break; }
        remaining  -= lines[i].length + 1; // +1 for the newline character
        lineStart  += lines[i].length + 1;
        lineIdx = i + 1;
      }
      const col = Math.max(0, e.col - lineStart);
      const ptr = ' '.repeat(col) + '^^^'; // pointer arrows under the bad token
      html += `<pre class="err-ptr">${escHtml(lines[lineIdx] || '')}\n${ptr}</pre>`;
    }
    return `<div class="err-block">${html}</div>`;
  }).join('');
}

// ── Output panel helpers ──────────────────────────────────────

// updateVarsPanel — renders the symbol table (all assigned variables and their values)
function updateVarsPanel(env) {
  const el   = document.getElementById('varsOut');
  const keys = Object.keys(env);
  if (!keys.length) { el.innerHTML = '<em class="muted">No variables</em>'; return; }
  el.innerHTML = keys.map(k =>
    `<div class="var-row">
      <span class="var-name">${escHtml(k)}</span>
      <span class="var-eq">=</span>
      <span class="var-val">${formatNum(env[k])}</span>
    </div>`
  ).join('');
}

// showResult — shows a compact summary line of all variables, e.g. "a=10  b=5  c=2"
function showResult(env) {
  const keys = Object.keys(env);
  if (!keys.length) return;
  document.getElementById('resultOut').textContent =
    keys.map(k => `${k}=${formatNum(env[k])}`).join('    ');
}

// showPrints — renders the output of all print() statements
function showPrints(prints) {
  const el = document.getElementById('printOut');
  if (!prints || !prints.length) { el.innerHTML = ''; return; }
  el.innerHTML =
    '<div class="print-header">Console output (print statements):</div>' +
    prints.map(v => `<div class="print-line">&gt;&nbsp;${escHtml(v)}</div>`).join('');
}

// clearOutput — resets every output panel back to its placeholder state
function clearOutput() {
  document.getElementById('errOut').innerHTML      = '';
  document.getElementById('printOut').innerHTML    = '';
  document.getElementById('resultOut').textContent = '';
  document.getElementById('tokenOut').innerHTML    =
    '<em class="muted">Click "Tokens", "Run", or use Step mode</em>';
  document.getElementById('astOut').textContent    = '';
  document.getElementById('astTreeOut').innerHTML  = '';
  document.getElementById('traceOut').textContent  = '';
  document.getElementById('varsOut').innerHTML      = '<em class="muted">No variables</em>';
  document.getElementById('stmtLabel').textContent  = '';
}

// ═════════════════════════════════════════════════════════
//  VISUAL AST — SVG tree diagram
//
//  Converts the AST into a graphical tree using SVG rectangles
//  and lines.  Two-pass layout:
//    Pass 1 (measure): compute the width each subtree needs (bottom-up)
//    Pass 2 (place):   assign (x, y) coordinates to each node (top-down)
// ═════════════════════════════════════════════════════════

// _astChildren — returns the child nodes for a given AST node
// (defines which nodes are connected by edges in the visual diagram)
function _astChildren(n) {
  switch (n.type) {
    case 'Program': return n.stmts;
    case 'Assign':  return [n.expr];
    case 'Print':   return [n.expr];
    case 'BinOp':   return [n.left, n.right];
    case 'Unary':   return [n.operand];
    case 'Builtin': return [n.arg];
    case 'If':      return [n.cond, ...n.body];
    case 'While':   return [n.cond, ...n.body];
    case 'For':     return [n.start, n.end, ...n.body];
    default:        return [];
  }
}

// _astLabel — returns the short text label shown inside each SVG rectangle
function _astLabel(n) {
  let s;
  switch (n.type) {
    case 'Program': s = 'Program'; break;
    case 'Assign':  s = `= ${n.name}`; break;
    case 'Print':   s = 'print'; break;
    case 'BinOp':   s = n.op; break;
    case 'Unary':   s = 'neg (−)'; break;
    case 'Builtin': s = n.fn; break;
    case 'If':      s = 'if'; break;
    case 'While':   s = 'while'; break;
    case 'For':     s = `for ${n.varName}`; break;
    case 'Ident':   s = n.name; break;
    case 'Number':  s = String(n.value); break;
    default:        s = n.type; break;
  }
  return s.length > 11 ? s.slice(0, 10) + '…' : s; // truncate long labels
}

// _astClass — returns the CSS class for a node rectangle (controls its color)
function _astClass(n) {
  const map = {
    Program:'anprog', Assign:'anass',  Print:'anprint',
    BinOp:'anbin',    Unary:'anun',    Ident:'anid',
    Number:'annum',   Builtin:'anblt', If:'anif', While:'anwhile', For:'anfor',
  };
  return map[n.type] || 'anoth';
}

// buildASTSVG — builds a full SVG element string for the visual tree
// NW/NH = node width/height, HGAP = horizontal gap, VGAP = vertical gap, PAD = padding
function buildASTSVG(root) {
  const NW = 84, NH = 34, HGAP = 22, VGAP = 56, PAD = 28;

  // Pass 1: measure — recursively computes how wide each subtree needs to be.
  // Leaf nodes need exactly NW pixels. Parent nodes need the sum of children widths + gaps.
  function measure(n) {
    const ch = _astChildren(n);
    if (!ch.length) { n._w = NW; return NW; }
    const total = ch.reduce((s, c) => s + measure(c), 0) + HGAP * (ch.length - 1);
    n._w = Math.max(NW, total);
    return n._w;
  }

  // Pass 2: place — assigns (x, y) pixel coordinates to every node.
  // cx = center x of the node, y = top y of the node row
  function place(n, cx, y) {
    n._x = cx; n._y = y;
    const ch = _astChildren(n);
    if (!ch.length) return;
    let x = cx - n._w / 2; // start from left edge of this node's allocated space
    ch.forEach(c => { place(c, x + c._w / 2, y + NH + VGAP); x += c._w + HGAP; });
  }

  measure(root);
  place(root, root._w / 2 + PAD, PAD + NH / 2);

  // Collect all nodes and edges into flat arrays for rendering
  const allN = [], allE = [];
  (function collect(n) {
    allN.push(n);
    _astChildren(n).forEach(c => { allE.push([n, c]); collect(c); });
  })(root);

  const svgW = root._w + PAD * 2;
  const svgH = Math.max(...allN.map(n => n._y)) + NH / 2 + PAD;

  // Render edges (lines from parent bottom to child top)
  const edges = allE.map(([p, c]) =>
    `<line x1="${p._x}" y1="${p._y + NH/2}" x2="${c._x}" y2="${c._y - NH/2}" class="ast-edge"/>`
  ).join('');

  // Render nodes (rectangles with text labels)
  const nodes = allN.map(n => {
    const lbl = _astLabel(n);
    return `<g class="ast-node ${_astClass(n)}" transform="translate(${n._x},${n._y})">
      <rect x="${-NW/2}" y="${-NH/2}" width="${NW}" height="${NH}" rx="7"/>
      <text dominant-baseline="middle" text-anchor="middle"
            font-size="11" font-family="Courier New,monospace">${escHtml(lbl)}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}"
               class="ast-svg" xmlns="http://www.w3.org/2000/svg">
    <g>${edges}</g>
    <g>${nodes}</g>
  </svg>`;
}

// ── AST view toggle (text ↔ visual) ──────────────────────────
// _astMode tracks which view is active; _lastAST caches the last parsed tree
// so switching modes doesn't need to re-run the parser
let _astMode = 'text';
let _lastAST  = null;

// switchAST — called by the Text / Visual toggle buttons in the AST panel
function switchAST(mode) {
  _astMode = mode;
  document.getElementById('astTextBtn').classList.toggle('active', mode === 'text');
  document.getElementById('astTreeBtn').classList.toggle('active', mode === 'tree');
  document.getElementById('astOut').style.display     = mode === 'text' ? '' : 'none';
  document.getElementById('astTreeOut').style.display = mode === 'tree' ? '' : 'none';
  if (mode === 'tree' && _lastAST)
    document.getElementById('astTreeOut').innerHTML = buildASTSVG(_lastAST);
}

// _displayAST — renders the AST in both the text panel and the SVG panel
function _displayAST(ast) {
  _lastAST = ast;
  document.getElementById('astOut').textContent = prettyAST(ast);
  if (_astMode === 'tree')
    document.getElementById('astTreeOut').innerHTML = buildASTSVG(ast);
}

// ═════════════════════════════════════════════════════════
//  RUN MODE — execute the whole program at once
// ═════════════════════════════════════════════════════════

// run — the main "Run" button handler
// Runs all 3 pipeline stages in sequence and updates all output panels
function run() {
  _exitStep(); // exit step mode if active
  clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;

  // Stage 1: Lex — convert source text to tokens
  let tokens;
  try { tokens = new Lexer(src).tokenize(); }
  catch (e) { showErrors([e], src); return; }
  renderTokens(tokens.filter(t => t.type !== TT.EOF)); // skip the EOF token in display

  // Stage 2: Parse — convert tokens to AST
  const ast = new Parser(tokens).parse();
  _displayAST(ast);

  // Stage 3: Evaluate — walk the AST and compute values
  const ev = new Evaluator();
  ev.eval(ast);

  // Display all results (parse errors + runtime errors combined)
  const allErrors = [...ast.parseErrors, ...ev.errors];
  document.getElementById('traceOut').textContent = ev.trace.join('\n');
  if (allErrors.length) showErrors(allErrors, src);
  showPrints(ev.prints);
  showResult(ev.env);
  updateVarsPanel(ev.env);

  // Log the run to the SQLite database automatically
  const resultStr = Object.keys(ev.env).map(k => `${k}=${formatNum(ev.env[k])}`).join('  ');
  dbLogRun(src, resultStr, Object.keys(ev.env).length, allErrors.length > 0);
}

// showTokens — runs only Stage 1 and displays the token stream
function showTokens() {
  _exitStep(); clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  try { renderTokens(new Lexer(src).tokenize().filter(t => t.type !== TT.EOF)); }
  catch (e) { showErrors([e], src); }
}

// showAST — runs Stages 1 and 2 and displays the AST (without evaluating)
function showAST() {
  _exitStep(); clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  try {
    const tokens = new Lexer(src).tokenize();
    const ast    = new Parser(tokens).parse();
    _displayAST(ast);
    if (ast.parseErrors.length) showErrors(ast.parseErrors, src);
  } catch (e) { showErrors([e], src); }
}

// ═════════════════════════════════════════════════════════
//  STEP MODE — execute one statement at a time
//
//  Lets you walk through the program manually, seeing the
//  tokens, AST, and trace for each individual statement.
//  Variables accumulate across steps using a shared Evaluator.
// ═════════════════════════════════════════════════════════

// State for step mode
let _stepStmts = []; // the list of top-level statements (from the parse)
let _stepIdx   = 0;  // index of the next statement to execute
let _stepEv    = null; // the persistent Evaluator (env carries over between steps)
let _stepping  = false; // whether step mode is currently active
let _stepAST   = null; // full ProgramNode — Visual tab always shows the complete tree

// doStep — called by the "Step" button
// First call: parses the program and initializes step mode
// Subsequent calls: execute the next statement
function doStep() {
  if (!_stepping) {
    // First press — parse the whole program and enter step mode
    const src = document.getElementById('code').value.trim();
    if (!src) return;
    clearOutput();
    let tokens;
    try { tokens = new Lexer(src).tokenize(); }
    catch (e) { showErrors([e], src); return; }
    const ast = new Parser(tokens).parse();
    if (ast.parseErrors.length) showErrors(ast.parseErrors, src);
    _stepStmts = ast.stmts;
    if (!_stepStmts.length) return;
    _stepAST  = ast;  // store the full tree so Visual always shows all statements
    _stepIdx  = 0;
    _stepEv   = new Evaluator(); // shared across all steps so env persists
    _stepping = true;
    document.getElementById('resetStepBtn').disabled = false;
    _updateStep();
  }

  if (_stepIdx >= _stepStmts.length) { _updateStep(); return; }

  clearOutput();
  const stmt    = _stepStmts[_stepIdx];
  const stmtSrc = nodeToSrc(stmt); // convert the single AST node back to source text

  try {
    // Tokens: show only the current statement's tokens
    renderTokens(new Lexer(stmtSrc).tokenize().filter(t => t.type !== TT.EOF));
    // Text AST: shows only the current statement for focused step-by-step reading
    // Visual AST: always shows the full program tree
    _displayAST(stmt);
    if (_astMode === 'tree' && _stepAST) {
      document.getElementById('astTreeOut').innerHTML = buildASTSVG(_stepAST);
      _lastAST = _stepAST;
    }
    // Execute only this statement (trace and prints reset each step)
    _stepEv.clearTrace();
    _stepEv.prints = [];
    _stepEv.eval(stmt);
    document.getElementById('traceOut').textContent = _stepEv.trace.join('\n');
    showPrints(_stepEv.prints);
    showResult(_stepEv.env);   // show accumulated variables so far
    updateVarsPanel(_stepEv.env);
  } catch (e) {
    showErrors([e], stmtSrc);
  }

  _stepIdx++;
  _updateStep(); // update button label and step counter
}

// resetStep — exits step mode and clears all output
function resetStep() { _exitStep(); clearOutput(); }

// _exitStep — internal: resets all step-mode state variables
function _exitStep() {
  _stepping = false; _stepStmts = []; _stepIdx = 0; _stepEv = null; _stepAST = null;
  _updateStep();
}

// _updateStep — updates the Step button label and the status line
// to show which statement comes next
function _updateStep() {
  const lbl = document.getElementById('stmtLabel');
  const btn = document.getElementById('stepBtn');
  const rst = document.getElementById('resetStepBtn');
  if (!_stepping) {
    lbl.textContent = ''; btn.textContent = '⏭ Step';
    btn.disabled = false; rst.disabled = true; return;
  }
  if (_stepIdx >= _stepStmts.length) {
    lbl.textContent = `✓ Done — all ${_stepStmts.length} statements executed.`;
    btn.textContent = 'Done ✓'; btn.disabled = true;
  } else {
    btn.textContent = 'Next ▶'; btn.disabled = false;
    lbl.textContent =
      `Next → Statement ${_stepIdx + 1} / ${_stepStmts.length}: ${nodeToSrc(_stepStmts[_stepIdx])}`;
  }
  rst.disabled = false;
}

// ── Examples dropdown ─────────────────────────────────────────
// Populates the select element with example programs on page load.
// Selecting an example loads its code into the editor and runs it immediately.
(function initExamples() {
  const sel = document.getElementById('exampleSelect');
  EXAMPLES.forEach((ex, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = ex.label;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', e => {
    if (e.target.value === '') return;
    document.getElementById('code').value = EXAMPLES[+e.target.value].code;
    e.target.value = ''; // reset dropdown so the same option can be selected again
    run();
  });
})();

// Ctrl+Enter (or Cmd+Enter on Mac) triggers run() from the code textarea
document.getElementById('code').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});

// ── DB save from UI ───────────────────────────────────────────
// dbSaveCurrent — reads the program name field and calls the database save function
function dbSaveCurrent() {
  const name = document.getElementById('progName').value;
  const code = document.getElementById('code').value.trim();
  if (!code) return;
  dbSaveProgram(name, code);
  document.getElementById('progName').value = '';
}

// Allow pressing Enter in the program name field to save instead of clicking the button
document.getElementById('progName')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); dbSaveCurrent(); }
});

// ── Page initialization ───────────────────────────────────────
// On load: disable reset button (not in step mode yet), load the first example,
// initialize the database, then run immediately to show a result right away.
document.getElementById('resetStepBtn').disabled = true;
document.getElementById('code').value = EXAMPLES[0].code;
dbInit().then(() => run()).catch(() => run()); // run() even if DB fails to load
