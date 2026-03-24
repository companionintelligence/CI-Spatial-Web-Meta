import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  applyMetadataToObject,
  createDemoMetadata,
  createEmptyMetadata,
  extractCompanionScanMetadata,
  normaliseCompanionScanMetadata,
  updateMetadataPin,
} from './companionScanMetadata.js';

const PIN_COLORS = {
  CvServer: 0xff7a18,
  MetaScene: 0x3da5ff,
};

export class WorldMapViewer {
  constructor({ container, onMetadataChange, onSelectionChange, onStatusChange }) {
    this.container = container;
    this.onMetadataChange = onMetadataChange ?? (() => {});
    this.onSelectionChange = onSelectionChange ?? (() => {});
    this.onStatusChange = onStatusChange ?? (() => {});

    this.metadata = createEmptyMetadata();
    this.selectedPinId = null;
    this.sourceVisibility = { CvServer: true, MetaScene: true };
    this._markerGroups = new Map();
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._gltfRoot = null;
    this._exportName = 'companion-world-map.glb';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07111d);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
    this.camera.position.set(2.8, 2.2, 3.8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.75, 0);

    this.worldRoot = new THREE.Group();
    this.pinRoot = new THREE.Group();
    this.helperRoot = new THREE.Group();
    this.scene.add(this.worldRoot, this.pinRoot, this.helperRoot);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x223344, 1.4);
    const directional = new THREE.DirectionalLight(0xffffff, 1.8);
    directional.position.set(4, 6, 3);
    this.scene.add(
      hemisphere,
      directional,
      new THREE.GridHelper(10, 10, 0x31506d, 0x163147),
      new THREE.AxesHelper(0.75),
    );


    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('pointerdown', event => this._onPointerDown(event));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this._render());
  }

  resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  async loadArrayBuffer(buffer, fileName = 'companion-world-map.glb') {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });

    this._clearWorld();
    this._gltfRoot = gltf.scene ?? gltf.scenes?.[0] ?? new THREE.Group();
    this.worldRoot.add(this._gltfRoot);
    this.metadata = extractCompanionScanMetadata(gltf);
    this._exportName = fileName.replace(/\.(gltf|glb)$/i, '-edited.glb');
    this._rebuildPins();
    this.frameWorld();
    this._notifyMetadata(`Loaded ${fileName}`);
    if (this.metadata.pins[0]) this.selectPin(this.metadata.pins[0].id);
  }

  loadDemoScene() {
    this._clearWorld();

    const room = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.08, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x1d3246, roughness: 0.85 }),
    );
    room.position.y = -0.04;

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.08, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x8f6f49, roughness: 0.75 }),
    );
    desk.position.set(0.8, 0.74, -1.1);

    const chair = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.26, 0.55, 24),
      new THREE.MeshStandardMaterial({ color: 0x4d6989, roughness: 0.65 }),
    );
    chair.position.set(-0.65, 0.28, -0.85);

    this._gltfRoot = new THREE.Group();
    this._gltfRoot.add(room, desk, chair);
    this.worldRoot.add(this._gltfRoot);

    this.metadata = createDemoMetadata();
    this._exportName = 'companion-world-map-demo-edited.glb';
    this._rebuildPins();
    this.frameWorld();
    this._notifyMetadata('Loaded demo world map');
    if (this.metadata.pins[0]) this.selectPin(this.metadata.pins[0].id);
  }

  getMetadata() {
    return normaliseCompanionScanMetadata(this.metadata);
  }

  setSourceVisibility(source, visible) {
    this.sourceVisibility[source] = visible;
    for (const [pinId, group] of this._markerGroups.entries()) {
      const pin = this.metadata.pins.find(item => item.id === pinId);
      if (!pin) continue;
      group.visible = this.sourceVisibility[pin.source] !== false;
    }
  }

  selectPin(pinId) {
    this.selectedPinId = pinId;
    this._updateSelectionState();
    const pin = this.metadata.pins.find(item => item.id === pinId) ?? null;
    if (pin) {
      this.controls.target.set(pin.position.x, pin.position.y, pin.position.z);
    }
    this.onSelectionChange(pin);
  }

  updatePin(pinId, updates) {
    this.metadata = updateMetadataPin(this.metadata, pinId, updates);
    this._rebuildPins();
    this.selectPin(pinId);
    this._notifyMetadata('Updated world map metadata');
  }

  resetView() {
    this.frameWorld();
  }

  async exportGlb() {
    const exporter = new GLTFExporter();
    const exportRoot = this._gltfRoot ?? this.worldRoot;
    const previousExtras = exportRoot.userData.gltfExtras;
    const previousMetadata = exportRoot.userData.companion_scan;

    applyMetadataToObject(exportRoot, this.metadata);

    try {
      return await new Promise((resolve, reject) => {
        exporter.parse(exportRoot, resolve, reject, { binary: true, embedImages: false });
      });
    } finally {
      exportRoot.userData.gltfExtras = previousExtras;
      exportRoot.userData.companion_scan = previousMetadata;
    }
  }

  exportFileName() {
    return this._exportName;
  }

  frameWorld() {
    const target = this._gltfRoot ?? this.pinRoot;
    const box = new THREE.Box3().setFromObject(target);

    if (box.isEmpty()) {
      this.controls.target.set(0, 0.75, 0);
      this.camera.position.set(2.8, 2.2, 3.8);
      this.controls.update();
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length(), 1.5);

    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(radius * 0.6, radius * 0.45, radius * 0.75));
    this.controls.update();
  }

  _render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _clearWorld() {
    this.worldRoot.clear();
    this.pinRoot.clear();
    this.helperRoot.clear();
    this._markerGroups.clear();
    this.selectedPinId = null;
    this._gltfRoot = null;
  }

  _rebuildPins() {
    this.pinRoot.clear();
    this.helperRoot.clear();
    this._markerGroups.clear();

    for (const pin of this.metadata.pins) {
      const group = this._createPinGroup(pin);
      group.visible = this.sourceVisibility[pin.source] !== false;
      this.pinRoot.add(group);
      this._markerGroups.set(pin.id, group);
    }

    if (this.metadata.floorplan?.bounds) {
      const helper = this._createFloorplanHelper(this.metadata.floorplan.bounds);
      this.helperRoot.add(helper);
    }

    this._updateSelectionState();
    this.onSelectionChange(this.metadata.pins.find(pin => pin.id === this.selectedPinId) ?? null);
  }

  _createPinGroup(pin) {
    const group = new THREE.Group();
    group.position.set(pin.position.x, pin.position.y, pin.position.z);
    group.userData.pinId = pin.id;

    const color = PIN_COLORS[pin.source] ?? 0xffffff;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 18, 18),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18 }),
    );
    marker.userData.pinId = pin.id;

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this._createLabelTexture(pin.label || pin.id, pin.source, pin.confidence),
        transparent: true,
      }),
    );
    sprite.position.set(0, 0.18, 0);
    sprite.scale.set(0.95, 0.22, 1);
    sprite.userData.pinId = pin.id;

    group.add(marker, sprite);
    return group;
  }

  _createFloorplanHelper(bounds) {
    const min = new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z);
    const max = new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z);
    const size = max.clone().sub(min);
    const center = min.clone().add(max).multiplyScalar(0.5);

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(size.x, 0.02),
        Math.max(size.y, 0.02),
        Math.max(size.z, 0.02),
      ),
      new THREE.MeshBasicMaterial({
        color: 0x5bc0eb,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      }),
    );
    box.position.copy(center);
    return box;
  }

  _createLabelTexture(label, source, confidence) {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(6, 17, 30, 0.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = source === 'MetaScene' ? '#3da5ff' : '#ff7a18';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.fillStyle = '#e7f4ff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(label || 'Unlabelled pin', 18, 40);
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#8fb6d8';
    ctx.fillText(`${source} • ${Math.round((confidence ?? 0) * 100)}%`, 18, 74);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  _updateSelectionState() {
    for (const [pinId, group] of this._markerGroups.entries()) {
      const marker = group.children[0];
      marker.scale.setScalar(pinId === this.selectedPinId ? 1.5 : 1);
      marker.material.emissiveIntensity = pinId === this.selectedPinId ? 0.5 : 0.18;
    }
  }

  _notifyMetadata(statusMessage) {
    this.onMetadataChange(this.getMetadata());
    this.onStatusChange(statusMessage);
  }

  _onPointerDown(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);

    const hits = this._raycaster.intersectObjects(this.pinRoot.children, true);
    const pinId = hits.map(hit => this._findPinId(hit.object)).find(Boolean);
    if (pinId) this.selectPin(pinId);
  }

  _findPinId(object) {
    let current = object;
    while (current) {
      if (current.userData?.pinId) return current.userData.pinId;
      current = current.parent;
    }
    return null;
  }
}
