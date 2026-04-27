import * as THREE from "three";
import { NAV_BLOCK_RADIUS, NAV_GRID } from "../config/appConfig.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInt(value) {
  return Math.trunc(value);
}

export function createPathPlanner(options = {}) {
  const config = {
    width: options.width ?? NAV_GRID.width,
    depth: options.depth ?? NAV_GRID.depth,
    cellSize: options.cellSize ?? NAV_GRID.cellSize,
    origin: options.origin ? options.origin.clone() : NAV_GRID.origin.clone()
  };
  const halfWidth = config.width * 0.5;
  const halfDepth = config.depth * 0.5;
  const maxX = toInt(config.width - 1);
  const maxZ = toInt(config.depth - 1);
  const blockedCells = new Set();

  function cellKey(x, z) {
    return `${x},${z}`;
  }

  function isInsideCell(x, z) {
    return x >= 0 && z >= 0 && x < config.width && z < config.depth;
  }

  function worldToCell(world) {
    const localX = (world.x - config.origin.x + halfWidth) / config.cellSize;
    const localZ = (world.z - config.origin.z + halfDepth) / config.cellSize;
    const cellX = clamp(Math.floor(localX), 0, maxX);
    const cellZ = clamp(Math.floor(localZ), 0, maxZ);
    return { x: cellX, z: cellZ };
  }

  function cellToWorld(cell, y = 0) {
    const worldX = (cell.x + 0.5) * config.cellSize - halfWidth + config.origin.x;
    const worldZ = (cell.z + 0.5) * config.cellSize - halfDepth + config.origin.z;
    return new THREE.Vector3(worldX, y, worldZ);
  }

  function isBlocked(cell) {
    return blockedCells.has(cellKey(cell.x, cell.z));
  }

  function setBlocked(cell, blocked = true) {
    if (!isInsideCell(cell.x, cell.z)) return false;
    const key = cellKey(cell.x, cell.z);
    if (blocked) {
      const before = blockedCells.size;
      blockedCells.add(key);
      return blockedCells.size !== before;
    }
    return blockedCells.delete(key);
  }

  function setBlockedByWorld(world, blocked = true, radius = NAV_BLOCK_RADIUS) {
    const center = worldToCell(world);
    const radiusInCell = Math.max(0, Math.ceil(radius / config.cellSize));
    let changed = false;
    for (let dz = -radiusInCell; dz <= radiusInCell; dz += 1) {
      for (let dx = -radiusInCell; dx <= radiusInCell; dx += 1) {
        const test = { x: center.x + dx, z: center.z + dz };
        if (!isInsideCell(test.x, test.z)) continue;
        changed = setBlocked(test, blocked) || changed;
      }
    }
    return changed;
  }

  function replaceBlockedCells(cells) {
    blockedCells.clear();
    (cells || []).forEach((cell) => {
      if (!cell || !isInsideCell(cell.x, cell.z)) return;
      blockedCells.add(cellKey(cell.x, cell.z));
    });
  }

  function parseCellKey(key) {
    const [x, z] = String(key).split(",").map((n) => Number(n));
    return { x, z };
  }

  function heuristic(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function pickNearestOpenCell(goal) {
    if (!isBlocked(goal)) return goal;
    const queue = [goal];
    const visited = new Set([cellKey(goal.x, goal.z)]);
    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = [
        { x: current.x + 1, z: current.z },
        { x: current.x - 1, z: current.z },
        { x: current.x, z: current.z + 1 },
        { x: current.x, z: current.z - 1 }
      ];
      for (const next of neighbors) {
        if (!isInsideCell(next.x, next.z)) continue;
        const key = cellKey(next.x, next.z);
        if (visited.has(key)) continue;
        if (!isBlocked(next)) return next;
        visited.add(key);
        queue.push(next);
      }
    }
    return null;
  }

  function resolveReachableTarget(worldTarget, worldStart = null) {
    const targetCellRaw = worldToCell(worldTarget);
    const resolvedCell = pickNearestOpenCell(targetCellRaw);
    if (!resolvedCell) return null;
    const targetWorld = cellToWorld(
      resolvedCell,
      (worldTarget && typeof worldTarget.y === "number" ? worldTarget.y : 0)
    );
    if (worldStart && worldStart.distanceTo(targetWorld) < 1e-3) {
      return worldTarget.clone();
    }
    return targetWorld;
  }

  function reconstructPath(cameFrom, currentKey) {
    const cellList = [parseCellKey(currentKey)];
    let cursor = currentKey;
    while (cameFrom.has(cursor)) {
      cursor = cameFrom.get(cursor);
      cellList.push(parseCellKey(cursor));
    }
    cellList.reverse();
    return cellList;
  }

  function findPath(startWorld, endWorld, optionsForPath = {}) {
    const { allowDiagonal = true } = optionsForPath;
    const start = worldToCell(startWorld);
    const endRaw = worldToCell(endWorld);
    const end = pickNearestOpenCell(endRaw);
    if (!end) return [];

    const startKey = cellKey(start.x, start.z);
    const endKey = cellKey(end.x, end.z);
    if (startKey === endKey) {
      return [endWorld.clone()];
    }

    const openSet = new Set([startKey]);
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const fScore = new Map([[startKey, heuristic(start, end)]]);

    const directions = allowDiagonal
      ? [
          { x: 1, z: 0, c: 1 },
          { x: -1, z: 0, c: 1 },
          { x: 0, z: 1, c: 1 },
          { x: 0, z: -1, c: 1 },
          { x: 1, z: 1, c: Math.SQRT2 },
          { x: 1, z: -1, c: Math.SQRT2 },
          { x: -1, z: 1, c: Math.SQRT2 },
          { x: -1, z: -1, c: Math.SQRT2 }
        ]
      : [
          { x: 1, z: 0, c: 1 },
          { x: -1, z: 0, c: 1 },
          { x: 0, z: 1, c: 1 },
          { x: 0, z: -1, c: 1 }
        ];

    while (openSet.size > 0) {
      let currentKey = null;
      let currentScore = Number.POSITIVE_INFINITY;
      openSet.forEach((key) => {
        const score = fScore.get(key) ?? Number.POSITIVE_INFINITY;
        if (score < currentScore) {
          currentScore = score;
          currentKey = key;
        }
      });
      if (!currentKey) break;
      if (currentKey === endKey) {
        const pathCells = reconstructPath(cameFrom, currentKey);
        const path = pathCells.map((cell) => cellToWorld(cell, startWorld.y || 0));
        if (path.length > 0) {
          path[0] = startWorld.clone();
          path[path.length - 1] = endWorld.clone();
        }
        return path;
      }
      openSet.delete(currentKey);
      const currentCell = parseCellKey(currentKey);
      for (const dir of directions) {
        const next = { x: currentCell.x + dir.x, z: currentCell.z + dir.z };
        if (!isInsideCell(next.x, next.z)) continue;
        const nextKey = cellKey(next.x, next.z);
        if (nextKey !== endKey && isBlocked(next)) continue;
        const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + dir.c;
        if (tentative >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
        cameFrom.set(nextKey, currentKey);
        gScore.set(nextKey, tentative);
        fScore.set(nextKey, tentative + heuristic(next, end));
        openSet.add(nextKey);
      }
    }

    return [];
  }

  function getBlockedCells() {
    return Array.from(blockedCells).map(parseCellKey);
  }

  return {
    config,
    worldToCell,
    cellToWorld,
    setBlocked,
    isBlocked,
    setBlockedByWorld,
    replaceBlockedCells,
    getBlockedCells,
    findPath,
    resolveReachableTarget
  };
}
