"use strict";
// Depends on: TT, InterpError  (lexer.js)

// ═══════════════════════════════════════════════════════════════
//  PARSER (Syntactic Analysis — Stage 2 of the pipeline)
//
//  Job: take the flat token list from the Lexer and build an
//  Abstract Syntax Tree (AST) — a tree that represents the
//  structure and meaning of the program.
//
//  Uses Recursive Descent Parsing: each grammar rule is a method.
//  Operator precedence is enforced by the call hierarchy:
//
//    expr (lowest precedence: comparisons)
//      └─ addExpr  (add, sub)
//           └─ term  (mult, div, mod)
//                └─ power  (pow)
//                     └─ factor  (highest: numbers, variables, built-ins)
// ═══════════════════════════════════════════════════════════════

// ── AST Node classes ──────────────────────────────────────────
// Each class represents one kind of node in the syntax tree.
// The 'type' string lets the Evaluator know what to do with it.

// A literal number, e.g. 42 or 3.14
class NumberNode  { constructor(v,col=0)      { this.type='Number';  this.value=v;  this.col=col; } }

// A variable reference, e.g. myVar (the name is looked up at eval time)
class IdentNode   { constructor(n,col=0)      { this.type='Ident';   this.name=n;   this.col=col; } }

// Unary minus, e.g. -x  (op is always '-', operand is another expression node)
class UnaryNode   { constructor(op,e,col=0)   { this.type='Unary';   this.op=op;    this.operand=e; this.col=col; } }

// A binary operation, e.g. x add y  (left and right are child expression nodes)
class BinOpNode   { constructor(l,op,r,col=0) { this.type='BinOp';   this.left=l;   this.op=op; this.right=r; this.col=col; } }

// A built-in function call, e.g. sqrt(x)  (fn = function name, arg = expression node)
class BuiltinNode { constructor(fn,a,col=0)   { this.type='Builtin'; this.fn=fn;    this.arg=a;    this.col=col; } }

// Variable assignment statement, e.g. x = expr;
class AssignNode  { constructor(nm,e,col=0)        { this.type='Assign'; this.name=nm;    this.expr=e;               this.col=col; } }

// Print statement, e.g. print(expr);
class PrintNode   { constructor(e,col=0)            { this.type='Print';  this.expr=e;                                this.col=col; } }

// If statement: executes body only when cond is non-zero
class IfNode      { constructor(c,b,col=0)          { this.type='If';     this.cond=c;    this.body=b;               this.col=col; } }

// While loop: repeats body as long as cond is non-zero
class WhileNode   { constructor(c,b,col=0)          { this.type='While';  this.cond=c;    this.body=b;               this.col=col; } }

// For loop: for(varName = start to end){ body }
class ForNode     { constructor(v,s,e,b,col=0)      { this.type='For';    this.varName=v; this.start=s; this.end=e;  this.body=b;  this.col=col; } }

// Root node: holds the list of all top-level statements, and any parse errors
class ProgramNode { constructor(stmts)              { this.type='Program'; this.stmts=stmts; this.parseErrors=[]; } }

// ─────────────────────────────────────────────────────────
//  Parser  –  Syntactic Analysis
//
//  Grammar (EBNF):
//    program    → statement* EOF
//    statement  → IDENT '=' expr ';'
//               | 'print' '(' expr ')' ';'
//               | 'if'    '(' expr ')' '{' statement* '}'
//               | 'while' '(' expr ')' '{' statement* '}'
//               | 'for'   '(' IDENT '=' expr 'to' expr ')' '{' statement* '}'
//    expr       → addExpr ( ('gt'|'lt'|'eq') addExpr )?
//    addExpr    → term   ( ('add'|'sub') term )*
//    term       → power  ( ('mult'|'div'|'mod') power )*
//    power      → factor ( 'pow' factor )?
//    factor     → NUMBER | IDENT | '(' expr ')' | '-' factor
//               | ('sqrt'|'abs'|'floor'|'ceil') '(' expr ')'
//
//  System keywords (reserved): add sub mult div mod pow
//                               sqrt abs floor ceil gt lt eq if print
// ─────────────────────────────────────────────────────────
class Parser {
  constructor(tokens) {
    this.tokens  = tokens; // the flat token array from the Lexer
    this.pos     = 0;      // index of the token we are currently looking at
    this._errors = [];     // errors found inside block bodies (while/for/if)
  }

  // cur — returns the token at the current position without consuming it
  get cur() { return this.tokens[this.pos]; }

  // consume — takes the current token and moves the position forward.
  // If 'expected' is provided and the token type doesn't match, throws an error.
  consume(expected) {
    const t = this.tokens[this.pos++];
    if (expected && t.type !== expected)
      throw new InterpError(
        `Expected '${expected}' but got '${t.type}' ('${t.value}')`, t.col);
    return t;
  }

  // ── factor ── (highest precedence — tightest binding)
  // Handles: numbers, variable names, parenthesized expressions,
  //          unary minus, and built-in function calls.
  factor() {
    const t = this.cur;
    // A literal number → NumberNode
    if (t.type === TT.NUMBER) { this.consume(); return new NumberNode(t.value, t.col); }
    // A variable name → IdentNode
    if (t.type === TT.IDENT)  { this.consume(); return new IdentNode(t.value,  t.col); }
    // Parenthesized sub-expression: (expr)
    if (t.type === TT.LPAREN) {
      this.consume(TT.LPAREN);
      const n = this.expr();        // recursively parse the inner expression
      this.consume(TT.RPAREN);
      return n;
    }
    // Unary minus: -factor
    if (t.type === TT.MINUS) {
      const col = t.col; this.consume();
      return new UnaryNode('-', this.factor(), col);
    }
    // Built-in functions: sqrt(expr), abs(expr), floor(expr), ceil(expr)
    if ([TT.SQRT, TT.ABS, TT.FLOOR, TT.CEIL].includes(t.type)) {
      const col = t.col; this.consume();
      this.consume(TT.LPAREN);
      const arg = this.expr();
      this.consume(TT.RPAREN);
      return new BuiltinNode(t.value, arg, col);
    }
    throw new InterpError(
      `Expected number, variable, or '(' — got '${t.value || t.type}'`, t.col);
  }

  // ── power ── handles the 'pow' operator (e.g. base pow exp)
  // Only one pow per expression (no chaining without parentheses)
  power() {
    let n = this.factor();
    if (this.cur.type === TT.POW) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.factor(), op.col);
    }
    return n;
  }

  // ── term ── handles mult, div, mod (left-to-right, all equal precedence)
  term() {
    let n = this.power();
    while ([TT.MULT, TT.DIV, TT.MOD].includes(this.cur.type)) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.power(), op.col);
    }
    return n;
  }

  // ── addExpr ── handles add and sub (lower precedence than mult/div)
  addExpr() {
    let n = this.term();
    while (this.cur.type === TT.ADD || this.cur.type === TT.SUB) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.term(), op.col);
    }
    return n;
  }

  // ── expr ── handles comparison operators (lowest expression precedence)
  // gt, lt, eq return 1 (true) or 0 (false) at evaluation time
  // Only one comparison allowed per expression (no chaining like a gt b gt c)
  expr() {
    let n = this.addExpr();
    if ([TT.GT, TT.LT, TT.EQOP].includes(this.cur.type)) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.addExpr(), op.col);
    }
    return n;
  }

  // ── statement ── parses one complete statement
  // A statement is a top-level action: assignment, print, if, while, for.
  statement() {
    const t = this.cur;

    // ── while (expr) { statements } ──
    if (t.type === TT.WHILE) {
      this.consume();
      this.consume(TT.LPAREN);
      const cond = this.expr();       // the loop condition
      this.consume(TT.RPAREN);
      this.consume(TT.LBRACE);
      const body = [];
      // Parse statements inside the braces until we hit } or end of input
      while (this.cur.type !== TT.RBRACE && this.cur.type !== TT.EOF) {
        try { body.push(this.statement()); }
        catch (e) {
          // Error recovery: skip to the next ; or } so parsing can continue
          this._errors.push(e);
          while (![TT.SEMI, TT.RBRACE, TT.EOF].includes(this.cur.type)) this.consume();
          if (this.cur.type === TT.SEMI) this.consume();
        }
      }
      this.consume(TT.RBRACE);
      return new WhileNode(cond, body, t.col);
    }

    // ── for (ident = start to end) { statements } ──
    if (t.type === TT.FOR) {
      this.consume();
      this.consume(TT.LPAREN);
      const varTok = this.consume(TT.IDENT); // the loop variable name
      this.consume(TT.EQUALS);
      const start = this.expr();             // starting value
      this.consume(TT.TO);
      const end = this.expr();               // ending value (inclusive)
      this.consume(TT.RPAREN);
      this.consume(TT.LBRACE);
      const body = [];
      while (this.cur.type !== TT.RBRACE && this.cur.type !== TT.EOF) {
        try { body.push(this.statement()); }
        catch (e) {
          this._errors.push(e);
          while (![TT.SEMI, TT.RBRACE, TT.EOF].includes(this.cur.type)) this.consume();
          if (this.cur.type === TT.SEMI) this.consume();
        }
      }
      this.consume(TT.RBRACE);
      return new ForNode(varTok.value, start, end, body, t.col);
    }

    // ── if (expr) { statements } ──
    if (t.type === TT.IF) {
      this.consume();
      this.consume(TT.LPAREN);
      const cond = this.expr();   // the condition — non-zero means true
      this.consume(TT.RPAREN);
      this.consume(TT.LBRACE);
      const body = [];
      while (this.cur.type !== TT.RBRACE && this.cur.type !== TT.EOF) {
        try {
          body.push(this.statement());
        } catch (e) {
          this._errors.push(e);
          while (![TT.SEMI, TT.RBRACE, TT.EOF].includes(this.cur.type)) this.consume();
          if (this.cur.type === TT.SEMI) this.consume();
        }
      }
      this.consume(TT.RBRACE);
      return new IfNode(cond, body, t.col);
    }

    // ── print(expr); ──
    if (t.type === TT.PRINT) {
      // Prevent someone from writing: print = 5;  ('print' is reserved)
      if (this.tokens[this.pos + 1]?.type === TT.EQUALS)
        throw new InterpError(`Error: 'print' is a system keyword`, t.col);
      this.consume();
      this.consume(TT.LPAREN);
      const e = this.expr();
      this.consume(TT.RPAREN);
      this.consume(TT.SEMI);
      return new PrintNode(e, t.col);
    }

    // Guard: reject operator keywords used as variable names (e.g. add = 5;)
    const SYS = [TT.ADD, TT.SUB, TT.MULT, TT.DIV, TT.MOD, TT.POW,
                 TT.SQRT, TT.ABS, TT.FLOOR, TT.CEIL, TT.GT, TT.LT, TT.EQOP,
                 TT.WHILE, TT.FOR, TT.TO];
    if (SYS.includes(t.type))
      throw new InterpError(`Error: '${t.value}' is a system keyword`, t.col);

    // ── IDENT = expr ; ── (variable assignment)
    const nm = this.consume(TT.IDENT); // the variable name
    this.consume(TT.EQUALS);
    const e = this.expr();             // the value expression
    this.consume(TT.SEMI);
    return new AssignNode(nm.value, e, nm.col);
  }

  // parse — top-level entry point.
  // Calls statement() in a loop until EOF.
  // On error: skips to the next ';' and keeps going (error recovery),
  // so one bad line doesn't break the rest of the program.
  parse() {
    const stmts = [], errors = [];
    while (this.cur.type !== TT.EOF) {
      try {
        stmts.push(this.statement());
      } catch (e) {
        errors.push(e);
        // Skip tokens until the next statement boundary
        while (this.cur.type !== TT.SEMI && this.cur.type !== TT.EOF)
          this.consume();
        if (this.cur.type === TT.SEMI) this.consume();
      }
    }
    const prog = new ProgramNode(stmts);
    prog.parseErrors = [...errors, ...this._errors]; // merge all collected errors
    return prog;
  }
}

// ── nodeToSrc / exprToSrc ─────────────────────────────────────
// Converts an AST node back into a source-code string.
// Used by Step Mode: each statement node is re-tokenized so the
// token panel shows only the tokens for that one statement.
function nodeToSrc(node) {
  switch (node.type) {
    case 'Assign': return `${node.name} = ${exprToSrc(node.expr)};`;
    case 'Print':  return `print(${exprToSrc(node.expr)});`;
    case 'If':     return `if(${exprToSrc(node.cond)}){${node.body.map(nodeToSrc).join(' ')}}`;
    case 'While':  return `while(${exprToSrc(node.cond)}){${node.body.map(nodeToSrc).join(' ')}}`;
    case 'For':    return `for(${node.varName}=${exprToSrc(node.start)} to ${exprToSrc(node.end)}){${node.body.map(nodeToSrc).join(' ')}}`;
    default:       return exprToSrc(node);
  }
}

function exprToSrc(node) {
  switch (node.type) {
    case 'Number':  return String(node.value);
    case 'Ident':   return node.name;
    case 'Unary':   return `-(${exprToSrc(node.operand)})`;
    case 'BinOp':   return `(${exprToSrc(node.left)} ${node.op} ${exprToSrc(node.right)})`;
    case 'Builtin': return `${node.fn}(${exprToSrc(node.arg)})`;
    default:        return '?';
  }
}

// ── prettyAST ─────────────────────────────────────────────────
// Converts the AST into a readable indented text representation.
// This is what appears in the "Text" view of the AST panel.
// depth controls indentation: each level adds 2 spaces.
function prettyAST(node, depth = 0) {
  const p = '  '.repeat(depth); // indentation prefix for child lines
  switch (node.type) {
    case 'Program':
      return `Program[\n${node.stmts.map(s => p+'  '+prettyAST(s,depth+1)).join('\n')}\n${p}]`;
    case 'Number':  return `Number(${node.value})`;
    case 'Ident':   return `Ident(${node.name})`;
    case 'Unary':
      return `Unary(${node.op})\n${p}  └ ${prettyAST(node.operand, depth+1)}`;
    case 'Assign':
      return `Assign(${node.name})\n${p}  └ ${prettyAST(node.expr, depth+1)}`;
    case 'Print':
      return `Print\n${p}  └ ${prettyAST(node.expr, depth+1)}`;
    case 'BinOp':
      return `BinOp(${node.op})\n${p}  ├ ${prettyAST(node.left,depth+1)}\n${p}  └ ${prettyAST(node.right,depth+1)}`;
    case 'Builtin':
      return `Builtin(${node.fn})\n${p}  └ ${prettyAST(node.arg, depth+1)}`;
    case 'If':
      return `If\n${p}  ├ cond: ${prettyAST(node.cond,depth+1)}\n${p}  └ body[\n${node.body.map(s=>p+'    '+prettyAST(s,depth+2)).join('\n')}\n${p}  ]`;
    case 'While':
      return `While\n${p}  ├ cond: ${prettyAST(node.cond,depth+1)}\n${p}  └ body[\n${node.body.map(s=>p+'    '+prettyAST(s,depth+2)).join('\n')}\n${p}  ]`;
    case 'For':
      return `For(${node.varName})\n${p}  ├ start: ${prettyAST(node.start,depth+1)}\n${p}  ├ end:   ${prettyAST(node.end,depth+1)}\n${p}  └ body[\n${node.body.map(s=>p+'    '+prettyAST(s,depth+2)).join('\n')}\n${p}  ]`;
    default: return JSON.stringify(node);
  }
}
