# AnyFrame

AnyFrame is a small component compiler. A `.frame` file has a script, a template, and optional scoped CSS. The compiler turns the template into DOM updates.

`state`, `derived`, `effect`, and `read` are already in scope inside `<script>`. Read and write a signal with `.get()` and `.set()`. In the template, `{name}` reads a signal, so `{items}` and `{if items.length === 0}` stay up to date. A plain `let` is not reactive.

```html
<script>
  import Item from "./Item.frame";

  const items = state([]);
</script>

{each items as item (item.id)}
  <Item item={item} />
{/each}

<style>
  :scope { display: grid; gap: 8px; }
</style>
```

A template is HTML plus a few blocks:

- `{expr}` prints a value.
- `@click={handler}` listens. `@submit.prevent={handler}` calls `preventDefault` first. `stop` and `stopImmediate` work the same way.
- `{if expr}` … `{else}` … `{else if expr}` … `{/if}` chooses a branch.
- `{each list as item (key)}` … `{/each}` repeats a branch and reuses a row when its key stays the same.
- A capitalized tag is a child component. Several root nodes are a fragment.

Scoped CSS adds a hash class to every element in the file and rewrites selectors, including `:scope`.

TypeScript in `<script>` is stripped with esbuild. The Vite plugin reloads the page when a `.frame` file changes.

Out of scope for v1: SSR, hydration, slots, context, animations, stores, `bind:value`, and assignment tracking.

## Run the task list

```sh
npm install
npm run dev
```

Open http://127.0.0.1:43123 . Add a task, tick it, and switch All / Open / Done. The empty copy changes with the filter.

## Tests

```sh
npm test
```

Signal tests cover subscribe, derived values, and effect cleanup. Compiler fixtures cover `if`, `each`, text, events, child components, fragments, scoped CSS, and the task list.
