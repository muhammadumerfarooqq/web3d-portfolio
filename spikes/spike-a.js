// Spike A (P1): load the Blender export and prove animations, morph targets and skinning work.
// Dev-only: served by `npm run dev`, never part of the production build.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const MODEL_URL = '/blender/exports/spike-a.glb';
const DRACO_PATH = '/node_modules/three/examples/jsm/libs/draco/gltf/';

const canvas = document.getElementById('viewport');
const statusEl = document.getElementById('status');
const clipsEl = document.getElementById('clips');
const morphsEl = document.getElementById('morphs');
const skinnedEl = document.getElementById('skinned');
const toggleBtn = document.getElementById('squash-toggle');
const slider = document.getElementById('squash-slider');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1b24);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 1.6, 7);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(3, 5, 4);
scene.add(sun);

const timer = new THREE.Timer();
timer.connect(document); // pauses delta while the tab is hidden
let mixer = null;
const squashTargets = []; // [{ mesh, index }]

function addItem(list, text) {
  const li = document.createElement('li');
  li.textContent = text;
  list.appendChild(li);
}

function setSquash(value) {
  for (const { mesh, index } of squashTargets) mesh.morphTargetInfluences[index] = value;
  slider.value = String(value);
  const on = value >= 0.5;
  toggleBtn.textContent = `Squash: ${on ? 'on' : 'off'}`;
  toggleBtn.setAttribute('aria-pressed', String(on));
}

function showError(message) {
  statusEl.textContent = `Load error: ${message}`;
  statusEl.classList.add('error');
}

const dracoLoader = new DRACOLoader().setDecoderPath(DRACO_PATH);
const loader = new GLTFLoader().setDRACOLoader(dracoLoader);

loader.load(
  MODEL_URL,
  (gltf) => {
    scene.add(gltf.scene);

    mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      mixer.clipAction(clip).play();
      addItem(clipsEl, `${clip.name}: ${clip.duration.toFixed(2)} s`);
    }
    if (gltf.animations.length === 0) addItem(clipsEl, 'none found');

    let skinned = 0;
    const morphNames = new Set();
    gltf.scene.traverse((obj) => {
      if (obj.isSkinnedMesh) skinned += 1;
      if (obj.isMesh && obj.morphTargetDictionary) {
        for (const [name, index] of Object.entries(obj.morphTargetDictionary)) {
          morphNames.add(name);
          if (name === 'Squash') squashTargets.push({ mesh: obj, index });
        }
      }
    });
    for (const name of morphNames) addItem(morphsEl, name);
    if (morphNames.size === 0) addItem(morphsEl, 'none found');
    skinnedEl.textContent = String(skinned);

    if (squashTargets.length > 0) {
      toggleBtn.disabled = false;
      slider.disabled = false;
    }
    statusEl.textContent = `Loaded ${MODEL_URL}`;
    dracoLoader.dispose();
  },
  undefined,
  (error) => {
    showError(error?.message ?? String(error));
    dracoLoader.dispose();
  },
);

toggleBtn.addEventListener('click', () => setSquash(Number(slider.value) >= 0.5 ? 0 : 1));
slider.addEventListener('input', () => setSquash(Number(slider.value)));

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  if (mixer) mixer.update(delta);
  controls.update();
  renderer.render(scene, camera);
});
