# AnyFrame

AnyFrame is a small component compiler. A `.frame` file has a script, a template, and optional scoped CSS. The compiler turns the template into DOM updates. State stays explicit: `state()` and `derived()` in the script, read and written with `.get()` and `.set()`.

In the template, identifiers are wrapped in `read()`, so `{items}` and `{#if items.length === 0}` subscribe to signals. A plain `let` is not reactive.

```html
<script>
  import { state } from "anyframe";
  import Item from "./Item.frame";

  const items = state([]);
</script>

{#each items as item (item.id)}
  <Item item={item} />
{/each}

<style>
  :scope { display: grid; gap: 8px; }
</style>
```

Templates can use elements, text, attributes, `{expressions}`, `on:click={handler}`, modifiers such as `on:submit|preventDefault={handler}`, `{#if}` / `{:else}` / `{:else if}` / `{/if}`, and keyed `{#each list as item (key)}`. A capitalized tag is a child component imported from a `.frame` file. Several root nodes become a fragment. Scoped CSS adds a content hash class to every element and rewrites selectors, including `:scope`.

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
