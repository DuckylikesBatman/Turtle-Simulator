"use strict";
// Depends on: sql_lexer.js  (SQL_TT, SqlError, SqlToken)

// ═══════════════════════════════════════════════════════════════
//  SQL PARSER (Syntactic Analysis for the SQL Interpreter)
//
//  Job: turn the token list from SqlLexer into a SQL AST.
//
//  Only SELECT queries are supported (no INSERT/UPDATE/DELETE).
//  Grammar:
//    query  → SELECT cols FROM table
//               (WHERE cond)?
//               (ORDER BY col (ASC|DESC)?)?
//               (LIMIT n)?
//    cols   → '*' | IDENT (',' IDENT)*
//    cond   → IDENT op value (AND cond)*
//    op     → '=' | '!=' | '>' | '<' | '>=' | '<='
//    value  → NUMBER | STRING | IDENT
// ═══════════════════════════════════════════════════════════════

// ── AST Node classes ──────────────────────────────────────────

// SqlSelectNode — the root AST node for a SELECT query
//   cols    — ['*'] for SELECT *, or an array of column name strings
//   from    — the table name string
//   where   — a SqlCondNode or SqlAndNode, or null if no WHERE clause
//   orderBy — { col: string, dir: 'ASC'|'DESC' }, or null
//   limit   — a number, or null if no LIMIT clause
class SqlSelectNode {
  constructor(cols, from, where, orderBy, limit) {
    this.type    = 'SqlSelect';
    this.cols    = cols;
    this.from    = from;
    this.where   = where;
    this.orderBy = orderBy;
    this.limit   = limit;
  }
}

// SqlCondNode — a single WHERE condition, e.g. had_errors = 1
//   col — the column name being tested
//   op  — the comparison operator string ('=', '!=', '>', '<', '>=', '<=')
//   val — the value to compare against (number or string)
class SqlCondNode {
  constructor(col, op, val) { this.type='SqlCond'; this.col=col; this.op=op; this.val=val; }
}

// SqlAndNode — two conditions joined by AND, e.g. had_errors = 1 AND var_count > 2
//   left  — first SqlCondNode (or nested SqlAndNode)
//   right — second SqlCondNode (or nested SqlAndNode)
class SqlAndNode {
  constructor(left, right) { this.type='SqlAnd'; this.left=left; this.right=right; }
}

// ── SqlParser ─────────────────────────────────────────────────
// Recursive-descent parser for SQL queries.
// parse() is the only public method — it returns a SqlSelectNode.
class SqlParser {
  constructor(tokens) {
    this.tokens = tokens; // token array from SqlLexer
    this.pos    = 0;      // current position in token array
  }

  // cur — peek at the current token without consuming it
  get cur() { return this.tokens[this.pos]; }

  // consume — take the current token and advance.
  // If 'expected' is provided, throws if the type doesn't match.
  consume(expected) {
    const t = this.tokens[this.pos++];
    if (expected && t.type !== expected)
      throw new SqlError(`Expected ${expected} but got '${t.value}'`, t.col);
    return t;
  }

  // parseValue — reads the right-hand side of a WHERE condition
  // Accepts numbers, quoted strings, and identifiers (column names used as values)
  parseValue() {
    const t = this.cur;
    if (t.type === SQL_TT.NUMBER || t.type === SQL_TT.STRING || t.type === SQL_TT.IDENT) {
      this.consume(); return t.value;
    }
    throw new SqlError(`Expected a value but got '${t.value}'`, t.col);
  }

  // parseCond — parses one WHERE condition (or a chain of AND conditions)
  // Format: columnName operator value (AND columnName operator value)*
  parseCond() {
    const col   = this.consume(SQL_TT.IDENT).value; // column name
    const opTok = this.cur;
    const OPS   = [SQL_TT.EQ, SQL_TT.NEQ, SQL_TT.GT, SQL_TT.LT, SQL_TT.GTE, SQL_TT.LTE];
    if (!OPS.includes(opTok.type)) throw new SqlError(`Expected a comparison operator`, opTok.col);
    this.consume(); // consume the operator token
    const val  = this.parseValue();
    let   node = new SqlCondNode(col, opTok.value, val);
    // If followed by AND, recursively build a SqlAndNode
    if (this.cur.type === SQL_TT.AND) { this.consume(); node = new SqlAndNode(node, this.parseCond()); }
    return node;
  }

  // parse — the main entry point
  // Parses the full SELECT query and returns a SqlSelectNode
  parse() {
    this.consume(SQL_TT.SELECT);

    // Parse column list: either '*' or a comma-separated list of names
    const cols = [];
    if (this.cur.type === SQL_TT.STAR) { this.consume(); cols.push('*'); }
    else {
      cols.push(this.consume(SQL_TT.IDENT).value);
      while (this.cur.type === SQL_TT.COMMA) {
        this.consume(); // consume the comma
        cols.push(this.consume(SQL_TT.IDENT).value);
      }
    }

    // FROM table_name
    this.consume(SQL_TT.FROM);
    const from = this.consume(SQL_TT.IDENT).value;

    let where = null, orderBy = null, limit = null;

    // Optional WHERE clause
    if (this.cur.type === SQL_TT.WHERE) {
      this.consume(); where = this.parseCond();
    }

    // Optional ORDER BY col (ASC|DESC)
    if (this.cur.type === SQL_TT.ORDER) {
      this.consume();                           // consume ORDER
      this.consume(SQL_TT.BY);                 // consume BY
      const col = this.consume(SQL_TT.IDENT).value;
      let dir = 'ASC'; // default direction is ascending
      if      (this.cur.type === SQL_TT.DESC) { this.consume(); dir = 'DESC'; }
      else if (this.cur.type === SQL_TT.ASC)  { this.consume(); }
      orderBy = { col, dir };
    }

    // Optional LIMIT n
    if (this.cur.type === SQL_TT.LIMIT) {
      this.consume(); limit = this.consume(SQL_TT.NUMBER).value;
    }

    // Any remaining tokens are unexpected
    if (this.cur.type !== SQL_TT.EOF)
      throw new SqlError(`Unexpected token '${this.cur.value}'`, this.cur.col);

    return new SqlSelectNode(cols, from, where, orderBy, limit);
  }
}

// ── prettySqlAST ──────────────────────────────────────────────
// Converts a SqlSelectNode into a human-readable text representation
// for display in the SQL Interpreter's AST panel.
function prettySqlAST(node) {
  const lines = ['SqlSelect'];
  lines.push(`  ├ cols:    ${node.cols.join(', ')}`);
  lines.push(`  ├ from:    ${node.from}`);
  if (node.where)   lines.push(`  ├ where:   ${_condStr(node.where)}`);
  if (node.orderBy) lines.push(`  ├ orderBy: ${node.orderBy.col} ${node.orderBy.dir}`);
  lines.push(`  └ limit:   ${node.limit !== null ? node.limit : '(none)'}`);
  return lines.join('\n');
}

// _condStr — recursively converts a WHERE condition node to a string
// SqlAnd nodes show both sides separated by "AND"
function _condStr(node) {
  if (node.type === 'SqlAnd')
    return `${_condStr(node.left)}\n  │           AND ${_condStr(node.right)}`;
  return `${node.col} ${node.op} ${JSON.stringify(node.val)}`;
}
