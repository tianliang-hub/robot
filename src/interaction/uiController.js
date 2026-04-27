import { CUSTOMER_MOOD_LABEL, TABLE_STATE_LABEL } from "../config/appConfig.js";
import { sendMessage } from "../ai/chatClient.js";
import { extractIntent } from "../ai/intentExtractor.js";
import { parseNaturalCommand } from "../ai/nlParser.js";

export function createUIController({ store, scheduler, logger, replayRecorder }) {
  const chefStatusEl = document.getElementById("chef-status");
  const waiterStatusEl = document.getElementById("waiter-status");
  const tableStateEls = Object.fromEntries(
    Array.from(document.querySelectorAll("[id^='table-state-']")).map((el) => {
      const tableId = String(el.id).replace("table-state-", "");
      return [tableId, el];
    })
  );
  const taskListEl = document.getElementById("task-list");
  const cmdInput = document.getElementById("cmd-input");
  const cmdSendBtn = document.getElementById("cmd-send");
  const voiceBtn = document.getElementById("voice-btn");
  const scenarioSelect = document.getElementById("scenario-select");
  const replayBtn = document.getElementById("replay-btn");
  const demoScriptBtn = document.getElementById("demo-script-btn");
  const buttons = Array.from(document.querySelectorAll(".task-btn[data-action]"));
  const smartButtons = Array.from(document.querySelectorAll(".task-btn[data-smart-action]"));
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
  const globalChatBtn = document.getElementById("global-chat-btn");
  const chatPanel = document.getElementById("chat-panel");
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  const chatEndBtn = document.getElementById("chat-end-btn");
  const chatModeSelect = document.getElementById("chat-mode-select");

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
      if (!tableStateEls[tableId]) return;
      const status = state.tableStatus[tableId];
      const hasCustomer = scheduler.tableHasCustomer(tableId);
      const label = TABLE_STATE_LABEL[status] || status;
      tableStateEls[tableId].textContent = hasCustomer ? label : `${label}（空桌不可下单）`;
      tableStateEls[tableId].className = hasCustomer
        ? `table-state ${status}`
        : `table-state ${status} empty-table`;
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
      const hasCustomer = scheduler.tableHasCustomer(tableId);
      btn.disabled =
        !hasCustomer || !scheduler.isActionAllowed(state.tableStatus[tableId], action);
    });
    smartButtons.forEach((btn) => {
      const tableId = btn.dataset.table;
      btn.disabled = !scheduler.tableHasCustomer(tableId);
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

    if (state.chat.active || state.chat.messages.length > 0) {
      chatPanel.classList.remove("hidden");
    } else {
      chatPanel.classList.add("hidden");
    }
    chatModeSelect.value = state.chat.mode || "table";
    chatSendBtn.disabled = !state.chat.active || state.chat.isWaitingReply;
    chatEndBtn.disabled = !state.chat.active;
    chatInput.disabled = !state.chat.active;
    chatMessages.innerHTML = "";
    state.chat.messages.forEach((entry) => {
      const div = document.createElement("div");
      div.className = `chat-msg ${entry.role}`;
      div.textContent = `${entry.role === "user" ? "我" : "服务员"}：${entry.content}`;
      chatMessages.appendChild(div);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function bindButtons() {
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        scheduler.handleAction(btn.dataset.action, btn.dataset.table);
      });
    });
    smartButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = chatModeSelect.value || "table";
        scheduler.startSmartConversation(btn.dataset.table, btn.dataset.smartAction, mode);
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

  function buildHistoryMessages(state) {
    return state.chat.messages.map((item) => ({
      role: item.role,
      content: item.content
    }));
  }

  function bindChatPanel() {
    globalChatBtn.addEventListener("click", () => {
      const fallbackTableId =
        store.state.customers[0]?.tableId || Object.keys(store.state.tableStatus)[0] || "1";
      scheduler.startSmartConversation(fallbackTableId, "order", "global");
    });

    chatModeSelect.addEventListener("change", () => {
      store.patch({
        chat: {
          ...store.state.chat,
          mode: chatModeSelect.value
        }
      });
    });

    async function sendChatText() {
      const text = chatInput.value.trim();
      if (!text || !store.state.chat.active) return;

      scheduler.appendChatMessage("user", text);
      chatInput.value = "";
      const parsedIntent = extractIntent(text);
      if (parsedIntent.type === "end_chat") {
        scheduler.endChatConversation("用户输入聊天结束");
        return;
      }
      if (parsedIntent.type === "intent_switch") {
        scheduler.updateChatPendingIntent(parsedIntent.intent);
        logger.log(`[智能意图] 对话中识别到意图切换：${parsedIntent.intent}`);
      }

      scheduler.setChatWaiting(true);
      try {
        const state = store.state;
        const reply = await sendMessage({
          mode: state.chat.mode || "table",
          tableId: state.chat.tableId || "0",
          sessionId: state.chat.sessionId,
          text,
          history: buildHistoryMessages(state)
        });
        scheduler.appendChatMessage("assistant", reply);
      } catch (error) {
        scheduler.appendChatMessage(
          "assistant",
          "网络有点忙，我先记下你的需求。你可以继续说，或者输入“聊天结束”。"
        );
        logger.log(`[智能对话] 远端响应失败，已使用本地兜底：${error instanceof Error ? error.message : "未知错误"}`);
      } finally {
        scheduler.setChatWaiting(false);
      }
    }

    chatSendBtn.addEventListener("click", sendChatText);
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") sendChatText();
    });
    chatEndBtn.addEventListener("click", () => {
      scheduler.endChatConversation("点击结束按钮");
    });
  }

  function mount({ onCustomerSelected } = {}) {
    bindButtons();
    bindCommandInput();
    bindScenarioControls();
    bindCustomerPanel();
    bindChatPanel();
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
