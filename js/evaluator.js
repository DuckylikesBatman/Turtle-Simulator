"use strict";
// Depends on: InterpError (lexer.js), AST node types (parser.js)

// ─────────────────────────────────────────────────────────
//  Evaluator  –  Semantic Analysis / Tree Walking
//
//  Recursively walks the AST.  Every expression node is
//  reduced to a number.  Side effects:
//    • AssignNode  → stores result in this.env
//    • PrintNode   → appends formatted value to this.prints
//
//  Evaluation trace:
//    Every meaningful computation step is recorded in
//    this.trace as an indented string, mirroring the shape
//    of the AST.  Clear between steps with clearTrace().
//
//  Multi-error collection:
//    In Program eval, each statement is run inside try/catch.
//    Runtime errors are pushed to this.errors instead of
//    propagating, so ALL errors are reported in one pass.
//
//  Error messages (exact format):
//    "Error {name} not declared."
//    "Error cannot divide by 0."
//    "Error cannot mod by 0."
//    "Error {sym} is system symbol"  ← thrown by Parser
// ─────────────────────────────────────────────────────────
class Evaluator {
  constructor() {
    this.env    = {};   // symbol table: varName → number
    this.trace  = [];   // evaluation log lines
    this.prints = [];   // output from print() statements
    this.errors = [];   // runtime errors (all, not just first)
  }

  _fmt(v) {
    return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(10)).toString();
  }

  _log(depth, msg) { this.trace.push('  '.repeat(depth) + msg); }

  clearTrace() { this.trace = []; }

  eval(node, depth = 0) {
    switch (node.type) {

      // ── Leaf nodes ───────────────────────────────────────

      case 'Number':
        // Logged by the parent (BinOp / Assign) when needed; no entry here.
        return node.value;

      case 'Ident': {
        if (!(node.name in this.env))
          throw new InterpError(`Error ${node.name} not declared.`, node.col);
        const v = this.env[node.name];
        this._log(depth, `${node.name} → ${this._fmt(v)}`);
        return v;
      }

      // ── Operator nodes ────────────────────────────────────

      case 'Unary': {
        this._log(depth, `negate:`);
        const v = this.eval(node.operand, depth + 1);
        const r = -v;
        this._log(depth + 1, `→ -(${this._fmt(v)}) = ${this._fmt(r)}`);
        return r;
      }

      case 'BinOp': {
        this._log(depth, `${node.op}:`);
        const l = this.eval(node.left,  depth + 1);
        const r = this.eval(node.right, depth + 1);
        let result;
        if (node.op === 'add')  result = l + r;
        if (node.op === 'sub')  result = l - r;
        if (node.op === 'mult') result = l * r;
        if (node.op === 'div') {
          if (r === 0) throw new InterpError('Error cannot divide by 0.', node.col);
          result = l / r;
        }
        if (node.op === 'mod') {
          if (r === 0) throw new InterpError('Error cannot mod by 0.', node.col);
          result = l % r;
        }
        this._log(depth + 1,
          `→ ${this._fmt(l)} ${node.op} ${this._fmt(r)} = ${this._fmt(result)}`);
        return result;
      }

      // ── Statement nodes ───────────────────────────────────

      case 'Assign': {
        const isLiteral = node.expr.type === 'Number';
        if (!isLiteral) this._log(depth, `Assign ${node.name}:`);
        const val = this.eval(node.expr, isLiteral ? depth : depth + 1);
        this.env[node.name] = val;
        this._log(depth, `${node.name} = ${this._fmt(val)}`);
        return val;
      }

      case 'Print': {
        this._log(depth, `print:`);
        const val = this.eval(node.expr, depth + 1);
        this.prints.push(this._fmt(val));
        this._log(depth + 1, `→ output: ${this._fmt(val)}`);
        return val;
      }

      // ── Program: run every statement, collect all errors ──

      case 'Program': {
        for (let i = 0; i < node.stmts.length; i++) {
          if (i > 0) this.trace.push('');
          try {
            this.eval(node.stmts[i], depth);
          } catch (e) {
            this.errors.push(e);
            this._log(depth, `✗ ${e.message}`);
          }
        }
        return this.env;
      }
    }
    throw new InterpError(`Unknown AST node: ${node.type}`, 0);
  }
}
