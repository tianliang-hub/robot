import GUI from "lil-gui";
import { ACTOR_MODEL_PLAN, SCENARIO_PRESETS, STATIC_MODEL_PLAN } from "./src/config/appConfig.js";
import { createLogger } from "./src/core/logger.js";
import { createStateStore } from "./src/core/state.js";
import { createScheduler } from "./src/dispatch/scheduler.js";
import { createUIController } from "./src/interaction/uiController.js";
import { createMetricsCollector } from "./src/metrics/metricsCollector.js";
import { createReplayRecorder } from "./src/metrics/replayRecorder.js";
import { createSceneManager } from "./src/scene/sceneManager.js";
import { createStrategyAdvisor } from "./src/ai/strategyAdvisor.js";

const store = createStateStore();
const replayRecorder = createReplayRecorder();
const logger = createLogger({ replayRecorder });
const metrics = createMetricsCollector();
const sceneManager = createSceneManager({ logger });
const advisor = createStrategyAdvisor({ logger });
const scheduler = createScheduler({
  store,
  sceneManager,
  logger,
  metrics,
  advisor
});
const uiController = createUIController({
  store,
  scheduler,
  logger,
  replayRecorder
});

function initDebugPanel() {
  const params = {
    mode: "showcase",
    导出TransformJSON: async () => {
      const payload = {};
      sceneManager.editableTargets.forEach((item) => {
        payload[item.name] = {
          position: {
            x: Number(item.object3D.position.x.toFixed(3)),
            y: Number(item.object3D.position.y.toFixed(3)),
            z: Number(item.object3D.position.z.toFixed(3))
          },
          rotationDeg: {
            x: Number((item.object3D.rotation.x * (180 / Math.PI)).toFixed(2)),
            y: Number((item.object3D.rotation.y * (180 / Math.PI)).toFixed(2)),
            z: Number((item.object3D.rotation.z * (180 / Math.PI)).toFixed(2))
          }
        };
      });
      const text = JSON.stringify(payload, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        logger.log("[调试] Transform JSON 已复制到剪贴板。");
      } catch (_e) {
        logger.log("[调试] 复制失败，已输出到控制台。");
      }
      console.log("[SceneTransformExport]\n", text);
    }
  };
  const gui = new GUI({ title: "系统调试台" });
  gui.add(params, "mode", ["showcase", "debug"]).name("模式");
  gui.add(params, "导出TransformJSON");
  return gui;
}

async function bootstrap() {
  replayRecorder.clear();
  replayRecorder.resetClock();

  uiController.mount();
  sceneManager.bindPointerInteraction();
  sceneManager.setOnTableClick((tableId) => {
    logger.log(`[空间交互] 捕获 3D 坐标点击，锁定桌台${tableId}，按桌台人数发起点餐需求。`);
    scheduler.handleTableOrderByHeadcount(tableId);
  });
  sceneManager.setOnCustomerClick((customerId) => {
    store.patch({ selectedCustomerId: customerId });
    logger.log(`[空间交互] 已锁定顾客${customerId}，顾客服务面板已展开。`);
  });

  await sceneManager.loadModelsInStages(ACTOR_MODEL_PLAN, STATIC_MODEL_PLAN);
  scheduler.applyScenario("normal");
  scheduler.startEmotionEngine();
  sceneManager.animate();
  initDebugPanel();
  metrics.render();
  logger.log("系统启动完成，已进入平峰模式。");
  logger.log("你可以通过按钮、3D点击、文本/语音指令三种方式下发任务。");

  // 默认记录一次建议日志，作为AI能力入口提示
  advisor.evaluate(store.state);
}

// 设置默认场景参数，避免首次渲染前空值
store.patch({
  scenario: "normal",
  delays: { ...SCENARIO_PRESETS.normal.delays }
});

bootstrap();
