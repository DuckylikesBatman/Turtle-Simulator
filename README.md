# Mathematical Expression Interpreter

A browser-based interpreter that visualizes every stage of the interpretation pipeline for a simple mathematical language.

## How to Run

Open `index.html` in any modern browser — no build step or server required.

## Pipeline Stages

The app processes each program through three stages, displaying the output of each:

| Stage | Component | Description |
|-------|-----------|-------------|
| 1 | **Lexer** | Converts source text into a token stream |
| 2 | **Parser** | Builds an Abstract Syntax Tree (AST) from the tokens |
| 3 | **Evaluator** | Tree-walks the AST to produce results and a trace |

## Language Reference

### Assignment

```
x = 10;
y = x add 5;
```

### Arithmetic Operators

| Keyword | Operation |
|---------|-----------|
| `add`   | Addition |
| `sub`   | Subtraction |
| `mult`  | Multiplication |
| `div`   | Division |
| `mod`   | Modulo |
| `pow`   | Exponentiation |

### Comparison Operators

Returns `1` (true) or `0` (false).

| Keyword | Operation |
|---------|-----------|
| `gt`    | Greater than |
| `lt`    | Less than |
| `eq`    | Equal to |

### Built-in Functions

```
x = sqrt(16);
y = abs(-5);
z = floor(3.7);
w = ceil(3.2);
```

### Control Flow

```
if (x gt 0) {
    print(x);
}
```

### Output

```
print(x add y);
```

### Comments

```
# This is a comment
x = 42;  # inline comment
```

### Grammar (EBNF)

```
program    → statement* EOF
statement  → IDENT '=' expr ';'
           | 'print' '(' expr ')' ';'
           | 'if' '(' expr ')' '{' statement* '}'
expr       → addExpr ( ('gt'|'lt'|'eq') addExpr )?
addExpr    → term   ( ('add'|'sub')         term   )*
term       → power  ( ('mult'|'div'|'mod')  power  )*
power      → factor ( 'pow' factor )?
factor     → NUMBER | IDENT | '(' expr ')' | '-' factor
           | ('sqrt'|'abs'|'floor'|'ceil') '(' expr ')'
```

## Example Program

```
a = 10;
b = 3;
c = a mod b;
d = sqrt(a mult a add b mult b);
print(c);
print(d);

if (a gt b) {
    result = a sub b;
    print(result);
}
```

## Features

- **Step mode** — execute one statement at a time using the Step button
- **Token view** — inspect the raw token stream from the lexer
- **AST view** — toggle between text and visual tree representations
- **Evaluation trace** — see every reduction step during tree-walking
- **Symbol table** — live view of all assigned variables
- **Database** — programs and run history are persisted via SQLite (sql.js) in the browser, with a built-in SQL console

## File Structure

```
index.html          — UI layout and pipeline display
style.css           — Styles
js/
  lexer.js          — Tokenizer (Stage 1)
  parser.js         — Parser and AST node definitions (Stage 2)
  evaluator.js      — Tree-walking evaluator (Stage 3)
  database.js       — sql.js database integration
  main.js           — UI wiring and run/step logic
```
