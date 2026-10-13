/* BREEZE 3D — WebGL-сцена: объёмная буква D собирается из облака точек (метафора реверс-инжиниринга).
   Обычный скрипт + локальный three.js r149 (assets/vendor): работает и при открытии файла с диска (file://). */
(() => {
  'use strict';

  const THREE = window.THREE;
  const host = document.querySelector('[data-scene]');
  if (!host || !THREE) return;

  const COLOR = Object.freeze({ mint: 0xdcffee, green: 0x43e97b, aqua: 0x38f9d7 });
  const ITALIC_SLANT = 0.2;        // наклон курсива, как у логотипа (Anybody Italic)
  const POINT_COUNT = 9000;
  const POINT_JITTER = 0.012;      // «шум сканера»
  const SCAN_RANGE = 1.18;         // половина высоты прохода лазера
  const SCAN_SECONDS = 4.2;        // один проход
  const HOLD_SECONDS = 2.2;        // пауза в крайних положениях
  const SWAY_AMPLITUDE = 0.5;      // покачивание буквы, рад
  const SWAY_SPEED = 0.45;
  const POINTER_TILT = 0.2;        // наклон за курсором, рад
  const STAGES = Object.freeze([
    { until: 0.02, label: 'Облако точек' },
    { until: 0.98, label: 'Построение модели' },
    { until: Infinity, label: 'CAD-модель готова' },
  ]);

  /* ---------- Геометрия: курсивная D с округлым «животом» ---------- */
  const slant = (x, y) => [x + y * ITALIC_SLANT, y];

  function createLetterShape() {
    const shape = new THREE.Shape();
    shape.moveTo(...slant(-0.62, -1));
    shape.lineTo(...slant(0.08, -1));
    shape.bezierCurveTo(...slant(0.74, -1), ...slant(1.04, -0.58), ...slant(1.04, 0));
    shape.bezierCurveTo(...slant(1.04, 0.58), ...slant(0.74, 1), ...slant(0.08, 1));
    shape.lineTo(...slant(-0.62, 1));
    shape.quadraticCurveTo(...slant(-0.78, 1), ...slant(-0.78, 0.84));
    shape.lineTo(...slant(-0.78, -0.84));
    shape.quadraticCurveTo(...slant(-0.78, -1), ...slant(-0.62, -1));

    const counter = new THREE.Path();
    counter.moveTo(...slant(-0.3, -0.54));
    counter.lineTo(...slant(0.06, -0.54));
    counter.bezierCurveTo(...slant(0.42, -0.54), ...slant(0.56, -0.3), ...slant(0.56, 0));
    counter.bezierCurveTo(...slant(0.56, 0.3), ...slant(0.42, 0.54), ...slant(0.06, 0.54));
    counter.lineTo(...slant(-0.3, 0.54));
    counter.lineTo(...slant(-0.3, -0.54));
    shape.holes.push(counter);
    return shape;
  }

  function createLetterGeometry() {
    const geometry = new THREE.ExtrudeGeometry(createLetterShape(), {
      depth: 0.42, curveSegments: 40,
      bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.055, bevelSegments: 10,
    });
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    return geometry;
  }

  /* ---------- Материалы: градиентный торец + голографический хром по бокам ---------- */
  function createFaceTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, size, size, 0);
    gradient.addColorStop(0, '#1fae5c');
    gradient.addColorStop(0.35, '#43e97b');
    gradient.addColorStop(0.7, '#38f9d7');
    gradient.addColorStop(1, '#dcffee');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    // UV торца = координаты контура: растягиваем градиент на габарит буквы
    texture.repeat.set(1 / 2.3, 1 / 2.2);
    texture.offset.set(0.98 / 2.3, 1.1 / 2.2);
    return texture;
  }

  function createMaterials(clippingPlanes) {
    const face = new THREE.MeshPhysicalMaterial({
      map: createFaceTexture(), metalness: 0.35, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06,
      envMapIntensity: 1.1, side: THREE.DoubleSide, clippingPlanes,
    });
    const sides = new THREE.MeshPhysicalMaterial({
      color: COLOR.mint, metalness: 1, roughness: 0.14, iridescence: 1, iridescenceIOR: 1.35,
      iridescenceThicknessRange: [140, 460], envMapIntensity: 1.25, side: THREE.DoubleSide, clippingPlanes,
    });
    return [face, sides]; // группы ExtrudeGeometry: 0 — торцы, 1 — боковины и фаски
  }

  /* ---------- Окружение для отражений (облегчённый аналог RoomEnvironment) ---------- */
  function createEnvironment(renderer) {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x03140a);
    const panel = (color, intensity, width, height, position) => {
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
      mesh.position.set(...position);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
    };
    panel(0xffffff, 3.2, 7, 2.2, [0, 6, 2]);
    panel(COLOR.aqua, 2.6, 2.4, 7, [-6, 1, 1.5]);
    panel(COLOR.green, 2.2, 2.4, 7, [6, -1, 1.5]);
    panel(0xd9b8ff, 1.6, 6, 2, [0, -5, 3]);      // лиловый блик — как у хромированных форм бренда
    panel(COLOR.mint, 1.2, 9, 4, [0, 0, -7]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const texture = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    return texture;
  }

  /* ---------- Облако точек: выборка по площади треугольников ---------- */
  function createPointCloud(geometry) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.attributes.position;
    const triangleCount = position.count / 3;
    const cumulative = new Float32Array(triangleCount);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const triangle = new THREE.Triangle();
    let totalArea = 0;
    for (let i = 0; i < triangleCount; i += 1) {
      a.fromBufferAttribute(position, i * 3);
      b.fromBufferAttribute(position, i * 3 + 1);
      c.fromBufferAttribute(position, i * 3 + 2);
      totalArea += triangle.set(a, b, c).getArea();
      cumulative[i] = totalArea;
    }

    const findTriangle = (target) => {
      let low = 0;
      let high = triangleCount - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (cumulative[mid] < target) low = mid + 1;
        else high = mid;
      }
      return low;
    };
    const jitter = () => (Math.random() - 0.5) * 2 * POINT_JITTER;

    const points = new Float32Array(POINT_COUNT * 3);
    for (let n = 0; n < POINT_COUNT; n += 1) {
      const index = findTriangle(Math.random() * totalArea);
      a.fromBufferAttribute(position, index * 3);
      b.fromBufferAttribute(position, index * 3 + 1);
      c.fromBufferAttribute(position, index * 3 + 2);
      let u = Math.random();
      let v = Math.random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      points[n * 3] = a.x + (b.x - a.x) * u + (c.x - a.x) * v + jitter();
      points[n * 3 + 1] = a.y + (b.y - a.y) * u + (c.y - a.y) * v + jitter();
      points[n * 3 + 2] = a.z + (b.z - a.z) * u + (c.z - a.z) * v + jitter();
    }
    const cloud = new THREE.BufferGeometry();
    cloud.setAttribute('position', new THREE.BufferAttribute(points, 3));
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
  function mountScene() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

    THREE.ColorManagement.legacyMode = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.environment = createEnvironment(renderer);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0.25, 6.4);
    camera.lookAt(0, 0, 0);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(3, 4, 5);
    const rimAqua = new THREE.PointLight(COLOR.aqua, 24, 14);
    rimAqua.position.set(-3, 1.6, -2);
    const rimGreen = new THREE.PointLight(COLOR.green, 18, 14);
    rimGreen.position.set(3, -2, -1.5);
    scene.add(keyLight, rimAqua, rimGreen, new THREE.AmbientLight(COLOR.mint, 0.15));

    // Выше лазера — готовая модель, ниже — облако точек
    const modelPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const cloudPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    const geometry = createLetterGeometry();
    const letter = new THREE.Mesh(geometry, createMaterials([modelPlane]));
    const cloud = new THREE.Points(createPointCloud(geometry), new THREE.PointsMaterial({
      color: COLOR.aqua, size: 0.028, map: createDotTexture(), sizeAttenuation: true, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: [cloudPlane],
    }));

    const spinner = new THREE.Group();
    spinner.add(letter, cloud);
    const { laser, materials: laserMaterials } = createLaser(1.55);
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

    function renderFrame(seconds) {
      tilt.x += (pointer.y * POINTER_TILT - tilt.x) * 0.05;
      tilt.y += (pointer.x * POINTER_TILT - tilt.y) * 0.05;
      spinner.rotation.y = Math.sin(seconds * SWAY_SPEED) * SWAY_AMPLITUDE + tilt.y;
      spinner.rotation.x = -0.08 + tilt.x;
      applyProgress(scanProgress(seconds));
      renderer.render(scene, camera);
    }

    let elapsed = 0;
    let running = false;

    function resize() {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // setSize очищает буфер: без цикла (reduced motion / вне экрана) перерисовываем вручную
      if (!running) renderFrame(elapsed);
    }

    if (prefersReducedMotion) {
      elapsed = SCAN_SECONDS + HOLD_SECONDS / 2; // статичный кадр: готовая модель
    }
    resize();
    new ResizeObserver(resize).observe(host);
    host.classList.add('is-ready');
    host.closest('.viewport')?.classList.add('is-live');
    if (prefersReducedMotion) return;

    if (hasFinePointer) {
      window.addEventListener('pointermove', (event) => {
        pointer.x = event.clientX / window.innerWidth - 0.5;
        pointer.y = event.clientY / window.innerHeight - 0.5;
      }, { passive: true });
    }

    // Рендерим только когда сцена на экране
    const clock = new THREE.Clock();
    function loop() {
      if (!running) return;
      elapsed += Math.min(clock.getDelta(), 0.1);
      renderFrame(elapsed);
      requestAnimationFrame(loop);
    }
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting === running) return;
      running = entry.isIntersecting;
      if (running) {
        clock.getDelta();
        requestAnimationFrame(loop);
      }
    }).observe(host);
  }

  // Запуск в конце: все const выше уже инициализированы
  try {
    mountScene();
  } catch (error) {
    host.querySelector('canvas')?.remove();
    host.classList.remove('is-ready');
    console.warn('3D-сцена недоступна, показываю статичную букву:', error);
  }
})();
