const MAX_EXPR_LENGTH = 256;
const MAX_AST_NODES = 80;

const ALLOWED_VARIABLES = new Set([
  'x',
  'v',
  'vx',
  't',
  'theta',
  'omega',
  'k',
  'm',
  'g',
  'A',
  'w',
  'gamma',
  'mu',
  'pi',
  'e'
]);

const FORBIDDEN_PATTERNS = [
  /__proto__/i,
  /\bconstructor\b/i,
  /\bprototype\b/i,
  /\bprocess\b/i,
  /\bglobalThis\b/i,
  /\bwindow\b/i,
  /\bimport\b/i,
  /\brequire\b/i,
  /\beval\b/i,
  /\bFunction\b/i,
  /\bcreateUnit\b/i,
  /\bevaluate\b/i
];

type UnaryFn = (arg: number) => number;
type BinaryFn = (a: number, b: number) => number;

const UNARY_FUNCTIONS: Readonly<Record<string, UnaryFn>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sign: Math.sign
};

const BINARY_FUNCTIONS: Readonly<Record<string, BinaryFn>> = {
  atan2: Math.atan2,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  hypot: Math.hypot
};

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

export type SafeAstNode =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '+' | '-'; arg: SafeAstNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: SafeAstNode; right: SafeAstNode }
  | { kind: 'call'; fn: string; args: readonly SafeAstNode[] };

export interface CompiledSafeFormula {
  readonly expr: string;
  readonly nodeCount: number;
  readonly evaluate: (scope: Readonly<Record<string, number>>) => number;
}

/** Compatibility/reference-test hook; production expressions use one deterministic grammar. */
export async function preloadMathjsCompiler(): Promise<void> {
  await import('mathjs');
}

function precheckRawExpression(expr: string): void {
  const trimmed = expr.trim();
  if (!trimmed) {
    throw new Error('Expression must be a non-empty string.');
  }
  if (trimmed.length > MAX_EXPR_LENGTH) {
    throw new Error(`Expression length exceeds limit (${MAX_EXPR_LENGTH} chars).`);
  }
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(trimmed)) {
      throw new Error(`Rejected disallowed identifier in expression: "${trimmed}"`);
    }
  }
  if (/[[\]{};=`\\$"'@]/.test(trimmed) || trimmed.includes('.')) {
    // Allow numeric decimal dots, reject identifier member access like a.b
    if (!/^[\d\s+\-*/^(),a-zA-Z_.]+$/.test(trimmed) || /[a-zA-Z_]\s*\./.test(trimmed)) {
      throw new Error(`Disallowed syntax or member access in expression: "${trimmed}"`);
    }
  }
}

function tokenizeFallback(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && i + 1 < expr.length && /\d/.test(expr[i + 1]!))) {
      const literal=expr.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0];
      if(!literal)throw new Error('Invalid number token.');
      const end=i+literal.length;
      const val=Number(literal);
      if (!Number.isFinite(val)) throw new Error(`Invalid number token in "${expr}".`);
      tokens.push({ kind: 'num', value: val });
      i = end;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let end = i;
      while (end < expr.length && /[a-zA-Z0-9_]/.test(expr[end]!)) end += 1;
      tokens.push({ kind: 'id', value: expr.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' });
      i += 1;
      continue;
    }
    throw new Error(`Unsupported character "${ch}" in expression.`);
  }
  return tokens;
}

function parseTokensToAst(tokens: readonly Token[]): { ast: SafeAstNode; nodeCount: number } {
  let pos = 0;
  let count = 0;
  const bump = () => {
    count += 1;
    if (count > MAX_AST_NODES) {
      throw new Error(`AST complexity exceeds safe maximum (${MAX_AST_NODES} nodes).`);
    }
  };

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parsePrimary = (): SafeAstNode => {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of expression.');
    if (tok.kind === 'num') {
      consume();
      bump();
      return { kind: 'num', value: tok.value };
    }
    if (tok.kind === 'lparen') {
      consume();
      const inner = parseAddSub();
      if (peek()?.kind !== 'rparen') throw new Error('Mismatched parenthesis.');
      consume();
      return inner;
    }
    if (tok.kind === 'id') {
      consume();
      if (peek()?.kind === 'lparen') {
        consume();
        const args: SafeAstNode[] = [];
        if (peek()?.kind !== 'rparen') {
          args.push(parseAddSub());
          while (peek()?.kind === 'comma') {
            consume();
            args.push(parseAddSub());
          }
        }
        if (peek()?.kind !== 'rparen') throw new Error(`Expected closing ")" for ${tok.value}.`);
        consume();
        if (
          (Object.prototype.hasOwnProperty.call(UNARY_FUNCTIONS,tok.value) && args.length === 1) ||
          (Object.prototype.hasOwnProperty.call(BINARY_FUNCTIONS,tok.value) && args.length === 2)
        ) {
          bump();
          return { kind: 'call', fn: tok.value, args };
        }
        throw new Error(`Function "${tok.value}" with ${args.length} args is not whitelisted.`);
      }
      if (!ALLOWED_VARIABLES.has(tok.value)) {
        throw new Error(`Identifier "${tok.value}" is not in the physics variable whitelist.`);
      }
      bump();
      return { kind: 'var', name: tok.value };
    }
    throw new Error(`Unexpected token in expression.`);
  };

  const parseUnary = (): SafeAstNode => {
    const tok = peek();
    if (tok && tok.kind === 'op' && (tok.value === '+' || tok.value === '-')) {
      consume();
      bump();
      return { kind: 'unary', op: tok.value, arg: parseUnary() };
    }
    return parsePower();
  };

  const parsePower = (): SafeAstNode => {
    const left = parsePrimary();
    const tok = peek();
    if (tok && tok.kind === 'op' && tok.value === '^') {
      consume();
      bump();
      return { kind: 'binary', op: '^', left, right: parseUnary() };
    }
    return left;
  };

  const parseMulDiv = (): SafeAstNode => {
    let node = parseUnary();
    while (true) {
      const tok = peek();
      if (!tok || tok.kind !== 'op' || (tok.value !== '*' && tok.value !== '/')) break;
      consume();
      bump();
      node = { kind: 'binary', op: tok.value, left: node, right: parseUnary() };
    }
    return node;
  };

  const parseAddSub = (): SafeAstNode => {
    let node = parseMulDiv();
    while (true) {
      const tok = peek();
      if (!tok || tok.kind !== 'op' || (tok.value !== '+' && tok.value !== '-')) break;
      consume();
      bump();
      node = { kind: 'binary', op: tok.value, left: node, right: parseMulDiv() };
    }
    return node;
  };

  const ast = parseAddSub();
  if (pos < tokens.length) {
    throw new Error('Unexpected trailing tokens in expression.');
  }
  return { ast, nodeCount: count };
}

function evalSafeAst(node: SafeAstNode, scope: Readonly<Record<string, number>>): number {
  const value=evalNode(node,scope);
  if(!Number.isFinite(value))throw new Error('Expression produced a non-finite real value.');
  return value;
}
function evalNode(node: SafeAstNode, scope: Readonly<Record<string, number>>): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var': {
      if (node.name === 'pi') return Math.PI;
      if (node.name === 'e') return Math.E;
      if(!Object.prototype.hasOwnProperty.call(scope,node.name))throw new Error('Missing variable '+node.name);
      return scope[node.name]!;
    }
    case 'unary': {
      const v = evalSafeAst(node.arg, scope);
      return node.op === '-' ? -v : v;
    }
    case 'binary': {
      const l = evalSafeAst(node.left, scope);
      const r = evalSafeAst(node.right, scope);
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          if(r===0)throw new Error('Division by zero.');
          return l/r;
        case '^':
          return Math.pow(l, r);
      }
    }
    case 'call': {
      if (node.args.length === 1) {
        const fn = UNARY_FUNCTIONS[node.fn]!;
        return fn(evalSafeAst(node.args[0]!, scope));
      }
      const fn2 = BINARY_FUNCTIONS[node.fn]!;
      return fn2(evalSafeAst(node.args[0]!, scope), evalSafeAst(node.args[1]!, scope));
    }
  }
}

/** One bounded, explicit grammar; no readiness-dependent interpretation or executable code. */
export function compileSafeFormula(expr: string): CompiledSafeFormula {
  precheckRawExpression(expr);
  const {ast,nodeCount}=parseTokensToAst(tokenizeFallback(expr));
  return {expr:expr.trim(),nodeCount,evaluate:scope=>evalSafeAst(ast,scope)};
}
