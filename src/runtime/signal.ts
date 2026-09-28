export const SIGNAL: unique symbol = Symbol("anyframe.signal");

export interface Signal<T> {
  (): T;
  (value: T): T;
  readonly [SIGNAL]: true;
  get(): T;
  set(value: T): void;
  subscribe(listener: (value: T) => void): () => void;
}

type Listener = {
  run: () => void;
  deps: Set<State<unknown>>;
};

type State<T> = {
  value: T;
  listeners: Set<Listener>;
  subscribers: Set<(value: T) => void>;
};

type Scope = {
  parent: Scope | null;
  cleanups: Array<() => void>;
  children: Scope[];
  disposed: boolean;
};

let owner: Scope | null = null;
let active: Listener | null = null;

export function isSignal(value: unknown): value is Signal<unknown> {
  return (typeof value === "function" || (typeof value === "object" && value !== null)) && SIGNAL in value;
}

function callable<T>(methods: Pick<Signal<T>, "get" | "set" | "subscribe">): Signal<T> {
  const signal = ((...args: [] | [T]): T => {
    if (args.length === 0) return methods.get();
    const next = args[0] as T;
    methods.set(next);
    return next;
  }) as Signal<T>;
  Object.defineProperty(signal, SIGNAL, { value: true });
  signal.get = methods.get;
  signal.set = methods.set;
  signal.subscribe = methods.subscribe;
  return signal;
}

function notify<T>(state: State<T>): void {
  const previous = active;
  active = null;
  const listeners = [...state.listeners];
  const subscribers = [...state.subscribers];
  try {
    for (const listener of listeners) listener.run();
    for (const subscriber of subscribers) subscriber(state.value);
  } finally {
    active = previous;
  }
}

function unlink(listener: Listener): void {
  for (const dep of listener.deps) dep.listeners.delete(listener);
  listener.deps.clear();
}

export function createEffect(fn: () => void | (() => void), register = true): () => void {
  const captured = owner;
  const listener: Listener = { run: () => {}, deps: new Set() };
  let userCleanup: (() => void) | void;
  let disposed = false;

  const run = () => {
    if (disposed) return;
    if (typeof userCleanup === "function") userCleanup();
    userCleanup = undefined;
    unlink(listener);
    const previousOwner = owner;
    const previousActive = active;
    owner = captured;
    active = listener;
    try {
      const result = fn();
      if (typeof result === "function") userCleanup = result;
    } finally {
      active = previousActive;
      owner = previousOwner;
    }
  };

  listener.run = run;
  run();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (typeof userCleanup === "function") userCleanup();
    userCleanup = undefined;
    unlink(listener);
  };

  if (register) onCleanup(dispose);
  return dispose;
}

export function effect(fn: () => void | (() => void)): () => void {
  return createEffect(fn, true);
}

export function onCleanup(fn: () => void): void {
  if (owner) owner.cleanups.push(fn);
}

export function own(): Scope {
  const scope: Scope = { parent: owner, cleanups: [], children: [], disposed: false };
  if (owner) owner.children.push(scope);
  owner = scope;
  return scope;
}

export function release(): void {
  owner = owner?.parent ?? null;
}

export function claim(scope: Scope): void {
  owner = scope;
}

export function dispose(scope: Scope): void {
  if (scope.disposed) return;
  scope.disposed = true;
  for (const child of [...scope.children]) dispose(child);
  const cleanups = scope.cleanups.splice(0);
  for (const cleanup of cleanups) cleanup();
  if (scope.parent) {
    const index = scope.parent.children.indexOf(scope);
    if (index >= 0) scope.parent.children.splice(index, 1);
  }
}

export function state<T>(initial: T): Signal<T> {
  const box: State<T> = {
    value: initial,
    listeners: new Set(),
    subscribers: new Set(),
  };

  return callable({
    get() {
      if (active) {
        box.listeners.add(active);
        active.deps.add(box as State<unknown>);
      }
      return box.value;
    },
    set(next: T) {
      if (Object.is(next, box.value)) return;
      box.value = next;
      notify(box);
    },
    subscribe(listener: (value: T) => void) {
      box.subscribers.add(listener);
      return () => {
        box.subscribers.delete(listener);
      };
    },
  });
}

export function derived<T>(compute: () => T): Signal<T> {
  const current = state<T>(undefined as T);
  effect(() => {
    current(compute());
  });
  return callable({
    get() {
      return current();
    },
    set() {
      throw new Error("Cannot set a derived signal");
    },
    subscribe(listener) {
      return current.subscribe(listener);
    },
  });
}

type Unwrap<T> = T extends Signal<infer U> ? U : T;

/** Read a signal inside a template expression. Plain values pass through. */
export function read<T>(value: T): Unwrap<T> {
  if (isSignal(value)) return value.get() as Unwrap<T>;
  return value as Unwrap<T>;
}

export function prop<T>(props: Record<string, T>, key: string): Signal<T> {
  return callable({
    get() {
      return props[key];
    },
    set() {
      throw new Error(`Cannot assign to prop "${key}"`);
    },
    subscribe(listener) {
      let ready = false;
      const stop = effect(() => {
        const value = props[key];
        if (ready) listener(value);
      });
      ready = true;
      return stop;
    },
  });
}
