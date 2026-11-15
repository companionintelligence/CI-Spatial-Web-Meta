/**
 * Starting the immersive-ar session from the page (the Quest app's launch and its
 * Enter AR button, see ./questApp.js). A browser tab never needs this: IWSDK offers
 * the session there and the Meta Quest Browser shows Enter AR.
 */

import {
  buildSessionInit,
  normalizeReferenceSpec,
  resolveReferenceSpaceType,
} from '@iwsdk/core';

/**
 * Start the session with the world's own settings (`World.create`'s `xr` options) and
 * hand it to the renderer. IWSDK's `world.launchXR()` does the same, but it returns
 * nothing, so a refused request could not be reported. These are the steps it takes,
 * through the helpers IWSDK exports.
 * @param {import('@iwsdk/core').World} world
 * @param {XRSystem} [xr]
 * @returns {Promise<XRSession>}
 * @throws {Error} when WebXR is unavailable, the request is refused, or no reference
 *   space can be had; a session that started is ended again.
 */
export async function startArSession(world, xr = globalThis.navigator?.xr) {
  if (world.session) return world.session;
  if (!xr?.requestSession) throw new Error('WebXR is not available in this browser.');

  const defaults = world.xrDefaults ?? {};
  const session = await xr.requestSession(defaults.sessionMode ?? 'immersive-ar', buildSessionInit(defaults));
  const onEnd = () => {
    session.removeEventListener('end', onEnd);
    if (world.session === session) world.session = undefined;
  };
  session.addEventListener('end', onEnd);

  try {
    const ref = normalizeReferenceSpec(defaults.referenceSpace);
    const type = await resolveReferenceSpaceType(session, ref.type, ref.required ? [] : ref.fallbackOrder);
    // As IWSDK does: the app draws no depth-based occlusion mesh.
    world.renderer.xr.getDepthSensingMesh = () => null;
    world.renderer.xr.setReferenceSpaceType(type);
    await world.renderer.xr.setSession(session);
    world.session = session;
    return session;
  } catch (err) {
    await session.end().catch(() => {});
    throw err;
  }
}
