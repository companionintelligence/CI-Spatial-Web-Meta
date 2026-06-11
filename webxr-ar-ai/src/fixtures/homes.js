/**
 * Test homes — 24 procedurally defined home/room layouts used as fixtures by:
 *   - Playwright e2e scan tests (converted to IWER @iwer/sem environments and
 *     fed through the real WebXR plane/mesh-detection path)
 *   - Unit tests (structure validation, Pipeline A scale tests)
 *   - The desktop editor's "sample home" test data
 *   - The CV test-image generator (rendered to synthetic camera frames)
 *
 * Geometry conventions (matching @iwer/sem):
 *   - Planes (floor/ceiling/walls/decor) are bounded2D entities; the plane's
 *     local +Y is its normal, the polygon spans local X/Z, and offsets are
 *     centred so the entity pose is the rectangle centre.
 *   - Furniture are bounded3D box entities; pose at the box centre.
 *   - Semantic labels use the META vocabulary that @iwer/sem maps onto WebXR
 *     semantic labels (FLOOR→floor, WALL_FACE→wall, COUCH→couch, …).
 */

const S = Math.SQRT1_2; // sin/cos of 45°

/** Quaternions orienting a plane's local +Y normal. */
const PLANE_QUAT = {
  up:    { x: 0,  y: 0, z: 0,  w: 1 },   // floor
  down:  { x: 1,  y: 0, z: 0,  w: 0 },   // ceiling
  posZ:  { x: S,  y: 0, z: 0,  w: S },   // wall facing +Z
  negZ:  { x: -S, y: 0, z: 0,  w: S },   // wall facing -Z
  posX:  { x: 0,  y: 0, z: -S, w: S },   // wall facing +X
  negX:  { x: 0,  y: 0, z: S,  w: S },   // wall facing -X
};

/** META semantic labels → the WebXR labels IWSDK will see. */
export const WEBXR_LABEL = {
  FLOOR: 'floor', CEILING: 'ceiling', WALL_FACE: 'wall',
  DOOR_FRAME: 'door', WINDOW_FRAME: 'window', WALL_ART: 'wall art',
  TABLE: 'table', COUCH: 'couch', CHAIR: 'couch', BED: 'bed',
  STORAGE: 'shelf', LAMP: 'lamp', SCREEN: 'screen', PLANT: 'plant',
};

// ── Archetypes ─────────────────────────────────────────────────────────────
// room: { x, z } centre, { w, d, h } size. furniture: [label, w, h, d, x, z, yaw?]
// decor: wall-mounted planes: [label, side(n|s|e|w), u(along wall), y, w, h]

const ARCHETYPES = [
  {
    name: 'studio',
    rooms: [{ x: 0, z: 0, w: 4.0, d: 3.2, h: 2.6 }],
    furniture: [
      ['BED',     1.5, 0.5, 2.0, -1.0, -0.4],
      ['TABLE',   1.2, 0.75, 0.6, 1.2, -1.1],
      ['CHAIR',   0.5, 0.9, 0.5, 1.2, -0.4],
      ['STORAGE', 0.9, 1.8, 0.45, -1.4, 1.2],
      ['LAMP',    0.3, 1.5, 0.3, 1.6, 1.2],
      ['PLANT',   0.4, 1.1, 0.4, -1.7, -1.3],
    ],
    decor: [
      ['WINDOW_FRAME', 'n', 0.5, 1.5, 1.2, 1.0],
      ['DOOR_FRAME',   's', -1.2, 1.05, 0.9, 2.1],
      ['SCREEN',       'e', 0, 1.4, 1.1, 0.65],
    ],
  },
  {
    name: 'one_bedroom',
    rooms: [
      { x: 0,   z: 0, w: 4.5, d: 3.5, h: 2.7 },
      { x: 4.1, z: 0, w: 3.4, d: 3.5, h: 2.7 },
    ],
    furniture: [
      ['COUCH',   1.9, 0.85, 0.9, -0.8, 0.9],
      ['TABLE',   1.1, 0.45, 0.6, -0.8, -0.3],
      ['PLANT',   0.4, 1.2, 0.4, 1.6, -1.3],
      ['BED',     1.6, 0.55, 2.0, 4.1, -0.4],
      ['STORAGE', 1.2, 2.0, 0.5, 5.2, 1.3],
      ['LAMP',    0.3, 1.4, 0.3, 3.0, 1.2],
    ],
    decor: [
      ['SCREEN',       'n', -0.8, 1.4, 1.3, 0.75],
      ['DOOR_FRAME',   'e', 0, 1.05, 0.9, 2.1],
      ['WINDOW_FRAME', 's', 0.7, 1.5, 1.4, 1.1],
    ],
  },
  {
    name: 'office_solo',
    rooms: [{ x: 0, z: 0, w: 3.0, d: 2.6, h: 2.5 }],
    furniture: [
      ['TABLE',   1.5, 0.74, 0.75, 0, -0.6],
      ['CHAIR',   0.55, 1.1, 0.55, 0, 0.2],
      ['STORAGE', 0.8, 1.9, 0.4, -1.0, 0.9],
      ['LAMP',    0.25, 0.5, 0.25, 0.6, -0.7],
    ],
    decor: [
      ['SCREEN',       'n', 0, 1.25, 0.62, 0.37],
      ['WINDOW_FRAME', 'w', 0, 1.5, 1.1, 0.9],
      ['DOOR_FRAME',   's', 0.8, 1.05, 0.9, 2.1],
    ],
  },
  {
    name: 'office_team',
    rooms: [{ x: 0, z: 0, w: 6.0, d: 4.0, h: 2.8 }],
    furniture: [
      ['TABLE', 1.4, 0.74, 0.7, -1.6, -1.0],
      ['TABLE', 1.4, 0.74, 0.7, 1.6, -1.0],
      ['TABLE', 1.4, 0.74, 0.7, -1.6, 1.0],
      ['TABLE', 1.4, 0.74, 0.7, 1.6, 1.0],
      ['CHAIR', 0.55, 1.1, 0.55, -1.6, -0.3],
      ['CHAIR', 0.55, 1.1, 0.55, 1.6, -0.3],
      ['CHAIR', 0.55, 1.1, 0.55, -1.6, 1.7],
      ['CHAIR', 0.55, 1.1, 0.55, 1.6, 1.7],
      ['STORAGE', 1.6, 1.2, 0.45, 0, -1.7],
      ['PLANT', 0.45, 1.4, 0.45, 2.6, -1.6],
      ['PLANT', 0.45, 1.4, 0.45, -2.6, -1.6],
    ],
    decor: [
      ['SCREEN', 'e', 0, 1.5, 1.6, 0.9],
      ['DOOR_FRAME', 'w', -1.0, 1.05, 0.9, 2.1],
      ['WINDOW_FRAME', 'n', -1.5, 1.6, 1.6, 1.1],
      ['WINDOW_FRAME', 'n', 1.5, 1.6, 1.6, 1.1],
    ],
  },
  {
    name: 'kitchen',
    rooms: [{ x: 0, z: 0, w: 3.4, d: 2.8, h: 2.5 }],
    furniture: [
      ['STORAGE', 2.4, 0.9, 0.6, -0.3, -1.05],   // counter run
      ['STORAGE', 0.6, 2.0, 0.6, 1.35, -1.0],    // tall cabinet
      ['TABLE',   1.2, 0.9, 0.8, 0.1, 0.55],     // island
      ['STORAGE', 1.8, 0.5, 0.35, -0.4, 1.1],
    ],
    decor: [
      ['WINDOW_FRAME', 'n', -0.3, 1.5, 1.0, 0.8],
      ['DOOR_FRAME',   'e', 0.4, 1.05, 0.9, 2.1],
    ],
  },
  {
    name: 'dining',
    rooms: [{ x: 0, z: 0, w: 4.0, d: 3.0, h: 2.7 }],
    furniture: [
      ['TABLE', 1.8, 0.76, 1.0, 0, 0],
      ['CHAIR', 0.5, 0.95, 0.5, -0.6, -0.85],
      ['CHAIR', 0.5, 0.95, 0.5, 0.6, -0.85],
      ['CHAIR', 0.5, 0.95, 0.5, -0.6, 0.85],
      ['CHAIR', 0.5, 0.95, 0.5, 0.6, 0.85],
      ['STORAGE', 1.5, 0.85, 0.45, 0, -1.25],
      ['LAMP', 0.35, 1.6, 0.35, 1.6, 1.1],
    ],
    decor: [
      ['WALL_ART', 'n', 0, 1.55, 1.1, 0.75],
      ['WINDOW_FRAME', 'e', 0, 1.5, 1.2, 1.0],
    ],
  },
  {
    name: 'kids_bedroom',
    rooms: [{ x: 0, z: 0, w: 3.2, d: 2.8, h: 2.5 }],
    furniture: [
      ['BED', 0.9, 0.5, 1.7, -0.95, -0.35],
      ['STORAGE', 0.8, 1.0, 0.4, 1.1, -1.0],
      ['TABLE', 0.9, 0.6, 0.5, 1.0, 0.9],
      ['LAMP', 0.25, 0.45, 0.25, -1.3, -1.1],
    ],
    decor: [
      ['WALL_ART', 'w', -0.3, 1.5, 0.7, 0.5],
      ['WINDOW_FRAME', 'n', 0.4, 1.45, 1.0, 0.9],
      ['DOOR_FRAME', 's', -1.0, 1.05, 0.85, 2.05],
    ],
  },
  {
    name: 'gym',
    rooms: [{ x: 0, z: 0, w: 5.0, d: 4.0, h: 2.9 }],
    furniture: [
      ['TABLE', 1.3, 0.45, 0.5, -1.4, -1.0],     // bench
      ['STORAGE', 1.8, 1.1, 0.5, 1.6, -1.6],     // rack
      ['STORAGE', 0.8, 0.4, 0.8, -1.8, 1.4],
    ],
    decor: [
      ['SCREEN', 'n', 0, 1.7, 1.4, 0.8],
      ['WALL_ART', 'e', 0.5, 1.5, 0.9, 0.6],
      ['DOOR_FRAME', 'w', 0, 1.05, 0.95, 2.1],
    ],
  },
  {
    name: 'library',
    rooms: [{ x: 0, z: 0, w: 4.5, d: 3.5, h: 2.8 }],
    furniture: [
      ['STORAGE', 2.0, 2.3, 0.35, -1.0, -1.55],
      ['STORAGE', 2.0, 2.3, 0.35, 1.2, -1.55],
      ['STORAGE', 1.4, 2.3, 0.35, -2.0, 0.4, Math.PI / 2],
      ['STORAGE', 1.4, 2.3, 0.35, 2.0, 0.4, Math.PI / 2],
      ['TABLE', 1.3, 0.74, 0.8, 0.3, 0.4],
      ['COUCH', 1.6, 0.8, 0.85, -0.2, 1.2],
      ['LAMP', 0.3, 1.55, 0.3, 1.4, 1.2],
    ],
    decor: [
      ['WINDOW_FRAME', 's', 0, 1.6, 1.5, 1.1],
    ],
  },
  {
    name: 'workshop',
    rooms: [{ x: 0, z: 0, w: 5.0, d: 3.5, h: 2.7 }],
    furniture: [
      ['TABLE', 2.0, 0.9, 0.8, -1.2, -1.2],
      ['TABLE', 2.0, 0.9, 0.8, 1.4, -1.2],
      ['STORAGE', 1.2, 1.9, 0.5, -1.9, 1.2],
      ['STORAGE', 1.2, 1.9, 0.5, 1.9, 1.2],
    ],
    decor: [
      ['DOOR_FRAME', 's', 0, 1.1, 1.2, 2.2],
      ['WINDOW_FRAME', 'n', 1.0, 1.6, 1.2, 0.9],
      ['WALL_ART', 'w', 0, 1.5, 0.8, 1.1],     // pegboard
    ],
  },
  {
    name: 'conference',
    rooms: [{ x: 0, z: 0, w: 5.5, d: 3.5, h: 2.8 }],
    furniture: [
      ['TABLE', 3.0, 0.74, 1.2, 0, 0],
      ['CHAIR', 0.55, 1.05, 0.55, -1.0, -0.95],
      ['CHAIR', 0.55, 1.05, 0.55, 0, -0.95],
      ['CHAIR', 0.55, 1.05, 0.55, 1.0, -0.95],
      ['CHAIR', 0.55, 1.05, 0.55, -1.0, 0.95],
      ['CHAIR', 0.55, 1.05, 0.55, 0, 0.95],
      ['CHAIR', 0.55, 1.05, 0.55, 1.0, 0.95],
    ],
    decor: [
      ['SCREEN', 'e', 0, 1.5, 1.7, 1.0],
      ['DOOR_FRAME', 'w', 0.8, 1.05, 0.9, 2.1],
      ['WINDOW_FRAME', 'n', 0, 1.6, 2.4, 1.1],
    ],
  },
  {
    name: 'loft',
    rooms: [{ x: 0, z: 0, w: 7.0, d: 5.0, h: 3.2 }],
    furniture: [
      ['COUCH', 2.2, 0.85, 0.95, -1.8, 0.6],
      ['TABLE', 1.2, 0.45, 0.7, -1.8, -0.7],
      ['BED', 1.6, 0.55, 2.0, 2.4, -1.4],
      ['STORAGE', 1.6, 2.1, 0.5, 3.1, 1.6],
      ['TABLE', 1.6, 0.9, 0.8, -0.2, -2.0],     // kitchen island
      ['PLANT', 0.5, 1.6, 0.5, -3.0, -2.0],
      ['PLANT', 0.45, 1.3, 0.45, 0.6, 2.1],
      ['LAMP', 0.35, 1.7, 0.35, -3.0, 1.9],
    ],
    decor: [
      ['SCREEN', 'w', 0.3, 1.5, 1.5, 0.85],
      ['WINDOW_FRAME', 'n', -1.8, 1.7, 2.0, 1.6],
      ['WINDOW_FRAME', 'n', 1.8, 1.7, 2.0, 1.6],
      ['DOOR_FRAME', 's', 2.8, 1.1, 1.0, 2.2],
      ['WALL_ART', 'e', -1.0, 1.6, 1.2, 0.9],
    ],
  },
];

// ── Variants ───────────────────────────────────────────────────────────────

/** Deterministic pseudo-random in [-1, 1] from a string + index. */
function jitter(seed, i) {
  let h = 2166136261;
  const s = `${seed}:${i}`;
  for (let c = 0; c < s.length; c++) {
    h ^= s.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** A scaled + furniture-jittered variant of an archetype. */
function makeVariant(home, scale = 1.15) {
  return {
    name: `${home.name}_alt`,
    rooms: home.rooms.map(r => ({
      x: r.x * scale, z: r.z * scale,
      w: +(r.w * scale).toFixed(2), d: +(r.d * scale).toFixed(2), h: r.h,
    })),
    furniture: home.furniture.map(([label, w, h, d, x, z, yaw = 0], i) => [
      label, w, h, d,
      +(x * scale + jitter(home.name, i) * 0.15).toFixed(2),
      +(z * scale + jitter(home.name, i + 100) * 0.15).toFixed(2),
      yaw + jitter(home.name, i + 200) * 0.3,
    ]),
    decor: home.decor,
  };
}

/** All 24 test homes (12 archetypes + 12 variants). */
export const TEST_HOMES = [
  ...ARCHETYPES,
  ...ARCHETYPES.map(h => makeVariant(h)),
];

// ── SEM conversion ─────────────────────────────────────────────────────────

let _uuidSeq = 0;
const uuid = (name) => `home-${name}-${++_uuidSeq}`;

function planeEntity(name, label, position, quat, width, height) {
  return {
    uuid: uuid(name),
    semanticLabel_META: label,
    locatable_META: { position, orientation: quat },
    bounded2D_META: {
      offset: { x: -width / 2, y: -height / 2 },
      extent: { width, height },
    },
  };
}

function boxEntity(name, label, position, yaw, w, h, d) {
  const half = yaw / 2;
  return {
    uuid: uuid(name),
    semanticLabel_META: label,
    locatable_META: {
      position,
      orientation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
    },
    bounded3D_META: {
      offset: { x: -w / 2, y: -h / 2, z: -d / 2 },
      extent: { width: w, height: h, depth: d },
    },
  };
}

/** Wall plane definitions for a room: [side, position, quat, width]. */
function wallDefs(room) {
  const { x, z, w, d, h } = room;
  return [
    ['n', { x, y: h / 2, z: z - d / 2 }, PLANE_QUAT.posZ, w],
    ['s', { x, y: h / 2, z: z + d / 2 }, PLANE_QUAT.negZ, w],
    ['w', { x: x - w / 2, y: h / 2, z }, PLANE_QUAT.posX, d],
    ['e', { x: x + w / 2, y: h / 2, z }, PLANE_QUAT.negX, d],
  ];
}

/**
 * Convert a home spec to an @iwer/sem environment JSON
 * (`device.sem.loadEnvironment(json)`).
 */
export function homeToSemJson(home) {
  const entities = [];

  for (const room of home.rooms) {
    const { x, z, w, d, h } = room;
    entities.push(planeEntity(home.name, 'FLOOR',   { x, y: 0, z }, PLANE_QUAT.up,   w, d));
    entities.push(planeEntity(home.name, 'CEILING', { x, y: h, z }, PLANE_QUAT.down, w, d));
    for (const [, pos, quat, width] of wallDefs(room)) {
      entities.push(planeEntity(home.name, 'WALL_FACE', pos, quat, width, h));
    }
  }

  // Wall decor planes sit just inside their wall (first room hosts them)
  const room = home.rooms[0];
  const walls = Object.fromEntries(wallDefs(room).map(([side, pos, quat]) => [side, { pos, quat }]));
  for (const [label, side, u, y, w, h] of home.decor ?? []) {
    const wall = walls[side];
    const inset = 0.01;
    const pos = { ...wall.pos, y };
    if (side === 'n') { pos.x = room.x + u; pos.z += inset; }
    if (side === 's') { pos.x = room.x + u; pos.z -= inset; }
    if (side === 'w') { pos.z = room.z + u; pos.x += inset; }
    if (side === 'e') { pos.z = room.z + u; pos.x -= inset; }
    entities.push(planeEntity(home.name, label, pos, wall.quat, w, h));
  }

  for (const [label, w, h, d, x, z, yaw = 0] of home.furniture) {
    entities.push(boxEntity(home.name, label, { x, y: h / 2, z }, yaw, w, h, d));
  }

  return { type: 'scene', version: 1, spatialEntities: entities };
}

/**
 * Expected scan outcome for a home — used by the e2e assertions.
 * @returns {{planes:number, meshes:number, labels:string[]}}
 */
export function expectedSceneSummary(home) {
  const planes = home.rooms.length * 6 + (home.decor?.length ?? 0);
  const meshes = home.furniture.length;
  const labels = new Set();
  labels.add(WEBXR_LABEL.FLOOR).add(WEBXR_LABEL.CEILING).add(WEBXR_LABEL.WALL_FACE);
  for (const [label] of home.decor ?? []) labels.add(WEBXR_LABEL[label]);
  for (const [label] of home.furniture) labels.add(WEBXR_LABEL[label]);
  return { planes, meshes, labels: [...labels] };
}

// ── Editor / viewer sample data ────────────────────────────────────────────

/**
 * Convert a home spec to a viewer scan fixture: a companion_scan block plus
 * box descriptors for visible sample geometry.
 */
export function homeToScanFixture(home) {
  const pins = [];
  let i = 0;

  for (const room of home.rooms) {
    pins.push({
      id: `pin-${home.name}-${++i}`, source: 'MetaScene', label: WEBXR_LABEL.FLOOR,
      hit_type: 'plane', position: { x: room.x, y: 0, z: room.z },
      position_anchor_local: { x: room.x, y: 0, z: room.z },
      semantic_labels: [WEBXR_LABEL.FLOOR],
      plane_extents: { center: { x: 0, y: 0, z: 0 }, size: { x: room.w, y: 0, z: room.d } },
    });
  }
  for (const [label, w, h, d, x, z] of home.furniture) {
    pins.push({
      id: `pin-${home.name}-${++i}`, source: 'CvServer', label: WEBXR_LABEL[label],
      confidence: 0.7 + 0.25 * Math.abs(jitter(home.name, i)),
      hit_type: 'mesh',
      position: { x, y: h / 2, z },
      position_anchor_local: { x, y: h / 2, z },
      volume_extents: { center: { x: 0, y: 0, z: 0 }, size: { x: w, y: h, z: d } },
    });
  }

  const xs = home.rooms.flatMap(r => [r.x - r.w / 2, r.x + r.w / 2]);
  const zs = home.rooms.flatMap(r => [r.z - r.d / 2, r.z + r.d / 2]);
  const maxH = Math.max(...home.rooms.map(r => r.h));

  return {
    scan: {
      version: '1.1',
      session_id: `sample-${home.name}`,
      exported_at: new Date().toISOString(),
      anchor_uuid: null,
      pins,
      floorplan: {
        bounds: {
          min: { x: Math.min(...xs), y: 0, z: Math.min(...zs) },
          max: { x: Math.max(...xs), y: maxH, z: Math.max(...zs) },
        },
        cv_pin_count: home.furniture.length,
        scene_pin_count: home.rooms.length,
      },
    },
    boxes: home.furniture.map(([label, w, h, d, x, z, yaw = 0]) => ({
      label: WEBXR_LABEL[label], w, h, d, x, y: h / 2, z, yaw,
    })),
    rooms: home.rooms,
  };
}
