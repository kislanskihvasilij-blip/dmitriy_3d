/* BREEZE 3D — WebGL-сцена: облако точек превращается в CAD-модель (метафора реверс-инжиниринга) */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COLOR = Object.freeze({ mint: 0xdcffee, green: 0x43e97b, aqua: 0x38f9d7, body: 0x0e2c1b });
const POINT_COUNT = 9000;
const POINT_JITTER = 0.012;      // «шум сканера»
const SCAN_RANGE = 1.05;         // половина высоты прохода лазера
const SCAN_SECONDS = 4.2;        // один проход
const HOLD_SECONDS = 1.8;        // пауза в крайних положениях
const SPIN_SPEED = 0.22;         // рад/с вокруг вертикали
const POINTER_TILT = 0.18;       // наклон за курсором, рад
const STAGES = Object.freeze([
  { until: 0.02, label: 'Облако точек' },
  { until: 0.98, label: 'Построение модели' },
  { until: Infinity, label: 'CAD-модель готова' },
]);

/* ---------- Геометрия детали: шестерня со ступицей ---------- */
function circlePath(x, y, radius) {
  const path = new THREE.Path();
  path.absarc(x, y, radius, 0, Math.PI * 2, true);
  return path;
}

function createGearShape({ teeth, outer, root, bore, holes, holeRadius, holeRing }) {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const start = i * step;
    const profile = [[root, start], [outer, start + step * 0.2], [outer, start + step * 0.45], [root, start + step * 0.65]];
    profile.forEach(([radius, angle], j) => {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0 && j === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  shape.holes.push(circlePath(0, 0, bore));
  for (let k = 0; k < holes; k += 1) {
    const angle = (k / holes) * Math.PI * 2;
    shape.holes.push(circlePath(Math.cos(angle) * holeRing, Math.sin(angle) * holeRing, holeRadius));
  }
  return shape;
}

function createPartGeometry() {
  const bevel = { bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 2, curveSegments: 48 };
  const gear = new THREE.ExtrudeGeometry(
    createGearShape({ teeth: 18, outer: 1, root: 0.86, bore: 0.2, holes: 6, holeRadius: 0.1, holeRing: 0.6 }),
    { depth: 0.26, ...bevel },
  );
  gear.translate(0, 0, -0.13);

  const hubShape = new THREE.Shape();
  hubShape.absarc(0, 0, 0.4, 0, Math.PI * 2, false);
  hubShape.holes.push(circlePath(0, 0, 0.2));
  const hub = new THREE.ExtrudeGeometry(hubShape, { depth: 0.56, ...bevel });
  hub.translate(0, 0, -0.28);

  const merged = mergeGeometries([gear, hub], false);
  gear.dispose();
  hub.dispose();
  if (!merged) throw new Error('Не удалось объединить геометрию детали');
  return merged;
}

/* ---------- Облако точек с поверхности модели ---------- */
function createPointCloud(geometry) {
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build();
  const positions = new Float32Array(POINT_COUNT * 3);
  const point = new THREE.Vector3();
  const jitter = () => (Math.random() - 0.5) * 2 * POINT_JITTER;
  for (let i = 0; i < POINT_COUNT; i += 1) {
    sampler.sample(point);
    positions.set([point.x + jitter(), point.y + jitter(), point.z + jitter()], i * 3);
  }
  const cloud = new THREE.BufferGeometry();
  cloud.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return cloud;
}

function createDotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/* ---------- Лазерная плоскость сканера ---------- */
function createLaser(radius) {
  const laser = new THREE.Group();
  const sheet = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 96),
    new THREE.MeshBasicMaterial({ color: COLOR.aqua, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const ringPoints = Array.from({ length: 160 }, (_, i) => {
    const angle = (i / 160) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  });
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ringPoints),
    new THREE.LineBasicMaterial({ color: COLOR.aqua, transparent: true, opacity: 0.85 }),
  );
  sheet.rotation.x = -Math.PI / 2;
  ring.rotation.x = -Math.PI / 2;
  laser.add(sheet, ring);
  return { laser, materials: [sheet.material, ring.material] };
}

/* ---------- Цикл сканирования: облако → модель → облако ---------- */
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function scanProgress(seconds) {
  const cycle = 2 * (SCAN_SECONDS + HOLD_SECONDS);
  const local = seconds % cycle;
  if (local < SCAN_SECONDS) return easeInOut(local / SCAN_SECONDS);
  if (local < SCAN_SECONDS + HOLD_SECONDS) return 1;
  const back = local - SCAN_SECONDS - HOLD_SECONDS;
  if (back < SCAN_SECONDS) return 1 - easeInOut(back / SCAN_SECONDS);
  return 0;
}

function createHud() {
  const stage = document.querySelector('[data-scan-stage]');
  const value = document.querySelector('[data-scan-value]');
  const bar = document.querySelector('[data-scan-bar]');
  let lastPercent = -1;
  return (progress) => {
    const percent = Math.round(progress * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    if (value) value.textContent = `${percent}%`;
    if (bar) bar.style.setProperty('--p', progress.toFixed(3));
    if (stage) stage.textContent = STAGES.find((item) => progress < item.until).label;
  };
}

/* ---------- Сцена ---------- */
function mountScene(host) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.6, 6.2);
  camera.lookAt(0, 0, 0);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
  keyLight.position.set(3, 4, 5);
  const rimAqua = new THREE.PointLight(COLOR.aqua, 22, 14);
  rimAqua.position.set(-3, 1.6, -2);
  const rimGreen = new THREE.PointLight(COLOR.green, 16, 14);
  rimGreen.position.set(3, -2, -1.5);
  scene.add(keyLight, rimAqua, rimGreen, new THREE.AmbientLight(COLOR.mint, 0.12));

  // Выше плоскости — готовая модель, ниже — облако точек
  const modelPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const cloudPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

  const geometry = createPartGeometry();
  const solid = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
    color: COLOR.body, metalness: 0.75, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.25,
    envMapIntensity: 0.9, side: THREE.DoubleSide, clippingPlanes: [modelPlane],
  }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    new THREE.LineBasicMaterial({ color: COLOR.aqua, transparent: true, opacity: 0.3, clippingPlanes: [modelPlane] }),
  );
  const cloud = new THREE.Points(createPointCloud(geometry), new THREE.PointsMaterial({
    color: COLOR.aqua, size: 0.03, map: createDotTexture(), sizeAttenuation: true, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: [cloudPlane],
  }));

  const part = new THREE.Group();
  part.add(solid, edges, cloud);
  part.rotation.set(-0.55, 0, 0.18);
  const spinner = new THREE.Group();
  spinner.add(part);
  const { laser, materials: laserMaterials } = createLaser(1.5);
  scene.add(spinner, laser);

  const updateHud = createHud();
  const pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };

  function applyProgress(progress) {
    const level = SCAN_RANGE - progress * 2 * SCAN_RANGE;
    modelPlane.constant = -level;
    cloudPlane.constant = level;
    laser.position.y = level;
    const laserVisible = progress > 0.005 && progress < 0.995 ? 1 : 0;
    laserMaterials[0].opacity = 0.07 * laserVisible;
    laserMaterials[1].opacity = 0.85 * laserVisible;
    updateHud(progress);
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function renderFrame(seconds) {
    tilt.x += (pointer.y * POINTER_TILT - tilt.x) * 0.05;
    tilt.y += (pointer.x * POINTER_TILT - tilt.y) * 0.05;
    spinner.rotation.y = seconds * SPIN_SPEED + tilt.y;
    spinner.rotation.x = tilt.x;
    applyProgress(scanProgress(seconds));
    renderer.render(scene, camera);
  }

  resize();
  new ResizeObserver(resize).observe(host);

  if (prefersReducedMotion) {
    spinner.rotation.y = 0.6;
    applyProgress(0.5);
    renderer.render(scene, camera);
    host.classList.add('is-ready');
    return;
  }

  if (hasFinePointer) {
    window.addEventListener('pointermove', (event) => {
      pointer.x = event.clientX / window.innerWidth - 0.5;
      pointer.y = event.clientY / window.innerHeight - 0.5;
    }, { passive: true });
  }

  // Рендерим только когда сцена на экране
  const clock = new THREE.Clock();
  let elapsed = 0;
  let running = false;
  function loop() {
    if (!running) return;
    elapsed += Math.min(clock.getDelta(), 0.1);
    renderFrame(elapsed);
    requestAnimationFrame(loop);
  }
  new IntersectionObserver(([entry]) => {
    const shouldRun = entry.isIntersecting;
    if (shouldRun === running) return;
    running = shouldRun;
    if (running) {
      clock.getDelta();
      requestAnimationFrame(loop);
    }
  }).observe(host);

  renderFrame(0);
  host.classList.add('is-ready');
}

// Запуск в конце модуля: все const-объявления выше уже инициализированы (иначе TDZ)
const container = document.querySelector('[data-scene]');
if (container) {
  try {
    mountScene(container);
  } catch (error) {
    container.querySelector('canvas')?.remove();
    console.warn('3D-сцена недоступна, показываю статичную схему:', error);
  }
}
