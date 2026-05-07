"use strict";
// Depends on: InterpError (lexer.js), AST node types (parser.js)

// ═══════════════════════════════════════════════════════════════
//  EVALUATOR (Semantic Analysis / Tree Walking — Stage 3)
//
//  Job: walk the AST produced by the Parser and compute real values.
//  This is where the program actually "runs".
//
//  Strategy: "tree-walking interpreter"
//    - Start at the root (ProgramNode)
//    - Recursively visit each node
//    - Expression nodes return a number
//    - Statement nodes cause side effects (store variables, print output)
//
//  Key data:
//    env    — the symbol table: maps variable name → current number value
//    trace  — a log of every evaluation step (shown in the Trace panel)
//    prints — output from print() statements (shown in Console output)
//    errors — runtime errors collected so one bad statement doesn't stop the rest
// ═══════════════════════════════════════════════════════════════
class Evaluator {
  constructor() {
    this.env     = {};   // symbol table: varName → number
    this.trace   = [];   // evaluation log lines (displayed in UI)
    this.prints  = [];   // output from print() statements
    this.errors  = [];   // runtime errors (collected, not thrown immediately)
  }

  // _fmt — formats a number for display
  // Integers show without a decimal point; floats are trimmed to 10 decimal places
  _fmt(v) {
    return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(10)).toString();
  }

  // _log — appends an indented line to the trace log
  // depth controls how many spaces of indent (deeper = more nested in the tree)
  _log(depth, msg) { this.trace.push('  '.repeat(depth) + msg); }

  // clearTrace — resets the trace log (used between steps in Step Mode)
  clearTrace() { this.trace = []; }

  // ── eval ── the core recursive function
  // Takes an AST node and returns its numeric value (for expressions)
  // or causes side effects (for statements).
  // depth is purely for trace indentation.
  eval(node, depth = 0) {
    switch (node.type) {

      // ── Leaf nodes (no children) ─────────────────────────────

      // A literal number just returns its value immediately — no logging needed
      case 'Number':
        return node.value;

      // A variable name: look it up in the symbol table
      // Throws if the variable hasn't been assigned yet
      case 'Ident': {
        if (!(node.name in this.env))
          throw new InterpError(`Error: '${node.name}' is not declared`, node.col);
        const v = this.env[node.name];
        this._log(depth, `${node.name} → ${this._fmt(v)}`);
        return v;
      }

      // ── Operator nodes ────────────────────────────────────────

      // Unary minus: negates the operand expression
      case 'Unary': {
        this._log(depth, `negate:`);
        const v = this.eval(node.operand, depth + 1); // evaluate the inner expression
        const r = -v;
        this._log(depth + 1, `→ -(${this._fmt(v)}) = ${this._fmt(r)}`);
        return r;
      }

      // Built-in math functions: sqrt, abs, floor, ceil
      // Evaluates the argument expression, then applies the Math function
      case 'Builtin': {
        this._log(depth, `${node.fn}:`);
        const v = this.eval(node.arg, depth + 1); // evaluate the argument
        let r;
        switch (node.fn) {
          case 'sqrt':  r = Math.sqrt(v);  break;
          case 'abs':   r = Math.abs(v);   break;
          case 'floor': r = Math.floor(v); break;
          case 'ceil':  r = Math.ceil(v);  break;
        }
        this._log(depth + 1, `→ ${node.fn}(${this._fmt(v)}) = ${this._fmt(r)}`);
        return r;
      }

      // Binary operations: add, sub, mult, div, mod, pow, gt, lt, eq
      // Evaluates left and right child nodes, then applies the operator.
      // Comparisons (gt, lt, eq) return 1 (true) or 0 (false).
      case 'BinOp': {
        this._log(depth, `${node.op}:`);
        const l = this.eval(node.left,  depth + 1); // evaluate left side
        const r = this.eval(node.right, depth + 1); // evaluate right side
        let result;
        if (node.op === 'add')  result = l + r;
        if (node.op === 'sub')  result = l - r;
        if (node.op === 'mult') result = l * r;
        if (node.op === 'pow')  result = Math.pow(l, r);
        if (node.op === 'gt')   result = l > r   ? 1 : 0; // 1 = true, 0 = false
        if (node.op === 'lt')   result = l < r   ? 1 : 0;
        if (node.op === 'eq')   result = l === r ? 1 : 0;
        if (node.op === 'div') {
          if (r === 0) throw new InterpError('Error: division by zero', node.col);
          result = l / r;
        }
        if (node.op === 'mod') {
          if (r === 0) throw new InterpError('Error: modulo by zero', node.col);
          result = l % r;
        }
        this._log(depth + 1,
          `→ ${this._fmt(l)} ${node.op} ${this._fmt(r)} = ${this._fmt(result)}`);
        return result;
      }

      // ── Statement nodes (side effects) ───────────────────────

      // Assignment: evaluate the expression and store the result in env
      // env is the symbol table — it persists for the whole program run
      case 'Assign': {
        const isLiteral = node.expr.type === 'Number'; // avoid redundant log for plain x = 5
        if (!isLiteral) this._log(depth, `Assign ${node.name}:`);
        const val    = this.eval(node.expr, isLiteral ? depth : depth + 1);
        this.env[node.name] = val; // store in symbol table
        this._log(depth, `${node.name} = ${this._fmt(val)}`);
        return val;
      }

      // Print: evaluate the expression, then add the value to the prints array
      // The UI picks up this.prints after evaluation and displays them
      case 'Print': {
        this._log(depth, `print:`);
        const val = this.eval(node.expr, depth + 1);
        this.prints.push(this._fmt(val)); // saved for display in the UI
        this._log(depth + 1, `→ output: ${this._fmt(val)}`);
        return val;
      }

      // If: evaluate the condition; if non-zero, execute each body statement
      // 0 is treated as false, anything else is true (same as C/JavaScript)
      case 'If': {
        this._log(depth, `if:`);
        const cond = this.eval(node.cond, depth + 1);
        this._log(depth + 1,
          `→ condition = ${this._fmt(cond)} (${cond !== 0 ? 'true' : 'false'})`);
        if (cond !== 0) {
          this._log(depth + 1, `→ entering body`);
          for (const s of node.body) this.eval(s, depth + 2);
        } else {
          this._log(depth + 1, `→ skipping body`);
        }
        return 0;
      }

      // While: keep evaluating the condition and running the body until condition = 0
      // Safety limit of 10,000 iterations prevents infinite loops from hanging the browser
      case 'While': {
        this._log(depth, `while:`);
        const LIMIT = 10000;
        let iters = 0;
        while (true) {
          const cond = this.eval(node.cond, depth + 1);
          this._log(depth + 1, `→ condition = ${this._fmt(cond)} (${cond !== 0 ? 'true' : 'false'})`);
          if (cond === 0) { this._log(depth + 1, `→ exiting loop`); break; }
          if (++iters > LIMIT)
            throw new InterpError('Error: while loop exceeded 10 000 iterations', node.col);
          for (const s of node.body) this.eval(s, depth + 2); // run body statements
        }
        return 0;
      }

      // For: iterates varName from start to end (inclusive), step 1
      // Sets env[varName] before each iteration so body statements can use it
      case 'For': {
        this._log(depth, `for ${node.varName}:`);
        const start = this.eval(node.start, depth + 1); // evaluate start expression
        const end   = this.eval(node.end,   depth + 1); // evaluate end expression
        this._log(depth + 1, `→ range: ${this._fmt(start)} to ${this._fmt(end)}`);
        const LIMIT = 10000;
        let count = 0;
        for (let i = start; i <= end; i++) {
          if (++count > LIMIT)
            throw new InterpError('Error: for loop exceeded 10 000 iterations', node.col);
          this.env[node.varName] = i; // update the loop variable in the symbol table
          this._log(depth + 1, `→ ${node.varName} = ${this._fmt(i)}`);
          for (const s of node.body) this.eval(s, depth + 2); // run body statements
        }
        return 0;
      }

      // ── Program: run every statement, collecting all errors ──
      // Rather than stopping at the first error, errors are collected so the
      // user can see all mistakes at once. Each statement gets a blank trace line
      // between it and the next one for readability.
      case 'Program': {
        for (let i = 0; i < node.stmts.length; i++) {
          if (i > 0) this.trace.push(''); // blank separator between statements
          try {
            this.eval(node.stmts[i], depth);
          } catch (e) {
            this.errors.push(e);                  // save the error
            this._log(depth, `✗ ${e.message}`);   // log it in the trace
          }
        }
        return this.env; // return the final symbol table after all statements
      }
    }
    throw new InterpError(`Unknown AST node: ${node.type}`, 0);
  }
}
