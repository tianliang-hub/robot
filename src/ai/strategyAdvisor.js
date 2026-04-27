export function createStrategyAdvisor({ logger }) {
  let lastLogAt = 0;

  return {
    evaluate(state) {
      const now = performance.now();
      if (now - lastLogAt < 2800) return;

      const queueSize = state.taskQueue.length;
      if (queueSize >= 6) {
        logger.log("[AI建议] 当前任务拥塞，建议临时优先处理高优先级任务并降低低优先级注入频率。");
        lastLogAt = now;
        return;
      }

      const angryCustomers = state.customers.filter((item) => item.mood === "angry");
      if (angryCustomers.length > 0) {
        logger.log("[AI建议] 存在高愤怒顾客，建议立即插队安抚并同步解释等待原因。");
        lastLogAt = now;
        return;
      }

      const delayedCustomers = state.customers.filter((item) =>
        item.demandQueue.some((demand) => Date.now() - demand.requestedAt >= 10000)
      );
      if (delayedCustomers.length > 0) {
        logger.log("[AI建议] 检测到长等待顾客，建议先处理结账和安抚，再推进送餐任务。");
        lastLogAt = now;
        return;
      }

      const emergencyCount = state.taskQueue.filter((task) => task.type === "送水").length;
      if (emergencyCount >= 2) {
        logger.log("[AI建议] 紧急送水任务较多，建议优先清空送水队列再推进送餐。");
        lastLogAt = now;
      }
    },
    explainStateConflict(reason) {
      logger.log(`[AI解释] 检测到状态冲突：${reason}。建议检查桌台状态与任务类型是否匹配。`);
    }
  };
}
