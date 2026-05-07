"use strict";

// ═══════════════════════════════════════════════════════════════
//  LEXER (Lexical Analysis — Stage 1 of the pipeline)
//
//  Job: read raw source text character by character and break it
//  into a flat list of "tokens" (like words and punctuation).
//
//  Example:
//    Input:  "a = 10 add b;"
//    Output: [IDENT(a), EQUALS(=), NUMBER(10), ADD(add), IDENT(b), SEMI(;), EOF]
// ═══════════════════════════════════════════════════════════════

// ── Token Type constants ──────────────────────────────────────
// TT acts as an enum: every possible token category has a name.
// Object.freeze() prevents accidental changes to these values.
const TT = Object.freeze({
  NUMBER:  'NUMBER',   // a numeric literal, e.g. 42 or 3.14
  IDENT:   'IDENT',   // a user-defined variable name, e.g. myVar
  ADD:     'ADD',     // keyword: add
  SUB:     'SUB',     // keyword: sub
  MULT:    'MULT',    // keyword: mult
  DIV:     'DIV',     // keyword: div
  MOD:     'MOD',     // keyword: mod
  POW:     'POW',     // keyword: pow
  SQRT:    'SQRT',    // keyword: sqrt
  ABS:     'ABS',     // keyword: abs
  FLOOR:   'FLOOR',   // keyword: floor
  CEIL:    'CEIL',    // keyword: ceil
  GT:      'GT',      // keyword: gt  (greater than)
  LT:      'LT',      // keyword: lt  (less than)
  EQOP:    'EQOP',   // keyword: eq  (equality comparison)
  IF:      'IF',      // keyword: if
  WHILE:   'WHILE',   // keyword: while
  FOR:     'FOR',     // keyword: for
  TO:      'TO',      // keyword: to  (used in for loops)
  PRINT:   'PRINT',   // keyword: print
  MINUS:   'MINUS',   // the '-' unary minus symbol
  EQUALS:  'EQUALS',  // the '=' assignment symbol
  SEMI:    'SEMI',    // the ';' statement terminator
  LPAREN:  'LPAREN',  // '('
  RPAREN:  'RPAREN',  // ')'
  LBRACE:  'LBRACE',  // '{'
  RBRACE:  'RBRACE',  // '}'
  EOF:     'EOF',     // end of file — signals the parser to stop
});

// ── Custom error class ────────────────────────────────────────
// InterpError is thrown whenever the lexer (or parser/evaluator)
// encounters a problem.  The 'col' property stores the character
// position so the UI can draw a ^^^ pointer under the bad spot.
class InterpError extends Error {
  constructor(message, col) {
    super(message);
    this.col = col; // column index in the source string
  }
}

// ── Token class ───────────────────────────────────────────────
// A Token is one "word" produced by the Lexer.
//   type  — one of the TT constants above
//   value — the actual text or numeric value (e.g. 42, "add", "myVar")
//   col   — position in the source string (used for error pointers)
class Token {
  constructor(type, value, col = 0) {
    this.type  = type;
    this.value = value;
    this.col   = col;
  }
  // Human-readable representation, useful for debugging
  toString() { return `Token(${this.type}, ${JSON.stringify(this.value)})`; }
}

// ── Lexer class ───────────────────────────────────────────────
// The Lexer reads source text character-by-character and produces
// an array of Token objects via the tokenize() method.
class Lexer {
  constructor(src) {
    this.src = src; // the full source string
    this.pos = 0;   // current reading position (index into src)
  }

  // Returns the character at the current position, or null at end of input
  get ch() { return this.pos < this.src.length ? this.src[this.pos] : null; }

  // Moves the reading position forward by one character
  advance() { this.pos++; }

  // skipWS — skip whitespace and comments
  // Whitespace: spaces, tabs, carriage returns, newlines
  // Comments: everything from '#' to end of that line is ignored
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

  // readNumber — called when the current character is a digit
  // Reads a sequence of digits and an optional decimal point,
  // then returns a NUMBER token with the parsed float value.
  readNumber() {
    const col = this.pos;
    let s = '';
    // Read integer part
    while (this.ch && /\d/.test(this.ch)) { s += this.ch; this.advance(); }
    // Read optional decimal part
    if (this.ch === '.') {
      s += '.'; this.advance();
      while (this.ch && /\d/.test(this.ch)) { s += this.ch; this.advance(); }
    }
    return new Token(TT.NUMBER, parseFloat(s), col);
  }

  // readIdent — called when the current character is a letter or underscore
  // Reads a word, then checks if it's a reserved keyword.
  // If yes → returns the matching keyword token type
  // If no  → returns a plain IDENT (variable name) token
  readIdent() {
    const col = this.pos;
    let s = '';
    while (this.ch && /[A-Za-z_0-9]/.test(this.ch)) { s += this.ch; this.advance(); }
    const lower = s.toLowerCase(); // keywords are case-insensitive
    const keywords = {
      add:   TT.ADD,   sub:   TT.SUB,
      mult:  TT.MULT,  div:   TT.DIV,
      mod:   TT.MOD,   pow:   TT.POW,
      sqrt:  TT.SQRT,  abs:   TT.ABS,
      floor: TT.FLOOR, ceil:  TT.CEIL,
      gt:    TT.GT,    lt:    TT.LT,
      eq:    TT.EQOP,  if:    TT.IF,
      while: TT.WHILE, for:   TT.FOR,
      to:    TT.TO,    print: TT.PRINT,
    };
    if (lower in keywords) return new Token(keywords[lower], lower, col);
    return new Token(TT.IDENT, s, col); // plain variable name
  }

  // tokenize — the main method: scans the entire source and returns
  // an array of Token objects ending with a single EOF token.
  tokenize() {
    const tokens = [];
    while (this.ch !== null) {
      this.skipWS();
      if (this.ch === null) break;

      const c = this.ch, col = this.pos;

      if      (/\d/.test(c))        tokens.push(this.readNumber());
      else if (/[A-Za-z_]/.test(c)) tokens.push(this.readIdent());
      // Single-character symbols:
      else if (c === '=') { tokens.push(new Token(TT.EQUALS, '=', col)); this.advance(); }
      else if (c === ';') { tokens.push(new Token(TT.SEMI,   ';', col)); this.advance(); }
      else if (c === '(') { tokens.push(new Token(TT.LPAREN, '(', col)); this.advance(); }
      else if (c === ')') { tokens.push(new Token(TT.RPAREN, ')', col)); this.advance(); }
      else if (c === '{') { tokens.push(new Token(TT.LBRACE, '{', col)); this.advance(); }
      else if (c === '}') { tokens.push(new Token(TT.RBRACE, '}', col)); this.advance(); }
      // '-' followed by a digit → negative number literal; otherwise → MINUS token
      else if (c === '-') {
        if (this.pos + 1 < this.src.length && /\d/.test(this.src[this.pos + 1])) {
          this.advance(); // consume '-'
          const tok = this.readNumber();
          tok.value = -tok.value;
          tok.col = col;
          tokens.push(tok);
        } else {
          tokens.push(new Token(TT.MINUS, '-', col)); this.advance();
        }
      }
      else throw new InterpError(`Unexpected character '${c}'`, col);
    }
    // Always end with EOF so the parser knows when to stop
    tokens.push(new Token(TT.EOF, null, this.pos));
    return tokens;
  }
}
