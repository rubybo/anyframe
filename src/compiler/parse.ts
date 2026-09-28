export class FrameParseError extends Error {
  readonly line: number;
  readonly column: number;
  readonly filename: string;

  constructor(filename: string, line: number, column: number, message: string) {
    super(`${filename}:${line}:${column}: ${message}`);
    this.name = "FrameParseError";
    this.filename = filename;
    this.line = line;
    this.column = column;
  }
}

export type Loc = { index: number };

export type AttributeNode = {
  name: string;
  value: string | null;
  dynamic: boolean;
  index: number;
};

export type EventNode = {
  name: string;
  modifiers: string[];
  handler: string;
  index: number;
};

export type PropNode = {
  name: string;
  value: string;
  dynamic: boolean;
  index: number;
};

export type TemplateNode =
  | { type: "fragment"; children: TemplateNode[] }
  | { type: "element"; name: string; attributes: AttributeNode[]; events: EventNode[]; children: TemplateNode[]; index: number }
  | { type: "text"; value: string; index: number }
  | { type: "mustache"; expr: string; index: number }
  | { type: "if"; test: string; testIndex: number; then: TemplateNode; else: TemplateNode | null; index: number }
  | { type: "each"; list: string; listIndex: number; item: string; key: string; keyIndex: number; body: TemplateNode; index: number }
  | { type: "component"; name: string; props: PropNode[]; index: number };

export type FrameFile = {
  filename: string;
  source: string;
  script: string;
  css: string;
  template: TemplateNode;
};

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

const MODIFIERS = new Set(["preventDefault", "stopPropagation", "stopImmediatePropagation"]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

export function lineColumn(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(index, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

type TagSpan = {
  openStart: number;
  contentStart: number;
  closeStart: number;
  closeEnd: number;
  content: string;
};

function findTag(source: string, tag: "script" | "style", filename: string): TagSpan | null {
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  const found: TagSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(source))) {
    const openStart = match.index;
    const contentStart = openStart + match[0].length;
    const closeRe = new RegExp(`</${tag}\\s*>`, "i");
    closeRe.lastIndex = contentStart;
    const close = closeRe.exec(source.slice(contentStart));
    if (!close) {
      const loc = lineColumn(source, openStart);
      throw new FrameParseError(filename, loc.line, loc.column, `Unclosed <${tag}>`);
    }
    const closeStart = contentStart + close.index;
    found.push({
      openStart,
      contentStart,
      closeStart,
      closeEnd: closeStart + close[0].length,
      content: source.slice(contentStart, closeStart),
    });
    openRe.lastIndex = closeStart + close[0].length;
  }
  if (found.length > 1) {
    const loc = lineColumn(source, found[1].openStart);
    throw new FrameParseError(filename, loc.line, loc.column, `Only one <${tag}> block is allowed`);
  }
  return found[0] ?? null;
}

function blankRange(source: string, start: number, end: number): string {
  let out = source.slice(0, start);
  for (let i = start; i < end; i++) out += source[i] === "\n" ? "\n" : " ";
  return out + source.slice(end);
}

export function parseFrame(input: string, filename = "Component.frame"): FrameFile {
  const source = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const scriptTag = findTag(source, "script", filename);
  const styleTag = findTag(source, "style", filename);
  let templateSource = source;
  if (scriptTag) templateSource = blankRange(templateSource, scriptTag.openStart, scriptTag.closeEnd);
  if (styleTag) templateSource = blankRange(templateSource, styleTag.openStart, styleTag.closeEnd);
  const parser = new Parser(templateSource, filename);
  const template = parser.parseRoot();
  return {
    filename,
    source,
    script: scriptTag?.content ?? "",
    css: styleTag?.content ?? "",
    template,
  };
}

class Parser {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly filename: string,
  ) {}

  parseRoot(): TemplateNode {
    const children = this.parseSequence(null);
    this.skipWhitespace();
    if (this.pos < this.source.length) {
      this.error(`Unexpected ${this.preview()}`, this.pos);
    }
    return { type: "fragment", children };
  }

  private parseSequence(stop: "if" | "each" | null): TemplateNode[] {
    const children: TemplateNode[] = [];
    while (this.pos < this.source.length) {
      this.skipBom();
      if (this.startsWith("</")) {
        if (stop) this.error(`Unexpected closing tag before {/${stop}}`, this.pos);
        this.error(`Unexpected closing tag ${this.readRawCloseName()}`, this.pos);
      }
      if (this.source[this.pos] === "{") {
        const start = this.pos;
        const inner = this.readMustache();
        const kind = this.classifyMustache(inner, start);
        if (kind.type === "close") {
          if (stop !== kind.block) this.error(`Unexpected {/${kind.block}}`, start);
          return children;
        }
        if (kind.type === "else") {
          if (stop !== "if") this.error("Unexpected {:else}", start);
          this.pendingElse = kind.raw;
          this.pendingElseIndex = start;
          return children;
        }
        if (kind.type === "if") children.push(this.parseIf(kind.test, kind.index, start));
        else if (kind.type === "each") children.push(this.parseEach(kind.header, start));
        else children.push({ type: "mustache", expr: inner.trim(), index: start + 1 });
        continue;
      }
      if (this.source[this.pos] === "<") {
        const node = this.parseTag();
        if (node) children.push(node);
        continue;
      }
      const text = this.readText();
      if (text.value.trim()) children.push(text);
    }
    if (stop) this.error(`Unclosed {#${stop}}`, this.pos);
    return children;
  }

  private pendingElse: string | null = null;
  private pendingElseIndex = 0;

  private parseIf(test: string, testIndex: number, index: number): TemplateNode {
    if (!test.trim()) this.error("Expected a condition after {#if}", testIndex);
    const thenChildren = this.parseSequence("if");
    let elseNode: TemplateNode | null = null;
    if (this.pendingElse !== null) {
      const raw = this.pendingElse;
      const elseIndex = this.pendingElseIndex;
      this.pendingElse = null;
      if (raw === ":else") {
        elseNode = { type: "fragment", children: this.parseSequence("if") };
      } else if (raw.startsWith(":else if")) {
        const nested = raw.slice(":else if".length).trim();
        if (!nested) this.error("Expected a condition after {:else if}", elseIndex);
        elseNode = this.parseIf(nested, elseIndex + raw.indexOf(nested), elseIndex);
      } else {
        this.error("Unexpected {:else}", elseIndex);
      }
    }
    return {
      type: "if",
      test: test.trim(),
      testIndex,
      then: { type: "fragment", children: thenChildren },
      else: elseNode,
      index,
    };
  }

  private parseEach(header: string, index: number): TemplateNode {
    const match = header.match(/^([\s\S]+?)\s+as\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]+)\)\s*$/);
    if (!match) {
      this.error("Expected {#each list as item (key)}", index);
    }
    const list = match[1].trim();
    const item = match[2];
    const key = match[3].trim();
    if (!list) this.error("Expected a list in {#each}", index);
    if (!key) this.error("Expected a key in {#each}", index);
    const listIndex = index + header.indexOf(list) + "{#each ".length;
    const keyIndex = index + header.lastIndexOf("(") + 2;
    const body = { type: "fragment" as const, children: this.parseSequence("each") };
    return { type: "each", list, listIndex, item, key, keyIndex, body, index };
  }

  private classifyMustache(inner: string, index: number):
    | { type: "if"; test: string; index: number }
    | { type: "each"; header: string }
    | { type: "close"; block: "if" | "each" }
    | { type: "else"; raw: string }
    | { type: "interp" } {
    const trimmed = inner.trim();
    if (trimmed.startsWith("#if")) {
      const test = trimmed.slice(3).trim();
      return { type: "if", test, index: index + inner.indexOf(test) + 1 };
    }
    if (trimmed.startsWith("#each")) {
      return { type: "each", header: trimmed.slice(5).trim() };
    }
    if (/^\/if\b/.test(trimmed)) {
      if (!/^\/if\s*$/.test(trimmed)) this.error("Unexpected tokens in {/if}", index);
      return { type: "close", block: "if" };
    }
    if (/^\/each\b/.test(trimmed)) {
      if (!/^\/each\s*$/.test(trimmed)) this.error("Unexpected tokens in {/each}", index);
      return { type: "close", block: "each" };
    }
    if (trimmed === ":else" || trimmed.startsWith(":else if")) return { type: "else", raw: trimmed };
    if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith(":")) {
      this.error(`Unknown block {${trimmed}}`, index);
    }
    if (!trimmed) this.error("Empty expression", index);
    return { type: "interp" };
  }

  private parseTag(): TemplateNode | null {
    const index = this.pos;
    this.pos++;
    if (this.source.startsWith("!--", this.pos)) {
      const end = this.source.indexOf("-->", this.pos);
      if (end < 0) this.error("Unclosed comment", index);
      this.pos = end + 3;
      return null;
    }
    if (this.source[this.pos] === "/") this.error("Unexpected closing tag", index);
    const name = this.readTagName();
    const { attributes, events, selfClosing } = this.parseAttributes();
    const component = /^[A-Z]/.test(name);
    if (component && events.length) this.error("Events on components are not supported", events[0].index);
    if (selfClosing || (!component && VOID_TAGS.has(name))) {
      return component ? this.componentNode(name, attributes, index) : {
        type: "element",
        name,
        attributes,
        events,
        children: [],
        index,
      };
    }
    const children = this.parseElementChildren(name);
    if (component) {
      if (children.some((child) => child.type !== "text" || child.value.trim())) {
        this.error("Slots are not supported", index);
      }
      return this.componentNode(name, attributes, index);
    }
    return { type: "element", name, attributes, events, children, index };
  }

  private componentNode(name: string, attributes: AttributeNode[], index: number): TemplateNode {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) this.error(`Invalid component name <${name}>`, index);
    const props: PropNode[] = attributes.map((attribute) => {
      if (!/^[A-Za-z_$][\w$]*$/.test(attribute.name)) {
        this.error(`Component prop "${attribute.name}" must be an identifier`, attribute.index);
      }
      if (attribute.dynamic) {
        return { name: attribute.name, value: attribute.value ?? "", dynamic: true, index: attribute.index };
      }
      if (attribute.value === null) {
        return { name: attribute.name, value: "true", dynamic: false, index: attribute.index };
      }
      return {
        name: attribute.name,
        value: JSON.stringify(attribute.value),
        dynamic: false,
        index: attribute.index,
      };
    });
    return { type: "component", name, props, index };
  }

  private parseElementChildren(name: string): TemplateNode[] {
    const children: TemplateNode[] = [];
    while (this.pos < this.source.length) {
      if (this.startsWith("</")) {
        const closeAt = this.pos;
        this.pos += 2;
        const closeName = this.readTagName();
        this.skipWhitespace();
        if (this.source[this.pos] !== ">") this.error("Expected > after closing tag", this.pos);
        this.pos++;
        if (closeName !== name) this.error(`Mismatched </${closeName}>, expected </${name}>`, closeAt);
        return children;
      }
      if (this.source[this.pos] === "{") {
        const start = this.pos;
        const inner = this.readMustache();
        const kind = this.classifyMustache(inner, start);
        if (kind.type === "close" || kind.type === "else") {
          this.error(`Unexpected {${inner.trim()}} inside <${name}>`, start);
        }
        if (kind.type === "if") children.push(this.parseIf(kind.test, kind.index, start));
        else if (kind.type === "each") children.push(this.parseEach(kind.header, start));
        else children.push({ type: "mustache", expr: inner.trim(), index: start + 1 });
        continue;
      }
      if (this.source[this.pos] === "<") {
        const node = this.parseTag();
        if (node) children.push(node);
        continue;
      }
      const text = this.readText();
      if (text.value.trim()) children.push(text);
    }
    this.error(`Unclosed <${name}>`, this.pos);
  }

  private parseAttributes(): { attributes: AttributeNode[]; events: EventNode[]; selfClosing: boolean } {
    const attributes: AttributeNode[] = [];
    const events: EventNode[] = [];
    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (this.source.startsWith("/>", this.pos)) {
        this.pos += 2;
        return { attributes, events, selfClosing: true };
      }
      if (this.source[this.pos] === ">") {
        this.pos++;
        return { attributes, events, selfClosing: false };
      }
      const index = this.pos;
      const attrName = this.readAttributeName();
      let value: string | null = null;
      let dynamic = false;
      this.skipWhitespace();
      if (this.source[this.pos] === "=") {
        this.pos++;
        this.skipWhitespace();
        if (this.source[this.pos] === "{") {
          dynamic = true;
          const exprStart = this.pos;
          value = this.readMustache().trim();
          if (!value) this.error("Empty attribute expression", exprStart);
        } else if (this.source[this.pos] === '"' || this.source[this.pos] === "'") {
          value = decodeEntities(this.readQuoted());
        } else {
          const start = this.pos;
          while (this.pos < this.source.length && !/[\s>/=]/.test(this.source[this.pos])) this.pos++;
          if (start === this.pos) this.error("Expected an attribute value", index);
          value = decodeEntities(this.source.slice(start, this.pos));
        }
      }
      if (attrName.startsWith("on:")) {
        const spec = attrName.slice(3);
        const [eventName, ...modifiers] = spec.split("|");
        if (!eventName) this.error("Expected an event name", index);
        if (!dynamic || value === null) this.error(`Expected on:${eventName}={handler}`, index);
        for (const modifier of modifiers) {
          if (!MODIFIERS.has(modifier)) this.error(`Unknown event modifier "${modifier}"`, index);
        }
        events.push({ name: eventName, modifiers, handler: value, index });
      } else {
        attributes.push({ name: attrName, value, dynamic, index });
      }
    }
    this.error("Unterminated tag", this.pos);
  }

  private readText(): { type: "text"; value: string; index: number } {
    const index = this.pos;
    let raw = "";
    while (this.pos < this.source.length && this.source[this.pos] !== "<" && this.source[this.pos] !== "{") {
      raw += this.source[this.pos++];
    }
    return { type: "text", value: decodeEntities(raw), index };
  }

  private readMustache(): string {
    const start = this.pos;
    if (this.source[this.pos] !== "{") this.error("Expected {", this.pos);
    this.pos++;
    const exprStart = this.pos;
    let depth = 1;
    while (this.pos < this.source.length && depth > 0) {
      const char = this.source[this.pos];
      if (char === "'" || char === '"' || char === "`") {
        this.skipString();
        continue;
      }
      if (char === "/" && this.source[this.pos + 1] === "/") {
        this.pos += 2;
        while (this.pos < this.source.length && this.source[this.pos] !== "\n") this.pos++;
        continue;
      }
      if (char === "/" && this.source[this.pos + 1] === "*") {
        this.pos += 2;
        while (this.pos < this.source.length && !(this.source[this.pos] === "*" && this.source[this.pos + 1] === "/")) {
          this.pos++;
        }
        this.pos = Math.min(this.source.length, this.pos + 2);
        continue;
      }
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) break;
      }
      this.pos++;
    }
    if (depth !== 0) this.error("Unterminated {", start);
    const inner = this.source.slice(exprStart, this.pos);
    this.pos++;
    return inner;
  }

  private skipString(): void {
    const quote = this.source[this.pos];
    const start = this.pos;
    this.pos++;
    while (this.pos < this.source.length) {
      const char = this.source[this.pos++];
      if (char === "\\") {
        this.pos++;
        continue;
      }
      if (quote === "`" && char === "$" && this.source[this.pos] === "{") {
        this.pos++;
        let depth = 1;
        while (this.pos < this.source.length && depth > 0) {
          const next = this.source[this.pos];
          if (next === "'" || next === '"' || next === "`") {
            this.skipString();
            continue;
          }
          if (next === "{") depth++;
          else if (next === "}") depth--;
          this.pos++;
        }
        continue;
      }
      if (char === quote) return;
    }
    this.error("Unterminated string", start);
  }

  private readQuoted(): string {
    const quote = this.source[this.pos];
    const start = this.pos;
    this.pos++;
    let value = "";
    while (this.pos < this.source.length) {
      const char = this.source[this.pos++];
      if (char === "\\") {
        value += this.source[this.pos++] ?? "";
        continue;
      }
      if (char === quote) return value;
      value += char;
    }
    this.error("Unterminated string", start);
  }

  private readTagName(): string {
    const start = this.pos;
    if (!/[A-Za-z]/.test(this.source[this.pos] ?? "")) this.error("Expected a tag name", this.pos);
    this.pos++;
    while (this.pos < this.source.length && /[A-Za-z0-9_:-]/.test(this.source[this.pos])) this.pos++;
    return this.source.slice(start, this.pos);
  }

  private readAttributeName(): string {
    const start = this.pos;
    if (!/[^\s=/>]/.test(this.source[this.pos] ?? "")) this.error("Expected an attribute name", this.pos);
    while (this.pos < this.source.length && /[^\s=/>]/.test(this.source[this.pos])) this.pos++;
    return this.source.slice(start, this.pos);
  }

  private readRawCloseName(): string {
    const start = this.pos;
    this.pos = Math.min(this.source.length, this.pos + 12);
    return this.source.slice(start, this.pos);
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) this.pos++;
  }

  private skipBom(): void {}

  private startsWith(value: string): boolean {
    return this.source.startsWith(value, this.pos);
  }

  private preview(): string {
    return this.source.slice(this.pos, this.pos + 12).replace(/\s+/g, " ");
  }

  private error(message: string, index: number): never {
    const loc = lineColumn(this.source, index);
    throw new FrameParseError(this.filename, loc.line, loc.column, message);
  }
}
