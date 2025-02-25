import { StoreSignals } from "@hella/store";
import { RouterState, RouterEvents, RouterHella } from "./types";
import { ctx } from "@hella/core";

const HELLA_ROUTER: RouterHella = {
  store: null as StoreSignals<RouterState> | null,
  events: {
    beforeNavigate: new Set(),
    afterNavigate: new Set(),
  } as RouterEvents,
};

const context = ctx();

context.HELLA_ROUTER ||= HELLA_ROUTER;

export const routerContext = context.HELLA_ROUTER as RouterHella;
