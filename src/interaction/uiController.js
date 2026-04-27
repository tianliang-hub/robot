import { CUSTOMER_MOOD_LABEL, TABLE_STATE_LABEL } from "../config/appConfig.js";
import { parseNaturalCommand } from "../ai/nlParser.js";

export function createUIController({ store, scheduler, logger, replayRecorder }) {
  const chefStatusEl = document.getElementById("chef-status");
  const waiterStatusEl = document.getElementById("waiter-status");
  const tableStateEls = {
    "1": document.getElementById("table-state-1"),
    "2": document.getElementById("table-state-2")
  };
  const taskListEl = document.getElementById("task-list");
  const cmdInput = document.getElementById("cmd-input");
  const cmdSendBtn = document.getElementById("cmd-send");
  const voiceBtn = document.getElementById("voice-btn");
  const scenarioSelect = document.getElementById("scenario-select");
  const replayBtn = document.getElementById("replay-btn");
  const demoScriptBtn = document.getElementById("demo-script-btn");
  const buttons = Array.from(document.querySelectorAll(".task-btn[data-action]"));
  const customerPanel = document.getElementById("customer-panel");
  const customerPanelTitle = document.getElementById("customer-panel-title");
  const customerPanelTable = document.getElementById("customer-panel-table");
  const customerPanelMood = document.getElementById("customer-panel-mood");
  const customerPanelPatience = document.getElementById("customer-panel-patience");
  const customerPatienceFill = document.getElementById("customer-panel-patience-fill");
  const customerOrderBtn = document.getElementById("customer-order-btn");
  const customerPickupBtn = document.getElementById("customer-pickup-btn");
  const customerCheckoutBtn = document.getElementById("customer-checkout-btn");
  const customerSootheBtn = document.getElementById("customer-soothe-btn");
  const customerPanelClose = document.getElementById("customer-panel-close");

  function render(state) {
    const robotStateMap = {
      idle: "空闲",
      cooking: "烹饪中",
      toTransfer: "前往出餐台",
      delivering: "配送中",
      toWater: "前往接水点",
      confirming: "顾客确认中",
      reporting: "汇报厨师中",
      checkingOut: "结账处理中",
      cleaning: "收餐处理中",
      returning: "返回待命区"
    };
    chefStatusEl.textContent = robotStateMap[state.chefState] || state.chefState;
    waiterStatusEl.textContent = robotStateMap[state.waiterState] || state.waiterState;

    Object.keys(tableStateEls).forEach((tableId) => {
      const status = state.tableStatus[tableId];
      tableStateEls[tableId].textContent = TABLE_STATE_LABEL[status] || status;
      tableStateEls[tableId].className = `table-state ${status}`;
    });

    taskListEl.innerHTML = "";
    if (state.taskQueue.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.textContent = "暂无任务";
      taskListEl.appendChild(emptyLi);
    } else {
      state.taskQueue.forEach((task, index) => {
        const li = document.createElement("li");
        li.textContent = `#${index + 1} [P${task.priority}] [${task.source}] 桌台${task.tableId} - ${task.type}`;
        taskListEl.appendChild(li);
      });
    }

    buttons.forEach((btn) => {
      const tableId = btn.dataset.table;
      const action = btn.dataset.action;
      btn.disabled = !scheduler.isActionAllowed(state.tableStatus[tableId], action);
    });

    const selected = state.customers.find((item) => item.id === state.selectedCustomerId) || null;
    if (!selected) {
      customerPanel.classList.add("hidden");
    } else {
      customerPanel.classList.remove("hidden");
      customerPanelTitle.textContent = `${selected.name} 服务面板`;
      customerPanelTable.textContent = `${selected.tableId}号桌`;
      customerPanelMood.textContent = CUSTOMER_MOOD_LABEL[selected.mood] || selected.mood;
      const patiencePct = Math.max(0, Math.round(selected.patience));
      customerPanelPatience.textContent = `${patiencePct}%`;
      customerPatienceFill.style.transform = `scaleX(${Math.max(0.04, patiencePct / 100)})`;
    }
  }

  function bindButtons() {
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        scheduler.handleAction(btn.dataset.action, btn.dataset.table);
      });
    });
  }

  function bindCommandInput() {
    function executeCommand() {
      const parsed = parseNaturalCommand(cmdInput.value);
      if (!parsed.ok) {
        logger.log(`[AI解析] ${parsed.message}`);
        return;
      }

      parsed.actions.forEach((action) => {
        scheduler.handleAction(action, parsed.tableId);
      });
      logger.log(`[AI解析] 已解析指令：桌台${parsed.tableId} -> ${parsed.actions.join(" -> ")}`);
      cmdInput.value = "";
    }

    cmdSendBtn.addEventListener("click", executeCommand);
    cmdInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") executeCommand();
    });

    voiceBtn.addEventListener("click", () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        logger.log("[语音] 当前浏览器不支持语音识别，建议使用文本指令。");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = "zh-CN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        cmdInput.value = text;
        logger.log(`[语音] 识别结果：${text}`);
      };
      recognition.onerror = () => logger.log("[语音] 识别失败，请重试。");
      recognition.start();
    });
  }

  function bindScenarioControls() {
    scenarioSelect.addEventListener("change", () => scheduler.applyScenario(scenarioSelect.value));
    replayBtn.addEventListener("click", async () => {
      const events = replayRecorder.getEvents();
      if (events.length === 0) {
        logger.log("[回放] 当前无可回放事件。");
        return;
      }
      logger.log("[回放] 开始回放事件流...");
      await replayRecorder.playback((entry) => {
        logger.log(`[回放] ${entry.message}`, { replayTag: true, record: false });
      }, 2.4);
      logger.log("[回放] 事件流回放结束。");
    });
    demoScriptBtn.addEventListener("click", () => scheduler.runDemoScript());
  }

  function bindCustomerPanel() {
    function selectedCustomer() {
      return store.state.customers.find((item) => item.id === store.state.selectedCustomerId) || null;
    }

    customerOrderBtn.addEventListener("click", () => {
      const customer = selectedCustomer();
      if (!customer) return;
      scheduler.handleCustomerRequest(customer.id, "order");
    });
    customerPickupBtn.addEventListener("click", () => {
      const customer = selectedCustomer();
      if (!customer) return;
      scheduler.handleCustomerRequest(customer.id, "pickup");
    });
    customerCheckoutBtn.addEventListener("click", () => {
      const customer = selectedCustomer();
      if (!customer) return;
      scheduler.handleCustomerRequest(customer.id, "checkout");
    });
    customerSootheBtn.addEventListener("click", () => {
      const customer = selectedCustomer();
      if (!customer) return;
      scheduler.handleCustomerRequest(customer.id, "soothe");
    });
    customerPanelClose.addEventListener("click", () => {
      store.patch({ selectedCustomerId: null });
    });
  }

  function mount({ onCustomerSelected } = {}) {
    bindButtons();
    bindCommandInput();
    bindScenarioControls();
    bindCustomerPanel();
    if (onCustomerSelected) {
      onCustomerSelected((customerId) => {
        store.patch({ selectedCustomerId: customerId });
      });
    }
    render(store.state);
    store.subscribe(render);
  }

  return { mount };
}
