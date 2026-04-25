"use strict";
// Depends on: lexer.js, parser.js, evaluator.js, optimizer.js

// ── Examples ──────────────────────────────────────────────
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
  { label: 'Comments (#)',
    code:  '# compute area of a circle\npi=3.14159; r=6;\narea= pi mult (r mult r); # pi*r^2\nprint(area);' },
  { label: 'Constant folding demo',
    code:  '# these sub-expressions are all literals — the optimizer pre-computes them\na= (3 add 4) mult 2;   # optimizer: (3+4)=7 then 7*2=14\nb= sqrt(9) add 1;      # optimizer: sqrt(9)=3 then 3+1=4\nc= 2 pow 8;            # optimizer: 256' },
  { label: 'Error: variable not declared',
    code:  'aa=4; b=5; da=3; ans= bb div aa;' },
  { label: 'Error: divide by zero',
    code:  'a= 10 div 0;' },
  { label: 'Error: system symbol',
    code:  'div=5; b=3;' },
  { label: 'Multi-error recovery',
    code:  'a=5; b= ghost add 1; d= a div 0; e= a add 2;' },
];

// ── Utilities ─────────────────────────────────────────────
function formatNum(v) {
  return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(10)).toString();
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Token badges ──────────────────────────────────────────
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

// ── Error display with source pointer ─────────────────────
function showErrors(errors, src) {
  if (!errors.length) return;
  const lines = src.split('\n');
  document.getElementById('errOut').innerHTML = errors.map(e => {
    let html = `<div class="err-msg">${escHtml(e.message)}</div>`;
    if (e.col !== undefined) {
      let remaining = e.col, lineIdx = 0, lineStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) { lineIdx = i; break; }
        remaining  -= lines[i].length + 1;
        lineStart  += lines[i].length + 1;
        lineIdx = i + 1;
      }
      const col = Math.max(0, e.col - lineStart);
      const ptr = ' '.repeat(col) + '^^^';
      html += `<pre class="err-ptr">${escHtml(lines[lineIdx] || '')}\n${ptr}</pre>`;
    }
    return `<div class="err-block">${html}</div>`;
  }).join('');
}

// ── Panel helpers ─────────────────────────────────────────
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

function showResult(env) {
  const keys = Object.keys(env);
  if (!keys.length) return;
  document.getElementById('resultOut').textContent =
    keys.map(k => `${k}=${formatNum(env[k])}`).join('    ');
}

function showPrints(prints) {
  const el = document.getElementById('printOut');
  if (!prints || !prints.length) { el.innerHTML = ''; return; }
  el.innerHTML =
    '<div class="print-header">Console output (print statements):</div>' +
    prints.map(v => `<div class="print-line">&gt;&nbsp;${escHtml(v)}</div>`).join('');
}

function showOptimizer(original, optimized, foldCount) {
  const summary    = document.getElementById('optSummary');
  const beforeEl   = document.getElementById('optBefore');
  const afterEl    = document.getElementById('optAfter');
  const beforeBtn  = document.getElementById('optBeforeBtn');
  const afterBtn   = document.getElementById('optAfterBtn');

  if (foldCount === 0) {
    summary.textContent     = 'No constant sub-expressions found — AST unchanged.';
    beforeEl.style.display  = 'none';
    afterEl.style.display   = 'none';
    beforeBtn.style.display = 'none';
    afterBtn.style.display  = 'none';
  } else {
    summary.textContent     = `${foldCount} constant sub-expression${foldCount > 1 ? 's' : ''} folded.`;
    beforeBtn.style.display = '';
    afterBtn.style.display  = '';
    beforeEl.textContent    = prettyAST(original);
    afterEl.textContent     = prettyAST(optimized);
    switchOpt(_optMode);
  }
}

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
  document.getElementById('optSummary').textContent = '';
  document.getElementById('optBefore').textContent   = '';
  document.getElementById('optAfter').textContent    = '';
  document.getElementById('optBefore').style.display  = 'none';
  document.getElementById('optAfter').style.display   = 'none';
  document.getElementById('optBeforeBtn').style.display = '';
  document.getElementById('optAfterBtn').style.display  = '';
  document.getElementById('optBeforeBtn').classList.remove('active');
  document.getElementById('optAfterBtn').classList.add('active');
  _optMode = 'after';
  document.getElementById('stmtLabel').textContent  = '';
}

// ═════════════════════════════════════════════════════════
//  VISUAL AST  –  SVG tree diagram
// ═════════════════════════════════════════════════════════
function _astChildren(n) {
  switch (n.type) {
    case 'Program': return n.stmts;
    case 'Assign':  return [n.expr];
    case 'Print':   return [n.expr];
    case 'BinOp':   return [n.left, n.right];
    case 'Unary':   return [n.operand];
    case 'Builtin': return [n.arg];
    case 'If':      return [n.cond, ...n.body];
    default:        return [];
  }
}

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
    case 'Ident':   s = n.name; break;
    case 'Number':  s = String(n.value); break;
    default:        s = n.type; break;
  }
  return s.length > 11 ? s.slice(0, 10) + '…' : s;
}

function _astClass(n) {
  const map = {
    Program:'anprog', Assign:'anass',  Print:'anprint',
    BinOp:'anbin',    Unary:'anun',    Ident:'anid',
    Number:'annum',   Builtin:'anblt', If:'anif',
  };
  return map[n.type] || 'anoth';
}

function buildASTSVG(root) {
  const NW = 84, NH = 34, HGAP = 22, VGAP = 56, PAD = 28;

  function measure(n) {
    const ch = _astChildren(n);
    if (!ch.length) { n._w = NW; return NW; }
    const total = ch.reduce((s, c) => s + measure(c), 0) + HGAP * (ch.length - 1);
    n._w = Math.max(NW, total);
    return n._w;
  }

  function place(n, cx, y) {
    n._x = cx; n._y = y;
    const ch = _astChildren(n);
    if (!ch.length) return;
    let x = cx - n._w / 2;
    ch.forEach(c => { place(c, x + c._w / 2, y + NH + VGAP); x += c._w + HGAP; });
  }

  measure(root);
  place(root, root._w / 2 + PAD, PAD + NH / 2);

  const allN = [], allE = [];
  (function collect(n) {
    allN.push(n);
    _astChildren(n).forEach(c => { allE.push([n, c]); collect(c); });
  })(root);

  const svgW = root._w + PAD * 2;
  const svgH = Math.max(...allN.map(n => n._y)) + NH / 2 + PAD;

  const edges = allE.map(([p, c]) =>
    `<line x1="${p._x}" y1="${p._y + NH/2}" x2="${c._x}" y2="${c._y - NH/2}" class="ast-edge"/>`
  ).join('');

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

// AST view toggle (text ↔ visual)
let _astMode = 'text';
let _lastAST  = null;

function switchAST(mode) {
  _astMode = mode;
  document.getElementById('astTextBtn').classList.toggle('active', mode === 'text');
  document.getElementById('astTreeBtn').classList.toggle('active', mode === 'tree');
  document.getElementById('astOut').style.display     = mode === 'text' ? '' : 'none';
  document.getElementById('astTreeOut').style.display = mode === 'tree' ? '' : 'none';
  if (mode === 'tree' && _lastAST)
    document.getElementById('astTreeOut').innerHTML = buildASTSVG(_lastAST);
}

function _displayAST(ast) {
  _lastAST = ast;
  document.getElementById('astOut').textContent = prettyAST(ast);
  if (_astMode === 'tree')
    document.getElementById('astTreeOut').innerHTML = buildASTSVG(ast);
}

// ── Optimizer view toggle (before ↔ after) ────────────────
let _optMode = 'after';
function switchOpt(mode) {
  _optMode = mode;
  document.getElementById('optBeforeBtn').classList.toggle('active', mode === 'before');
  document.getElementById('optAfterBtn').classList.toggle('active',  mode === 'after');
  document.getElementById('optBefore').style.display = mode === 'before' ? '' : 'none';
  document.getElementById('optAfter').style.display  = mode === 'after'  ? '' : 'none';
}

// ═════════════════════════════════════════════════════════
//  RUN MODE  –  execute everything at once
// ═════════════════════════════════════════════════════════
function run() {
  _exitStep();
  clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;

  // Stage 1: Lex
  let tokens;
  try { tokens = new Lexer(src).tokenize(); }
  catch (e) { showErrors([e], src); return; }
  renderTokens(tokens.filter(t => t.type !== TT.EOF));

  // Stage 2: Parse
  const ast = new Parser(tokens).parse();
  _displayAST(ast);

  // Stage 3: Optimize
  const opt    = new Optimizer();
  const optAst = opt.fold(ast);
  showOptimizer(ast, optAst, opt.foldCount);

  // Stage 4: Evaluate optimized AST
  const ev = new Evaluator();
  ev.eval(optAst);

  const allErrors = [...ast.parseErrors, ...ev.errors];
  document.getElementById('traceOut').textContent = ev.trace.join('\n');
  if (allErrors.length) showErrors(allErrors, src);
  showPrints(ev.prints);
  showResult(ev.env);
  updateVarsPanel(ev.env);
  dbLogRun(src, Object.keys(ev.env).length, allErrors.length > 0);
}

function showTokens() {
  _exitStep(); clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  try { renderTokens(new Lexer(src).tokenize().filter(t => t.type !== TT.EOF)); }
  catch (e) { showErrors([e], src); }
}

function showAST() {
  _exitStep(); clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  try {
    const tokens = new Lexer(src).tokenize();
    const ast    = new Parser(tokens).parse();
    _displayAST(ast);
    const opt    = new Optimizer();
    const optAst = opt.fold(ast);
    showOptimizer(ast, optAst, opt.foldCount);
    if (ast.parseErrors.length) showErrors(ast.parseErrors, src);
  } catch (e) { showErrors([e], src); }
}

// ═════════════════════════════════════════════════════════
//  STEP MODE  –  one statement at a time
// ═════════════════════════════════════════════════════════
let _stepStmts = [], _stepIdx = 0, _stepEv = null, _stepping = false;

function doStep() {
  if (!_stepping) {
    const src = document.getElementById('code').value.trim();
    if (!src) return;
    clearOutput();
    let tokens;
    try { tokens = new Lexer(src).tokenize(); }
    catch (e) { showErrors([e], src); return; }
    const ast = new Parser(tokens).parse();
    if (ast.parseErrors.length) showErrors(ast.parseErrors, src);
    // Optimize the whole program before stepping
    const optAst = new Optimizer().fold(ast);
    _stepStmts = optAst.stmts;
    if (!_stepStmts.length) return;
    _stepIdx  = 0;
    _stepEv   = new Evaluator();
    _stepping = true;
    document.getElementById('resetStepBtn').disabled = false;
    _updateStep();
  }

  if (_stepIdx >= _stepStmts.length) { _updateStep(); return; }

  clearOutput();
  const stmt    = _stepStmts[_stepIdx];
  const stmtSrc = nodeToSrc(stmt);

  try {
    renderTokens(new Lexer(stmtSrc).tokenize().filter(t => t.type !== TT.EOF));
    _displayAST(stmt);
    _stepEv.clearTrace();
    _stepEv.prints = [];
    _stepEv.eval(stmt);
    document.getElementById('traceOut').textContent = _stepEv.trace.join('\n');
    showPrints(_stepEv.prints);
    showResult(_stepEv.env);
    updateVarsPanel(_stepEv.env);
  } catch (e) {
    showErrors([e], stmtSrc);
  }

  _stepIdx++;
  _updateStep();
}

function resetStep() { _exitStep(); clearOutput(); }

function _exitStep() {
  _stepping = false; _stepStmts = []; _stepIdx = 0; _stepEv = null;
  _updateStep();
}

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

// ── Examples dropdown ─────────────────────────────────────
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
    e.target.value = '';
    run();
  });
})();

document.getElementById('code').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});

// ── DB: save program from UI ──────────────────────────────
function dbSaveCurrent() {
  const name = document.getElementById('progName').value;
  const code = document.getElementById('code').value.trim();
  if (!code) return;
  dbSaveProgram(name, code);
  document.getElementById('progName').value = '';
}

// allow Enter in the program-name field to save
document.getElementById('progName')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); dbSaveCurrent(); }
});

// SQL console Enter = execute
document.getElementById('sqlInput')?.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); dbExecuteQuery(); }
});

// ── Init ──────────────────────────────────────────────────
document.getElementById('resetStepBtn').disabled = true;
switchOpt('after');
document.getElementById('code').value = EXAMPLES[0].code;
dbInit().then(() => run()).catch(() => run());
