"use strict";
// Depends on: AST node classes (parser.js)

// ─────────────────────────────────────────────────────────
//  Optimizer  –  Constant Folding
//
//  Walks the AST bottom-up.  Any sub-expression whose operands
//  are all Number literals is replaced with a single Number
//  node holding the pre-computed result.
//
//  Example:
//    BinOp(add, Number(3), Number(4))  →  Number(7)
//    Builtin(sqrt, Number(16))         →  Number(4)
//    Unary(-, Number(5))               →  Number(-5)
//
//  Nodes that reference variables are left unchanged because
//  their values are not known at compile time.
//
//  this.foldCount counts how many sub-expressions were folded.
// ─────────────────────────────────────────────────────────
class Optimizer {
  constructor() { this.foldCount = 0; }

  fold(node) {
    switch (node.type) {

      case 'Number':
      case 'Ident':
        return node;

      case 'Unary': {
        const operand = this.fold(node.operand);
        if (operand.type === 'Number') {
          this.foldCount++;
          return new NumberNode(-operand.value, node.col);
        }
        return new UnaryNode(node.op, operand, node.col);
      }

      case 'Builtin': {
        const arg = this.fold(node.arg);
        if (arg.type === 'Number') {
          let r;
          switch (node.fn) {
            case 'sqrt':  r = Math.sqrt(arg.value);  break;
            case 'abs':   r = Math.abs(arg.value);   break;
            case 'floor': r = Math.floor(arg.value); break;
            case 'ceil':  r = Math.ceil(arg.value);  break;
          }
          this.foldCount++;
          return new NumberNode(r, node.col);
        }
        return new BuiltinNode(node.fn, arg, node.col);
      }

      case 'BinOp': {
        const left  = this.fold(node.left);
        const right = this.fold(node.right);
        if (left.type === 'Number' && right.type === 'Number') {
          const l = left.value, r = right.value;
          let result = null;
          if (node.op === 'add')  result = l + r;
          if (node.op === 'sub')  result = l - r;
          if (node.op === 'mult') result = l * r;
          if (node.op === 'pow')  result = Math.pow(l, r);
          if (node.op === 'gt')   result = l > r   ? 1 : 0;
          if (node.op === 'lt')   result = l < r   ? 1 : 0;
          if (node.op === 'eq')   result = l === r ? 1 : 0;
          if (node.op === 'div' && r !== 0) result = l / r;
          if (node.op === 'mod' && r !== 0) result = l % r;
          if (result !== null) {
            this.foldCount++;
            return new NumberNode(result, node.col);
          }
        }
        return new BinOpNode(left, node.op, right, node.col);
      }

      case 'Assign':
        return new AssignNode(node.name, this.fold(node.expr), node.col);

      case 'Print':
        return new PrintNode(this.fold(node.expr), node.col);

      case 'If': {
        const cond = this.fold(node.cond);
        const body = node.body.map(s => this.fold(s));
        return new IfNode(cond, body, node.col);
      }

      case 'Program': {
        const prog = new ProgramNode(node.stmts.map(s => this.fold(s)));
        prog.parseErrors = node.parseErrors;
        return prog;
      }

      default: return node;
    }
  }
}
