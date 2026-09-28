# AnyFrame

AnyFrame is a small component compiler. A `.frame` file has a script, a template, and optional scoped CSS. The compiler turns the template into DOM updates.

`state`, `derived`, and `effect` are already in scope inside `<script>`. A signal is a function: `title()` reads it and `title("next")` writes it. In the template, `{title}` reads it for you, so `{items}` and `{if items.length === 0}` stay up to date. A plain `let` is not reactive.

```html
<script>
  const title = state("");
  const items = state([{ id: 1, label: "Milk" }]);

  function rename() {
    title("Grace");
  }

  function add() {
    items([...items(), { id: 2, label: title() }]);
  }
</script>

<p>{title}</p>
<button type="button" @click={rename}>Rename</button>
<button type="button" @click={add}>Add</button>

{each items as item (item.id)}
  <span>{item.label}</span>
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
