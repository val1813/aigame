'use strict';

/**
 * FOV 计算 — 简单 Shadowcasting 实现
 * 参考: http://www.roguebasin.com/index.php/FOV_using_recursive_shadowcasting
 *
 * @param {object} map - { width, height, tiles: string[] }
 * @param {number} px - player x
 * @param {number} py - player y
 * @param {number} radius
 * @returns {Set<string>} visible cell keys "x,y"
 */
function computeFOV(map, px, py, radius) {
  const visible = new Set();
  visible.add(`${px},${py}`);

  if (!map || !map.tiles) return visible;

  const width = map.width || (map.tiles[0] ? map.tiles[0].length : 0);
  const height = map.height || map.tiles.length;

  function isBlocking(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return true;
    const row = map.tiles[y];
    if (!row) return true;
    const ch = row[x];
    return ch === '#' || ch === '≈';
  }

  // 8 octants
  for (let octant = 0; octant < 8; octant++) {
    castLight(visible, px, py, radius, 1, 1.0, 0.0, octant, isBlocking);
  }

  return visible;
}

const OCTANT_TRANSFORMS = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

function castLight(visible, px, py, radius, row, startSlope, endSlope, octant, isBlocking) {
  if (startSlope < endSlope) return;
  const [xx, xy, yx, yy] = OCTANT_TRANSFORMS[octant];

  let nextStartSlope = startSlope;
  let blocked = false;

  for (let distance = row; distance <= radius && !blocked; distance++) {
    for (let dx = -distance; dx <= 0; dx++) {
      const dy = -distance;
      const cx = px + dx * xx + dy * xy;
      const cy = py + dx * yx + dy * yy;

      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);

      if (startSlope < rSlope) continue;
      if (endSlope > lSlope) break;

      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        visible.add(`${cx},${cy}`);
      }

      if (blocked) {
        if (isBlocking(cx, cy)) {
          nextStartSlope = rSlope;
          continue;
        } else {
          blocked = false;
          startSlope = nextStartSlope;
        }
      } else if (isBlocking(cx, cy) && distance < radius) {
        blocked = true;
        castLight(visible, px, py, radius, distance + 1, startSlope, lSlope, octant, isBlocking);
        nextStartSlope = rSlope;
      }
    }
  }
}

module.exports = { computeFOV };
