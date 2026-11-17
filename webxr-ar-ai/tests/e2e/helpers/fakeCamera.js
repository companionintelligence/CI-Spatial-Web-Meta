/**
 * A fake back camera for the e2e suite. Headless Chromium has no camera, and the app
 * only ever asks for one when the user opts in, so the suite supplies one:
 *
 *   - enumerateDevices reports one back-facing video device (IWSDK picks it by label);
 *   - getUserMedia returns a canvas stream that moves each frame, and records the
 *     constraints it was asked for in window.__gum.calls, so a test can check that
 *     no request ever asked for audio.
 *
 * Call before page.goto (it is an init script).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function installFakeCamera(page) {
  await page.addInitScript(() => {
    const log = { calls: [] };
    window.__gum = log;
    const devices = navigator.mediaDevices;
    if (!devices) return;

    devices.enumerateDevices = async () => [
      { deviceId: 'fake-back-camera', kind: 'videoinput', label: 'Back camera', groupId: 'fake' },
    ];

    devices.getUserMedia = async (constraints = {}) => {
      log.calls.push({
        video: Boolean(constraints.video),
        audio: Boolean(constraints.audio),
        deviceId: constraints.video && constraints.video.deviceId ? 'set' : null,
      });
      if (constraints.audio) {
        throw new DOMException('audio is never requested by Companion Scan', 'NotAllowedError');
      }
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      let frame = 0;
      const draw = () => {
        frame += 1;
        ctx.fillStyle = `hsl(${(frame * 3) % 360} 40% 40%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(100 + (frame % 400), 200, 300, 200);
      };
      draw();
      log.timer = setInterval(draw, 33);
      return canvas.captureStream(30);
    };
  });
}
