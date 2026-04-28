import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  MODEL_QUALITY,
  NAV_GRID,
  NAV_STATIC_OBSTACLE_EXCLUDE_NAMES,
  NAV_STATIC_OBSTACLE_INCLUDE_NAMES,
  NAV_STATIC_OBSTACLE_PADDING,
  RAYCAST_THROTTLE_MS,
  SCENE_POINTS,
  SERVICE_POINTS,
  TABLE_UNDER_OBSTACLE_OFFSETS,
  TABLE_UNDER_OBSTACLE_RADIUS,
  WAITER_TURN_SPEED
} from "../config/appConfig.js";

export function createSceneManager({ logger }) {
  const threeContainer = document.getElementById("three-container");
  const loadingIndicator = document.getElementById("loading-indicator");
  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  const gltfLoader = new GLTFLoader();

  let hoveredTableAnchor = null;
  let lastPointerCheckAt = 0;
  let onTableClick = null;
  let onCustomerClick = null;
  let onObstacleChanged = null;
  let obstacleEditMode = false;
  let activePathLine = null;
  let startedAt = performance.now();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a2a);

  const camera = new THREE.PerspectiveCamera(
    60,
    threeContainer.clientWidth / threeContainer.clientHeight,
    0.1,
    1000
  );
  camera.position.set(12, 12, 12);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  threeContainer.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.panSpeed = 1.25;
  controls.screenSpacePanning = true;
  controls.enableZoom = true;
  controls.zoomSpeed = 1.35;
  controls.rotateSpeed = 1.25;
  controls.minDistance = 2.5;
  controls.maxDistance = 80;
  controls.minPolarAngle = 0.03;
  controls.maxPolarAngle = Math.PI - 0.03;
  controls.keyPanSpeed = 35;
  controls.target.set(0, 0, 0);

  const visualGridSize = Math.max(NAV_GRID.width, NAV_GRID.depth);
  const visualGridDivisions = Math.max(24, Math.round(visualGridSize / Math.max(0.4, NAV_GRID.cellSize)));
  const gridHelper = new THREE.GridHelper(visualGridSize, visualGridDivisions, 0x2dff8f, 0x2f7f95);
  gridHelper.position.x = NAV_GRID.origin.x;
  gridHelper.position.z = NAV_GRID.origin.z;
  const gridMaterials = Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.1;
    material.depthWrite = false;
  });
  scene.add(gridHelper);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);
  const obstacleMarkerGroup = new THREE.Group();
  scene.add(obstacleMarkerGroup);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  const anchors = {
    chef: createAnchor(0xff3b3b, SCENE_POINTS.chef),
    waiter: createAnchor(0x3a7bff, SCENE_POINTS.standby),
    waiter2: createAnchor(0x4f9bff, SCENE_POINTS.standby2 || SCENE_POINTS.standby),
    transfer: createAnchor(0xffd24a, SCENE_POINTS.transferZone),
    recycle: createAnchor(0x555555, SCENE_POINTS.recycleZone),
    water: createCylinderAnchor(0xffffff, SCENE_POINTS.waterPoint)
  };
  const tableAnchorKeys = Object.entries(SCENE_POINTS.tables || {}).map(([tableId, pos]) => {
    const key = `table${tableId}`;
    anchors[key] = createCylinderAnchor(0x39d67a, pos);
    anchors[key].userData.tableId = String(tableId);
    return key;
  });

  const editableTargets = [];
  const clickableTables = tableAnchorKeys.map((key) => anchors[key]).filter(Boolean);
  const clickableCustomers = [];
  const modelRefs = new Map();
  const actorRigs = new Map();
  const animationMixers = [];
  const customerMoodVisuals = new Map();
  const customerBehaviors = new Map();
  const obstacleMarkers = new Map();
  const staticObstacleCells = new Set();
  const tableUnderObstacleCells = new Set();

  const quality = resolveQuality();
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(MODEL_QUALITY[quality].shadowMap, MODEL_QUALITY[quality].shadowMap);
  dirLight.shadow.camera.left = -28;
  dirLight.shadow.camera.right = 28;
  dirLight.shadow.camera.top = 22;
  dirLight.shadow.camera.bottom = -22;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 80;

  function createAnchor(color, pos) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 })
    );
    mesh.position.copy(pos);
    mesh.material.transparent = true;
    mesh.material.opacity = 0.02;
    mesh.material.depthWrite = false;
    scene.add(mesh);
    return mesh;
  }

  function createCylinderAnchor(color, pos) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 1, 24),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 })
    );
    mesh.position.copy(pos);
    mesh.material.transparent = true;
    mesh.material.opacity = 0.02;
    mesh.material.depthWrite = false;
    scene.add(mesh);
    return mesh;
  }

  function resolveQuality() {
    const memory = navigator.deviceMemory || 8;
    if (memory <= 4) return "low";
    if (memory <= 8) return "medium";
    return "high";
  }

  function loadGLB(url) {
    return new Promise((resolve, reject) => {
      gltfLoader.load(url, (gltf) => resolve(gltf), undefined, reject);
    });
  }

  function normalizeToGround(object3D) {
    object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    object3D.position.x -= center.x;
    object3D.position.z -= center.z;
    object3D.position.y -= box.min.y;
  }

  function applyShadowFlags(object3D, importance, worldPos) {
    const maxCastDistance = MODEL_QUALITY[quality].maxCastDistance;
    const canCast = importance === "high" && worldPos.length() <= maxCastDistance;
    object3D.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = canCast;
      child.receiveShadow = true;
    });
  }

  async function attachActorModel(plan) {
    const gltf = await loadGLB(plan.url);
    const model = gltf.scene;
    model.scale.setScalar(plan.scale ?? 1);
    if (typeof plan.rotationY === "number") model.rotation.y = plan.rotationY;
    normalizeToGround(model);
    applyShadowFlags(model, plan.importance, anchors[plan.anchorKey].position);
    anchors[plan.anchorKey].add(model);
    editableTargets.push({ name: plan.name, object3D: anchors[plan.anchorKey] });
    registerActorRig(plan.anchorKey, model, gltf.animations || []);
  }

  async function spawnStaticModel(plan, parent = scene) {
    let gltf = null;
    let usedFallback = false;
    try {
      gltf = await loadGLB(plan.url);
    } catch (error) {
      if (!plan.fallbackUrl) throw error;
      gltf = await loadGLB(plan.fallbackUrl);
      usedFallback = true;
      logger.log(`[模型] ${plan.name} 主模型加载失败，已回退占位模型`);
    }
    const model = gltf.scene;
    model.scale.setScalar(usedFallback ? (plan.fallbackScale ?? plan.scale ?? 1) : (plan.scale ?? 1));
    const rotationY = usedFallback
      ? (typeof plan.fallbackRotationY === "number" ? plan.fallbackRotationY : plan.rotationY)
      : plan.rotationY;
    if (typeof rotationY === "number") model.rotation.y = rotationY;
    normalizeToGround(model);
    model.position.set(plan.pos[0], plan.pos[1], plan.pos[2]);
    applyShadowFlags(model, plan.importance, model.position);
    parent.add(model);
    editableTargets.push({ name: plan.name, object3D: model });
    modelRefs.set(plan.name, model);
    if (String(plan.name || "").startsWith("顾客")) {
      model.userData.customerId = String(plan.name).replace("顾客", "");
      clickableCustomers.push(model);
      customerMoodVisuals.set(model.userData.customerId, {
        object3D: model,
        baseY: model.position.y,
        mood: "calm"
      });
      customerBehaviors.set(model.userData.customerId, "normal");
    }
  }

  function registerActorRig(anchorKey, model, clips) {
    const mixer = new THREE.AnimationMixer(model);
    animationMixers.push(mixer);
    const actions = new Map();
    clips.forEach((clip) => {
      actions.set(clip.name.toLowerCase(), mixer.clipAction(clip));
    });
    actorRigs.set(anchorKey, {
      mixer,
      model,
      actions,
      activeAction: null,
      fallbackAction: null,
      baseTransform: {
        y: model.position.y,
        rotY: model.rotation.y,
        rotZ: model.rotation.z
      }
    });
  }

  function pickClipAction(rig, logicalAction) {
    if (!rig || !rig.actions || rig.actions.size === 0) return null;
    const alias = {
      idle: ["idle", "stand", "wait"],
      walk: ["walk", "run", "move"],
      cook: ["cook", "chop", "make", "kitchen"],
      pickup: ["pickup", "pick", "take", "grab"],
      serve: ["serve", "deliver", "give"],
      pay: ["pay", "checkout", "cash"],
      soothe: ["soothe", "calm", "talk", "wave"],
      confirm: ["confirm", "talk", "listen", "wave"],
      report: ["report", "tell", "talk", "wave"],
      scratchHead: ["scratch", "head", "anxious"]
    };
    const keys = alias[logicalAction] || [logicalAction];
    for (const key of keys) {
      for (const [clipName, action] of rig.actions.entries()) {
        if (clipName.includes(key)) return action;
      }
    }
    return null;
  }

  function playActorAction(anchorKey, logicalAction) {
    const rig = actorRigs.get(anchorKey);
    if (!rig) return false;
    const next = pickClipAction(rig, logicalAction);
    if (!next) {
      rig.fallbackAction = logicalAction;
      return false;
    }
    if (rig.activeAction === next) return true;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setLoop(THREE.LoopRepeat);
    next.play();
    if (rig.activeAction) {
      rig.activeAction.crossFadeTo(next, 0.25, false);
    }
    rig.activeAction = next;
    rig.fallbackAction = null;
    return true;
  }

  function setCustomerMoodVisual(customerId, mood) {
    const view = customerMoodVisuals.get(String(customerId));
    if (!view) return;
    view.mood = mood;
    view.object3D.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat || !("emissive" in mat)) return;
        if (mood === "angry") {
          mat.emissive.setHex(0x7d1d1d);
          mat.emissiveIntensity = 1.2;
        } else if (mood === "anxious") {
          mat.emissive.setHex(0x7d6620);
          mat.emissiveIntensity = 0.9;
        } else if (mood === "waiting") {
          mat.emissive.setHex(0x2c4f7d);
          mat.emissiveIntensity = 0.5;
        } else {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0.25;
        }
      });
    });
  }

  function setTableMoodVisual(tableId, mood) {
    const anchor = anchors[`table${String(tableId)}`];
    if (!anchor) return;
    anchor.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat || !("emissive" in mat)) return;
        if (mood === "angry") {
          mat.emissive.setHex(0x6d0f0f);
          mat.emissiveIntensity = 1.2;
        } else if (mood === "anxious") {
          mat.emissive.setHex(0x7a6115);
          mat.emissiveIntensity = 0.85;
        } else if (mood === "waiting") {
          mat.emissive.setHex(0x133a61);
          mat.emissiveIntensity = 0.55;
        } else {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0.25;
        }
      });
    });
  }

  function setCustomerBehavior(customerId, behavior) {
    const key = String(customerId);
    if (!customerMoodVisuals.has(key)) return;
    customerBehaviors.set(key, behavior || "normal");
  }

  async function loadModelsInStages(actorPlans, staticPlans) {
    editableTargets.length = 0;
    const staged = [...actorPlans, ...staticPlans];
    const total = staged.length;
    let loaded = 0;

    async function runStage(stage) {
      const jobs = [];
      actorPlans
        .filter((x) => x.stage === stage)
        .forEach((plan) => {
          jobs.push(
            attachActorModel(plan)
              .catch(() => logger.log(`[模型] ${plan.name} 加载失败，回退锚点`))
              .finally(() => {
                loaded += 1;
                updateLoadProgress(loaded / total);
              })
          );
        });

      staticPlans
        .filter((x) => x.stage === stage)
        .forEach((plan) => {
          jobs.push(
            spawnStaticModel(plan)
              .catch(() => logger.log(`[模型] ${plan.name} 加载失败`))
              .finally(() => {
                loaded += 1;
                updateLoadProgress(loaded / total);
              })
          );
        });
      await Promise.allSettled(jobs);
    }

    updateLoadProgress(0);
    await runStage(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runStage(2);
    projectStaticObstacles([...actorPlans, ...staticPlans]);
    updateLoadProgress(1);
  }

  function updateLoadProgress(ratio) {
    const pct = Math.round(ratio * 100);
    loadingIndicator.textContent = ratio >= 1 ? "模型加载完成" : `模型加载中 ${pct}%`;
  }

  function setOnTableClick(cb) {
    onTableClick = cb;
  }

  function setOnCustomerClick(cb) {
    onCustomerClick = cb;
  }

  function setOnObstacleChanged(cb) {
    onObstacleChanged = cb;
  }

  function navCellKey(cell) {
    return `${cell.x},${cell.z}`;
  }

  function worldToNavCell(world) {
    const halfWidth = NAV_GRID.width * 0.5;
    const halfDepth = NAV_GRID.depth * 0.5;
    const localX = (world.x - NAV_GRID.origin.x + halfWidth) / NAV_GRID.cellSize;
    const localZ = (world.z - NAV_GRID.origin.z + halfDepth) / NAV_GRID.cellSize;
    return {
      x: THREE.MathUtils.clamp(Math.floor(localX), 0, Math.max(0, Math.floor(NAV_GRID.width - 1))),
      z: THREE.MathUtils.clamp(Math.floor(localZ), 0, Math.max(0, Math.floor(NAV_GRID.depth - 1)))
    };
  }

  function navCellToWorld(cell) {
    const halfWidth = NAV_GRID.width * 0.5;
    const halfDepth = NAV_GRID.depth * 0.5;
    return new THREE.Vector3(
      (cell.x + 0.5) * NAV_GRID.cellSize - halfWidth + NAV_GRID.origin.x,
      0,
      (cell.z + 0.5) * NAV_GRID.cellSize - halfDepth + NAV_GRID.origin.z
    );
  }

  function parseCellKey(key) {
    const [x, z] = String(key).split(",").map((value) => Number(value));
    return { x, z };
  }

  function getAllObstacleCells() {
    const merged = new Set(staticObstacleCells);
    tableUnderObstacleCells.forEach((key) => merged.add(key));
    obstacleMarkers.forEach((_marker, key) => merged.add(key));
    return Array.from(merged).map((key) => parseCellKey(key));
  }

  function emitObstacleChanged() {
    if (onObstacleChanged) onObstacleChanged(getAllObstacleCells());
  }

  function shouldProjectStaticObstacle(plan) {
    const name = String(plan?.name || "");
    if (!name) return false;
    if (name.startsWith("锚点-桌台")) return true;
    if (NAV_STATIC_OBSTACLE_INCLUDE_NAMES.includes(name)) return true;
    if (!Array.isArray(plan?.pos)) return false;
    return !NAV_STATIC_OBSTACLE_EXCLUDE_NAMES.includes(name);
  }

  function projectStaticObstacles(staticPlans = []) {
    staticObstacleCells.clear();
    let projectedModels = 0;
    const skippedNames = [];
    const missingModels = [];
    staticPlans.forEach((plan) => {
      const name = String(plan?.name || "");
      if (!shouldProjectStaticObstacle(plan)) {
        if (name) skippedNames.push(name);
        return;
      }
      const model = modelRefs.get(name) || (plan.anchorKey ? anchors[plan.anchorKey] : null);
      if (!model) {
        if (name) missingModels.push(name);
        return;
      }
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return;
      projectedModels += 1;

      const minX = box.min.x - NAV_STATIC_OBSTACLE_PADDING;
      const maxX = box.max.x + NAV_STATIC_OBSTACLE_PADDING;
      const minZ = box.min.z - NAV_STATIC_OBSTACLE_PADDING;
      const maxZ = box.max.z + NAV_STATIC_OBSTACLE_PADDING;
      const minCell = worldToNavCell(new THREE.Vector3(minX, 0, minZ));
      const maxCell = worldToNavCell(new THREE.Vector3(maxX, 0, maxZ));
      for (let z = minCell.z; z <= maxCell.z; z += 1) {
        for (let x = minCell.x; x <= maxCell.x; x += 1) {
          staticObstacleCells.add(navCellKey({ x, z }));
        }
      }
    });
    logger.log(
      `[导航投影] 静态障碍覆盖：模型${projectedModels}个，障碍单元${staticObstacleCells.size}个，跳过${skippedNames.length}个，缺失${missingModels.length}个`
    );
    if (skippedNames.length > 0) {
      logger.log(`[导航投影] 跳过模型：${skippedNames.join("、")}`);
    }
    if (missingModels.length > 0) {
      logger.log(`[导航投影] 未找到模型引用：${missingModels.join("、")}`);
    }
    projectTableUnderObstacles();
    emitObstacleChanged();
  }

  function projectTableUnderObstacles() {
    tableUnderObstacleCells.clear();
    const protectedCells = new Set();
    Object.values(SERVICE_POINTS.tableService || {}).forEach((point) => {
      const center = worldToNavCell(point);
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const cell = { x: center.x + dx, z: center.z + dz };
          if (cell.x < 0 || cell.z < 0 || cell.x >= NAV_GRID.width || cell.z >= NAV_GRID.depth) continue;
          protectedCells.add(navCellKey(cell));
        }
      }
    });

    const radiusInCell = Math.max(0, Math.ceil(TABLE_UNDER_OBSTACLE_RADIUS / NAV_GRID.cellSize));
    Object.keys(SCENE_POINTS.tables || {}).forEach((tableId) => {
      const anchor = anchors[`table${tableId}`];
      if (!anchor) return;
      TABLE_UNDER_OBSTACLE_OFFSETS.forEach((offset) => {
        const [dx = 0, dz = 0] = offset;
        const center = worldToNavCell(
          new THREE.Vector3(anchor.position.x + dx, 0, anchor.position.z + dz)
        );
        for (let z = center.z - radiusInCell; z <= center.z + radiusInCell; z += 1) {
          for (let x = center.x - radiusInCell; x <= center.x + radiusInCell; x += 1) {
            if (x < 0 || z < 0 || x >= NAV_GRID.width || z >= NAV_GRID.depth) continue;
            const key = navCellKey({ x, z });
            if (protectedCells.has(key)) continue;
            tableUnderObstacleCells.add(key);
          }
        }
      });
    });
    logger.log(`[导航投影] 已投影桌底隐藏障碍单元 ${tableUnderObstacleCells.size}`);
  }

  function getGroundHitPoint(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObject(floor, false);
    return hits.length > 0 ? hits[0].point : null;
  }

  function setObstacleCell(cell, blocked, fromPointer = true) {
    const key = navCellKey(cell);
    const marker = obstacleMarkers.get(key);
    if (blocked) {
      if (marker) {
        if (fromPointer) logger.log(`[障碍编辑] 障碍格(${cell.x},${cell.z})已存在`);
        return false;
      }
      const center = navCellToWorld(cell);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(NAV_GRID.cellSize * 0.88, 0.72, NAV_GRID.cellSize * 0.88),
        new THREE.MeshStandardMaterial({
          color: 0xff8b3d,
          emissive: 0x6d2f05,
          emissiveIntensity: 0.7,
          transparent: true,
          opacity: 0.88
        })
      );
      mesh.position.set(center.x, 0.36, center.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      obstacleMarkerGroup.add(mesh);
      obstacleMarkers.set(key, mesh);
      if (fromPointer) logger.log(`[障碍编辑] 左键添加障碍格(${cell.x},${cell.z})`);
      emitObstacleChanged();
      return true;
    }

    if (!marker) {
      if (fromPointer) logger.log(`[障碍编辑] 障碍格(${cell.x},${cell.z})不存在`);
      return false;
    }
    obstacleMarkerGroup.remove(marker);
    marker.geometry.dispose();
    marker.material.dispose();
    obstacleMarkers.delete(key);
    if (fromPointer) logger.log(`[障碍编辑] 右键删除障碍格(${cell.x},${cell.z})`);
    emitObstacleChanged();
    return true;
  }

  function editObstacleByPointer(event) {
    const point = getGroundHitPoint(event);
    if (!point) return false;
    const cell = worldToNavCell(point);
    if (event.button === 0) {
      return setObstacleCell(cell, true, true);
    }
    if (event.button === 2) {
      return setObstacleCell(cell, false, true);
    }
    return false;
  }

  function resetObstacles() {
    obstacleMarkers.forEach((marker) => {
      obstacleMarkerGroup.remove(marker);
      marker.geometry.dispose();
      marker.material.dispose();
    });
    const count = obstacleMarkers.size;
    obstacleMarkers.clear();
    logger.log(`[障碍编辑] 已重置障碍，共清空 ${count} 个障碍格`);
    emitObstacleChanged();
  }

  function getHoveredTableFromPointer(event) {
    const now = performance.now();
    if (event.type === "mousemove" && now - lastPointerCheckAt < RAYCAST_THROTTLE_MS) {
      return hoveredTableAnchor;
    }
    lastPointerCheckAt = now;
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(clickableTables, false);
    return hits.length > 0 ? hits[0].object : null;
  }

  function getHighlightMaterials(anchor) {
    if (anchor.userData.highlightMaterials) return anchor.userData.highlightMaterials;
    const mats = [];
    anchor.traverse((child) => {
      if (!child.isMesh) return;
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((mat) => {
        if (!mat || !("emissive" in mat)) return;
        if (!mat.userData.__hoverBase) {
          mat.userData.__hoverBase = {
            emissive: mat.emissive.clone(),
            emissiveIntensity: mat.emissiveIntensity ?? 1
          };
        }
        mats.push(mat);
      });
    });
    anchor.userData.highlightMaterials = mats;
    return mats;
  }

  function setHover(anchor, enabled) {
    if (!anchor) return;
    getHighlightMaterials(anchor).forEach((mat) => {
      const base = mat.userData.__hoverBase;
      if (enabled) {
        mat.emissive.setHex(0x1f7a52);
        mat.emissiveIntensity = Math.max(base.emissiveIntensity * 1.7, 1.05);
      } else {
        mat.emissive.copy(base.emissive);
        mat.emissiveIntensity = base.emissiveIntensity;
      }
    });
  }

  function bindPointerInteraction() {
    renderer.domElement.addEventListener("mousemove", (event) => {
      const hit = getHoveredTableFromPointer(event);
      if (hit === hoveredTableAnchor) return;
      if (hoveredTableAnchor) setHover(hoveredTableAnchor, false);
      hoveredTableAnchor = hit;
      if (hoveredTableAnchor) setHover(hoveredTableAnchor, true);
    });

    renderer.domElement.addEventListener("mouseleave", () => {
      if (hoveredTableAnchor) setHover(hoveredTableAnchor, false);
      hoveredTableAnchor = null;
    });

    renderer.domElement.addEventListener("contextmenu", (event) => {
      if (!obstacleEditMode) return;
      event.preventDefault();
    });

    renderer.domElement.addEventListener("pointerdown", (event) => {
      if (obstacleEditMode && editObstacleByPointer(event)) {
        event.preventDefault();
        return;
      }
      if (event.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
      const customerHits = raycaster.intersectObjects(clickableCustomers, true);
      if (customerHits.length > 0) {
        const customerId = resolveCustomerId(customerHits[0].object);
        if (customerId && onCustomerClick) {
          onCustomerClick(customerId);
          return;
        }
      }

      const hit = getHoveredTableFromPointer(event);
      if (!hit) return;
      const tableId = hit.userData.tableId;
      if (!tableId || !onTableClick) return;
      onTableClick(tableId);
    });
  }

  function resolveCustomerId(object3D) {
    let cursor = object3D;
    while (cursor) {
      if (cursor.userData?.customerId) return cursor.userData.customerId;
      cursor = cursor.parent;
    }
    return null;
  }

  function drawPathLine(from, to) {
    clearPathLine();
    const p1 = new THREE.Vector3(from.x, 0.05, from.z);
    const p2 = new THREE.Vector3(to.x, 0.05, to.z);
    const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const material = new THREE.LineDashedMaterial({
      color: 0x00ffff,
      dashSize: 0.5,
      gapSize: 0.25,
      transparent: true,
      opacity: 0.85
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    activePathLine = line;
    scene.add(activePathLine);
  }

  function clearPathLine() {
    if (!activePathLine) return;
    scene.remove(activePathLine);
    activePathLine.geometry.dispose();
    activePathLine.material.dispose();
    activePathLine = null;
  }

  function normalizeAngle(rad) {
    let angle = rad;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function rotateTowards(currentYaw, targetYaw, maxStep) {
    const delta = normalizeAngle(targetYaw - currentYaw);
    if (Math.abs(delta) <= maxStep) return targetYaw;
    return currentYaw + Math.sign(delta) * maxStep;
  }

  function resolveArrivalPoint(from, target, stopDistance = 0) {
    const resolved = target.clone();
    if (stopDistance <= 0) return resolved;
    const moveDir = target.clone().sub(from);
    moveDir.y = 0;
    const length = moveDir.length();
    if (length <= 1e-4) return resolved;
    const clamped = Math.min(stopDistance, length * 0.8);
    moveDir.normalize().multiplyScalar(clamped);
    resolved.sub(moveDir);
    return resolved;
  }

  function moveObjectTo(object3D, target, duration = 1200, options = {}) {
    const { faceToMove = false, turnSpeed = WAITER_TURN_SPEED } = options;
    return new Promise((resolve) => {
      const start = performance.now();
      let prev = start;
      const from = object3D.position.clone();
      function step(now) {
        const dt = Math.max(0.001, (now - prev) / 1000);
        prev = now;
        const t = Math.min((now - start) / duration, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        object3D.position.lerpVectors(from, target, eased);
        if (faceToMove) {
          const dir = target.clone().sub(object3D.position);
          dir.y = 0;
          if (dir.lengthSq() > 1e-6) {
            const targetYaw = Math.atan2(dir.x, dir.z);
            object3D.rotation.y = rotateTowards(
              object3D.rotation.y,
              targetYaw,
              turnSpeed * dt
            );
          }
        }
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          object3D.position.copy(target);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  async function moveAnchor(anchorKey, target, duration, options = {}) {
    const normalizedOptions =
      typeof options === "boolean" ? { withPath: options } : options;
    const {
      withPath = false,
      faceToMove = anchorKey === "waiter",
      stopDistance = 0,
      turnSpeed = WAITER_TURN_SPEED
    } = normalizedOptions;
    const anchor = anchors[anchorKey];
    if (!anchor) return;
    const to = resolveArrivalPoint(anchor.position, target, stopDistance);
    if (anchorKey === "waiter") {
      to.y = 0;
    }
    if (withPath) {
      drawPathLine(anchor.position.clone(), to.clone());
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await moveObjectTo(anchor, to, duration, { faceToMove, turnSpeed });
    if (withPath) clearPathLine();
  }

  function setAnchorFacing(anchorKey, targetPoint) {
    const anchor = anchors[anchorKey];
    if (!anchor || !targetPoint) return;
    const dir = targetPoint.clone().sub(anchor.position);
    dir.y = 0;
    if (dir.lengthSq() <= 1e-6) return;
    anchor.rotation.y = Math.atan2(dir.x, dir.z);
  }

  function animate() {
    const now = performance.now();
    const delta = Math.min((now - startedAt) / 1000, 0.1);
    startedAt = now;
    animationMixers.forEach((mixer) => mixer.update(delta));
    actorRigs.forEach((rig) => {
      const root = rig.model;
      if (!rig.fallbackAction) return;
      const t = now * 0.01;
      if (rig.fallbackAction === "walk") {
        root.position.y = rig.baseTransform.y + Math.sin(t) * 0.04;
      } else if (rig.fallbackAction === "cook") {
        root.rotation.y = rig.baseTransform.rotY + Math.sin(t * 0.7) * 0.2;
      } else if (["pickup", "serve", "pay", "soothe", "confirm", "report"].includes(rig.fallbackAction)) {
        root.rotation.z = rig.baseTransform.rotZ + Math.sin(t * 1.2) * 0.08;
      } else {
        root.position.y += (rig.baseTransform.y - root.position.y) * 0.2;
        root.rotation.z += (rig.baseTransform.rotZ - root.rotation.z) * 0.2;
      }
    });
    customerMoodVisuals.forEach((view) => {
      const behavior = customerBehaviors.get(String(view.object3D.userData.customerId || "")) || "normal";
      if (view.mood === "angry") {
        view.object3D.position.y = view.baseY + Math.sin(now * 0.02) * 0.05;
      } else {
        view.object3D.position.y += (view.baseY - view.object3D.position.y) * 0.22;
      }
      if (behavior === "scratchHead") {
        view.object3D.rotation.z = Math.sin(now * 0.018) * 0.12;
      } else {
        view.object3D.rotation.z += (0 - view.object3D.rotation.z) * 0.2;
      }
    });
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  function onResize() {
    const width = threeContainer.clientWidth;
    const height = threeContainer.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  window.addEventListener("resize", onResize);

  return {
    scene,
    anchors,
    editableTargets,
    modelRefs,
    playActorAction,
    setCustomerMoodVisual,
    setCustomerBehavior,
    setTableMoodVisual,
    bindPointerInteraction,
    setOnTableClick,
    setOnCustomerClick,
    loadModelsInStages,
    animate,
    moveAnchor,
    setAnchorFacing,
    clearPathLine,
    setGridVisible(visible) {
      gridHelper.visible = Boolean(visible);
    },
    setObstacleEditMode(enabled) {
      obstacleEditMode = Boolean(enabled);
      renderer.domElement.style.cursor = obstacleEditMode ? "crosshair" : "default";
    },
    setOnObstacleChanged,
    resetObstacles
  };
}
