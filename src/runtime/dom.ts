import { createEffect, onCleanup, state, type Signal } from "./signal.ts";

export type Component = (props?: Record<string, unknown>) => (anchor: Node) => () => void;

export type RenderBlock = (anchor: Node) => (() => void) | void;

export function element(tag: string, scope?: string): HTMLElement {
  const el = document.createElement(tag);
  if (scope) {
    el.setAttribute("data-af-scope", scope);
    el.classList.add(scope);
  }
  return el;
}

export function text(value = ""): Text {
  return document.createTextNode(value);
}

export function setText(node: Text, value: unknown): void {
  const next = value == null ? "" : String(value);
  if (node.data !== next) node.data = next;
}

export function attr(el: Element, name: string, value: unknown): void {
  if (name === "class") {
    const scope = el.getAttribute("data-af-scope");
    const extra = value == null || value === false ? "" : String(value);
    const classes = [scope, extra].filter(Boolean).join(" ");
    if (el.getAttribute("class") !== classes) el.setAttribute("class", classes);
    return;
  }

  const tag = el.tagName;
  if (name === "value" && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")) {
    const input = el as HTMLInputElement;
    const next = value == null ? "" : String(value);
    if (input.value !== next) input.value = next;
    return;
  }

  if ((name === "checked" || name === "indeterminate") && tag === "INPUT") {
    (el as HTMLInputElement)[name] = Boolean(value);
    return;
  }

  if (name.startsWith("aria-") && typeof value === "boolean") {
    el.setAttribute(name, value ? "true" : "false");
    return;
  }

  if (typeof value === "boolean") {
    if (name in el) (el as unknown as Record<string, unknown>)[name] = value;
    if (value) el.setAttribute(name, "");
    else el.removeAttribute(name);
    return;
  }

  if (value == null) {
    el.removeAttribute(name);
    return;
  }

  el.setAttribute(name, String(value));
}

export function listen(el: Element, type: string, handler: EventListener): () => void {
  el.addEventListener(type, handler);
  const off = () => el.removeEventListener(type, handler);
  onCleanup(off);
  return off;
}

export function insert(parent: Node | null, node: Node, anchor?: Node | null): void {
  if (!parent) throw new Error("AnyFrame cannot insert a node without a parent");
  if (anchor) parent.insertBefore(node, anchor);
  else parent.appendChild(node);
}

export function remove(node: Node): void {
  node.parentNode?.removeChild(node);
}

export function comment(label = ""): Comment {
  return document.createComment(label);
}

export function injectCss(id: string, css: string): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

export function branch(
  anchor: Node,
  when: () => unknown,
  thenRender: RenderBlock,
  elseRender?: RenderBlock,
): () => void {
  let current: boolean | null = null;
  let destroy = () => {};

  const stop = createEffect(() => {
    const next = Boolean(when());
    if (next === current) return;
    destroy();
    destroy = () => {};
    current = next;
    const render = next ? thenRender : elseRender;
    if (!render) return;
    const result = render(anchor);
    if (typeof result === "function") destroy = result;
  }, false);

  const dispose = () => {
    stop();
    destroy();
    destroy = () => {};
    current = null;
  };
  onCleanup(dispose);
  return dispose;
}

type Row<T> = {
  key: unknown;
  item: Signal<T>;
  nodes: Node[];
  destroy: () => void;
};

export function repeat<T>(
  anchor: Node,
  getList: () => readonly T[] | null | undefined,
  getKey: (item: T, index: number) => unknown,
  render: (item: Signal<T>, anchor: Node) => (() => void) | void,
): () => void {
  let rows: Array<Row<T>> = [];

  const stop = createEffect(() => {
    const raw = getList();
    const list = Array.isArray(raw) ? Array.from(raw) : [];
    const pool = new Map<unknown, Array<Row<T>>>();
    for (const row of rows) {
      const bucket = pool.get(row.key);
      if (bucket) bucket.push(row);
      else pool.set(row.key, [row]);
    }

    const next: Array<Row<T>> = [];
    const reused = new Set<Row<T>>();
    for (let index = 0; index < list.length; index++) {
      const item = list[index] as T;
      const key = getKey(item, index);
      const bucket = pool.get(key);
      const existing = bucket?.shift();
      if (existing) {
        existing.item.set(item);
        reused.add(existing);
        next.push(existing);
      } else {
        next.push(createRow(item, key));
      }
    }

    for (const row of rows) {
      if (!reused.has(row)) row.destroy();
    }

    const parent = anchor.parentNode;
    if (!parent) throw new Error("AnyFrame each anchor is not mounted");
    for (const row of next) {
      for (const node of row.nodes) parent.insertBefore(node, anchor);
    }
    rows = next;
  }, false);

  function createRow(item: T, key: unknown): Row<T> {
    const parent = anchor.parentNode;
    if (!parent) throw new Error("AnyFrame each anchor is not mounted");
    const marker = comment("each");
    parent.insertBefore(marker, anchor);
    const itemSignal = state(item);
    const before = marker.previousSibling;
    let destroyInner = () => {};
    const result = render(itemSignal, marker);
    if (typeof result === "function") destroyInner = result;
    const nodes: Node[] = [];
    let cursor = before ? before.nextSibling : parent.firstChild;
    while (cursor && cursor !== marker) {
      nodes.push(cursor);
      cursor = cursor.nextSibling;
    }
    nodes.push(marker);
    return {
      key,
      item: itemSignal,
      nodes,
      destroy() {
        destroyInner();
        for (const node of nodes) remove(node);
      },
    };
  }

  const dispose = () => {
    stop();
    for (const row of rows) row.destroy();
    rows = [];
  };
  onCleanup(dispose);
  return dispose;
}

export function mount(component: Component, target: Element, props?: Record<string, unknown>): () => void {
  const anchor = comment("af");
  target.appendChild(anchor);
  const render = component(props ?? {});
  const destroy = render(anchor);
  return () => {
    destroy();
    remove(anchor);
  };
}
