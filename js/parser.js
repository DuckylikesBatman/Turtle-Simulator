"use strict";
// Depends on: TT, Token  (lexer.js)

// ── AST Node classes ──────────────────────────────────────
class NumberNode  { constructor(v)      { this.type = 'Number'; this.value = v; } }
class IdentNode   { constructor(name)   { this.type = 'Ident';  this.name = name; } }
class UnaryNode   { constructor(op, e)  { this.type = 'Unary';  this.op = op; this.operand = e; } }
class BinOpNode   { constructor(l,op,r) { this.type = 'BinOp';  this.left = l; this.op = op; this.right = r; } }
class AssignNode  { constructor(nm,e)   { this.type = 'Assign'; this.name = nm; this.expr = e; } }
class ProgramNode { constructor(stmts)  { this.type = 'Program'; this.stmts = stmts; } }

// ─────────────────────────────────────────────────────────
//  Parser  –  Syntactic Analysis
//  Consumes the token list and builds an Abstract Syntax Tree.
//
//  Grammar (EBNF):
//    program   → statement* EOF
//    statement → IDENT '=' expr ';'
//    expr      → term   ( ('add' | 'sub') term   )*
//    term      → factor ( ('mult' | 'div') factor )*
//    factor    → NUMBER | IDENT | '(' expr ')' | '-' factor
//
//  Operator precedence (low → high):
//    add / sub  <  mult / div  <  unary minus  <  atom
//
//  System-symbol check: if ADD/SUB/MULT/DIV appear in the
//  variable-name position, the error "Error X is system
//  symbol" is thrown before consuming the token.
// ─────────────────────────────────────────────────────────
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos    = 0;
  }

  get cur() { return this.tokens[this.pos]; }

  consume(expected) {
    const t = this.tokens[this.pos++];
    if (expected && t.type !== expected)
      throw new Error(`Expected '${expected}' but got '${t.type}' ('${t.value}')`);
    return t;
  }

  // factor → NUMBER | IDENT | '(' expr ')' | '-' factor
  factor() {
    const t = this.cur;
    if (t.type === TT.NUMBER) { this.consume(); return new NumberNode(t.value); }
    if (t.type === TT.IDENT)  { this.consume(); return new IdentNode(t.value); }
    if (t.type === TT.LPAREN) {
      this.consume(TT.LPAREN);
      const n = this.expr();
      this.consume(TT.RPAREN);
      return n;
    }
    // Unary minus: allows negative literals and negated variables
    if (t.type === TT.SUB) {
      this.consume();
      return new UnaryNode('-', this.factor());
    }
    throw new Error(`Expected a number, variable, or '(' — got '${t.value || t.type}'`);
  }

  // term → factor ( ('mult' | 'div') factor )*
  term() {
    let n = this.factor();
    while (this.cur.type === TT.MULT || this.cur.type === TT.DIV) {
      const op = this.consume().value;
      n = new BinOpNode(n, op, this.factor());
    }
    return n;
  }

  // expr → term ( ('add' | 'sub') term )*
  expr() {
    let n = this.term();
    while (this.cur.type === TT.ADD || this.cur.type === TT.SUB) {
      const op = this.consume().value;
      n = new BinOpNode(n, op, this.term());
    }
    return n;
  }

  // statement → IDENT '=' expr ';'
  statement() {
    const t = this.cur;
    // Reject keyword operators used as variable names
    if (t.type === TT.ADD || t.type === TT.SUB ||
        t.type === TT.MULT || t.type === TT.DIV) {
      throw new Error(`Error ${t.value} is system symbol`);
    }
    const nameToken = this.consume(TT.IDENT);
    this.consume(TT.EQUALS);
    const e = this.expr();
    this.consume(TT.SEMI);
    return new AssignNode(nameToken.value, e);
  }

  parse() {
    const stmts = [];
    while (this.cur.type !== TT.EOF) stmts.push(this.statement());
    return new ProgramNode(stmts);
  }
}

// ── AST → source string (for step mode re-tokenization) ──
function nodeToSrc(node) {
  switch (node.type) {
    case 'Assign': return `${node.name} = ${exprToSrc(node.expr)};`;
    default:       return exprToSrc(node);
  }
}

function exprToSrc(node) {
  switch (node.type) {
    case 'Number': return String(node.value);
    case 'Ident':  return node.name;
    case 'Unary':  return `-(${exprToSrc(node.operand)})`;
    case 'BinOp':  return `(${exprToSrc(node.left)} ${node.op} ${exprToSrc(node.right)})`;
    default:       return '?';
  }
}

// ── AST pretty-printer (used by "AST" button) ────────────
function prettyAST(node, depth = 0) {
  const p = '  '.repeat(depth);
  switch (node.type) {
    case 'Program':
      return `Program[\n${node.stmts.map(s => p + '  ' + prettyAST(s, depth+1)).join('\n')}\n${p}]`;
    case 'Number':
      return `Number(${node.value})`;
    case 'Ident':
      return `Ident(${node.name})`;
    case 'Unary':
      return `Unary(${node.op})\n${p}  └ ${prettyAST(node.operand, depth+1)}`;
    case 'Assign':
      return `Assign(${node.name})\n${p}  └ ${prettyAST(node.expr, depth+1)}`;
    case 'BinOp':
      return `BinOp(${node.op})\n${p}  ├ ${prettyAST(node.left, depth+1)}\n${p}  └ ${prettyAST(node.right, depth+1)}`;
    default:
      return JSON.stringify(node);
  }
}
