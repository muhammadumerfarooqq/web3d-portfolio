// Accessible video player for [data-player] figures. Replaces native controls with: play/pause,
// a scrub slider (role="slider", aria-valuetext), time, mute, captions (only when a <track>
// exists) and fullscreen. Keys while focus is in the player: Space/K, ←/→ (±5 s), M, F.
// DOM is built with createElement/textContent only.

const SEEK_STEP = 5;

const formatTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  play: 'M8 5.5v13l11-6.5Z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4.2 4.2 0 0 1 0 6',
  muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  cc: 'M3 6h18v12H3zM10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

function button(className, label, iconName) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `player__btn ${className}`;
  el.setAttribute('aria-label', label);
  el.append(icon(iconName));
  return el;
}

function setIcon(btn, name) {
  btn.replaceChildren(icon(name));
}

/** Enhance one [data-player] figure (idempotent). */
export function initPlayer(figure) {
  if (!figure || figure.dataset.playerReady) return;
  const video = figure.querySelector('video');
  if (!video) return;
  figure.dataset.playerReady = 'true';

  const noAudio = 'noAudio' in figure.dataset;
  video.controls = false;
  video.removeAttribute('controls');
  // Lazy players (the promo film, data-lazy) fetch nothing until play; the rest load metadata.
  if (video.preload === 'none' && !('lazy' in figure.dataset)) video.preload = 'metadata';
  if (noAudio) video.muted = true;

  // ── Controls ──
  const bar = document.createElement('div');
  bar.className = 'player__controls';

  const big = button('player__big', 'Play video', 'play');
  const play = button('player__play', 'Play', 'play');

  const slider = document.createElement('div');
  slider.className = 'player__scrub';
  slider.tabIndex = 0;
  slider.setAttribute('role', 'slider');
  slider.setAttribute('aria-label', 'Seek');
  slider.setAttribute('aria-valuemin', '0');
  slider.setAttribute('aria-valuemax', '0');
  slider.setAttribute('aria-valuenow', '0');
  slider.setAttribute('aria-valuetext', 'Loading video');
  const track = document.createElement('span');
  track.className = 'player__track';
  const fill = document.createElement('span');
  fill.className = 'player__fill';
  const thumb = document.createElement('span');
  thumb.className = 'player__thumb';
  track.append(fill, thumb);
  slider.append(track);

  const time = document.createElement('span');
  time.className = 'player__time';
  time.setAttribute('aria-hidden', 'true');
  time.textContent = '0:00 / 0:00';

  const mute = noAudio ? null : button('player__mute', 'Mute', video.muted ? 'muted' : 'volume');
  const hasTracks = video.querySelectorAll('track').length > 0;
  const captions = hasTracks ? button('player__cc', 'Captions', 'cc') : null;
  const fullscreen = button('player__fs', 'Full screen', 'expand');

  bar.append(play, slider, time, ...[mute, captions].filter(Boolean), fullscreen);
  figure.querySelector('.player__frame')?.append(big, bar);
  figure.classList.add('is-enhanced');

  // ── State ──
  let duration = 0;
  const syncTime = () => {
    const t = video.currentTime;
    const ratio = duration ? Math.min(1, t / duration) : 0;
    fill.style.transform = `scaleX(${ratio})`;
    thumb.style.transform = `translateX(${ratio * 100}cqi)`;
    time.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    slider.setAttribute('aria-valuenow', String(Math.round(t)));
    slider.setAttribute('aria-valuetext', `${formatTime(t)} of ${formatTime(duration)}`);
  };
  const onMetadata = () => {
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    slider.setAttribute('aria-valuemax', String(Math.round(duration)));
    syncTime();
  };
  // Metadata race: it may already be loaded (cached or preloaded) before we attach the listener.
  if (video.readyState >= 1) onMetadata();
  else video.addEventListener('loadedmetadata', onMetadata, { once: true });
  video.addEventListener('durationchange', onMetadata);
  video.addEventListener('timeupdate', syncTime);

  const syncPlay = () => {
    const playing = !video.paused && !video.ended;
    setIcon(play, playing ? 'pause' : 'play');
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    figure.classList.toggle('is-playing', playing);
  };
  video.addEventListener('play', syncPlay);
  video.addEventListener('pause', syncPlay);
  video.addEventListener('ended', syncPlay);

  const toggle = () => (video.paused || video.ended ? video.play().catch(() => {}) : video.pause());
  const seek = (t) => {
    video.currentTime = Math.max(0, Math.min(duration || video.duration || 0, t));
    syncTime();
  };
  const toggleMute = () => {
    if (!mute) return;
    video.muted = !video.muted;
    setIcon(mute, video.muted ? 'muted' : 'volume');
    mute.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else figure.requestFullscreen?.().catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === figure;
    fullscreen.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  });

  if (mute) {
    mute.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
    mute.addEventListener('click', toggleMute);
  }
  if (captions) {
    const tracks = [...video.textTracks];
    for (const t of tracks) t.mode = 'hidden';
    captions.setAttribute('aria-pressed', 'false');
    captions.addEventListener('click', () => {
      const on = captions.getAttribute('aria-pressed') !== 'true';
      tracks.forEach((t, i) => {
        t.mode = on && i === 0 ? 'showing' : 'hidden';
      });
      captions.setAttribute('aria-pressed', String(on));
    });
  }
  play.addEventListener('click', toggle);
  big.addEventListener('click', () => {
    toggle();
    play.focus();
  });
  video.addEventListener('click', toggle);
  fullscreen.addEventListener('click', toggleFullscreen);

  // Pointer scrubbing
  const seekFromPointer = (event) => {
    const rect = track.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * (duration || 0));
  };
  slider.addEventListener('pointerdown', (event) => {
    slider.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  });
  slider.addEventListener('pointermove', (event) => {
    if (slider.hasPointerCapture(event.pointerId)) seekFromPointer(event);
  });

  // Keyboard
  figure.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const onButton = event.target instanceof HTMLButtonElement;
    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        if (event.key === ' ' && onButton) return; // the button's own click handles Space
        event.preventDefault();
        toggle();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        seek(video.currentTime - SEEK_STEP);
        break;
      case 'ArrowRight':
        event.preventDefault();
        seek(video.currentTime + SEEK_STEP);
        break;
      case 'Home':
        if (event.target === slider) {
          event.preventDefault();
          seek(0);
        }
        break;
      case 'End':
        if (event.target === slider) {
          event.preventDefault();
          seek(duration);
        }
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      default:
    }
  });

  syncPlay();
}

/** Stop playback (e.g. when a modal closes). */
export function pausePlayers(root) {
  for (const v of root.querySelectorAll('video')) v.pause();
}
