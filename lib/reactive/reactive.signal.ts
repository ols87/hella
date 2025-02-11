import { debounceRaf, isFunction, toError } from "../global";
import { HELLA_REACTIVE } from "./reactive.global";
import {
  maxSubscribersExceeded,
  maxSubscribersLimit,
  trackSubscriber,
} from "./reactive.security";
import {
  Signal,
  SignalConfig,
  SignalState,
  SignalOptions,
  SignalReadArgs,
  SignalSetArgs,
  SignalSubscribers,
} from "./reactive.types";

let { batchingSignals } = HELLA_REACTIVE;
const { pendingEffects, activeEffects } = HELLA_REACTIVE;

/** Core reactive primitive for state management */
export function signal<T>(initial: T, config?: SignalConfig<T>): Signal<T> {
  const state = { initialized: false, initial, config };
  return signalProxy(state);
}

/**
 * Read-only signal that warns on mutation attempts
 */
export function immutable<T>(
  key: string | number | symbol,
  value: T
): Signal<T> {
  const sig = signal(value);
  return new Proxy(sig, {
    get(target, prop) {
      return prop === "set"
        ? console.warn(`Cannot modify readonly property: ${String(key)}`)
        : target[prop as keyof typeof target];
    },
  }) as Signal<T>;
}

/**
 * Batch multiple signal updates to trigger effects once
 */
export function batchSignals(fn: () => void): void {
  batchingSignals = true;
  fn();
  batchingSignals = false;
  pendingEffects.forEach((effect) => effect());
  pendingEffects.clear();
}

/**
 * Type guard for Signal instances
 */
export function isSignal(value: unknown): value is Signal<unknown> {
  return (
    Boolean(value) &&
    isFunction(value) &&
    "set" in value &&
    "subscribe" in value
  );
}

/**
 * Signal initialization proxy
 */
function signalProxy<T>(state: SignalState<T>): Signal<T> {
  const handler: ProxyHandler<Signal<T>> = {
    get(_, prop: string | symbol) {
      const isPendingSet = prop === "set" && !state.initialized;
      if (isPendingSet) {
        return (value: T) => {
          state.pendingValue = value;
        };
      }

      if (!state.initialized && prop !== "set") {
        state.signal = signalCore(state);
        state.initialized = true;
      }

      return state.signal![prop as keyof Signal<T>];
    },

    apply() {
      if (!state.initialized) {
        state.signal = signalCore(state);
        state.initialized = true;
      }
      return state.signal!();
    },
  };

  return new Proxy(() => {}, handler) as Signal<T>;
}

/**
 * Core signal implementation
 */
function signalCore<T>(state: SignalState<T>): Signal<T> {
  const subscribers = signalSubscribers(state);
  const value = { current: state.pendingValue ?? state.initial };

  function read(): T {
    return readSignal({ value: value.current, subscribers, state });
  }

  function set(newVal: T): void {
    setSignal({
      newVal,
      state,
      value,
      subscribers,
      notify: () => subscribers.notify(),
    });
  }

  Object.assign(read, {
    set,
    subscribe: (fn: () => void) => subscribers.add(fn),
    dispose: () => {
      state.config?.onDispose?.();
      subscribers.clear();
    },
  });

  return read as Signal<T>;
}

/**
 * Read current signal value
 */
function readSignal<T>({ value, subscribers, state }: SignalReadArgs<T>): T {
  if (state.config?.validate?.(value)) {
    throw toError("Signal value validation failed");
  }

  state.config?.onRead?.(value);
  activeEffects.length && subscribers.add(activeEffects.at(-1)!);

  return value;
}

/**
 * Set new signal value
 */
function setSignal<T>({
  newVal,
  state,
  value,
  subscribers,
  notify,
}: SignalSetArgs<T>): void {
  if (!state.initialized) {
    state.pendingValue = newVal;
    return;
  }

  if (state.config?.validate?.(newVal)) {
    throw toError("Signal value validation failed");
  }

  const nextValue = state.config?.sanitize?.(newVal) ?? newVal;
  state.config?.onWrite?.(value.current, nextValue);
  value.current = nextValue;
  notifySubscriber({ subscribers: subscribers.set, notify });
}

/**
 * Signal subscriber management
 */
function signalSubscribers<T>(state: SignalState<T>): SignalSubscribers {
  const subscribers = new Set<() => void>();
  const notify = debounceRaf(() => subscribers.forEach((sub) => sub()));
  const ops: SignalOptions<T> = {
    subscribers,
    notify,
    state,
  };

  return {
    add: addSubscriber(ops),
    remove: (fn) => removeSubscriber({ subscribers, state: state }, fn),
    notify: () => notify(),
    clear: () => subscribers.clear(),
    set: subscribers,
  };
}

/**
 * Add subscriber to signal and return cleanup function
 */
function addSubscriber<T>({ subscribers, state }: SignalOptions<T>) {
  return (fn: () => void) => {
    if (maxSubscribersExceeded(subscribers.size)) {
      throw toError(
        `Maximum subscriber limit (${maxSubscribersLimit()}) exceeded`
      );
    }

    subscribers.add(fn);
    trackSubscriber(state.signal!, subscribers.size);
    state.config?.onSubscribe?.(subscribers.size);

    return () => removeSubscriber({ subscribers, state }, fn);
  };
}

/**
 * Remove subscriber from signal
 */
function removeSubscriber<T>(
  { subscribers, state }: Pick<SignalOptions<T>, "subscribers" | "state">,
  fn: () => void
) {
  subscribers.delete(fn);
  state.config?.onUnsubscribe?.(subscribers.size);
}

/**
 * Notify all signal subscribers
 */
function notifySubscriber<T>({
  subscribers,
  notify,
}: Pick<SignalOptions<T>, "subscribers"> & { notify: () => void }) {
  if (batchingSignals) {
    subscribers.forEach((sub) => pendingEffects.add(sub));
    return;
  }
  notify();
}
