#!/usr/bin/env python3
"""
eval_images.py — scores the real CV server against the synthetic test images.

Generates the images first (on any machine with Node):
    cd webxr-ar-ai && node scripts/generate-cv-test-images.mjs

Then on the machine running the CV server:
    python3 eval_images.py --images ../webxr-ar-ai/test-assets/cv \
                           --server http://localhost:8000

For each <home>.png it POSTs /v1/detect and reports, per ground-truth object,
the best-IoU prediction. The synthetic boxes are flat-colour cuboids, so
treat this as a smoke test of the serving path + rough localisation — not a
model benchmark.

Uses stdlib only (urllib), no extra dependencies.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path


def iou(a: list[float], b: list[float]) -> float:
    """IoU of two normalised [cx, cy, w, h] boxes."""
    ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2
    ax2, ay2 = a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2
    bx2, by2 = b[0] + b[2] / 2, b[1] + b[3] / 2
    ix = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def post_detect(server: str, image_b64: str, prompt: str) -> list[dict]:
    payload = json.dumps({
        "image": image_b64,
        "prompt": prompt,
        "box_threshold": 0.3,
        "text_threshold": 0.25,
    }).encode()
    req = urllib.request.Request(
        f"{server}/v1/detect", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.load(res).get("detections", [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", default="../webxr-ar-ai/test-assets/cv")
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--iou-threshold", type=float, default=0.3)
    args = ap.parse_args()

    image_dir = Path(args.images)
    cases = sorted(image_dir.glob("*.json"))
    cases = [c for c in cases if c.stem != "index"]
    if not cases:
        print(f"No ground-truth JSON found in {image_dir}", file=sys.stderr)
        return 1

    total_gt = matched = 0
    for gt_path in cases:
        gt = json.loads(gt_path.read_text())
        png = image_dir / f"{gt['home']}.png"
        if not png.exists():
            continue

        labels = sorted({d["label"] for d in gt["detections"]})
        prompt = " . ".join(labels) or "object"
        image_b64 = base64.b64encode(png.read_bytes()).decode()

        try:
            preds = post_detect(args.server, image_b64, prompt)
        except Exception as exc:  # noqa: BLE001 — report and continue
            print(f"{gt['home']}: server error: {exc}")
            continue

        print(f"\n{gt['home']}  ({len(gt['detections'])} GT, {len(preds)} predicted)")
        for d in gt["detections"]:
            total_gt += 1
            best = max(
                (p for p in preds),
                key=lambda p: iou(d["bbox_cxcywh"], p.get("bbox_cxcywh", [0, 0, 0, 0])),
                default=None,
            )
            best_iou = iou(d["bbox_cxcywh"], best["bbox_cxcywh"]) if best else 0.0
            hit = best_iou >= args.iou_threshold
            matched += hit
            mark = "✓" if hit else "✗"
            pred_label = best.get("label", "—") if best else "—"
            print(f"  {mark} {d['label']:<12} IoU {best_iou:.2f}  (pred: {pred_label})")

    if total_gt:
        print(f"\nRecall @ IoU≥{args.iou_threshold}: {matched}/{total_gt} "
              f"({100 * matched / total_gt:.0f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
