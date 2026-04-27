import * as THREE from "three";
import {
  CUSTOMER_DEMAND_TEMPLATES,
  EMOTION_CONFIG,
  FLOW_CONFIG,
  NAV_REPLAN_MS,
  PATIENCE_DECAY_RULES,
  ROBOT_SAFE_DISTANCE,
  SCENE_POINTS,
  SCENARIO_PRESETS,
  SERVICE_POINTS,
  TABLE_STATE_LABEL,
  TASK_PRIORITY
} from "../config/appConfig.js";
import { createPathPlanner } from "./pathPlanner.js";

const SMART_TASK_BY_INTENT = {
  order: "智能点单",
  water: "智能送水",
  checkout: "智能结账"
};

const SMART_INTENT_BY_TASK = {
  智能点单: "order",
  智能送水: "water",
  智能结账: "checkout"
};

const TABLE_BOUND_TASKS = new Set([
  "点餐",
  "送水",
  "结账",
  "收餐",
  "冰箱取货",
  "情绪安抚",
  "智能点单",
  "智能送水",
  "智能结账"
]);

export function createScheduler({ store, sceneManager, logger, metrics, advisor }) {
  const { state } = store;
  let emotionTimer = null;
  let waiterLoopRunning = false;
  let chefLoopRunning = false;
  let chatWaitResolver = null;
  let obstacleVersion = 0;
  const chefOrderQueue = [];
  const pathPlanner = createPathPlanner();

  function sortQueue() {
    const now = performance.now();
    state.taskQueue.sort((a, b) => {
      const aAgeBoost = ((now - a.createdAt) / 10000) * FLOW_CONFIG.priorityAgingPer10s;
      const bAgeBoost = ((now - b.createdAt) / 10000) * FLOW_CONFIG.priorityAgingPer10s;
      const aScore = a.priority + aAgeBoost;
      const bScore = b.priority + bAgeBoost;
      return bScore - aScore || a.createdAt - b.createdAt;
    });
  }

  function notifyQueueChanged() {
    metrics.onQueueSize(state.taskQueue.length);
    advisor.evaluate(state);
    store.notify();
  }

  function addTask(type, tableId, priority = TASK_PRIORITY[type], source = "ui", silent = false) {
    if (TABLE_BOUND_TASKS.has(type) && !tableHasCustomer(String(tableId))) {
      if (!silent) {
        logger.log(`[空桌保护] 桌台${tableId}未绑定顾客，已忽略${type}任务。`);
      }
      return null;
    }
    if (
      (type === "点餐" || type === "智能点单") &&
      state.taskQueue.length >= FLOW_CONFIG.waiterQueueGuardMax &&
      source !== "emotion"
    ) {
      logger.log("[调度保护] 当前队列较长，已延缓新点餐注入，请优先消化现有任务。");
      return null;
    }
    const task = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      tableId: String(tableId),
      priority,
      source,
      createdAt: performance.now()
    };
    state.taskQueue.push(task);
    sortQueue();
    metrics.onTaskQueued(task);
    if (!silent) {
      logger.log(`收到任务：桌台${task.tableId} -> ${task.type}（优先级 ${task.priority}）`);
    }
    notifyQueueChanged();
    startWaiterDispatchLoop();
    return task;
  }

  function hasSameTask(type, tableId) {
    const key = String(tableId);
    return (
      state.taskQueue.some((task) => task.type === type && task.tableId === key) ||
      (state.currentTask && state.currentTask.type === type && state.currentTask.tableId === key)
    );
  }

  function getCustomerById(customerId) {
    return state.customers.find((item) => item.id === customerId) || null;
  }

  function tableHasCustomer(tableId) {
    return state.customers.some((item) => item.tableId === String(tableId));
  }

  function createSessionId(tableId, mode) {
    return `${mode}-${tableId}-${Date.now().toString(36)}`;
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getMoveDuration(base) {
    return Math.round(base * state.delays.moveScale);
  }

  function getCustomerCenterPoint() {
    const tables = Object.values(SCENE_POINTS.tables || {});
    if (tables.length === 0) return new THREE.Vector3(0, 0, 6);
    const sum = tables.reduce(
      (acc, point) => {
        acc.x += point.x;
        acc.z += point.z;
        return acc;
      },
      { x: 0, z: 0 }
    );
    return new THREE.Vector3(sum.x / tables.length, 0, sum.z / tables.length);
  }

  function faceWaiterToCustomers() {
    sceneManager.setAnchorFacing?.("waiter", getCustomerCenterPoint());
  }

  function faceChefToCounter() {
    const chefPos = sceneManager.anchors.chef?.position || SCENE_POINTS.chef;
    const counterFacing = new THREE.Vector3(chefPos.x, 0, chefPos.z + 2.2);
    sceneManager.setAnchorFacing?.("chef", counterFacing);
  }

  function isWaiterAtStandby() {
    const waiterPos = sceneManager.anchors.waiter?.position;
    if (!waiterPos) return false;
    return waiterPos.distanceTo(SCENE_POINTS.standby) <= 0.42;
  }

  async function returnWaiterToStandby(reason = "") {
    setWaiterState("returning");
    await moveWaiterWithReplan(SCENE_POINTS.standby, getMoveDuration(760), {
      withPath: true,
      faceToMove: true,
      stopDistance: 0,
      routeLabel: reason || "回待命位"
    });
    setWaiterState("idle");
    faceWaiterToCustomers();
  }

  async function waitForWaiterStandbyBeforeChef(orderTableId) {
    if (isWaiterAtStandby() && state.waiterState === "idle") return;
    logger.log(`[协同] 等待服务员回到待命位后启动烹饪（桌台${orderTableId}）`);
    while (true) {
      if (isWaiterAtStandby() && state.waiterState === "idle") {
        logger.log("[协同] 服务员已回位，厨师前往微波炉烹饪。");
        return;
      }
      await waitMs(120);
    }
  }

  function isRemainingPathBlocked(pathPoints) {
    for (let i = 0; i < pathPoints.length; i += 1) {
      const cell = pathPlanner.worldToCell(pathPoints[i]);
      if (pathPlanner.isBlocked(cell)) return true;
    }
    return false;
  }

  async function moveWaiterWithReplan(target, duration, options = {}) {
    const {
      withPath = true,
      faceToMove = true,
      stopDistance = 0,
      routeLabel = ""
    } = options;
    const destination = target.clone();
    let unreachableLogged = false;
    let routeLogged = false;

    while (true) {
      const current = sceneManager.anchors.waiter.position.clone();
      const resolvedTarget = pathPlanner.resolveReachableTarget(destination, current);
      if (!resolvedTarget) {
        if (!unreachableLogged) {
          logger.log("[路径规划] 当前不可达，等待障碍移除后重试");
          unreachableLogged = true;
        }
        await waitMs(NAV_REPLAN_MS);
        continue;
      }
      const targetCell = pathPlanner.worldToCell(destination);
      const resolvedCell = pathPlanner.worldToCell(resolvedTarget);
      if ((targetCell.x !== resolvedCell.x || targetCell.z !== resolvedCell.z) && !routeLogged && routeLabel) {
        logger.log(`[路径规划] ${routeLabel}目标格被占用，已回退到最近可达格(${resolvedCell.x},${resolvedCell.z})`);
      }

      const rawPath = pathPlanner.findPath(current, resolvedTarget);
      const waypoints = rawPath.slice(1);
      if (waypoints.length === 0) {
        if (!unreachableLogged) {
          logger.log("[路径规划] 当前不可达，等待障碍移除后重试");
          unreachableLogged = true;
        }
        await waitMs(NAV_REPLAN_MS);
        continue;
      }

      if (unreachableLogged) {
        logger.log("[路径规划] 目标已恢复可达，继续前进");
        unreachableLogged = false;
      }
      if (!routeLogged && routeLabel && waypoints.length > 1) {
        logger.log(`[路径规划] ${routeLabel}链路绕障生效，节点 ${waypoints.length}`);
        routeLogged = true;
      }

      const thisPlanVersion = obstacleVersion;
      let needReplan = false;
      let lastCheckAt = performance.now();
      const segmentDuration = Math.max(
        110,
        Math.min(NAV_REPLAN_MS, Math.round(duration / Math.max(1, waypoints.length)))
      );

      for (let i = 0; i < waypoints.length; i += 1) {
        const isLast = i === waypoints.length - 1;
        await sceneManager.moveAnchor("waiter", waypoints[i], segmentDuration, {
          withPath: withPath && i === 0,
          faceToMove,
          stopDistance: isLast ? stopDistance : 0
        });

        const now = performance.now();
        if (now - lastCheckAt >= NAV_REPLAN_MS) {
          lastCheckAt = now;
          const remained = waypoints.slice(i + 1);
          if (isRemainingPathBlocked(remained)) {
            logger.log(`[路径规划] 检测阻塞，重规划成功，剩余节点${remained.length}`);
            needReplan = true;
            break;
          }
        }
        if (obstacleVersion !== thisPlanVersion && i < waypoints.length - 1) {
          const remained = waypoints.slice(i + 1);
          logger.log(`[路径规划] 检测阻塞，重规划成功，剩余节点${remained.length}`);
          needReplan = true;
          break;
        }
      }

      if (!needReplan) return;
      await waitMs(NAV_REPLAN_MS);
    }
  }

  function updateDynamicObstacles(cells) {
    pathPlanner.replaceBlockedCells(cells);
    obstacleVersion += 1;
  }

  function waitConversationEnd() {
    return new Promise((resolve) => {
      chatWaitResolver = resolve;
    });
  }

  function setConversationState(next) {
    state.waiterConversationState = next;
    store.notify();
  }

  function patchChat(partial) {
    state.chat = { ...state.chat, ...partial };
    store.notify();
  }

  function appendChatMessage(role, content) {
    state.chat.messages.push({ role, content, at: Date.now() });
    store.notify();
  }

  function setChatWaiting(flag) {
    if (!state.chat.active && flag) return;
    state.chat.isWaitingReply = flag;
    store.notify();
  }

  function updateChatPendingIntent(intent) {
    if (!state.chat.active) return;
    state.chat.pendingIntent = intent;
    store.notify();
  }

  function endChatConversation(reason = "用户结束") {
    if (!state.chat.active) return false;
    logger.log(`[智能对话] 收到结束信号（${reason}），准备恢复任务。`);
    state.chat.active = false;
    state.chat.isWaitingReply = false;
    store.notify();
    if (chatWaitResolver) {
      chatWaitResolver();
      chatWaitResolver = null;
    }
    return true;
  }

  function getCustomerMoodByPatience(patience) {
    if (patience <= EMOTION_CONFIG.angryThreshold) return "angry";
    if (patience <= EMOTION_CONFIG.anxiousThreshold) return "anxious";
    if (patience < EMOTION_CONFIG.patienceMax) return "waiting";
    return "calm";
  }

  function updateCustomerMood(customer, nextMood) {
    if (!customer || customer.mood === nextMood) return;
    customer.mood = nextMood;
    logger.log(`[情绪] ${customer.name} 情绪变为：${nextMood}`);
    sceneManager.setCustomerMoodVisual?.(customer.id, nextMood);
    refreshTableMood(customer.tableId);
  }

  function refreshTableMood(tableId) {
    const related = state.customers.filter((item) => item.tableId === String(tableId));
    if (related.length === 0) return;
    const rank = { calm: 0, waiting: 1, anxious: 2, angry: 3 };
    const mood = related.reduce((acc, item) => (rank[item.mood] > rank[acc] ? item.mood : acc), "calm");
    sceneManager.setTableMoodVisual?.(tableId, mood);
  }

  function setTableStatus(tableId, status, logMessage = null) {
    state.tableStatus[String(tableId)] = status;
    if (logMessage) logger.log(logMessage);
    store.notify();
  }

  function setChefState(next) {
    state.chefState = next;
    if (next === "cooking") sceneManager.playActorAction?.("chef", "cook");
    else if (next === "toTransfer" || next === "returning") sceneManager.playActorAction?.("chef", "walk");
    else sceneManager.playActorAction?.("chef", "idle");
    store.notify();
  }

  function setWaiterState(next) {
    state.waiterState = next;
    if (["toTransfer", "delivering", "toWater", "checkingOut", "cleaning", "returning", "confirming", "reporting"].includes(next)) {
      sceneManager.playActorAction?.("waiter", "walk");
    } else {
      sceneManager.playActorAction?.("waiter", "idle");
    }
    store.notify();
  }

  function markCustomerDemandDone(tableId, taskType) {
    state.customers
      .filter((customer) => customer.tableId === String(tableId))
      .forEach((customer) => {
        const index = customer.demandQueue.findIndex((item) => item.type === taskType);
        if (index >= 0) customer.demandQueue.splice(index, 1);
        customer.patience = Math.min(EMOTION_CONFIG.patienceMax, customer.patience + EMOTION_CONFIG.recoverPerService);
        customer.serviceHistory.push({ type: taskType, at: Date.now() });
        updateCustomerMood(customer, getCustomerMoodByPatience(customer.patience));
      });
    refreshTableMood(tableId);
  }

  function queueCustomerDemand(customerId, action) {
    const customer = getCustomerById(customerId);
    if (!customer) return null;
    const template = CUSTOMER_DEMAND_TEMPLATES[action];
    if (!template) return null;
    const exists = customer.demandQueue.some((item) => item.type === template.type);
    if (exists) return { customer, template };
    customer.demandQueue.push({
      type: template.type,
      action,
      requestedAt: Date.now(),
      status: "pending"
    });
    updateCustomerMood(customer, "waiting");
    store.notify();
    return { customer, template };
  }

  function enqueueDemandForTable(tableId, demandType, action = "system") {
    let changed = false;
    state.customers
      .filter((customer) => customer.tableId === String(tableId))
      .forEach((customer) => {
        const exists = customer.demandQueue.some((item) => item.type === demandType);
        if (exists) return;
        customer.demandQueue.push({
          type: demandType,
          action,
          requestedAt: Date.now(),
          status: "pending"
        });
        updateCustomerMood(customer, "waiting");
        changed = true;
      });
    if (changed) store.notify();
  }

  function enqueueFollowupByIntent(tableId, intent) {
    const key = String(tableId);
    if (intent === "order") {
      if (state.tableStatus[key] === "idle") {
        setTableStatus(key, "waiting", `桌台${key}状态切换：空闲 -> 等餐中`);
      }
      enqueueDemandForTable(key, "点餐", "smart");
      if (!hasSameTask("点餐", key)) addTask("点餐", key, TASK_PRIORITY["点餐"], "smart", true);
      return;
    }
    if (intent === "water") {
      enqueueDemandForTable(key, "送水", "smart");
      addTask("送水", key, TASK_PRIORITY["送水"], "smart", true);
      return;
    }
    if (intent === "checkout") {
      enqueueDemandForTable(key, "结账", "smart");
      if (!hasSameTask("结账", key)) addTask("结账", key, TASK_PRIORITY["结账"], "smart", true);
    }
  }

  function findDemandDecayReason(customer) {
    const types = customer.demandQueue.map((item) => item.type);
    if (types.includes("点餐")) return "waitingForOrder";
    if (types.includes("送水")) return "waitingForWater";
    if (types.includes("结账")) return "waitingForCheckout";
    if (types.includes("冰箱取货")) return "waitingForPickup";
    return null;
  }

  function enqueueChefOrder(tableId) {
    chefOrderQueue.push({ tableId: String(tableId), createdAt: performance.now() });
    processChefOrderLoop();
  }

  function promoteSootheTask(tableId) {
    const target = state.taskQueue.find((item) => item.type === "情绪安抚" && item.tableId === String(tableId));
    if (!target || target.priority >= EMOTION_CONFIG.sootheEmergencyPriority) return;
    target.priority = EMOTION_CONFIG.sootheEmergencyPriority;
    sortQueue();
    notifyQueueChanged();
  }

  async function processChefOrderLoop() {
    if (chefLoopRunning) return;
    chefLoopRunning = true;
    while (chefOrderQueue.length > 0) {
      const order = chefOrderQueue.shift();
      const platingMs = Math.max(0, FLOW_CONFIG.plateAtTransferMs ?? 400);
      await waitForWaiterStandbyBeforeChef(order.tableId);
      setChefState("toTransfer");
      logger.log(`[点餐] 厨师前往烹饪位处理桌台${order.tableId}工单`);
      await sceneManager.moveAnchor(
        "chef",
        SERVICE_POINTS.cookStation || SCENE_POINTS.chef,
        getMoveDuration(820),
        { faceToMove: true, stopDistance: 0.55 }
      );
      setChefState("cooking");
      logger.log(
        `[点餐] 厨师开始制作桌台${order.tableId}餐品（烹饪${(state.delays.cookMs / 1000).toFixed(1)}s + 摆盘${(platingMs / 1000).toFixed(1)}s）`
      );
      await waitMs(state.delays.cookMs);
      if (platingMs > 0) {
        logger.log(`[点餐] 厨师正在完成桌台${order.tableId}摆盘，准备短距出餐`);
        await waitMs(platingMs);
      }
      setChefState("toTransfer");
      await sceneManager.moveAnchor(
        "chef",
        SERVICE_POINTS.transferChefNear || SERVICE_POINTS.transferChef,
        getMoveDuration(760),
        { faceToMove: true }
      );
      logger.log(`[点餐] 厨师已完成桌台${order.tableId}出餐，等待服务员取餐`);
      addTask("送餐", order.tableId, TASK_PRIORITY["送餐"], "chef", true);
      setChefState("returning");
      await sceneManager.moveAnchor("chef", SCENE_POINTS.chef, getMoveDuration(760), {
        faceToMove: true
      });
      faceChefToCounter();
      setChefState("idle");
    }
    chefLoopRunning = false;
  }

  async function handleOrderTask(task) {
    setWaiterState("confirming");
    logger.log(`[点餐] 服务员先到桌台${task.tableId}确认需求`);
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(900), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2,
      routeLabel: "点餐确认"
    });
    sceneManager.playActorAction?.("waiter", "confirm");
    await waitMs(FLOW_CONFIG.confirmAtTableMs);

    logger.log(`[点餐] 桌台${task.tableId}点单信息已登记，通知厨师开始处理。`);
    enqueueChefOrder(task.tableId);
    setWaiterState("reporting");
    await moveWaiterWithReplan(SERVICE_POINTS.transferReport || SERVICE_POINTS.transferPickup, getMoveDuration(520), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.15
    });
    sceneManager.playActorAction?.("waiter", "report");
    await waitMs(Math.max(220, Math.round(FLOW_CONFIG.reportToChefMs * 0.35)));
    logger.log(`[点餐] 服务员已完成桌台${task.tableId}报单，回待命位准备衔接出餐。`);
    await returnWaiterToStandby("报单后回待命位");
    logger.log(`[点餐] 服务员已回待命位，期间可继续处理其它任务。`);
  }

  async function handleDeliverTask(task) {
    setWaiterState("toTransfer");
    logger.log(`[送餐] 服务员前往出餐台提取桌台${task.tableId}餐品`);
    await moveWaiterWithReplan(SERVICE_POINTS.transferPickup, getMoveDuration(1000), {
      withPath: true,
      faceToMove: true,
      stopDistance: 0.15,
      routeLabel: "取餐"
    });
    sceneManager.playActorAction?.("waiter", "pickup");
    await waitMs(320);

    setWaiterState("delivering");
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(1400), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2,
      routeLabel: "送餐配送"
    });
    sceneManager.playActorAction?.("waiter", "serve");
    setTableStatus(task.tableId, "eating", `[送餐] 餐品已送达桌台${task.tableId}，状态切换为就餐中`);
    markCustomerDemandDone(task.tableId, "点餐");
    setTimeout(() => {
      if (state.tableStatus[task.tableId] === "eating") {
        setTableStatus(task.tableId, "checkout", `桌台${task.tableId}就餐结束，状态切换为待结账`);
      }
    }, state.delays.eatMs);
  }

  async function handleWaterTask(task) {
    setWaiterState("confirming");
    logger.log(`[送水] 服务员先到桌台${task.tableId}确认紧急送水需求`);
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(880), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    sceneManager.playActorAction?.("waiter", "confirm");
    await waitMs(FLOW_CONFIG.confirmAtTableMs);

    setWaiterState("toWater");
    logger.log(`[送水] 服务员前往接水点，为桌台${task.tableId}取水`);
    await moveWaiterWithReplan(SCENE_POINTS.waterPoint, getMoveDuration(900), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.25
    });
    await waitMs(250);

    setWaiterState("delivering");
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(1100), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    logger.log(`[送水] 桌台${task.tableId}送水完成`);
    markCustomerDemandDone(task.tableId, "送水");
  }

  async function handleCheckoutTask(task) {
    setWaiterState("checkingOut");
    logger.log(`[结账] 服务员前往桌台${task.tableId}处理结账`);
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(1100), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    sceneManager.playActorAction?.("waiter", "pay");
    await waitMs(state.delays.checkoutMs);
    setTableStatus(task.tableId, "cleaning", `桌台${task.tableId}结账完成，状态切换为待收餐`);
    markCustomerDemandDone(task.tableId, "结账");
  }

  async function handleCleanupTask(task) {
    setWaiterState("cleaning");
    logger.log(`[收餐] 服务员前往桌台${task.tableId}收餐`);
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(1100), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    await waitMs(300);
    const waypointList = SERVICE_POINTS.cleanupWaypoints?.[task.tableId] || [];
    for (const waypoint of waypointList) {
      logger.log(`[收餐] 服务员执行避障中转（桌台${task.tableId}）`);
      await moveWaiterWithReplan(waypoint, getMoveDuration(700), {
        withPath: true,
        faceToMove: true,
        stopDistance: ROBOT_SAFE_DISTANCE * 0.15
      });
    }
    logger.log("[收餐] 服务员将餐具运往回收站");
    await moveWaiterWithReplan(SERVICE_POINTS.recycleService, getMoveDuration(1200), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    await waitMs(state.delays.cleanupMs);
    setTableStatus(task.tableId, "idle", `桌台${task.tableId}收餐完成，状态重置为空闲`);
    markCustomerDemandDone(task.tableId, "收餐");
  }

  async function handlePickupTask(task) {
    setWaiterState("toWater");
    logger.log(`[服务] 服务员前往冰箱，为桌台${task.tableId}执行取货请求`);
    await moveWaiterWithReplan(SERVICE_POINTS.fridgeService, getMoveDuration(1050), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    await waitMs(380);
    setWaiterState("delivering");
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(1300), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    logger.log(`[服务] 桌台${task.tableId}冰箱取货服务完成`);
    markCustomerDemandDone(task.tableId, "冰箱取货");
  }

  async function handleSootheTask(task) {
    setWaiterState("delivering");
    logger.log(`[情绪] 服务员前往桌台${task.tableId}执行情绪安抚`);
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(1000), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    sceneManager.playActorAction?.("waiter", "soothe");
    await waitMs(800);
    state.customers
      .filter((customer) => customer.tableId === String(task.tableId))
      .forEach((customer) => {
        customer.patience = Math.min(EMOTION_CONFIG.patienceMax, customer.patience + 35);
        updateCustomerMood(customer, getCustomerMoodByPatience(customer.patience));
        sceneManager.setCustomerBehavior?.(customer.id, "normal");
      });
    logger.log(`[情绪] 桌台${task.tableId}安抚完成，耐心值回升`);
    markCustomerDemandDone(task.tableId, "情绪安抚");
  }

  async function handleSmartTask(task) {
    const intent = SMART_INTENT_BY_TASK[task.type] || "order";
    setWaiterState("confirming");
    setConversationState("movingToCustomer");
    logger.log(`[智能对话] 服务员前往桌台${task.tableId}，准备开启智能会话。`);
    await moveWaiterWithReplan(SERVICE_POINTS.tableService[task.tableId], getMoveDuration(930), {
      withPath: true,
      faceToMove: true,
      stopDistance: ROBOT_SAFE_DISTANCE * 0.2
    });
    setConversationState("chatting");
    state.chat = {
      active: true,
      mode: state.chat.mode || "table",
      tableId: String(task.tableId),
      sessionId: createSessionId(task.tableId, state.chat.mode || "table"),
      messages: [
        {
          role: "assistant",
          content: `你好，我是桌台${task.tableId}服务员。你可以问我“推荐吃什么”，也可以直接说“要水/结账”。输入“聊天结束”即可继续任务。`,
          at: Date.now()
        }
      ],
      pendingIntent: intent,
      isWaitingReply: false
    };
    store.notify();
    logger.log("[智能对话] 服务员已到桌，进入会话。");
    await waitConversationEnd();
    setConversationState("resuming");
    const nextIntent = state.chat.pendingIntent || intent;
    enqueueFollowupByIntent(task.tableId, nextIntent);
    patchChat({
      active: false,
      tableId: null,
      sessionId: "",
      messages: [],
      pendingIntent: null,
      isWaitingReply: false
    });
    setConversationState("idle");
    logger.log("[智能对话] 对话结束，继续执行业务任务。");
  }

  async function executeTask(task) {
    if (SMART_INTENT_BY_TASK[task.type]) {
      await handleSmartTask(task);
      return;
    }
    if (task.type === "点餐") {
      await handleOrderTask(task);
      return;
    }
    if (task.type === "送餐") await handleDeliverTask(task);
    if (task.type === "送水") await handleWaterTask(task);
    if (task.type === "冰箱取货") await handlePickupTask(task);
    if (task.type === "情绪安抚") await handleSootheTask(task);
    if (task.type === "结账") await handleCheckoutTask(task);
    if (task.type === "收餐") await handleCleanupTask(task);
    await returnWaiterToStandby("任务结束回待命位");
  }

  async function startWaiterDispatchLoop() {
    if (waiterLoopRunning) return;
    waiterLoopRunning = true;
    state.isDispatching = true;
    store.notify();
    while (state.taskQueue.length > 0) {
      const nextTask = state.taskQueue.shift();
      state.currentTask = nextTask;
      notifyQueueChanged();
      metrics.onTaskStarted(nextTask);
      try {
        await executeTask(nextTask);
        metrics.onTaskCompleted(nextTask);
        logger.log(`任务完成：桌台${nextTask.tableId} - ${nextTask.type}`);
      } catch (error) {
        logger.log(`[异常] 任务执行失败：${error instanceof Error ? error.message : "未知异常"}`);
      } finally {
        state.currentTask = null;
      }
    }
    waiterLoopRunning = false;
    state.isDispatching = false;
    store.notify();
  }

  function isActionAllowed(tableStatus, action) {
    if (action === "order") return tableStatus === "idle";
    if (action === "water") return tableStatus === "waiting" || tableStatus === "eating";
    if (action === "checkout") return tableStatus === "checkout";
    if (action === "cleanup") return tableStatus === "cleaning";
    return false;
  }

  function handleAction(action, tableId) {
    const key = String(tableId);
    if (!tableHasCustomer(key)) {
      logger.log(`[空桌保护] 桌台${key}无顾客，无法点单/结账/服务操作。`);
      return false;
    }
    const status = state.tableStatus[key];
    if (!isActionAllowed(status, action)) {
      advisor.explainStateConflict(`桌台${key}当前为${TABLE_STATE_LABEL[status]}，不能执行动作${action}`);
      return false;
    }
    if (action === "order") {
      if (!hasSameTask("点餐", key)) {
        setTableStatus(key, "waiting", `桌台${key}状态切换：空闲 -> 等餐中`);
        enqueueDemandForTable(key, "点餐", "ui");
        addTask("点餐", key);
      }
      return true;
    }
    if (action === "water") {
      enqueueDemandForTable(key, "送水", "ui");
      addTask("送水", key);
      return true;
    }
    if (action === "checkout") {
      if (!hasSameTask("结账", key)) {
        enqueueDemandForTable(key, "结账", "ui");
        addTask("结账", key);
      }
      return true;
    }
    if (action === "cleanup") {
      if (!hasSameTask("收餐", key)) addTask("收餐", key);
      return true;
    }
    return false;
  }

  function handleTableOrderByHeadcount(tableId) {
    const key = String(tableId);
    const relatedCustomers = state.customers.filter((item) => item.tableId === key);
    if (relatedCustomers.length === 0) {
      logger.log(`[空间交互] 桌台${key}未绑定顾客，无法发起点餐。`);
      return false;
    }
    logger.log(`[空间交互] 桌台${key}触发按人数点餐，共 ${relatedCustomers.length} 位顾客。`);
    relatedCustomers.forEach((customer) => {
      queueCustomerDemand(customer.id, "order");
    });
    return handleAction("order", key);
  }

  function startSmartConversation(tableId, intent, mode = "table") {
    const key = String(tableId);
    if (!tableHasCustomer(key)) {
      logger.log(`[智能对话] 桌台${key}未绑定顾客，无法开启智能会话。`);
      return false;
    }
    if (state.chat.active) {
      logger.log("[智能对话] 当前已有进行中的会话，请先结束。");
      return false;
    }
    const taskType = SMART_TASK_BY_INTENT[intent];
    if (!taskType) return false;
    if (hasSameTask(taskType, key)) return true;
    state.chat.mode = mode;
    addTask(taskType, key, TASK_PRIORITY["送水"] + 0.2, "smart", false);
    return true;
  }

  function handleCustomerRequest(customerId, action) {
    const queued = queueCustomerDemand(customerId, action);
    if (!queued) {
      logger.log("[顾客面板] 未识别的顾客请求。");
      return false;
    }
    const { customer, template } = queued;
    const key = customer.tableId;
    logger.log(`[顾客] ${customer.name} 发起请求：${template.label}`);
    if (action === "order") {
      if (state.tableStatus[key] === "idle") {
        setTableStatus(key, "waiting", `桌台${key}状态切换：空闲 -> 等餐中`);
      }
      if (!hasSameTask("点餐", key)) {
        enqueueDemandForTable(key, "点餐", "customer");
        addTask("点餐", key);
      }
      return true;
    }
    if (action === "pickup") {
      if (!hasSameTask("冰箱取货", key)) addTask("冰箱取货", key);
      return true;
    }
    if (action === "checkout") {
      if (!hasSameTask("结账", key)) {
        enqueueDemandForTable(key, "结账", "customer");
        addTask("结账", key);
      }
      return true;
    }
    if (action === "soothe") {
      if (!hasSameTask("情绪安抚", key)) addTask("情绪安抚", key, TASK_PRIORITY["情绪安抚"]);
      return true;
    }
    return false;
  }

  function startEmotionEngine() {
    if (emotionTimer) return;
    emotionTimer = setInterval(() => {
      let changed = false;
      state.customers.forEach((customer) => {
        if (customer.demandQueue.length === 0) return;
        const reason = findDemandDecayReason(customer);
        const reasonDecay = reason
          ? PATIENCE_DECAY_RULES[reason] ?? EMOTION_CONFIG.decayPerSecond
          : EMOTION_CONFIG.decayPerSecond;
        customer.patience = Math.max(0, customer.patience - reasonDecay);
        const mood = getCustomerMoodByPatience(customer.patience);
        updateCustomerMood(customer, mood);
        sceneManager.setCustomerBehavior?.(
          customer.id,
          customer.patience <= EMOTION_CONFIG.lowPatienceScratchThreshold ? "scratchHead" : "normal"
        );
        changed = true;
        if (reason && Math.floor(customer.patience) % 10 === 0) {
          logger.log(`[情绪] ${customer.name}因${reason}持续等待，耐心降至${Math.round(customer.patience)}。`);
        }
        if (
          customer.patience <= EMOTION_CONFIG.sootheBoostThreshold &&
          !hasSameTask("情绪安抚", customer.tableId)
        ) {
          const hasCheckout = hasSameTask("结账", customer.tableId);
          logger.log(`[情绪] ${customer.name}耐心接近临界，安抚任务已提到最高优先级。`);
          if (hasCheckout) {
            logger.log("[AI解释] 先安抚再结账，避免情绪失控导致服务中断。");
          }
          addTask("情绪安抚", customer.tableId, EMOTION_CONFIG.sootheEmergencyPriority, "emotion", true);
        } else if (customer.patience <= EMOTION_CONFIG.sootheBoostThreshold) {
          promoteSootheTask(customer.tableId);
        }
      });
      if (changed) store.notify();
    }, 1000);
  }

  async function runDemoScript() {
    logger.log("[演示] 开始执行端到端脚本：点单 -> 冰箱取货 -> 结账 -> 情绪安抚");
    handleCustomerRequest("A", "order");
    await waitMs(1300);
    handleCustomerRequest("C", "pickup");
    await waitMs(1200);
    handleCustomerRequest("B", "checkout");
    await waitMs(1200);
    const target = getCustomerById("C");
    if (target) {
      target.patience = Math.min(target.patience, 15);
      target.demandQueue.push({ type: "情绪安抚", action: "soothe", requestedAt: Date.now() });
      updateCustomerMood(target, "angry");
      sceneManager.setCustomerBehavior?.(target.id, "scratchHead");
      addTask("情绪安抚", target.tableId, TASK_PRIORITY["情绪安抚"], "demo", true);
      logger.log("[演示] 已注入愤怒顾客场景，验证安抚插队策略");
      store.notify();
    }
  }

  function applyScenario(mode) {
    const preset = SCENARIO_PRESETS[mode];
    if (!preset) return;
    state.scenario = mode;
    state.delays = { ...preset.delays };
    logger.log(`[模式] 已切换到${preset.name}`);
    const tableIds = Object.keys(state.tableStatus);
    if (mode === "lunchRush") {
      let injectCount = 0;
      tableIds.forEach((tableId) => {
        if (!tableHasCustomer(tableId)) return;
        const t = addTask("点餐", tableId, TASK_PRIORITY["点餐"], "scenario", true);
        if (t) injectCount += 1;
        if (t && state.tableStatus[tableId] === "idle") state.tableStatus[tableId] = "waiting";
      });
      logger.log(`[模式] 午高峰已注入${injectCount}桌点餐任务（有顾客桌）`);
    }
    if (mode === "emergency") {
      let injectCount = 0;
      tableIds.forEach((tableId) => {
        if (!tableHasCustomer(tableId)) return;
        const t = addTask("送水", tableId, TASK_PRIORITY["送水"], "scenario", true);
        if (t) injectCount += 1;
      });
      logger.log(`[模式] 突发事件已注入${injectCount}桌紧急送水任务（有顾客桌）`);
    }
    store.notify();
  }

  return {
    addTask,
    handleAction,
    handleTableOrderByHeadcount,
    handleCustomerRequest,
    startSmartConversation,
    appendChatMessage,
    setChatWaiting,
    updateChatPendingIntent,
    endChatConversation,
    applyScenario,
    startDispatchLoop: startWaiterDispatchLoop,
    startEmotionEngine,
    runDemoScript,
    isActionAllowed,
    tableHasCustomer,
    updateDynamicObstacles
  };
}
