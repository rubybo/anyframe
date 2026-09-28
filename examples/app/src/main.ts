import { mount } from "anyframe";
import App from "./App.frame";

const root = document.querySelector("#app");
if (!(root instanceof Element)) {
  throw new Error("Missing #app");
}

mount(App, root);
