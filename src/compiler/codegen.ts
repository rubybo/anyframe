import * as acorn from "acorn";
import { FrameParseError, lineColumn, type TemplateNode } from "./parse.ts";

type Estree = acorn.Node & Record<string, any>;

const GLOBALS = new Set([
  "undefined", "NaN", "Infinity", "Math", "Number", "String", "Boolean", "Array", "Object", "JSON",
  "Date", "console", "window", "document", "globalThis", "isNaN", "parseInt", "parseFloat", "Map",
  "Set", "WeakMap", "WeakSet", "Promise", "Error", "RegExp", "Intl", "Symbol", "ArrayBuffer",
]);

const RESERVED = new Set(
  "break,case,catch,class,const,continue,debugger,default,delete,do,else,export,extends,false,finally,for,function,if,import,in,instanceof,new,null,return,super,switch,this,throw,true,try,typeof,var,void,while,with,yield,let,enum,await,implements,interface,package,private,protected,public,static".split(","),
);

export function scopeClassName(filename: string, css: string): string {
  let hash = 2166136261;
  const input = `${filename}\0${css}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `af-${(hash >>> 0).toString(36)}`;
}

export function scopeCss(css: string, cls: string): string {
  return transformCss(css, true, cls);
}

function transformCss(css: string, rewrite: boolean, cls: string): string {
  let i = 0;
  let out = "";
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const next = end === -1 ? css.length : end + 2;
      out += css.slice(i, next);
      i = next;
      continue;
    }
    if (/\s/.test(css[i] ?? "")) {
      out += css[i];
      i++;
      continue;
    }
    if (css[i] === "@") {
      const start = i;
      let j = i;
      let paren = 0;
      let quote: string | null = null;
      while (j < css.length) {
        const char = css[j];
        if (quote) {
          if (char === "\\") {
            j += 2;
            continue;
          }
          if (char === quote) quote = null;
          j++;
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          j++;
          continue;
        }
        if (char === "(") paren++;
        else if (char === ")") paren--;
        else if ((char === "{" || char === ";") && paren === 0) break;
        j++;
      }
      const prelude = css.slice(start, j);
      if (css[j] === ";") {
        out += `${prelude};`;
        i = j + 1;
        continue;
      }
      if (css[j] !== "{") {
        out += prelude;
        i = j;
        continue;
      }
      const close = matchBrace(css, j);
      const body = css.slice(j + 1, close);
      const keyframes = /@(-webkit-)?keyframes\b/i.test(prelude);
      const transformed = keyframes ? body : transformCss(body, true, cls);
      out += `${prelude}{${transformed}}`;
      i = close + 1;
      continue;
    }
    const brace = findBrace(css, i);
    if (brace < 0) {
      out += css.slice(i);
      break;
    }
    const selector = css.slice(i, brace);
    const close = matchBrace(css, brace);
    const body = css.slice(brace + 1, close);
    const nextSelector = rewrite ? rewriteSelectorList(selector, cls) : selector;
    out += `${nextSelector}{${body}}`;
    i = close + 1;
  }
  return out;
}

function findBrace(css: string, start: number): number {
  let paren = 0;
  let bracket = 0;
  let quote: string | null = null;
  for (let i = start; i < css.length; i++) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    const char = css[i];
    if (quote) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") paren++;
    else if (char === ")") paren--;
    else if (char === "[") bracket++;
    else if (char === "]") bracket--;
    else if (char === "{" && paren === 0 && bracket === 0) return i;
  }
  return -1;
}

function matchBrace(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < css.length; i++) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    const char = css[i];
    if (quote) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unclosed CSS block");
}

function rewriteSelectorList(selector: string, cls: string): string {
  return splitTop(selector, ",").map((part) => rewriteSelector(part.trim(), cls)).join(", ");
}

function splitTop(input: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") paren++;
    else if (char === ")") paren--;
    else if (char === "[") bracket++;
    else if (char === "]") bracket--;
    else if (char === separator && paren === 0 && bracket === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function rewriteSelector(selector: string, cls: string): string {
  const compounds: Array<{ text: string; sep: string }> = [];
  let current = "";
  let paren = 0;
  let bracket = 0;
  let quote: string | null = null;
  const push = (sep: string) => {
    if (current.trim()) compounds.push({ text: current.trim(), sep });
    current = "";
  };
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (quote) {
      current += char;
      if (char === "\\") {
        current += selector[++i] ?? "";
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") paren++;
    else if (char === ")") paren--;
    else if (char === "[") bracket++;
    else if (char === "]") bracket--;
    if (paren === 0 && bracket === 0 && (char === ">" || char === "+" || char === "~")) {
      push(` ${char} `);
      continue;
    }
    if (paren === 0 && bracket === 0 && /\s/.test(char)) {
      let j = i;
      while (j < selector.length && /\s/.test(selector[j])) j++;
      if (j < selector.length && (selector[j] === ">" || selector[j] === "+" || selector[j] === "~")) {
        i = j - 1;
        continue;
      }
      push(" ");
      i = j - 1;
      continue;
    }
    current += char;
  }
  push("");
  return compounds.map((part) => rewriteCompound(part.text, cls) + part.sep).join("").trim();
}

function rewriteCompound(compound: string, cls: string): string {
  if (!compound) return compound;
  if (compound.includes(":scope")) return compound.replace(/:scope/g, `.${cls}`);
  const pseudo = compound.indexOf("::");
  if (pseudo >= 0) return `${compound.slice(0, pseudo)}.${cls}${compound.slice(pseudo)}`;
  return `${compound}.${cls}`;
}

type Rewrite = { code: string; free: string[] };

export function rewriteExpression(expr: string, boundNames: ReadonlySet<string> = new Set()): Rewrite {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error("Empty expression");
  let ast: Estree;
  try {
    ast = acorn.parseExpressionAt(trimmed, 0, { ecmaVersion: 2022 }) as Estree;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
  if (trimmed.slice(ast.end).trim()) throw new Error(`Unexpected trailing input in \`${trimmed}\``);

  const bindingNodes = new Set<Estree>();
  markBindings(ast, bindingNodes);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const free: string[] = [];

  const visit = (node: Estree | null, parent: Estree | null) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Identifier") {
      if (!isReference(node, parent, bindingNodes)) return;
      if (boundNames.has(node.name)) return;
      const shorthand = parent?.type === "Property" && parent.shorthand && parent.key === node;
      replacements.push({
        start: node.start,
        end: node.end,
        text: shorthand ? `${node.name}: __af.read(${node.name})` : `__af.read(${node.name})`,
      });
      free.push(node.name);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "type") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === "string") visit(child, node);
        }
      } else if (value && typeof value.type === "string") {
        visit(value, node);
      }
    }
  };
  visit(ast, null);

  let code = trimmed;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, replacement.start) + replacement.text + code.slice(replacement.end);
  }
  return { code, free: [...new Set(free)] };
}

function isReference(node: Estree, parent: Estree | null, bindingNodes: Set<Estree>): boolean {
  if (bindingNodes.has(node)) return false;
  if (!parent) return true;
  if ((parent.type === "MemberExpression" || parent.type === "MetaProperty") && parent.property === node && !parent.computed) {
    return false;
  }
  if (parent.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return false;
  if (parent.type === "LabeledStatement" && parent.label === node) return false;
  if ((parent.type === "BreakStatement" || parent.type === "ContinueStatement") && parent.label === node) return false;
  return true;
}

function markBindings(node: Estree | null, bindings: Set<Estree>): void {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "VariableDeclaration") {
    for (const declarator of node.declarations) markPattern(declarator.id, bindings);
  } else if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
    bindings.add(node.id);
  } else if (node.type === "CatchClause" && node.param) {
    markPattern(node.param, bindings);
  }
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
    for (const param of node.params) markPattern(param, bindings);
  }
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "type") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) markBindings(child, bindings);
    } else if (value && typeof value.type === "string") {
      markBindings(value, bindings);
    }
  }
}

function markPattern(pattern: Estree | null, bindings: Set<Estree>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      bindings.add(pattern);
      break;
    case "AssignmentPattern":
      markPattern(pattern.left, bindings);
      break;
    case "RestElement":
      markPattern(pattern.argument, bindings);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") markPattern(prop.argument, bindings);
        else markPattern(prop.value, bindings);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) markPattern(element, bindings);
      break;
    default:
      break;
  }
}

export type ScriptParts = {
  imports: string;
  body: string;
  bindings: Set<string>;
};

export function splitScript(code: string, filename: string): ScriptParts {
  const trimmed = code.replace(/\/\*[\s\S]*?\*\//g, "").trim() ? code : "";
  if (!trimmed.trim()) return { imports: "", body: "", bindings: new Set() };
  let ast: Estree;
  try {
    ast = acorn.parse(trimmed, { ecmaVersion: "latest", sourceType: "module", locations: true }) as Estree;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FrameParseError(filename, 1, 1, message);
  }
  const imports: string[] = [];
  const body: string[] = [];
  const bindings = new Set<string>();
  for (const statement of ast.body) {
    const text = trimmed.slice(statement.start, statement.end);
    if (statement.type === "ImportDeclaration") {
      imports.push(text);
      for (const specifier of statement.specifiers) bindings.add(specifier.local.name);
      continue;
    }
    if (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration" || statement.type === "ExportAllDeclaration") {
      const loc = statement.loc?.start;
      throw new FrameParseError(filename, loc?.line ?? 1, loc?.column ? loc.column + 1 : 1, "export in <script> is not supported");
    }
    body.push(text);
    if (statement.type === "FunctionDeclaration" && statement.id) bindings.add(statement.id.name);
    if (statement.type === "ClassDeclaration" && statement.id) bindings.add(statement.id.name);
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations) collectNames(declarator.id, bindings);
    }
  }
  return { imports: imports.join("\n"), body: body.join("\n"), bindings };
}

function collectNames(pattern: Estree | null, bindings: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      bindings.add(pattern.name);
      break;
    case "AssignmentPattern":
      collectNames(pattern.left, bindings);
      break;
    case "RestElement":
      collectNames(pattern.argument, bindings);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") collectNames(prop.argument, bindings);
        else collectNames(prop.value, bindings);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) collectNames(element, bindings);
      break;
    default:
      break;
  }
}

export function generateModule(options: {
  template: TemplateNode;
  script: ScriptParts;
  css: string;
  filename: string;
  source: string;
}): string {
  const cls = options.css.trim() ? scopeClassName(options.filename, options.css) : null;
  const scoped = cls ? scopeCss(options.css, cls) : "";
  const gen = new Generator(options.script.bindings, cls, options.filename, options.source);
  gen.nodes(options.template, "__afAnchor.parentNode", "__afAnchor", new Set());
  const view = gen.emit();
  const props = [...gen.propNames].map((name) => `const ${name} = __af.prop(__afProps, ${JSON.stringify(name)});`);
  const cssLine = cls ? `__af.injectCss(${JSON.stringify(`af-style-${cls}`)}, ${JSON.stringify(scoped)});` : "";
  const runtime = ["__af", "state", "derived", "effect", "read"].filter((name) => !options.script.bindings.has(name));
  const runtimeImport = runtime.length ? `import { ${runtime.join(", ")} } from "anyframe";` : "";
  const imports = [runtimeImport, options.script.imports].filter(Boolean).join("\n");
  return `${imports}
export default function Component(__afProps = {}) {
  const __afScope = __af.own();
  try {
    ${cssLine}
    ${props.join("\n    ")}
    ${indent(options.script.body, 4)}
    return (__afAnchor) => {
      __af.claim(__afScope);
      try {
        ${indent(view, 8)}
        return () => __af.dispose(__afScope);
      } catch (__afError) {
        __af.dispose(__afScope);
        throw __afError;
      } finally {
        __af.release();
      }
    };
  } catch (__afError) {
    __af.dispose(__afScope);
    throw __afError;
  } finally {
    __af.release();
  }
}
`;
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  if (!code.trim()) return "";
  return code.split("\n").map((line) => (line.trim() ? pad + line : line)).join("\n").trim();
}

class Generator {
  private lines: string[] = [];
  private count = 0;
  readonly propNames = new Set<string>();

  constructor(
    private readonly bindings: Set<string>,
    private readonly scopeClass: string | null,
    private readonly filename: string,
    private readonly source: string,
  ) {}

  emit(): string {
    return this.lines.join("\n");
  }

  private temp(): string {
    return `__n${this.count++}`;
  }

  private push(line: string): void {
    this.lines.push(line);
  }

  private expression(text: string, locals: Set<string>, bound: ReadonlySet<string>, index: number): string {
    try {
      const rewritten = rewriteExpression(text, bound);
      for (const name of rewritten.free) {
        if (this.bindings.has(name) || locals.has(name) || GLOBALS.has(name) || RESERVED.has(name)) continue;
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        this.propNames.add(name);
      }
      return rewritten.code;
    } catch (error) {
      if (error instanceof FrameParseError) throw error;
      const loc = lineColumn(this.source, index);
      const message = error instanceof Error ? error.message : String(error);
      throw new FrameParseError(this.filename, loc.line, loc.column, message);
    }
  }

  nodes(node: TemplateNode, parent: string, anchor: string, locals: Set<string>): void {
    if (node.type === "fragment") {
      for (const child of node.children) this.nodes(child, parent, anchor, locals);
      return;
    }
    if (node.type === "text") {
      const id = this.temp();
      this.push(`const ${id} = __af.text(${JSON.stringify(node.value)});`);
      this.push(`__af.insert(${parent}, ${id}, ${anchor});`);
      this.push(`__af.onCleanup(() => __af.remove(${id}));`);
      return;
    }
    if (node.type === "mustache") {
      const id = this.temp();
      const code = this.expression(node.expr, locals, new Set(), node.index);
      this.push(`const ${id} = __af.text("");`);
      this.push(`__af.insert(${parent}, ${id}, ${anchor});`);
      this.push(`__af.onCleanup(() => __af.remove(${id}));`);
      this.push(`__af.effect(() => { __af.setText(${id}, ${code}); });`);
      return;
    }
    if (node.type === "element") {
      const id = this.temp();
      this.push(`const ${id} = __af.element(${JSON.stringify(node.name)}, ${this.scopeClass ? JSON.stringify(this.scopeClass) : "undefined"});`);
      for (const attribute of node.attributes) {
        if (attribute.dynamic) {
          const code = this.expression(attribute.value ?? "", locals, new Set(), attribute.index);
          this.push(`__af.effect(() => { __af.attr(${id}, ${JSON.stringify(attribute.name)}, ${code}); });`);
        } else if (attribute.value !== null) {
          this.push(`__af.attr(${id}, ${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.value)});`);
        } else {
          this.push(`__af.attr(${id}, ${JSON.stringify(attribute.name)}, true);`);
        }
      }
      for (const event of node.events) {
        const handler = this.expression(event.handler, locals, new Set(), event.index);
        const modifiers = event.modifiers.map((modifier) => `event.${modifier}();`).join("\n");
        this.push(`__af.listen(${id}, ${JSON.stringify(event.name)}, (event) => {
        ${modifiers}
        const __fn = ${handler};
        __fn(event);
      });`);
      }
      this.push(`__af.insert(${parent}, ${id}, ${anchor});`);
      this.push(`__af.onCleanup(() => __af.remove(${id}));`);
      for (const child of node.children) this.nodes(child, id, "null", locals);
      return;
    }
    if (node.type === "if") {
      const slot = this.anchor(parent, anchor);
      const test = this.expression(node.test, locals, new Set(), node.testIndex);
      const thenFn = this.block(node.then, locals);
      const elseFn = node.else ? this.block(node.else, locals) : "undefined";
      this.push(`__af.branch(${slot}, () => (${test}), ${thenFn}, ${elseFn});`);
      return;
    }
    if (node.type === "each") {
      const slot = this.anchor(parent, anchor);
      const list = this.expression(node.list, locals, new Set(), node.listIndex);
      const key = this.expression(node.key, locals, new Set([node.item]), node.keyIndex);
      const childLocals = new Set(locals);
      childLocals.add(node.item);
      const body = this.block(node.body, childLocals, node.item);
      this.push(`__af.repeat(${slot}, () => (${list}), (${node.item}, __index) => (${key}), ${body});`);
      return;
    }
    if (node.type === "component") {
      const slot = anchor === "null" ? this.anchor(parent, anchor) : anchor;
      const props = this.temp();
      this.push(`const ${props} = {};`);
      for (const prop of node.props) {
        const value = prop.dynamic ? this.expression(prop.value, locals, new Set(), prop.index) : prop.value;
        this.push(`Object.defineProperty(${props}, ${JSON.stringify(prop.name)}, { enumerable: true, get() { return ${value}; } });`);
      }
      this.push(`__af.onCleanup(${node.name}(${props})(${slot}));`);
    }
  }

  private anchor(parent: string, anchor: string): string {
    const id = this.temp();
    this.push(`const ${id} = __af.comment();`);
    this.push(`__af.insert(${parent}, ${id}, ${anchor});`);
    this.push(`__af.onCleanup(() => __af.remove(${id}));`);
    return id;
  }

  private block(node: TemplateNode, locals: Set<string>, itemName?: string): string {
    const nested = new Generator(this.bindings, this.scopeClass, this.filename, this.source);
    const param = itemName ? `${itemName}, __afAnchor` : "__afAnchor";
    nested.nodes(node, "__afAnchor.parentNode", "__afAnchor", locals);
    for (const name of nested.propNames) this.propNames.add(name);
    const body = nested.emit();
    return `(${param}) => {
      const __afScope = __af.own();
      try {
        ${indent(body, 8)}
        return () => __af.dispose(__afScope);
      } catch (__afError) {
        __af.dispose(__afScope);
        throw __afError;
      } finally {
        __af.release();
      }
    }`;
  }
}
