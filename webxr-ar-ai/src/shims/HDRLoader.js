// Compatibility shim: three.js r167+ renamed HDRLoader → RGBELoader.
// @iwsdk/core 0.3.1 still imports the old name.
export { RGBELoader as HDRLoader } from 'three/examples/jsm/loaders/RGBELoader.js';
