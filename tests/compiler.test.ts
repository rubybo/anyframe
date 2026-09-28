import { afterEach, describe, expect, it } from "vitest";
import { mount, type Component } from "anyframe";
import { compile } from "../src/compiler/compile.ts";
import { FrameParseError } from "../src/compiler/parse.ts";
import Text from "./fixtures/text.frame";
import IfView from "./fixtures/if.frame";
import EachView from "./fixtures/each.frame";
import EventView from "./fixtures/event.frame";
import Parent from "./fixtures/Parent.frame";
import Scoped from "./fixtures/scoped.frame";
import Fragment from "./fixtures/fragment.frame";
import Plain from "./fixtures/plain.frame";
import App from "../examples/app/src/App.frame";

function render(component: Component) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const destroy = mount(component, host);
  return { host, destroy };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
  document.body.innerHTML = "";
  document.head.querySelectorAll("style").forEach((node) => {
    if (node.id.startsWith("af-style-")) node.remove();
  });
});

function clickButton(host: ParentNode, label: string) {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button ${label}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("compiler fixtures", () => {
  it("updates interpolated text", () => {
    const { host, destroy } = render(Text);
    cleanups.push(destroy);
    expect(host.textContent).toContain("Hello Ada!");
    clickButton(host, "Rename");
    expect(host.textContent).toContain("Hello Grace!");
  });

  it("mounts and unmounts if branches", () => {
    const { host, destroy } = render(IfView);
    cleanups.push(destroy);
    expect(host.querySelector(".yes")?.textContent).toBe("yes");
    clickButton(host, "Hide");
    expect(host.querySelector(".yes")).toBeNull();
    expect(host.querySelector(".no")?.textContent).toBe("no");
    clickButton(host, "Show");
    expect(host.querySelector(".no")).toBeNull();
    expect(host.querySelector(".yes")?.textContent).toBe("yes");
  });

  it("reconciles each blocks by key", () => {
    const { host, destroy } = render(EachView);
    cleanups.push(destroy);
    const second = host.querySelector('[data-id="2"]');
    expect(second?.textContent).toBe("b");
    clickButton(host, "Rename");
    expect(host.querySelector('[data-id="2"]')).toBe(second);
    expect(second?.textContent).toBe("z");
    clickButton(host, "Drop");
    expect(host.querySelector('[data-id="1"]')).toBeNull();
    expect(host.querySelector('[data-id="2"]')).toBe(second);
  });

  it("listens for events and applies modifiers", async () => {
    const { host, destroy } = render(EventView);
    cleanups.push(destroy);
    const form = host.querySelector("form");
    if (!form) throw new Error("Missing form");
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("sent");
    const code = await compile(
      `<form on:submit|preventDefault={save}></form>\n<script>\nfunction save() {}\n</script>\n`,
      "Event.frame",
    );
    expect(code).toContain("preventDefault");
    expect(code).toContain("__af.listen");
    expect(code).toContain("__af.read(save)");
  });

  it("passes reactive props to child components", () => {
    const { host, destroy } = render(Parent);
    cleanups.push(destroy);
    expect(host.querySelector(".label")?.textContent).toBe("one");
    clickButton(host, "Next");
    expect(host.querySelector(".label")?.textContent).toBe("two");
  });

  it("scopes css with a file hash class and rewrites :scope", async () => {
    const { host, destroy } = render(Scoped);
    cleanups.push(destroy);
    const box = host.querySelector(".box");
    const scope = box?.getAttribute("data-af-scope");
    expect(scope).toMatch(/^af-/);
    expect(box?.className).toContain(scope ?? "");
    const css = document.getElementById(`af-style-${scope}`)?.textContent ?? "";
    expect(css).not.toContain(":scope");
    expect(css).toContain(`.${scope}`);
    expect(css).toContain("display: grid");
    expect(css).toContain(`.box.${scope}`);
    const code = await compile(`<style>\n:scope { display: grid; gap: 8px; }\n</style>\n<div></div>\n`, "Scope.frame");
    expect(code).not.toContain(":scope");
    expect(code).toContain("display: grid");
    expect(code).toContain("gap: 8px");
  });

  it("renders multiple roots as a fragment", () => {
    const { host, destroy } = render(Fragment);
    cleanups.push(destroy);
    const paragraphs = [...host.querySelectorAll("p")];
    expect(paragraphs.map((node) => node.id)).toEqual(["a", "b"]);
    expect(host.querySelector("div")).toBeNull();
  });

  it("does not rerender a plain let", () => {
    const { host, destroy } = render(Plain);
    cleanups.push(destroy);
    clickButton(host, "Add");
    expect(host.querySelector("#clicks")?.textContent).toBe("1");
    expect(host.querySelector("#count")?.textContent).toBe("0");
  });

  it("reports parser errors with line and column", async () => {
    const source = "<div>\n  <span>\n</div>\n";
    await expect(compile(source, "Bad.frame")).rejects.toBeInstanceOf(FrameParseError);
    try {
      await compile(source, "Bad.frame");
    } catch (error) {
      expect(error).toBeInstanceOf(FrameParseError);
      const parseError = error as FrameParseError;
      expect(parseError.line).toBe(3);
      expect(parseError.column).toBeGreaterThan(0);
      expect(parseError.message).toMatch(/Bad\.frame:3:\d+/);
    }
    await expect(compile("{#each items as item}\n{/each}\n", "Each.frame")).rejects.toThrow(/Each\.frame:\d+:\d+/);
  });
});

describe("task list", () => {
  it("adds, toggles, filters, and shows the empty state", () => {
    const { host, destroy } = render(App);
    cleanups.push(destroy);
    expect(host.textContent).toContain("No tasks yet. Add the first one.");
    expect(host.textContent).toContain("0 open");

    const input = host.querySelector("#task-title") as HTMLInputElement;
    input.value = "Ship compiler";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(host.textContent).toContain("Ship compiler");
    expect(host.textContent).not.toContain("No tasks yet");
    expect(input.value).toBe("");
    expect(host.textContent).toContain("1 open");

    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.textContent).toContain("0 open");
    expect(host.querySelector("li")?.className).toContain("done");

    const open = host.querySelector("#show-open") as HTMLInputElement;
    open.checked = true;
    open.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.textContent).toContain("Nothing left open.");
    expect(host.textContent).not.toContain("Ship compiler");

    const done = host.querySelector("#show-done") as HTMLInputElement;
    done.checked = true;
    done.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.textContent).toContain("Ship compiler");

    const all = host.querySelector("#show-all") as HTMLInputElement;
    all.checked = true;
    all.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.textContent).toContain("Ship compiler");

    const scope = host.querySelector(".board")?.getAttribute("data-af-scope");
    expect(scope).toMatch(/^af-/);
    const itemScope = host.querySelector("li")?.getAttribute("data-af-scope");
    expect(itemScope).toMatch(/^af-/);
    expect(itemScope).not.toBe(scope);
  });
});
