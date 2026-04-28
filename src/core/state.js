import { CUSTOMER_BINDINGS, EMOTION_CONFIG, SCENE_POINTS, SCENARIO_PRESETS } from "../config/appConfig.js";

export function createStateStore() {
  const listeners = new Set();
  const tableStatus = Object.fromEntries(
    Object.keys(SCENE_POINTS.tables || {}).map((tableId) => [String(tableId), "idle"])
  );
  const state = {
    taskQueue: [],
    tableStatus,
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
    chat: {
      active: false,
      mode: "table",
      tableId: null,
      sessionId: "",
      messages: [],
      pendingIntent: null,
      isWaitingReply: false
    },
    waiterConversationState: "idle",
    chefState: "idle",
    waiterState: "idle",
    waiter2State: "idle",
    waiters: {
      waiter: { state: "idle", currentTask: null, conversationState: "idle" },
      waiter2: { state: "idle", currentTask: null, conversationState: "idle" }
    },
    currentTasks: { waiter: null, waiter2: null },
    isDispatching: false,
    currentTask: null,
    scenario: "normal",
    delays: { ...SCENARIO_PRESETS.normal.delays },
    loadProgress: 0,
    /** 智能会话期间同桌仅由该服务员服务 tableId -> waiterId */
    smartServiceHost: {}
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
