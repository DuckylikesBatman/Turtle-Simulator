"use strict";

const TT = Object.freeze({
  NUMBER:  'NUMBER',
  IDENT:   'IDENT',
  ADD:     'ADD',
  SUB:     'SUB',
  MULT:    'MULT',
  DIV:     'DIV',
  MOD:     'MOD',
  PRINT:   'PRINT',
  EQUALS:  'EQUALS',
  SEMI:    'SEMI',
  LPAREN:  'LPAREN',
  RPAREN:  'RPAREN',
  EOF:     'EOF',
});

// Custom error that carries the character offset where the problem occurred.
// Used by the lexer, parser, and evaluator to power the source pointer display.
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
    this.col   = col;   // character offset in the source string
  }
  toString() { return `Token(${this.type}, ${JSON.stringify(this.value)})`; }
}

// ─────────────────────────────────────────────────────────
//  Lexer  –  Lexical Analysis
//  Reads source text one character at a time and emits
//  a flat array of Token objects.
//
//  Keyword operators (case-insensitive):
//    add  sub  mult  div  mod
//  Reserved keyword:
//    print
// ─────────────────────────────────────────────────────────
class Lexer {
  constructor(src) { this.src = src; this.pos = 0; }

  get ch() { return this.pos < this.src.length ? this.src[this.pos] : null; }
  advance() { this.pos++; }

  skipWS() {
    while (this.ch === ' ' || this.ch === '\t' || this.ch === '\r' || this.ch === '\n')
      this.advance();
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
      mod:   TT.MOD,   print: TT.PRINT,
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
      else throw new InterpError(`Unexpected character '${c}'`, col);
    }
    tokens.push(new Token(TT.EOF, null, this.pos));
    return tokens;
  }
}
