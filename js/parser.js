"use strict";
// Depends on: TT, InterpError  (lexer.js)

// ── AST Node classes ──────────────────────────────────────
class NumberNode  { constructor(v,col=0)      { this.type='Number';  this.value=v;  this.col=col; } }
class IdentNode   { constructor(n,col=0)      { this.type='Ident';   this.name=n;   this.col=col; } }
class UnaryNode   { constructor(op,e,col=0)   { this.type='Unary';   this.op=op;    this.operand=e; this.col=col; } }
class BinOpNode   { constructor(l,op,r,col=0) { this.type='BinOp';   this.left=l;   this.op=op; this.right=r; this.col=col; } }
class BuiltinNode { constructor(fn,a,col=0)   { this.type='Builtin'; this.fn=fn;    this.arg=a;    this.col=col; } }
class AssignNode  { constructor(nm,e,col=0)   { this.type='Assign';  this.name=nm;  this.expr=e;   this.col=col; } }
class PrintNode   { constructor(e,col=0)      { this.type='Print';   this.expr=e;   this.col=col; } }
class IfNode      { constructor(c,b,col=0)    { this.type='If';      this.cond=c;   this.body=b;   this.col=col; } }
class ProgramNode { constructor(stmts)        { this.type='Program'; this.stmts=stmts; this.parseErrors=[]; } }

// ─────────────────────────────────────────────────────────
//  Parser  –  Syntactic Analysis
//
//  Grammar (EBNF):
//    program    → statement* EOF
//    statement  → IDENT '=' expr ';'
//               | 'print' '(' expr ')' ';'
//               | 'if' '(' expr ')' '{' statement* '}'
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
  constructor(tokens) { this.tokens = tokens; this.pos = 0; this._errors = []; }

  get cur() { return this.tokens[this.pos]; }

  consume(expected) {
    const t = this.tokens[this.pos++];
    if (expected && t.type !== expected)
      throw new InterpError(
        `Expected '${expected}' but got '${t.type}' ('${t.value}')`, t.col);
    return t;
  }

  // factor → NUMBER | IDENT | '(' expr ')' | '-' factor | builtin '(' expr ')'
  factor() {
    const t = this.cur;
    if (t.type === TT.NUMBER) { this.consume(); return new NumberNode(t.value, t.col); }
    if (t.type === TT.IDENT)  { this.consume(); return new IdentNode(t.value,  t.col); }
    if (t.type === TT.LPAREN) {
      this.consume(TT.LPAREN);
      const n = this.expr();
      this.consume(TT.RPAREN);
      return n;
    }
    if (t.type === TT.SUB) {
      const col = t.col; this.consume();
      return new UnaryNode('-', this.factor(), col);
    }
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

  // power → factor ('pow' factor)?
  power() {
    let n = this.factor();
    if (this.cur.type === TT.POW) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.factor(), op.col);
    }
    return n;
  }

  // term → power ( ('mult'|'div'|'mod') power )*
  term() {
    let n = this.power();
    while ([TT.MULT, TT.DIV, TT.MOD].includes(this.cur.type)) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.power(), op.col);
    }
    return n;
  }

  // addExpr → term ( ('add'|'sub') term )*
  addExpr() {
    let n = this.term();
    while (this.cur.type === TT.ADD || this.cur.type === TT.SUB) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.term(), op.col);
    }
    return n;
  }

  // expr → addExpr ( ('gt'|'lt'|'eq') addExpr )?
  expr() {
    let n = this.addExpr();
    if ([TT.GT, TT.LT, TT.EQOP].includes(this.cur.type)) {
      const op = this.consume();
      n = new BinOpNode(n, op.value, this.addExpr(), op.col);
    }
    return n;
  }

  // statement → IDENT '=' expr ';'  |  print(expr);  |  if(expr){ stmts }
  statement() {
    const t = this.cur;

    // if (expr) { stmts }
    if (t.type === TT.IF) {
      this.consume();
      this.consume(TT.LPAREN);
      const cond = this.expr();
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

    // print(expr);
    if (t.type === TT.PRINT) {
      if (this.tokens[this.pos + 1]?.type === TT.EQUALS)
        throw new InterpError(`Error print is system symbol`, t.col);
      this.consume();
      this.consume(TT.LPAREN);
      const e = this.expr();
      this.consume(TT.RPAREN);
      this.consume(TT.SEMI);
      return new PrintNode(e, t.col);
    }

    // Reject operator keywords in variable-name position
    const SYS = [TT.ADD, TT.SUB, TT.MULT, TT.DIV, TT.MOD, TT.POW,
                 TT.SQRT, TT.ABS, TT.FLOOR, TT.CEIL, TT.GT, TT.LT, TT.EQOP];
    if (SYS.includes(t.type))
      throw new InterpError(`Error ${t.value} is system symbol`, t.col);

    // IDENT = expr ;
    const nm = this.consume(TT.IDENT);
    this.consume(TT.EQUALS);
    const e = this.expr();
    this.consume(TT.SEMI);
    return new AssignNode(nm.value, e, nm.col);
  }

  parse() {
    const stmts = [], errors = [];
    while (this.cur.type !== TT.EOF) {
      try {
        stmts.push(this.statement());
      } catch (e) {
        errors.push(e);
        while (this.cur.type !== TT.SEMI && this.cur.type !== TT.EOF)
          this.consume();
        if (this.cur.type === TT.SEMI) this.consume();
      }
    }
    const prog = new ProgramNode(stmts);
    prog.parseErrors = [...errors, ...this._errors];
    return prog;
  }
}

// ── AST → source string (for step mode re-tokenization) ──
function nodeToSrc(node) {
  switch (node.type) {
    case 'Assign': return `${node.name} = ${exprToSrc(node.expr)};`;
    case 'Print':  return `print(${exprToSrc(node.expr)});`;
    case 'If':     return `if(${exprToSrc(node.cond)}){${node.body.map(nodeToSrc).join(' ')}}`;
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

// ── AST text pretty-printer ───────────────────────────────
function prettyAST(node, depth = 0) {
  const p = '  '.repeat(depth);
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
    default: return JSON.stringify(node);
  }
}
