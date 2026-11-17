/**
 * The JS builders produce the contract the server validates. The worked examples in
 * contracts/examples/ are the shared reference: same keys, same limits, same numbers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CAPTURE_LIMITS,
  CONTRACT_VERSION,
  buildAppendPayload,
  consentRecord,
  buildCapturePayload,
  buildKeyframe,
  clientRecord,
  intrinsicsFor,
  poseRecord,
} from '../../src/scan/payload.js';
import { defaultHierarchy, roomId, normaliseRoomName, saveRoomName, loadRoomName, DEFAULT_ROOM_NAME, ROOM_NAME_STORAGE_KEY } from '../../src/scan/hierarchy.js';
import { detectionForPlacement } from '../../src/scan/LocalScanClient.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const example = (name) => JSON.parse(readFileSync(`${REPO}contracts/examples/${name}`, 'utf8'));
const request = example('capture-request.v1.json');
const result = example('capture-result.v1.json');

const sortedKeys = (obj) => Object.keys(obj).sort();

/** A fake storage with the parts of the Storage API the code uses. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('contract constants', () => {
  it('matches the contract version and limits the server enforces', () => {
    expect(CONTRACT_VERSION).toBe('1.2');
    const contract = readFileSync(`${REPO}cv-server/localscan/contract.py`, 'utf8');
    expect(contract).toMatch(/CONTRACT_VERSION = "1\.2"/);
    expect(contract).toMatch(new RegExp(`MAX_KEYFRAMES_PER_REQUEST = ${CAPTURE_LIMITS.maxKeyframesPerRequest}\\b`));
    expect(contract).toMatch(new RegExp(`MAX_PLANES = ${CAPTURE_LIMITS.maxPlanes}\\b`));
  });
});

describe('keyframe, pose and intrinsics', () => {
  it('builds a keyframe with the same keys as the worked request', () => {
    const built = buildKeyframe({
      clientKeyframeId: 'cap-1', capturedAtMs: 1763300000000, width: 64, height: 36, base64: 'AAAA',
      position: { x: 0, y: 1.6, z: 0.5 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
      hfovRad: (80 * Math.PI) / 180,
    });
    expect(sortedKeys(built)).toEqual(sortedKeys(request.keyframes[0]));
    expect(sortedKeys(built.image)).toEqual(sortedKeys(request.keyframes[0].image));
    expect(sortedKeys(built.pose)).toEqual(sortedKeys(request.keyframes[0].pose));
    expect(built.pose.frame).toBe('local-floor');
  });

  it('derives the same focal length as the worked example from an 80 degree horizontal FOV', () => {
    const k = intrinsicsFor({ width: 64, height: 36, hfovRad: (80 * Math.PI) / 180 });
    expect(k.fx).toBeCloseTo(request.keyframes[0].intrinsics.fx, 2);
    expect(k.fy).toBe(k.fx);
    expect(k.cx).toBe(32);
    expect(k.cy).toBe(18);
  });

  it('refuses a non-positive FOV instead of producing infinite focal lengths', () => {
    expect(() => intrinsicsFor({ width: 64, height: 36, hfovRad: 0 })).toThrow(/positive/);
  });

  it('rounds poses to 4 decimal places and drops non-finite numbers to 0', () => {
    const pose = poseRecord({ x: 1.123456, y: Number.NaN, z: -0.5 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(pose.position).toEqual({ x: 1.1235, y: 0, z: -0.5 });
  });
});

describe('capture and append payloads', () => {
  it('builds a capture payload with the keys of the worked request', () => {
    const payload = buildCapturePayload({
      hierarchy: request.hierarchy,
      client: request.client,
      planes: request.planes,
      keyframes: request.keyframes,
    });
    expect(sortedKeys(payload)).toEqual(sortedKeys(request));
    expect(sortedKeys(payload.hierarchy)).toEqual(sortedKeys(request.hierarchy));
  });

  it('builds an append payload whose planes may be omitted, and that carries the consent', () => {
    expect(buildAppendPayload({ keyframes: request.keyframes, planes: null, consent: request.consent })).toEqual({
      keyframes: request.keyframes,
      planes: null,
      consent: request.consent,
    });
  });

  it('records the camera consent only while the camera is on', () => {
    expect(consentRecord({ cameraOn: false, grantedAt: '2026-11-16T19:40:00Z' })).toBeNull();
    expect(consentRecord({ cameraOn: true, grantedAt: '2026-11-16T19:40:00Z' })).toEqual({
      camera: true,
      granted_at: '2026-11-16T19:40:00Z',
    });
    expect(consentRecord({ cameraOn: true })).toEqual({ camera: true, granted_at: null });
  });

  it('builds the client record with the same keys as the worked request', () => {
    const client = clientRecord({ sessionId: request.client.session_id });
    expect(sortedKeys(client)).toEqual(sortedKeys(request.client));
    expect(client.device).toBe('meta-quest-3');
  });

  it('builds the default hierarchy with the keys of the worked request', () => {
    const hierarchy = defaultHierarchy('Kitchen');
    expect(sortedKeys(hierarchy)).toEqual(sortedKeys(request.hierarchy));
    expect(sortedKeys(hierarchy.floor)).toEqual(sortedKeys(request.hierarchy.floor));
    expect(hierarchy.room).toEqual({ id: 'room-kitchen', name: 'Kitchen' });
  });
});

describe('worked result', () => {
  it('reshapes a contract detection into the shape placement reads', () => {
    const placed = detectionForPlacement(result.detections[0]);
    expect(placed.label).toBe(result.detections[0].label);
    expect(placed.cx).toBe(result.detections[0].cx);
    expect(placed.bbox_cxcywh).toEqual(result.detections[0].bbox_cxcywh);
  });
});

describe('room names', () => {
  it('makes server-safe ids from room names', () => {
    expect(roomId('Kitchen')).toBe('room-kitchen');
    expect(roomId('  Spare Room (2) ')).toBe('room-spare-room-2');
    expect(roomId('***')).toBe('room-room');
    expect(roomId('a'.repeat(100))).toMatch(/^room-a{40}$/);
  });

  it('normalises and refuses bad names with a sentence the overlay can show', () => {
    expect(normaliseRoomName('  Living   room ')).toEqual({ ok: true, name: 'Living room' });
    expect(normaliseRoomName('   ')).toMatchObject({ ok: false });
    expect(normaliseRoomName('x'.repeat(121))).toMatchObject({ ok: false, error: expect.stringMatching(/120/) });
  });

  it('saves and loads the room name on this device, falling back to the default', () => {
    const storage = memoryStorage();
    expect(loadRoomName(storage)).toBe(DEFAULT_ROOM_NAME);
    expect(saveRoomName('Hall', storage)).toBe('Hall');
    expect(storage.getItem(ROOM_NAME_STORAGE_KEY)).toBe('Hall');
    expect(loadRoomName(storage)).toBe('Hall');
    expect(() => saveRoomName('   ', storage)).toThrow(/Enter a room name/);
  });

  it('falls back to the default when storage throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); } };
    expect(loadRoomName(broken)).toBe(DEFAULT_ROOM_NAME);
  });
});
