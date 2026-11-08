const backgroundField = document.querySelector<HTMLElement>('.background-image-field');
const imageLayers = [...document.querySelectorAll<HTMLImageElement>('.background-image')];
const backgroundUrls = backgroundField?.dataset.backgrounds?.split('|') ?? [];

if (backgroundField && imageLayers.length === 2 && backgroundUrls.length > 1) {
  let imageIndex = 0;
  let activeLayer = 0;
  let timer = 0;
  let preloadTimer = 0;
  let pointerFrame = 0;
  let switchingImage = false;

  const updateParallax = (pointerX: number, pointerY: number) => {
    pointerFrame = 0;
    const x = (0.5 - pointerX) * 34;
    const y = (0.5 - pointerY) * 24;
    backgroundField.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const rotateImage = async () => {
    if (switchingImage || document.hidden) return;
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
      timer = window.setTimeout(rotateImage, 15000);
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
    timer = window.setTimeout(rotateImage, 15000);
  };

  const start = () => {
    if (document.hidden || timer) return;
    timer = window.setTimeout(rotateImage, 15000);
  };

  const stop = () => {
    window.clearTimeout(timer);
    window.clearTimeout(preloadTimer);
    timer = 0;
    preloadTimer = 0;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
  };

  addEventListener('pointermove', (event) => {
    if (pointerFrame) return;
    const pointerX = event.clientX / innerWidth;
    const pointerY = event.clientY / innerHeight;
    pointerFrame = requestAnimationFrame(() => updateParallax(pointerX, pointerY));
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
}
