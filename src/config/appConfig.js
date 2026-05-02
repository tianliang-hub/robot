import * as THREE from "three";

export const LOG_LIMIT = 300;
export const RAYCAST_THROTTLE_MS = 33;

export const TASK_PRIORITY = {
  情绪安抚: 5,
  送水: 4,
  智能服务: 4.2,
  结账: 3,
  冰箱取货: 2,
  送餐: 2,
  点餐: 1,
  收餐: 0
};

export const TABLE_STATE_LABEL = {
  idle: "空闲",
  waiting: "等餐中",
  eating: "就餐中",
  checkout: "待结账",
  cleaning: "待收餐"
};

export const CUSTOMER_MOOD_LABEL = {
  calm: "平静",
  waiting: "等待中",
  anxious: "焦虑",
  angry: "愤怒"
};

export const EMOTION_CONFIG = {
  patienceMax: 100,
  decayPerSecond: 4,
  recoverPerService: 18,
  anxiousThreshold: 55,
  angryThreshold: 25,
  autoSootheThreshold: 20,
  sootheBoostThreshold: 24,
  lowPatienceScratchThreshold: 30,
  sootheEmergencyPriority: 7
};

export const CUSTOMER_BINDINGS = [
  { id: "A", name: "顾客A", tableId: "3", anchorModelName: "顾客A" },
  { id: "B", name: "顾客B", tableId: "3", anchorModelName: "顾客B" },
  { id: "C", name: "顾客C", tableId: "2", anchorModelName: "顾客C" }
];

export const CUSTOMER_DEMAND_TEMPLATES = {
  order: { type: "点餐", action: "order", label: "点单" },
  pickup: { type: "冰箱取货", action: "pickup", label: "请求冰箱取货" },
  checkout: { type: "结账", action: "checkout", label: "结账" },
  soothe: { type: "情绪安抚", action: "soothe", label: "安抚请求" }
};

export const SCENE_POINTS = {
  chef: new THREE.Vector3(0, 0, -9.7),
  standby: new THREE.Vector3(0, 0, -2),
  standby2: new THREE.Vector3(2.2, 0, -2),
  transferZone: new THREE.Vector3(0, 1.7, -6.1),
  recycleZone: new THREE.Vector3(-7, 0, -4.5),
  waterPoint: new THREE.Vector3(-5, 0, 0),
  fridgePoint: new THREE.Vector3(-8.9, 0, -4.5),
  tables: {
    "1": new THREE.Vector3(-5.2, 0, 3.2),
    "2": new THREE.Vector3(5.2, 0, 3.2),
    "3": new THREE.Vector3(-5.2, 0, 9.5),
    "4": new THREE.Vector3(5.3, 0, 9.5)
  }
};

const FRIDGE_POS = new THREE.Vector3(-7, 0, -1.5);
const FRIDGE_FACE_DIR = new THREE.Vector3()
  .subVectors(SCENE_POINTS.standby, FRIDGE_POS)
  .setY(0);
if (FRIDGE_FACE_DIR.lengthSq() > 1e-6) FRIDGE_FACE_DIR.normalize();
export const FRIDGE_ROTATION_Y = Math.atan2(FRIDGE_FACE_DIR.x, FRIDGE_FACE_DIR.z);

export const SERVICE_POINTS = {
  transferChef: new THREE.Vector3(0, 0, -6.9),
  transferChefNear: new THREE.Vector3(0, 0, -7.7),
  transferPickup: new THREE.Vector3(0, 0, -5.2),
  transferReport: new THREE.Vector3(0, 0, -4.8),
  cookStation: new THREE.Vector3(-4.8, 0, -8.7),
  recycleService: new THREE.Vector3(-6.2, 0, -4.3),
  // 冰箱正面朝向服务员初始位 standby，服务点放在正面外侧
  fridgeService: new THREE.Vector3(
    FRIDGE_POS.x + FRIDGE_FACE_DIR.x * 1.2,
    0,
    FRIDGE_POS.z + FRIDGE_FACE_DIR.z * 1.2
  ),
  cleanupWaypoints: {
    "1": [new THREE.Vector3(-6.8, 0, 1.2)],
    "2": [new THREE.Vector3(6.8, 0, 1.2)],
    "3": [new THREE.Vector3(-6.6, 0, 7.9)],
    "4": [new THREE.Vector3(3.8, 0, 7.9)]
  },
  tableServicePrimary: {
    "1": new THREE.Vector3(-5.2, 0, 2.1),
    "2": new THREE.Vector3(5.2, 0, 2.1),
    "3": new THREE.Vector3(-5.2, 0, 8.4),
    "4": new THREE.Vector3(5.3, 0, 8.4)
  },
  tableServiceAlt: {
    "1": new THREE.Vector3(-5.2, 0, 4.35),
    "2": new THREE.Vector3(5.2, 0, 4.35),
    "3": new THREE.Vector3(-5.2, 0, 10.65),
    "4": new THREE.Vector3(5.3, 0, 10.65)
  },
  tableServiceFallback: {
    "1": new THREE.Vector3(-3.9, 0, 3.2),
    "2": new THREE.Vector3(3.9, 0, 3.2),
    "3": new THREE.Vector3(-3.9, 0, 9.5),
    "4": new THREE.Vector3(4.0, 0, 9.5)
  },
  tableService: {
    "1": new THREE.Vector3(-5.2, 0, 2.1),
    "2": new THREE.Vector3(5.2, 0, 2.1),
    "3": new THREE.Vector3(-5.2, 0, 8.4),
    "4": new THREE.Vector3(5.3, 0, 8.4)
  }
};

export const ROBOT_SAFE_DISTANCE = 0.75;
export const WAITER_TURN_SPEED = 10;
export const NAV_GRID = {
  width: 36,
  depth: 36,
  cellSize: 0.8,
  origin: new THREE.Vector3(0, 0, 0)
};
export const NAV_REPLAN_MS = 150;
export const NAV_BLOCK_RADIUS = 0.55;
export const NAV_STATIC_OBSTACLE_PREFIXES = [
  "sofa",
  "散台沙发",
  "counter",
  "wall",
  "fridge",
  "oven",
  "扩展沙发"
];
export const NAV_STATIC_OBSTACLE_EXCLUDE_NAMES = ["顾客A", "顾客B", "顾客C"];
export const NAV_STATIC_OBSTACLE_INCLUDE_NAMES = ["锚点-回收站"];
export const NAV_STATIC_OBSTACLE_PADDING = 0.38;
export const TABLE_UNDER_OBSTACLE_OFFSETS = [
  [-0.5, 0],
  [0, 0],
  [0.5, 0],
  [0, -0.45],
  [0, 0.45]
];
export const TABLE_UNDER_OBSTACLE_RADIUS = 0.36;

export const FLOW_CONFIG = {
  confirmAtTableMs: 900,
  reportToChefMs: 900,
  plateAtTransferMs: 400,
  waiterQueueGuardMax: 10,
  priorityAgingPer10s: 0.35
};

export const PATIENCE_DECAY_RULES = {
  waitingForOrder: 4.5,
  waitingForWater: 3.8,
  waitingForCheckout: 4.2,
  waitingForPickup: 2.6
};

export const SCENARIO_PRESETS = {
  normal: {
    name: "平峰模式",
    delays: { cookMs: 3000, eatMs: 5000, checkoutMs: 1000, cleanupMs: 1000, moveScale: 1 }
  },
  lunchRush: {
    name: "午高峰",
    delays: { cookMs: 3800, eatMs: 5500, checkoutMs: 1200, cleanupMs: 1300, moveScale: 1.15 }
  },
  emergency: {
    name: "突发事件",
    delays: { cookMs: 2500, eatMs: 4500, checkoutMs: 900, cleanupMs: 900, moveScale: 0.9 }
  }
};

export const MODEL_QUALITY = {
  high: { shadowMap: 2048, maxCastDistance: 16 },
  medium: { shadowMap: 1536, maxCastDistance: 12 },
  low: { shadowMap: 1024, maxCastDistance: 8 }
};

/** 厨师 glTF 子节点名（小写匹配子串）加载后设为不可见，例如去掉手持刀保留锅/锅铲 */
export const CHEF_HIDDEN_MESH_NAME_SUBSTRINGS = ["knife"];

export const ACTOR_MODEL_PLAN = [
  {
    name: "锚点-熊猫厨师",
    url: "/models/chef/chef.glb",
    anchorKey: "chef",
    scale: 0.88,
    rotationY: 0,
    stage: 1,
    importance: "high"
  },
  {
    name: "锚点-兔子服务员",
    url: "/models/waiter/waiter.glb",
    anchorKey: "waiter",
    scale: 0.82,
    rotationY: 0,
    stage: 1,
    importance: "high"
  },
  {
    name: "锚点-兔子服务员2",
    url: "/models/waiter/waiter.glb",
    anchorKey: "waiter2",
    scale: 0.82,
    rotationY: 0,
    stage: 1,
    importance: "high"
  },
  {
    name: "锚点-桌台1",
    url: "/models/tables/table_1.glb",
    anchorKey: "table1",
    scale: 0.9,
    stage: 1,
    importance: "high"
  },
  {
    name: "锚点-桌台2",
    url: "/models/tables/table_2.glb",
    anchorKey: "table2",
    scale: 0.9,
    stage: 1,
    importance: "high"
  },
  {
    name: "锚点-桌台3",
    url: "/models/tables/table_1.glb",
    anchorKey: "table3",
    scale: 0.9,
    stage: 1,
    importance: "high"
  },
  {
    name: "锚点-桌台4",
    url: "/models/tables/table_2.glb",
    anchorKey: "table4",
    scale: 0.9,
    stage: 1,
    importance: "high"
  },
  {
    name: "锚点-出餐接驳点",
    url: "/models/food/ebi_nigiri.glb",
    anchorKey: "transfer",
    scale: 1.9,
    stage: 1,
    importance: "medium"
  },
  {
    name: "锚点-回收站",
    url: "/models/props/recycle_bin.glb",
    anchorKey: "recycle",
    scale: 0.72,
    rotationY: Math.PI / 2,
    stage: 1,
    importance: "medium"
  }
];

export const STATIC_MODEL_PLAN = [
  { name: "counter_straight", url: "/models/environment/counter_straight.glb", pos: [-5.4, 0, -7.1], scale: 0.95, rotationY: Math.PI, stage: 1, importance: "high" },
  { name: "counter_drawers", url: "/models/environment/counter_drawers.glb", pos: [-1.6, 0, -7.1], scale: 0.95, rotationY: Math.PI, stage: 1, importance: "high" },
  { name: "counter_straight_2", url: "/models/environment/counter_straight_2.glb", pos: [1.6, 0, -7.1], scale: 0.95, rotationY: 0, stage: 1, importance: "high" },
  { name: "counter_sink", url: "/models/environment/counter_sink.glb", pos: [4.8, 0, -7.1], scale: 0.95, rotationY: Math.PI, stage: 1, importance: "high" },
  { name: "sofa", url: "/models/environment/sofa.glb", pos: [-3.6, 0, 3.2], scale: 0.9, rotationY: -Math.PI / 2, stage: 1, importance: "medium" },
  { name: "sofa_right", url: "/models/environment/sofa.glb", pos: [-6.8, 0, 3.2], scale: 0.9, rotationY: Math.PI / 2, stage: 1, importance: "medium" },
  { name: "散台沙发-左", url: "/models/environment/sofa.glb", pos: [3.6, 0, 3.2], scale: 0.75, rotationY: Math.PI / 2, stage: 1, importance: "medium" },
  { name: "散台沙发-右", url: "/models/environment/sofa.glb", pos: [7, 0, 3.2], scale: 0.75, rotationY: -Math.PI / 2, stage: 1, importance: "medium" },
  { name: "扩展沙发-桌3左", url: "/models/environment/sofa.glb", pos: [-6.8, 0, 9.5], scale: 0.75, rotationY: Math.PI / 2, stage: 1, importance: "medium" },
  { name: "扩展沙发-桌3右", url: "/models/environment/sofa.glb", pos: [-3.6, 0, 9.5], scale: 0.75, rotationY: -Math.PI / 2, stage: 1, importance: "medium" },
  { name: "扩展沙发-桌4左", url: "/models/environment/sofa.glb", pos: [3.6, 0, 9.5], scale: 0.75, rotationY: Math.PI / 2, stage: 1, importance: "medium" },
  { name: "扩展沙发-桌4右", url: "/models/environment/sofa.glb", pos: [7, 0, 9.5], scale: 0.75, rotationY: -Math.PI / 2, stage: 1, importance: "medium" },
  { name: "wall_redwood_left", url: "/models/environment/wall_redwood.glb", pos: [-2.2, 2.3, -11.5], scale: 0.14, stage: 2, importance: "low" },
  { name: "wall_redwood_right", url: "/models/environment/wall_redwood.glb", pos: [2.8, 2.3, -11.5], scale: 0.14, stage: 2, importance: "low" },
  { name: "oven", url: "/models/environment/oven.glb", pos: [-6.9, 0, -9.5], scale: 1, rotationY: Math.PI / 2, stage: 1, importance: "high" },
  {
    name: "decor_pot_on_oven",
    url: "/models/props/plate.glb",
    pos: [-6.9, 2.16, -9.5],
    scale: 1.12,
    rotationY: Math.PI / 2,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_bottles_on_recycle",
    url: "/models/props/plate.glb",
    pos: [-7, 0.9, -4.5],
    scale: 1,
    rotationY:0,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  { name: "fridge", url: "/models/environment/fridge.glb", pos: [-7, 0, -1.5], scale: 0.9, rotationY: FRIDGE_ROTATION_Y, stage: 1, importance: "high" },
  { name: "wall_shoji_1", url: "/models/environment/wall_shoji.glb", pos: [-6, 0, -10], scale: 1.0, rotationY: 0, stage: 2, importance: "low" },
  { name: "wall_shoji_2", url: "/models/environment/wall_shoji.glb", pos: [-2, 0, -10], scale: 1.0, rotationY: 0, stage: 2, importance: "low" },
  { name: "wall_shoji_3", url: "/models/environment/wall_shoji.glb", pos: [2, 0, -10], scale: 1.0, rotationY: 0, stage: 2, importance: "low" },
  { name: "wall_shoji_4", url: "/models/environment/wall_shoji.glb", pos: [6, 0, -10], scale: 1.0, rotationY: 0, stage: 2, importance: "low" },
  { name: "wall_house_left_1", url: "/models/environment/wall_shoji.glb", pos: [-9, 0, -11], scale: 1.0, rotationY: Math.PI / 2, stage: 2, importance: "medium" },
  { name: "wall_house_left_2", url: "/models/environment/wall_shoji.glb", pos: [-9, 0, -7], scale: 1.0, rotationY: Math.PI / 2, stage: 2, importance: "medium" },
  { name: "wall_house_left_3", url: "/models/environment/wall_shoji.glb", pos: [-9, 0, -3], scale: 1.0, rotationY: Math.PI / 2, stage: 2, importance: "medium" },
  { name: "wall_house_left_4", url: "/models/environment/wall_shoji.glb", pos: [-9, 0, 1], scale: 1.0, rotationY: Math.PI / 2, stage: 2, importance: "medium" },
  { name: "wall_house_left_5", url: "/models/environment/wall_shoji.glb", pos: [-9, 0, 5], scale: 1.0, rotationY: Math.PI / 2, stage: 2, importance: "medium" },
  { name: "wall_house_left_6", url: "/models/environment/wall_shoji.glb", pos: [-9, 0, 9], scale: 1.0, rotationY: Math.PI / 2, stage: 2, importance: "medium" },
  {
    name: "decor_wall_light_1",
    url: "/models/props/plate.glb",
    pos: [-8.92, 3.42, -5],
    scale: 1,
    rotationY: Math.PI / 2,
    stage: 2,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_wall_light_2",
    url: "/models/props/plate.glb",
    pos: [-8.92, 3.42, 0],
    scale: 1,
    rotationY: Math.PI / 2,
    stage: 2,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_wall_light_3",
    url: "/models/props/plate.glb",
    pos: [-8.92, 3.42, 5],
    scale: 1,
    rotationY: Math.PI / 2,
    stage: 2,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_food_udon",
    url: "/models/food/ebi_nigiri_prop.glb",
    pos: [2.2, 1.98, -5.95],
    scale: 1.2,
    rotationY: Math.PI * 0.15,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_food_onigiri",
    url: "/models/food/ebi_nigiri_prop.glb",
    pos: [1.25, 1.68, -5.95],
    scale: 1.42,
    rotationY: -Math.PI * 0.2,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_food_tamago",
    url: "/models/food/ebi_nigiri_prop.glb",
    pos: [0.65, 1.68, -5.95],
    scale: 1.4,
    rotationY: 0,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_cutting_board_transfer",
    url: "/models/props/plate.glb",
    pos: [-4, 2, -6.92],
    scale: 1.3,
    rotationY: - Math.PI,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_right_counter_light",
    url: "/models/props/plate.glb",
    pos: [7.3, 0, -6.92],
    scale: 1,
    rotationY: Math.PI * 0.5,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_right_counter_bottle",
    url: "/models/props/plate.glb",
    pos: [1.25, 0.98, -6.9],
    scale: 0.1,
    rotationY: Math.PI / 2,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  {
    name: "decor_right_floor_plant",
    url: "/models/props/plate.glb",
    pos: [7.25, 1.4, -6.9],
    scale: 0.5,
    rotationY: Math.PI * 0.35,
    stage: 1,
    importance: "low",
    navObstacle: false
  },
  { name: "顾客A", url: "/models/customers/customer_a.glb", pos: [-6.6, 0, 9.5], scale: 0.8, rotationY: Math.PI / 2, stage: 2, importance: "medium" },
  { name: "顾客B", url: "/models/customers/customer_b.glb", pos: [-3.8, 0, 9.5], scale: 0.8, rotationY: -Math.PI / 2, stage: 2, importance: "medium" },
  { name: "顾客C", url: "/models/customers/customer_c.glb", pos: [6.8, 0, 3.1], scale: 0.8, rotationY: -Math.PI / 2, stage: 2, importance: "medium" }
];
