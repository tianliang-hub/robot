import { CUSTOMER_BINDINGS, EMOTION_CONFIG, SCENARIO_PRESETS } from "../config/appConfig.js";

export function createStateStore() {
  const listeners = new Set();
  const state = {
    taskQueue: [],
    tableStatus: { "1": "idle", "2": "idle" },
    customers: CUSTOMER_BINDINGS.map((item) => ({
      id: item.id,
      name: item.name,
      tableId: item.tableId,
      anchorModelName: item.anchorModelName,
      mood: "calm",
      patience: EMOTION_CONFIG.patienceMax,
      demandQueue: [],
      serviceHistory: [],
      visiblePanel: false
    })),
    selectedCustomerId: null,
    chefState: "idle",
    waiterState: "idle",
    isDispatching: false,
    currentTask: null,
    scenario: "normal",
    delays: { ...SCENARIO_PRESETS.normal.delays },
    loadProgress: 0
  };

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch(partial) {
      Object.assign(state, partial);
      notify();
    },
    update(updater) {
      updater(state);
      notify();
    },
    notify
  };
}
