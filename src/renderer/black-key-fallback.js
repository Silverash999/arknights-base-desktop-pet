/*
 * Fallback for the older black-background WebM files.
 *
 * The normal path now uses the PRTS Spine model files, whose texture PNGs
 * have genuine alpha.  This code is deliberately kept for offline recovery:
 * if a packaged Spine asset cannot load, the original WebM is rendered here
 * and only near-pure-black pixels are made transparent.
 */
(function () {
  function makeBlackKeyFallback(source, label, facing, applyFacing) {
    const canvas = document.createElement('canvas');
    // This is a compatibility-only path. Keeping the work canvas at display
    // resolution avoids two million-pixel readbacks every animation frame.
    canvas.width = 430;
    canvas.height = 430;
    canvas.className = 'black-key-fallback';
    canvas.setAttribute('aria-label', label);
    applyFacing(canvas, facing);

    const context = canvas.getContext('2d', { willReadFrequently: true });
    const video = document.createElement('video');
    video.src = source;
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';

    let stopped = false;
    const scheduleFrame = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(draw);
      } else {
        setTimeout(draw, 33);
      }
    };
    const draw = () => {
      if (stopped) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;

        // Intentionally conservative: do not eat dark clothing or outlines.
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] <= 3 && pixels[index + 1] <= 3 && pixels[index + 2] <= 3) {
            pixels[index + 3] = 0;
          }
        }
        context.putImageData(imageData, 0, 0);
      }
      scheduleFrame();
    };

    video.addEventListener('error', () => {
      stopped = true;
      canvas.replaceWith(Object.assign(document.createElement('img'), {
        src: source.replace(/-[^-]+\\.webm$/i, 'default.png'),
        alt: `${label}（备用动画无法播放）`,
        draggable: false
      }));
    }, { once: true });
    video.play().catch(() => {});
    scheduleFrame();

    return {
      element: canvas,
      dispose() {
        stopped = true;
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }

  window.makeBlackKeyFallback = makeBlackKeyFallback;
}());
