"use strict";
// Depends on: AST node types  (parser.js)

// ─────────────────────────────────────────────────────────
//  Evaluator  –  Semantic Analysis / Tree Walking
//
//  Recursively walks the AST produced by the Parser.
//  Every expression node is reduced to a number.
//  Variable assignments are stored in the symbol table (env).
//
//  Evaluation trace:
//    Each meaningful computation step is recorded in
//    this.trace as an indented string.  Call clearTrace()
//    before evaluating a single statement in step mode.
//
//  Error messages (exact format as specified):
//    • "Error {name} not declared."
//    • "Error cannot divide by 0."
//    • "Error {name} is system symbol"  ← caught in Parser
// ─────────────────────────────────────────────────────────
class Evaluator {
  constructor() {
    this.env   = {};   // symbol table: varName → number
    this.trace = [];   // human-readable evaluation log
  }

  // Format a number cleanly (no trailing ".0" for integers).
  _fmt(v) {
    if (Number.isInteger(v)) return String(v);
    return parseFloat(v.toFixed(10)).toString();
  }

  _log(depth, msg) {
    this.trace.push('  '.repeat(depth) + msg);
  }

  clearTrace() { this.trace = []; }

  eval(node, depth = 0) {
    switch (node.type) {

      // ── Leaf nodes ──────────────────────────────────────

      case 'Number':
        // Logged by parent context (BinOp / Unary); no log here.
        return node.value;

      case 'Ident': {
        if (!(node.name in this.env))
          throw new Error(`Error ${node.name} not declared.`);
        const v = this.env[node.name];
        this._log(depth, `${node.name} → ${this._fmt(v)}`);
        return v;
      }

      // ── Operator nodes ───────────────────────────────────

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
          if (r === 0) throw new Error('Error cannot divide by 0.');
          result = l / r;
        }
        this._log(depth + 1, `→ ${this._fmt(l)} ${node.op} ${this._fmt(r)} = ${this._fmt(result)}`);
        return result;
      }

      // ── Statement nodes ──────────────────────────────────

      case 'Assign': {
        const isLiteral = (node.expr.type === 'Number');
        if (!isLiteral) this._log(depth, `Assign ${node.name}:`);
        const val = this.eval(node.expr, isLiteral ? depth : depth + 1);
        this.env[node.name] = val;
        this._log(depth, `${node.name} = ${this._fmt(val)}`);
        return val;
      }

      case 'Program': {
        for (let i = 0; i < node.stmts.length; i++) {
          if (i > 0) this.trace.push('');   // blank line between statements
          this.eval(node.stmts[i], depth);
        }
        return this.env;
      }
    }
    throw new Error(`Unknown AST node: ${node.type}`);
  }
}
