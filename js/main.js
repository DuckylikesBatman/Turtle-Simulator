"use strict";
// Depends on: lexer.js, parser.js, evaluator.js

// ── Example programs ─────────────────────────────────────
const EXAMPLES = [
  { label: 'Basic assignment + division',
    code:  'a=10; b=5; c= a div b;' },
  { label: 'Grouped expressions',
    code:  'a=4; b=3; c=8; res= (a add b) sub (c div a);' },
  { label: 'All four operators',
    code:  'x=10; y=3; s= x add y; d= x sub y; p= x mult y; q= x div y;' },
  { label: 'Floating point',
    code:  'pi=3.14; r=5.0; area= pi mult (r mult r);' },
  { label: 'Unary minus (negative values)',
    code:  'a=10; neg= -a; b= neg add 3;' },
  { label: 'Error: variable not declared',
    code:  'aa=4; b=5; da=3; ans= bb div aa;' },
  { label: 'Error: divide by zero',
    code:  'a= 10 div 0;' },
  { label: 'Error: system symbol as variable',
    code:  'div=5; b=3;' },
];

// ── Format a number for display ──────────────────────────
function formatNum(v) {
  if (Number.isInteger(v)) return String(v);
  return parseFloat(v.toFixed(10)).toString();
}

// ── Render token badges ──────────────────────────────────
function renderTokens(tokens) {
  const el = document.getElementById('tokenOut');
  el.innerHTML = tokens.map(t => {
    const val = t.value !== null ? `<small class="tok-val">${t.value}</small>` : '';
    const pos = `<small class="tok-pos">@${t.col}</small>`;
    return `<span class="tok tok-${t.type.toLowerCase()}">${t.type}${val}${pos}</span>`;
  }).join('');
}

// ── Update symbol-table panel ────────────────────────────
function updateVarsPanel(env) {
  const el   = document.getElementById('varsOut');
  const keys = Object.keys(env);
  if (!keys.length) { el.innerHTML = '<em class="muted">No variables</em>'; return; }
  el.innerHTML = keys.map(k =>
    `<div class="var-row">
      <span class="var-name">${k}</span>
      <span class="var-eq">=</span>
      <span class="var-val">${formatNum(env[k])}</span>
    </div>`
  ).join('');
}

// ── Show result in teacher's expected format ─────────────
function showResult(env) {
  const keys = Object.keys(env);
  if (!keys.length) return;
  const line = keys.map(k => `${k}=${formatNum(env[k])}`).join('    ');
  document.getElementById('resultOut').textContent = line;
}

// ── Clear all output panels ──────────────────────────────
function clearOutput() {
  document.getElementById('errOut').textContent    = '';
  document.getElementById('resultOut').textContent = '';
  document.getElementById('tokenOut').innerHTML    = '<em class="muted">Click "Tokens" or use Step mode</em>';
  document.getElementById('astOut').textContent    = '';
  document.getElementById('traceOut').textContent  = '';
  document.getElementById('varsOut').innerHTML     = '<em class="muted">No variables</em>';
  document.getElementById('stmtLabel').textContent = '';
}

// ════════════════════════════════════════════════════════
//  RUN MODE  –  execute everything at once
// ════════════════════════════════════════════════════════
function run() {
  exitStepMode();
  clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  try {
    const tokens = new Lexer(src).tokenize();
    const ast    = new Parser(tokens).parse();
    const ev     = new Evaluator();
    ev.eval(ast);

    // Stage 1: show all tokens
    renderTokens(tokens.filter(t => t.type !== TT.EOF));
    // Stage 2: show full AST
    document.getElementById('astOut').textContent = prettyAST(ast);
    // Stage 3: show evaluation trace
    document.getElementById('traceOut').textContent = ev.trace.join('\n');

    showResult(ev.env);
    updateVarsPanel(ev.env);
  } catch (e) {
    document.getElementById('errOut').textContent = e.message;
  }
}

// ── Show Tokens only ─────────────────────────────────────
function showTokens() {
  exitStepMode();
  clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  try {
    renderTokens(new Lexer(src).tokenize().filter(t => t.type !== TT.EOF));
  } catch (e) {
    document.getElementById('errOut').textContent = e.message;
  }
}

// ── Show AST only ────────────────────────────────────────
function showAST() {
  exitStepMode();
  clearOutput();
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  try {
    const ast = new Parser(new Lexer(src).tokenize()).parse();
    document.getElementById('astOut').textContent = prettyAST(ast);
  } catch (e) {
    document.getElementById('errOut').textContent = e.message;
  }
}

// ════════════════════════════════════════════════════════
//  STEP MODE  –  one statement at a time
// ════════════════════════════════════════════════════════
let stepStmts = [];   // parsed statement list
let stepIdx   = 0;    // index of NEXT statement to execute
let stepEv    = null; // evaluator that persists across steps
let stepping  = false;

function startStepMode() {
  const src = document.getElementById('code').value.trim();
  if (!src) return;
  clearOutput();
  try {
    const tokens = new Lexer(src).tokenize();
    const ast    = new Parser(tokens).parse();
    stepStmts = ast.stmts;
    stepIdx   = 0;
    stepEv    = new Evaluator();
    stepping  = true;
    document.getElementById('resetStepBtn').disabled = false;
    updateStepStatus();
  } catch (e) {
    document.getElementById('errOut').textContent = e.message;
  }
}

function doStep() {
  if (!stepping) { startStepMode(); if (!stepping) return; }
  if (stepIdx >= stepStmts.length) {
    document.getElementById('stmtLabel').textContent = 'All statements executed.';
    return;
  }

  clearOutput();
  const stmt = stepStmts[stepIdx];
  stepIdx++;

  try {
    // Stage 1: tokenize THIS statement's source (reconstructed from AST)
    const stmtSrc    = nodeToSrc(stmt);
    const stmtTokens = new Lexer(stmtSrc).tokenize().filter(t => t.type !== TT.EOF);
    renderTokens(stmtTokens);

    // Stage 2: AST for THIS statement
    document.getElementById('astOut').textContent = prettyAST(stmt);

    // Stage 3: evaluate and collect trace for THIS statement
    stepEv.clearTrace();
    stepEv.eval(stmt);
    document.getElementById('traceOut').textContent = stepEv.trace.join('\n');

    showResult(stepEv.env);
    updateVarsPanel(stepEv.env);
    updateStepStatus();
  } catch (e) {
    document.getElementById('errOut').textContent = e.message;
    stepping = false;
    updateStepStatus();
  }
}

function resetStep() {
  exitStepMode();
  clearOutput();
}

function exitStepMode() {
  stepping  = false;
  stepStmts = [];
  stepIdx   = 0;
  stepEv    = null;
  updateStepStatus();
}

function updateStepStatus() {
  const label = document.getElementById('stmtLabel');
  const btn   = document.getElementById('stepBtn');
  const rst   = document.getElementById('resetStepBtn');

  if (!stepping) {
    label.textContent    = '';
    btn.textContent      = '⏭ Step';
    rst.disabled         = true;
    return;
  }

  if (stepIdx > stepStmts.length) {
    label.textContent = `Done (${stepStmts.length}/${stepStmts.length})`;
  } else {
    const curr = Math.min(stepIdx, stepStmts.length);
    label.textContent = `Statement ${curr} / ${stepStmts.length}: ${nodeToSrc(stepStmts[curr - 1])}`;
  }
  btn.textContent  = 'Next ▶';
  rst.disabled     = false;
}

// ── Populate examples ────────────────────────────────────
(function initExamples() {
  const sel = document.getElementById('exampleSelect');
  EXAMPLES.forEach((ex, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = ex.label;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', e => {
    if (e.target.value === '') return;
    document.getElementById('code').value = EXAMPLES[+e.target.value].code;
    e.target.value = '';
    run();
  });
})();

// ── Ctrl+Enter to run ────────────────────────────────────
document.getElementById('code').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});

// ── Init ─────────────────────────────────────────────────
document.getElementById('resetStepBtn').disabled = true;
document.getElementById('code').value = EXAMPLES[0].code;
run();
