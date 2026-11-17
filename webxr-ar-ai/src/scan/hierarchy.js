/**
 * The place hierarchy a scan is filed under: PLACE > BUILDING > FLOOR > ROOM > SCAN > OBJECT.
 *
 * The names match the Companion Scan data model, so a later sync is a mapping
 * (docs/data-contract.md, "Mapping to Companion Scan"). For v1 the place, building and
 * floor are fixed defaults, and the room name is set on the overlay and kept on this
 * device. Pure apart from the storage it is handed.
 */

export const ROOM_NAME_STORAGE_KEY = 'companionScan.roomName';
export const DEFAULT_ROOM_NAME = 'Room 1';
const MAX_ROOM_NAME = 120;

/**
 * @param {string} [roomName]
 * @returns {{place: object, building: object, floor: object, room: object}}
 */
export function defaultHierarchy(roomName = DEFAULT_ROOM_NAME) {
  return {
    place:    { id: 'place-home', name: 'Home' },
    building: { id: 'building-main', name: 'Main house' },
    floor:    { id: 'floor-ground', name: 'Ground floor', level: 0 },
    room:     { id: roomId(roomName), name: roomName },
  };
}

/**
 * A server-safe id for a room name ("Kitchen" -> "room-kitchen").
 * @param {string} name
 * @returns {string}
 */
export function roomId(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `room-${slug || 'room'}`;
}

/**
 * Validate and tidy a room name typed on the overlay.
 * @param {unknown} raw
 * @returns {{ok: true, name: string} | {ok: false, error: string}}
 */
export function normaliseRoomName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Enter a room name.' };
  if (name.length > MAX_ROOM_NAME) {
    return { ok: false, error: `Keep the room name to ${MAX_ROOM_NAME} characters or fewer.` };
  }
  return { ok: true, name };
}

/**
 * The saved room name, or the default. Storage errors fall back to the default.
 * @param {Storage} [storage]
 * @returns {string}
 */
export function loadRoomName(storage = globalThis.localStorage) {
  try {
    const checked = normaliseRoomName(storage?.getItem(ROOM_NAME_STORAGE_KEY));
    return checked.ok ? checked.name : DEFAULT_ROOM_NAME;
  } catch {
    return DEFAULT_ROOM_NAME;
  }
}

/**
 * Save a room name. Throws with a sentence the overlay can show.
 * @param {unknown} raw
 * @param {Storage} [storage]
 * @returns {string} the saved name
 */
export function saveRoomName(raw, storage = globalThis.localStorage) {
  const checked = normaliseRoomName(raw);
  if (!checked.ok) throw new Error(checked.error);
  storage.setItem(ROOM_NAME_STORAGE_KEY, checked.name);
  return checked.name;
}

/**
 * The hierarchy for the next scan, read at the moment it is needed.
 * @param {Storage} [storage]
 */
export function currentHierarchy(storage = globalThis.localStorage) {
  return defaultHierarchy(loadRoomName(storage));
}
