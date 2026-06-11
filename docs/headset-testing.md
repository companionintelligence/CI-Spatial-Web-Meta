# Headset Testing Guide — Quest 3

A step-by-step checklist for verifying Companion Scan on real hardware, plus
troubleshooting for the issues you're most likely to hit. Everything here can
be done with just the headset and a PC on the same network; the CV server is
optional for most checks.

## Prerequisites

- Quest 3 (or 3S) with Horizon OS v74+ (passthrough camera access via the browser)
- PC and headset on the same Wi-Fi network
- A completed **Space Setup** scan helps but is not required — the app prompts
  for one automatically when missing

## Setup

```bash
# 1. (Optional) CV server — GPU machine, weights in cv-server/weights/
cd cv-server && docker compose up --build

# 2. Frontend
cd webxr-ar-ai
npm install
npm run dev                                      # CV server on localhost
CV_SERVER_URL=http://192.168.1.50:8000 npm run dev   # CV server elsewhere
```

Find your PC's LAN IP (`ip addr` / `ipconfig`), then in the **Meta Quest
Browser** open `https://<PC-IP>:8081` and accept the self-signed certificate
warning (Advanced → Proceed).

## Smoke test (no CV server needed)

| # | Step | Expect |
|---|------|--------|
| 1 | Load the page | Desktop overlay panel appears: *WebXR: immersive-ar supported*; *CV server: Offline* is fine without Docker |
| 2 | Click **Enter AR** (browser session offer) | Passthrough view; overlay disappears |
| 3 | Grant **camera permission** when prompted | Viewfinder plane (small video rectangle) appears ~40 cm ahead after a moment |
| 4 | Look at left wrist | HUD: Model / Display / Preview / Pins rows + status line |
| 5 | No Space Setup yet? | After ~2 s the native room-capture flow launches; complete it and re-enter the session |
| 6 | Press **Right A** (capture) | HUD shows BUSY…, then a status line. Without a CV server: red CV error, but blue **scene pins** (walls/floor/furniture) still appear with labels |
| 7 | Press **Left Y** (export) | `companion-scan-*.glb` lands in the headset **Downloads** folder; HUD: yellow *Saved … upload failed* without a server, green *Exported …* with one |
| 8 | Exit AR (system button) | Desktop overlay reappears with live pin counts; camera indicator LED turns off |

## Full pipeline test (CV server running)

1. Overlay shows *CV server: Online* (badge polls every 8 s).
2. In AR, aim at a cluttered area and press **Right A**:
   - 2D bounding boxes on the viewfinder overlay
   - Green 3D labels placed **on** the surfaces of detected objects
   - Orange capture rays fade out over ~1.5 s (when Preview ≠ Off)
   - HUD status: `N detections · M scene pins`
3. Press **Right B** to switch to GDino, capture again; then SAM2 (slower —
   detect + segment).
4. **Walk while capturing**: pins must land where you *were looking* when you
   pressed A, even if you turn your head during the CV round trip.
5. Press **Left Y**, then open `https://<PC-IP>:8081/viewer.html` on the PC
   and drop in the downloaded GLB (transfer it off the headset, or use the
   server-side copy in the CV server's `GLTF_STORE`). Verify wireframe room
   geometry, pin spheres, and floorplan bounds.

## Calibration: pin placement accuracy

If CV pins land consistently left/right/short of where objects are:

1. Aim at a small, distinct object 1.5–2 m away, capture, note the offset.
2. Reload with `https://<PC-IP>:8081/?hfov=<degrees>` — default is 80.
   - Pins squeezed toward the view centre → **increase** hfov
   - Pins pushed outward from the centre → **decrease** hfov
3. Repeat in 2–3° steps; typical good values are 70–90.
4. Record the winning value — it is stable per device model.

## Cross-session anchor test

1. Scan + capture pins, note where a label sits on a real object.
2. Exit AR, close the browser tab, reopen, and re-enter AR.
3. Console should log a persistent-anchor restore (`SceneUnderstandingSystem`).
4. Export and compare `position_anchor_local` for the same surface across the
   two sessions — values should agree to within a few cm.

> Anchors note: if the headset declines the `anchors` feature, everything
> still works in-session; only cross-session re-localization degrades
> (anchor-local coordinates silently equal world coordinates).

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Certificate error page, no Proceed option | Open the URL with `https://` explicitly; re-run `npm run dev` so mkcert regenerates |
| *CV server: Offline* with Docker running | Wrong proxy target — restart dev server with `CV_SERVER_URL=http://<cv-host>:8000`; check `curl http://<cv-host>:8000/v1/health` from the PC |
| Viewfinder never appears | Camera permission denied — reset site permissions in browser settings; needs Horizon OS v74+ |
| No blue scene pins on capture | No Space Setup data and room-capture prompt dismissed — Settings → Physical Space → Space Setup, then reload |
| Captures hit nothing (all pins at fallback distance) | Same as above: the local raycaster needs scene geometry |
| Pins offset from objects | Run the hfov calibration above |
| HUD/controller discs missing | Controllers asleep at session start — press any button; attachment retries every frame |
| Export does nothing | Check the headset Downloads folder (the browser may hide the download toast); HUD status line reports the result |
| Stutter on capture | Expected ≤ 1 frame; if worse, lower the JPEG size in `PipelineB.initCameraEntity` (e.g. 960×540) |

## What to report

When filing an issue from on-device testing, include:

- Horizon OS + Meta Quest Browser versions (`chrome://version` in the browser)
- The HUD/overlay status line text at failure
- Browser console output (connect via `chrome://inspect` on the PC with the
  headset on USB + developer mode)
- The exported GLB if pin placement is wrong — the viewer makes the geometry
  vs. pin mismatch easy to see
