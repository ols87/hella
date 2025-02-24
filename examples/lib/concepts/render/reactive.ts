import { render, html } from "@hella/render";
import { signal } from "@hella/reactive";

const { div, button, p } = html;

const isActive = signal(false);

const App = () =>
  div({ classes: { active: isActive() } }, [
    button({
      id: "toggle",
      onclick: () => isActive.set(!isActive()),
    }),
    p({ classes: { active: isActive() } }, `Active: ${isActive()}`),
  ]);

render(App, "#app");
