"use strict";

const TT = Object.freeze({
  NUMBER:  'NUMBER',
  IDENT:   'IDENT',
  ADD:     'ADD',
  SUB:     'SUB',
  MULT:    'MULT',
  DIV:     'DIV',
  MOD:     'MOD',
  POW:     'POW',
  SQRT:    'SQRT',
  ABS:     'ABS',
  FLOOR:   'FLOOR',
  CEIL:    'CEIL',
  GT:      'GT',
  LT:      'LT',
  EQOP:    'EQOP',
  IF:      'IF',
  PRINT:   'PRINT',
  EQUALS:  'EQUALS',
  SEMI:    'SEMI',
  LPAREN:  'LPAREN',
  RPAREN:  'RPAREN',
  LBRACE:  'LBRACE',
  RBRACE:  'RBRACE',
  EOF:     'EOF',
});

class InterpError extends Error {
  constructor(message, col) {
    super(message);
    this.col = col;
  }
}

class Token {
  constructor(type, value, col = 0) {
    this.type  = type;
    this.value = value;
    this.col   = col;
  }
  toString() { return `Token(${this.type}, ${JSON.stringify(this.value)})`; }
}

class Lexer {
  constructor(src) { this.src = src; this.pos = 0; }

  get ch() { return this.pos < this.src.length ? this.src[this.pos] : null; }
  advance() { this.pos++; }

  skipWS() {
    while (true) {
      if (this.ch === ' ' || this.ch === '\t' || this.ch === '\r' || this.ch === '\n') {
        this.advance();
      } else if (this.ch === '#') {
        // comment: skip to end of line
        while (this.ch !== null && this.ch !== '\n') this.advance();
      } else {
        break;
      }
    }
  }

  readNumber() {
    const col = this.pos;
    let s = '';
    while (this.ch && /\d/.test(this.ch)) { s += this.ch; this.advance(); }
    if (this.ch === '.') {
      s += '.'; this.advance();
      while (this.ch && /\d/.test(this.ch)) { s += this.ch; this.advance(); }
    }
    return new Token(TT.NUMBER, parseFloat(s), col);
  }

  readIdent() {
    const col = this.pos;
    let s = '';
    while (this.ch && /[A-Za-z_0-9]/.test(this.ch)) { s += this.ch; this.advance(); }
    const lower = s.toLowerCase();
    const keywords = {
      add:   TT.ADD,   sub:   TT.SUB,
      mult:  TT.MULT,  div:   TT.DIV,
      mod:   TT.MOD,   pow:   TT.POW,
      sqrt:  TT.SQRT,  abs:   TT.ABS,
      floor: TT.FLOOR, ceil:  TT.CEIL,
      gt:    TT.GT,    lt:    TT.LT,
      eq:    TT.EQOP,  if:    TT.IF,
      print: TT.PRINT,
    };
    if (lower in keywords) return new Token(keywords[lower], lower, col);
    return new Token(TT.IDENT, s, col);
  }

  tokenize() {
    const tokens = [];
    while (this.ch !== null) {
      this.skipWS();
      if (this.ch === null) break;
      const c = this.ch, col = this.pos;
      if      (/\d/.test(c))        tokens.push(this.readNumber());
      else if (/[A-Za-z_]/.test(c)) tokens.push(this.readIdent());
      else if (c === '=') { tokens.push(new Token(TT.EQUALS, '=', col)); this.advance(); }
      else if (c === ';') { tokens.push(new Token(TT.SEMI,   ';', col)); this.advance(); }
      else if (c === '(') { tokens.push(new Token(TT.LPAREN, '(', col)); this.advance(); }
      else if (c === ')') { tokens.push(new Token(TT.RPAREN, ')', col)); this.advance(); }
      else if (c === '{') { tokens.push(new Token(TT.LBRACE, '{', col)); this.advance(); }
      else if (c === '}') { tokens.push(new Token(TT.RBRACE, '}', col)); this.advance(); }
      else throw new InterpError(`Unexpected character '${c}'`, col);
    }
    tokens.push(new Token(TT.EOF, null, this.pos));
    return tokens;
  }
}
