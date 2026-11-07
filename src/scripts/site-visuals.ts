const initializeSiteVisuals = async () => {
const canvas = document.querySelector<HTMLCanvasElement>('.geometry-canvas');
const stage = document.querySelector<HTMLElement>('.geometry-layer');
const title = document.querySelector<HTMLElement>('.geometry-label');
const backgroundField = document.querySelector<HTMLElement>('.background-image-field');
const imageLayers = [...document.querySelectorAll<HTMLImageElement>('.background-image')];
const backgroundUrls = backgroundField?.dataset.backgrounds?.split('|') ?? [];

if (!canvas || !stage || !title || !backgroundField || imageLayers.length !== 2 || backgroundUrls.length < 2) return;
const THREE = await import('three');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phi = (1 + Math.sqrt(5)) / 2;
  const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const metatronPoints: number[][] = [[0, 0, 0.18]];

  for (const ring of [0.5, 1]) {
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 2;
      const depth = ring === 1 ? Math.cos(angle * 2) * 0.13 : Math.sin(angle * 2) * 0.1;
      metatronPoints.push([Math.cos(angle) * ring, Math.sin(angle) * ring, depth]);
    }
  }

  const metatronEdges = metatronPoints.flatMap((_, i) =>
    metatronPoints.slice(i + 1).map((__, j) => [i, i + j + 1]),
  );
  const connectNearest = (points: number[][]) => {
    const lengths = points.flatMap((a, i) => points.slice(i + 1).map((b) => distance(a, b)));
    const shortest = Math.min(...lengths);
    const edges: number[][] = [];
    points.forEach((a, i) =>
      points.slice(i + 1).forEach((b, j) => {
        if (Math.abs(distance(a, b) - shortest) < 0.001) edges.push([i, i + j + 1]);
      }),
    );
    return edges;
  };

  const definitions = [
    { name: "Metatron's Cube", points: metatronPoints, edges: metatronEdges },
    { name: 'Tetrahedron', points: [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]] },
    { name: 'Hexahedron', points: Array.from({ length: 8 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]) },
    { name: 'Octahedron', points: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] },
    { name: 'Icosahedron', points: [[0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi], [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0], [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]] },
    { name: 'Dodecahedron', points: [...Array.from({ length: 8 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]), ...[-1, 1].flatMap((a) => [-1, 1].flatMap((b) => [[0, a / phi, b * phi], [a / phi, b * phi, 0], [a * phi, 0, b / phi]]))] },
  ].map((shape) => {
    const extent = Math.max(...shape.points.map((point) => Math.hypot(...point)));
    const points = shape.points.map((point) => point.map((value) => value / extent));
    return { ...shape, points, edges: shape.edges ?? connectNearest(points) };
  });

  const resampleEdges = (points: number[][], edges: number[][], count: number) => {
    const ordered = edges
      .map(([a, b]) => [points[a], points[b]])
      .sort((a, b) => Math.atan2((a[0][1] + a[1][1]) / 2, (a[0][0] + a[1][0]) / 2) - Math.atan2((b[0][1] + b[1][1]) / 2, (b[0][0] + b[1][0]) / 2));
    const lengths = ordered.map(([a, b]) => distance(a, b));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const allotments = lengths.map((length) => 1 + Math.floor(((count - ordered.length) * length) / total));
    const remaining = count - allotments.reduce((sum, value) => sum + value, 0);
    lengths
      .map((length, i) => ({ i, remainder: (((count - ordered.length) * length) / total) % 1 }))
      .sort((a, b) => b.remainder - a.remainder)
      .slice(0, remaining)
      .forEach(({ i }) => allotments[i]++);

    const result = new Float32Array(count * 6);
    let segment = 0;
    ordered.forEach(([a, b], edgeIndex) => {
      for (let part = 0; part < allotments[edgeIndex]; part++, segment++) {
        const start = part / allotments[edgeIndex];
        const end = (part + 1) / allotments[edgeIndex];
        for (let axis = 0; axis < 3; axis++) {
          result[segment * 6 + axis] = a[axis] + (b[axis] - a[axis]) * start;
          result[segment * 6 + 3 + axis] = a[axis] + (b[axis] - a[axis]) * end;
        }
      }
    });
    return result;
  };

  const matchLineOrder = (reference: Float32Array, candidate: Float32Array) => {
    const matches: { from: number; to: number; reversed: boolean; cost: number }[] = [];
    const segmentDistance = (a: Float32Array, ai: number, b: Float32Array, bi: number) =>
      Math.hypot(a[ai] - b[bi], a[ai + 1] - b[bi + 1], a[ai + 2] - b[bi + 2]);
    for (let from = 0; from < reference.length; from += 6) {
      for (let to = 0; to < candidate.length; to += 6) {
        const forward = segmentDistance(reference, from, candidate, to) + segmentDistance(reference, from + 3, candidate, to + 3);
        const reverse = segmentDistance(reference, from, candidate, to + 3) + segmentDistance(reference, from + 3, candidate, to);
        matches.push({ from, to, reversed: reverse < forward, cost: Math.min(forward, reverse) });
      }
    }
    matches.sort((a, b) => a.cost - b.cost);
    const ordered = new Float32Array(candidate.length);
    const usedFrom = new Set<number>();
    const usedTo = new Set<number>();
    for (const match of matches) {
      if (usedFrom.has(match.from) || usedTo.has(match.to)) continue;
      usedFrom.add(match.from);
      usedTo.add(match.to);
      for (let axis = 0; axis < 3; axis++) {
        ordered[match.from + axis] = candidate[match.to + (match.reversed ? 3 : 0) + axis];
        ordered[match.from + 3 + axis] = candidate[match.to + (match.reversed ? 0 : 3) + axis];
      }
      if (usedFrom.size === candidate.length / 6) break;
    }
    return ordered;
  };

  const shapes = definitions.map((shape) => ({ ...shape, lines: resampleEdges(shape.points, shape.edges, 96) }));
  for (let i = 1; i < shapes.length; i++) shapes[i].lines = matchLineOrder(shapes[i - 1].lines, shapes[i].lines);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    title.textContent = shapes[Math.floor(shapes.length / 2)].name;
    return;
  }

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 0.85));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  camera.position.set(0, 0, 5.3);
  const group = new THREE.Group();
  scene.add(group);

  const activeShape = Math.floor(shapes.length / 2);
  title.textContent = shapes[activeShape].name;
  let targetShape = activeShape;
  let morphStarted = 0;
  let morphProgress = 1;
  const morphFrom = shapes[activeShape].lines.slice();
  const currentLines = morphFrom.slice();
  const morphTo = shapes[activeShape].lines.slice();
  const mainGeometry = new THREE.BufferGeometry();
  mainGeometry.setAttribute('position', new THREE.BufferAttribute(shapes[activeShape].lines.slice(0, 96 * 6), 3));
  mainGeometry.setAttribute('morphStart', new THREE.BufferAttribute(morphFrom, 3).setUsage(THREE.DynamicDrawUsage));
  mainGeometry.setAttribute('morphEnd', new THREE.BufferAttribute(morphTo, 3).setUsage(THREE.DynamicDrawUsage));

  const mainMaterial = new THREE.ShaderMaterial({
    uniforms: { morphAmount: { value: 1 } },
    vertexShader: `
      attribute vec3 morphStart;
      attribute vec3 morphEnd;
      uniform float morphAmount;
      void main() {
        vec3 point = mix(morphStart, morphEnd, morphAmount);
        vec4 viewPoint = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * viewPoint;
      }
    `,
    fragmentShader: `
      void main() { gl_FragColor = vec4(0.94, 0.97, 1.0, 0.94); }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mainLines = new THREE.LineSegments(mainGeometry, mainMaterial);
  mainLines.frustumCulled = false;
  group.add(mainLines);

  const ghostPositions: number[] = [];
  for (const [a, b] of metatronEdges) ghostPositions.push(...metatronPoints[a], ...metatronPoints[b]);
  const ghostGeometry = new THREE.BufferGeometry();
  ghostGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ghostPositions, 3));
  const ghostLines = new THREE.LineSegments(ghostGeometry, new THREE.LineBasicMaterial({ color: 0xdce8ff, transparent: true, opacity: 0.12, depthWrite: false }));
  group.add(ghostLines);

  const circlePositions: number[] = [];
  for (const center of metatronPoints) {
    const normal = new THREE.Vector3(center[0] * 0.58 + 0.18, center[1] * 0.58 - 0.12, 0.78).normalize();
    const u = new THREE.Vector3(-normal.y, normal.x, 0).normalize();
    if (u.lengthSq() < 0.01) u.set(1, 0, 0);
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();
    const origin = new THREE.Vector3(...center);
    const points: THREE.Vector3[] = [];
    for (let step = 0; step < 48; step++) {
      const angle = (step / 48) * Math.PI * 2;
      points.push(origin.clone().addScaledVector(u, Math.cos(angle) * 0.25).addScaledVector(v, Math.sin(angle) * 0.25));
    }
    for (let i = 0; i < points.length; i++) {
      circlePositions.push(...points[i].toArray(), ...points[(i + 1) % points.length].toArray());
    }
  }
  const circleGeometry = new THREE.BufferGeometry();
  circleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(circlePositions, 3));
  const circleMaterial = new THREE.ShaderMaterial({
    vertexShader: `
      varying float viewDepth;
      void main() {
        vec4 viewPoint = modelViewMatrix * vec4(position, 1.0);
        viewDepth = viewPoint.z;
        gl_Position = projectionMatrix * viewPoint;
      }
    `,
    fragmentShader: `
      varying float viewDepth;
      void main() {
        float front = smoothstep(-5.8, -4.8, viewDepth);
        vec3 color = mix(vec3(0.22, 0.32, 0.48), vec3(0.88, 0.94, 1.0), front);
        float alpha = mix(0.15, 0.68, front);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  group.add(new THREE.LineSegments(circleGeometry, circleMaterial));

  scene.add(new THREE.HemisphereLight(0xc8dcff, 0x101522, 1.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-2.5, 3.5, 5);
  scene.add(keyLight);
  const sphereGeometry = new THREE.SphereGeometry(0.024, 12, 8);
  const sphereMaterial = new THREE.MeshPhongMaterial({ color: 0xe4efff, specular: 0xffffff, shininess: 80 });
  const nodes = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, metatronPoints.length);
  const nodeTransform = new THREE.Object3D();
  metatronPoints.forEach(([x, y, z], index) => {
    nodeTransform.position.set(x, y, z);
    nodeTransform.scale.setScalar(index === 0 ? 1.35 : 1);
    nodeTransform.updateMatrix();
    nodes.setMatrixAt(index, nodeTransform.matrix);
  });
  nodes.instanceMatrix.needsUpdate = true;
  group.add(nodes);

  let viewportWidth = innerWidth;
  let viewportHeight = innerHeight;
  let stageSize = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;
  let followX = 0.5;
  let followY = 0.5;
  let lastFrame = 0;
  let imageIndex = 0;
  let activeLayer = 0;
  let animationTimer = 0;
  let slideTimer = 0;
  let preloadTimer = 0;
  let switchingImage = false;
  const frameInterval = 1000 / 24;

  const resize = () => {
    viewportWidth = innerWidth;
    viewportHeight = innerHeight;
    stageSize = Math.min(viewportWidth, viewportHeight) * 0.52;
    stage.style.width = `${stageSize}px`;
    stage.style.height = `${stageSize}px`;
    renderer.setSize(stageSize, stageSize, false);
    draw();
  };

  const updateStagePosition = () => {
    const half = stageSize * 0.5;
    const x = Math.max(half, Math.min(viewportWidth - half, followX * viewportWidth));
    const y = Math.max(half, Math.min(viewportHeight - half, followY * viewportHeight));
    stage.style.transform = `translate3d(${x - half}px,${y - half}px,0)`;
  };

  const draw = () => {
    updateStagePosition();
    renderer.render(scene, camera);
  };

  const updateMorph = (now: number) => {
    if (morphProgress >= 1) return;
    morphProgress = Math.min(1, (now - morphStarted) / 500);
    const eased = morphProgress * morphProgress * (3 - 2 * morphProgress);
    mainMaterial.uniforms.morphAmount.value = eased;
    for (let i = 0; i < currentLines.length; i++) currentLines[i] = morphFrom[i] + (morphTo[i] - morphFrom[i]) * eased;
    if (morphProgress === 1) title.textContent = shapes[targetShape].name;
  };

  const setTargetShape = (index: number) => {
    if (index === targetShape) return;
    const mix = morphProgress >= 1 ? 1 : Math.max(0, Math.min(1, (performance.now() - morphStarted) / 500));
    const eased = mix * mix * (3 - 2 * mix);
    for (let i = 0; i < currentLines.length; i++) currentLines[i] = morphFrom[i] + (morphTo[i] - morphFrom[i]) * eased;
    morphFrom.set(currentLines);
    morphTo.set(shapes[index].lines);
    mainGeometry.attributes.morphStart.needsUpdate = true;
    mainGeometry.attributes.morphEnd.needsUpdate = true;
    targetShape = index;
    morphStarted = performance.now();
    morphProgress = reducedMotion ? 1 : 0;
    mainMaterial.uniforms.morphAmount.value = reducedMotion ? 1 : 0;
    if (reducedMotion) {
      currentLines.set(shapes[index].lines);
      title.textContent = shapes[index].name;
      draw();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX / viewportWidth;
    pointerY = event.clientY / viewportHeight;
    setTargetShape(Math.min(shapes.length - 1, Math.floor(pointerX * shapes.length)));
    backgroundField.style.transform = `translate3d(${(0.5 - pointerX) * 34}px,${(0.5 - pointerY) * 24}px,0)`;
    if (reducedMotion) {
      followX = pointerX;
      followY = pointerY;
      draw();
    }
  };

  const animate = (now: number) => {
    if (now - lastFrame < frameInterval) return;
    const delta = Math.min((now - lastFrame) / 1000, 0.06);
    lastFrame = now;
    group.rotation.y += delta * 0.18;
    group.rotation.x = Math.sin(now * 0.00012) * 0.08 + (pointerY - 0.5) * 0.24;
    followX += (pointerX - followX) * 0.11;
    followY += (pointerY - followY) * 0.11;
    updateMorph(now);
    draw();
  };

  const rotateImage = async () => {
    if (switchingImage) return;
    switchingImage = true;
    const nextIndex = (imageIndex + 1) % backgroundUrls.length;
    const nextLayer = 1 - activeLayer;
    const outgoingLayer = activeLayer;
    const incomingImage = imageLayers[nextLayer];
    incomingImage.src = backgroundUrls[nextIndex];
    try {
      await incomingImage.decode();
    } catch {
      switchingImage = false;
      slideTimer = window.setTimeout(rotateImage, 15000);
      return;
    }
    if (document.hidden) {
      switchingImage = false;
      return;
    }
    incomingImage.classList.add('is-active');
    imageLayers[outgoingLayer].classList.remove('is-active');
    activeLayer = nextLayer;
    imageIndex = nextIndex;
    switchingImage = false;
    preloadTimer = window.setTimeout(() => {
      const standby = imageLayers[outgoingLayer];
      standby.src = backgroundUrls[(imageIndex + 1) % backgroundUrls.length];
      standby.decode().catch(() => undefined);
    }, 2000);
    slideTimer = window.setTimeout(rotateImage, 15000);
  };

  const start = () => {
    if (reducedMotion || document.hidden || animationTimer) return;
    lastFrame = performance.now();
    renderer.setAnimationLoop(animate);
    animationTimer = 1;
    if (!slideTimer) slideTimer = window.setTimeout(rotateImage, 15000);
  };

  const stop = () => {
    renderer.setAnimationLoop(null);
    animationTimer = 0;
    window.clearTimeout(slideTimer);
    window.clearTimeout(preloadTimer);
    slideTimer = 0;
    preloadTimer = 0;
  };

  addEventListener('resize', resize);
  addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  resize();
  start();
};

initializeSiteVisuals();
