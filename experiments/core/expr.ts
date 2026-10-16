// Parses Vensim expressions (the right-hand side of an equation) into a syntax tree.

export type Expr =
  | { type: "num"; value: number }
  | { type: "na" }
  | { type: "ref"; key: string; subscripts: SubscriptRef[] }
  | { type: "call"; fn: string; args: Expr[] }
  | { type: "unary"; op: "-" | "not"; arg: Expr }
  | { type: "binary"; op: BinaryOp; left: Expr; right: Expr };

export type SubscriptRef = { key: string; bang: boolean };

export type BinaryOp = "+" | "-" | "*" | "/" | "^" | "=" | "<>" | "<" | ">" | "<=" | ">=" | "and" | "or";

export function parseExpression(source: string): Expr {
  const parser = new Parser(tokenize(source));
  const expr = parser.parseExpr();
  parser.expectEnd();
  return expr;
}

export function referencedKeys(expr: Expr, into = new Set<string>()): Set<string> {
  if (expr.type === "ref") into.add(expr.key);
  if (expr.type === "call") expr.args.forEach((a) => referencedKeys(a, into));
  if (expr.type === "unary") referencedKeys(expr.arg, into);
  if (expr.type === "binary") {
    referencedKeys(expr.left, into);
    referencedKeys(expr.right, into);
  }
  return into;
}

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "kw"; v: "NA" | "AND" | "OR" | "NOT" }
  | { t: "eof" };

const NAME_WORD = /^[A-Za-z_][A-Za-z0-9_$'&%.]*/;
const NEXT_NAME_WORD = /^\s+([A-Za-z0-9_$'&%.]+)/;
const NUMBER = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"') {
      const end = source.indexOf('"', i + 1);
      tokens.push({ t: "id", v: source.slice(i + 1, end) });
      i = end + 1;
    } else if (NUMBER.test(rest)) {
      const m = rest.match(NUMBER)![0];
      tokens.push({ t: "num", v: Number(m) });
      i += m.length;
    } else if (NAME_WORD.test(rest)) {
      let name = rest.match(NAME_WORD)![0];
      let next: RegExpMatchArray | null;
      while ((next = rest.slice(name.length).match(NEXT_NAME_WORD))) name += next[0];
      tokens.push({ t: "id", v: name });
      i += name.length;
    } else if (/^:(NA|AND|OR|NOT):/i.test(rest)) {
      const kw = rest.match(/^:(NA|AND|OR|NOT):/i)!;
      tokens.push({ t: "kw", v: kw[1].toUpperCase() as "NA" | "AND" | "OR" | "NOT" });
      i += kw[0].length;
    } else if (/^(<>|<=|>=)/.test(rest)) {
      tokens.push({ t: "op", v: rest.slice(0, 2) });
      i += 2;
    } else if ("+-*/^=<>()[],!".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i++;
    } else {
      throw new Error(`Unexpected character "${ch}" in: ${source}`);
    }
  }
  tokens.push({ t: "eof" });
  return tokens;
}

class Parser {
  private pos = 0;
  private tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseExpr(): Expr {
    return this.parseOr();
  }

  expectEnd() {
    if (this.peek().t !== "eof") throw new Error(`Unexpected token ${JSON.stringify(this.peek())}`);
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("OR")) {
      this.pos++;
      left = { type: "binary", op: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKeyword("AND")) {
      this.pos++;
      left = { type: "binary", op: "and", left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isKeyword("NOT")) {
      this.pos++;
      return { type: "unary", op: "not", arg: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseAdditive();
    const op = this.peekOp(["=", "<>", "<", ">", "<=", ">="]);
    if (!op) return left;
    this.pos++;
    return { type: "binary", op: op as BinaryOp, left, right: this.parseAdditive() };
  }

  private parseAdditive(): Expr {
    let left = this.parseTerm();
    let op: string | null;
    while ((op = this.peekOp(["+", "-"]))) {
      this.pos++;
      left = { type: "binary", op: op as BinaryOp, left, right: this.parseTerm() };
    }
    return left;
  }

  private parseTerm(): Expr {
    let left = this.parseUnary();
    let op: string | null;
    while ((op = this.peekOp(["*", "/"]))) {
      this.pos++;
      left = { type: "binary", op: op as BinaryOp, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Expr {
    const op = this.peekOp(["-", "+"]);
    if (!op) return this.parsePower();
    this.pos++;
    const arg = this.parseUnary();
    if (op === "+") return arg;
    if (arg.type === "num") return { type: "num", value: -arg.value };
    return { type: "unary", op: "-", arg };
  }

  private parsePower(): Expr {
    const base = this.parsePrimary();
    if (!this.peekOp(["^"])) return base;
    this.pos++;
    return { type: "binary", op: "^", left: base, right: this.parseUnary() };
  }

  private parsePrimary(): Expr {
    const token = this.next();
    if (token.t === "num") return { type: "num", value: token.v };
    if (token.t === "kw" && token.v === "NA") return { type: "na" };
    if (token.t === "op" && token.v === "(") {
      const inner = this.parseExpr();
      this.expectOp(")");
      return inner;
    }
    if (token.t === "id") {
      if (this.peekOp(["("])) {
        this.pos++;
        return { type: "call", fn: token.v.toUpperCase().replace(/[_\s]+/g, " ").trim(), args: this.parseArgs() };
      }
      const key = token.v.toLowerCase().replace(/[_\s]+/g, " ").trim();
      return { type: "ref", key, subscripts: this.peekOp(["["]) ? this.parseSubscripts() : [] };
    }
    throw new Error(`Unexpected token ${JSON.stringify(token)}`);
  }

  private parseArgs(): Expr[] {
    const args: Expr[] = [];
    if (this.peekOp([")"])) {
      this.pos++;
      return args;
    }
    while (true) {
      args.push(this.parseExpr());
      if (this.peekOp([")"])) {
        this.pos++;
        return args;
      }
      this.expectOp(",");
    }
  }

  private parseSubscripts(): SubscriptRef[] {
    this.expectOp("[");
    const subscripts: SubscriptRef[] = [];
    while (true) {
      const token = this.next();
      if (token.t !== "id") throw new Error(`Expected subscript, got ${JSON.stringify(token)}`);
      const bang = !!this.peekOp(["!"]);
      if (bang) this.pos++;
      subscripts.push({ key: token.v.toLowerCase().replace(/[_\s]+/g, " ").trim(), bang });
      if (this.peekOp(["]"])) {
        this.pos++;
        return subscripts;
      }
      this.expectOp(",");
    }
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private peekOp(ops: string[]): string | null {
    const token = this.peek();
    return token.t === "op" && ops.includes(token.v) ? token.v : null;
  }

  private isKeyword(kw: string): boolean {
    const token = this.peek();
    return token.t === "kw" && token.v === kw;
  }

  private expectOp(op: string) {
    const token = this.next();
    if (token.t !== "op" || token.v !== op) throw new Error(`Expected "${op}", got ${JSON.stringify(token)}`);
  }
}
