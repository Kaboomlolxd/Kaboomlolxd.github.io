const canvas = document.querySelector<HTMLCanvasElement>('.geometry-canvas');
const context = canvas?.getContext('2d');
const backgroundField = document.querySelector<HTMLElement>('.background-image-field');
const imageLayers = [...document.querySelectorAll<HTMLImageElement>('.background-image')];

if (canvas && context && backgroundField && imageLayers.length) {
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
    for (let from = 0; from < reference.length; from += 6) {
      for (let to = 0; to < candidate.length; to += 6) {
        const forward =
          distance(Array.from(reference.slice(from, from + 3)), Array.from(candidate.slice(to, to + 3))) +
          distance(Array.from(reference.slice(from + 3, from + 6)), Array.from(candidate.slice(to + 3, to + 6)));
        const reverse =
          distance(Array.from(reference.slice(from, from + 3)), Array.from(candidate.slice(to + 3, to + 6))) +
          distance(Array.from(reference.slice(from + 3, from + 6)), Array.from(candidate.slice(to, to + 3)));
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

  let width = 0;
  let height = 0;
  let canvasSize = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;
  let followX = 0.5;
  let followY = 0.5;
  let rotation = 0;
  let lastFrame = 0;
  let animationFrame = 0;
  let activeShape = Math.floor(shapes.length / 2);
  let targetShape = activeShape;
  let morphStarted = 0;
  let morphProgress = 1;
  let imageIndex = 0;
  let imageTimer = 0;
  const morphFrom = shapes[activeShape].lines.slice();
  const currentLines = morphFrom.slice();

  const setTargetShape = (index: number) => {
    if (index === targetShape) return;
    morphFrom.set(currentLines);
    targetShape = index;
    morphStarted = performance.now();
    morphProgress = reducedMotion ? 1 : 0;
    if (reducedMotion) {
      currentLines.set(shapes[index].lines);
      activeShape = index;
    }
  };

  const updateParallax = () => {
    const x = `${(0.5 - pointerX) * 34}px`;
    const y = `${(0.5 - pointerY) * 24}px`;
    backgroundField.style.transform = `translate3d(${x},${y},0)`;
  };

  const resize = () => {
    width = innerWidth;
    height = innerHeight;
    canvasSize = Math.min(width, height) * 0.52;
    const pixelRatio = Math.min(devicePixelRatio || 1, 0.8);
    canvas.width = Math.round(canvasSize * pixelRatio);
    canvas.height = Math.round(canvasSize * pixelRatio);
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw();
  };

  const project = (x: number, y: number, z: number, cx: number, cy: number, radius: number, cosY: number, sinY: number, cosX: number, sinX: number) => {
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    const y1 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;
    const perspective = 4.8 / (4.8 + z2 * 0.16);
    return [cx + x1 * radius * perspective, cy + y1 * radius * perspective, z2];
  };

  const projectPoint = (point: number[], cx: number, cy: number, radius: number, rotationY: number, rotationX: number) =>
    project(point[0], point[1], point[2], cx, cy, radius, Math.cos(rotationY), Math.sin(rotationY), Math.cos(rotationX), Math.sin(rotationX));

  const drawLines = (lines: Float32Array, cx: number, cy: number, radius: number, rotationY: number, rotationX: number) => {
    const cosY = Math.cos(rotationY);
    const sinY = Math.sin(rotationY);
    const cosX = Math.cos(rotationX);
    const sinX = Math.sin(rotationX);
    context!.beginPath();
    for (let i = 0; i < lines.length; i += 6) {
      const a = project(lines[i], lines[i + 1], lines[i + 2], cx, cy, radius, cosY, sinY, cosX, sinX);
      const b = project(lines[i + 3], lines[i + 4], lines[i + 5], cx, cy, radius, cosY, sinY, cosX, sinX);
      context!.moveTo(a[0], a[1]);
      context!.lineTo(b[0], b[1]);
    }
    context!.stroke();
  };

  const drawDepthCircles = (cx: number, cy: number, radius: number, rotationY: number, rotationX: number) => {
    const cosY = Math.cos(rotationY);
    const sinY = Math.sin(rotationY);
    const cosX = Math.cos(rotationX);
    const sinX = Math.sin(rotationX);
    const circles = metatronPoints.map((center, index) => {
      const normal = [center[0] * 0.58 + 0.18, center[1] * 0.58 - 0.12, 0.78];
      const normalLength = Math.hypot(...normal);
      for (let i = 0; i < 3; i++) normal[i] /= normalLength;
      let u = [-normal[1], normal[0], 0];
      if (Math.hypot(...u) < 0.01) u = [1, 0, 0];
      const uLength = Math.hypot(...u);
      u = u.map((value) => value / uLength);
      const v = [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]];
      const projected = [];
      for (let step = 0; step <= 40; step++) {
        const angle = (step / 40) * Math.PI * 2;
        const px = center[0] + (u[0] * Math.cos(angle) + v[0] * Math.sin(angle)) * 0.25;
        const py = center[1] + (u[1] * Math.cos(angle) + v[1] * Math.sin(angle)) * 0.25;
        const pz = center[2] + (u[2] * Math.cos(angle) + v[2] * Math.sin(angle)) * 0.25;
        projected.push(project(px, py, pz, cx, cy, radius, cosY, sinY, cosX, sinX));
      }
      return { index, projected };
    });

    for (const front of [false, true]) {
      context!.beginPath();
      for (const circle of circles) {
        for (let i = 0; i < circle.projected.length - 1; i++) {
          const a = circle.projected[i];
          const b = circle.projected[i + 1];
          if ((a[2] < 0) !== front && (b[2] < 0) !== front) continue;
          context!.moveTo(a[0], a[1]);
          context!.lineTo(b[0], b[1]);
        }
      }
      context!.strokeStyle = front ? 'rgba(232,242,255,.58)' : 'rgba(126,159,205,.19)';
      context!.lineWidth = front ? 1 : 0.78;
      context!.stroke();
    }
  };

  const draw = () => {
    if (!width || !canvasSize) return;
    const minSide = Math.min(width, height);
    const cx = canvasSize * 0.5;
    const cy = canvasSize * 0.5;
    const radius = minSide * 0.15;
    const x = Math.max(radius * 1.3, Math.min(width - radius * 1.3, followX * width));
    const y = Math.max(radius * 1.5, Math.min(height - radius * 1.5, followY * height));
    canvas.style.transform = `translate3d(${x - cx}px,${y - cy}px,0)`;
    context!.clearRect(0, 0, canvasSize, canvasSize);

    const rotationY = rotation + (pointerX - 0.5) * 0.2;
    const rotationX = Math.sin(rotation * 0.58) * 0.06 + (pointerY - 0.5) * 0.22;
    drawDepthCircles(cx, cy, radius, rotationY, rotationX);

    context!.beginPath();
    for (let i = 0; i < metatronPoints.length; i++) {
      for (let j = i + 1; j < metatronPoints.length; j++) {
        const a = projectPoint(metatronPoints[i], cx, cy, radius, rotationY, rotationX);
        const b = projectPoint(metatronPoints[j], cx, cy, radius, rotationY, rotationX);
        context!.moveTo(a[0], a[1]);
        context!.lineTo(b[0], b[1]);
      }
    }
    context!.strokeStyle = 'rgba(255,255,255,.12)';
    context!.lineWidth = 0.8;
    context!.stroke();

    context!.strokeStyle = 'rgba(255,255,255,.84)';
    context!.lineWidth = 1.35;
    drawLines(currentLines, cx, cy, radius, rotationY, rotationX);

    const nodes = metatronPoints
      .map((point) => projectPoint(point, cx, cy, radius, rotationY, rotationX))
      .sort((a, b) => b[2] - a[2]);
    for (const [xNode, yNode, depth] of nodes) {
      const size = 2.7 + Math.max(-0.5, depth) * 1.5;
      const sphere = context!.createRadialGradient(xNode - size * 0.38, yNode - size * 0.4, 0.2, xNode, yNode, size);
      sphere.addColorStop(0, 'rgba(255,255,255,.98)');
      sphere.addColorStop(0.28, 'rgba(198,222,255,.82)');
      sphere.addColorStop(0.68, 'rgba(84,132,198,.58)');
      sphere.addColorStop(1, 'rgba(15,29,54,.2)');
      context!.fillStyle = sphere;
      context!.beginPath();
      context!.arc(xNode, yNode, size, 0, Math.PI * 2);
      context!.fill();
    }

    context!.fillStyle = 'rgba(255,255,255,.66)';
    context!.font = `500 ${Math.max(10, Math.min(13, minSide * 0.016))}px system-ui,sans-serif`;
    context!.textAlign = 'center';
    context!.fillText(shapes[activeShape].name.toUpperCase(), cx, cy + radius * 1.34);
  };

  const updateMorph = (now: number) => {
    if (morphProgress >= 1) return;
    morphProgress = Math.min(1, (now - morphStarted) / 500);
    const eased = morphProgress * morphProgress * (3 - 2 * morphProgress);
    const target = shapes[targetShape].lines;
    for (let i = 0; i < currentLines.length; i++) currentLines[i] = morphFrom[i] + (target[i] - morphFrom[i]) * eased;
    if (morphProgress === 1) activeShape = targetShape;
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX / innerWidth;
    pointerY = event.clientY / innerHeight;
    setTargetShape(Math.min(shapes.length - 1, Math.floor(pointerX * shapes.length)));
    updateParallax();
    if (reducedMotion) {
      followX = pointerX;
      followY = pointerY;
      draw();
    }
  };

  const animate = (now: number) => {
    if (document.hidden) {
      animationFrame = 0;
      return;
    }
    if (now - lastFrame > 40) {
      const delta = Math.min((now - lastFrame) / 1000, 0.06);
      lastFrame = now;
      rotation += delta * 0.18;
      followX += (pointerX - followX) * 0.11;
      followY += (pointerY - followY) * 0.11;
      updateMorph(now);
      draw();
    }
    animationFrame = requestAnimationFrame(animate);
  };

  const rotateImage = () => {
    imageLayers[imageIndex].classList.remove('is-active');
    imageIndex = (imageIndex + 1) % imageLayers.length;
    imageLayers[imageIndex].classList.add('is-active');
  };

  const start = () => {
    if (!reducedMotion && !animationFrame && !document.hidden) animationFrame = requestAnimationFrame(animate);
    if (!reducedMotion && !imageTimer) imageTimer = window.setInterval(rotateImage, 15000);
  };
  const stop = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (imageTimer) window.clearInterval(imageTimer);
    animationFrame = 0;
    imageTimer = 0;
  };

  addEventListener('resize', resize);
  addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  updateParallax();
  resize();
  start();
}
