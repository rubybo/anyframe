import { mount } from "./runtime/dom.ts";
import {
  claim,
  derived,
  dispose,
  effect,
  onCleanup,
  own,
  prop,
  read,
  release,
  state,
} from "./runtime/signal.ts";
import {
  attr,
  branch,
  comment,
  element,
  injectCss,
  insert,
  listen,
  remove,
  repeat,
  setText,
  text,
  type Component,
} from "./runtime/dom.ts";

export { state, derived, effect, read, mount };
export type { Component };

/** Runtime used by compiled components. Application code uses state, derived, effect, and read. */
export const __af = {
  read,
  effect,
  prop,
  own,
  release,
  claim,
  dispose,
  onCleanup,
  element,
  text,
  setText,
  attr,
  listen,
  insert,
  remove,
  comment,
  branch,
  repeat,
  injectCss,
};
