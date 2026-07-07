(function (Scratch) {
  'use strict';
  if (!Scratch.extensions.unsandboxed) {
    throw new Error('youtube-player must be loaded unsandboxed');
  }

  const vm = Scratch.vm;

  const HEX_BYTE = new Array(256);
  for (let i = 0; i < 256; i++) HEX_BYTE[i] = i.toString(16).padStart(2, '0');

  class YouTubePlayer {
    constructor() {
      this.player = null;
      this.apiReady = false;
      this.pendingId = null;
      this.ended = false;
      this.loop = false;
      this._loadAPI();
      this._buildOverlay();
    }

    _loadAPI() {
      if (window.YT && window.YT.Player) {
        this.apiReady = true;
        return;
      }
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCb === 'function') prevCb();
        this.apiReady = true;
        if (this.pendingId) {
          this._createPlayer(this.pendingId);
          this.pendingId = null;
        }
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    }

    _buildOverlay() {
      const canvas = vm.runtime.renderer.canvas;
      const parent = canvas.parentElement;
      if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      const div = document.createElement('div');
      div.id = 'yt-ext-overlay';
      div.style.position = 'absolute';
      div.style.pointerEvents = 'none';
      div.style.zIndex = '1000';
      div.style.opacity = '0';
      div.style.transition = 'opacity 0.1s linear';
      parent.appendChild(div);
      this.container = div;

      const sync = () => {
        const c = canvas.getBoundingClientRect();
        const p = parent.getBoundingClientRect();
        div.style.left = (c.left - p.left) + 'px';
        div.style.top = (c.top - p.top) + 'px';
        div.style.width = c.width + 'px';
        div.style.height = c.height + 'px';
        requestAnimationFrame(sync);
      };
      sync();
    }

    extractId(url) {
      const m = String(url).match(
        /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/
      );
      return m ? m[1] : String(url).trim();
    }

    _createPlayer(videoId) {
      this.container.innerHTML = '<div id="yt-ext-inner" style="width:100%;height:100%"></div>';
      this.player = new YT.Player('yt-ext-inner', {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          cc_load_policy: 0,
          iv_load_policy: 3,
          disablekb: 1,
          fs: 0,
          origin: window.location.origin
        },
        events: {
          onReady: (e) => {
            e.target.playVideo();
            // belt-and-braces: cc_load_policy only sets the default,
            // this forces captions off even if a channel forces them on
            if (typeof e.target.unloadModule === 'function') {
              e.target.unloadModule('captions');
            }
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              if (this.loop) {
                e.target.seekTo(0, true);
                e.target.playVideo();
              } else {
                this.ended = true;
              }
            }
          }
        }
      });
    }

    load(url) {
      const id = this.extractId(url);
      this.ended = false;
      if (!this.apiReady) {
        this.pendingId = id;
        return;
      }
      if (this.player && this.player.loadVideoById) {
        this.player.loadVideoById(id);
      } else {
        this._createPlayer(id);
      }
    }

    setVisible(v) {
      this.container.style.opacity = v ? '1' : '0';
    }

    whenReady(fn) {
      const check = () => {
        if (this.player && this.player.unMute) fn();
        else setTimeout(check, 100);
      };
      check();
    }
  }

  class YouTubeBlocks {
    constructor() {
      this.yt = new YouTubePlayer();
      this.captureStream = null;
      this.captureVideo = null;
      this.sampleCanvas = null;
      this.sampleCtx = null;
      this._liveTimer = null;
      this._liveUtil = null;
      this._liveCols = 24;
      this._scanlinesOn = false;
      this._field = 0;
      this._persistence = 0;
      this._needsClear = true;
      // best-effort: make sure Pen's primitives exist without forcing the user
      // to manually add the Pen extension first
      if (vm.extensionManager && !vm.extensionManager.isExtensionLoaded('pen')) {
        vm.extensionManager.loadExtensionURL('pen').catch(() => {});
      }
    }

    getInfo() {
      return {
        id: 'youtubeplayer',
        name: 'YouTube Player',
        blocks: [
          {
            opcode: 'playVideo',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play video only (muted) [URL]',
            arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://youtu.be/dQw4w9WgXcQ' } }
          },
          {
            opcode: 'playAudio',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play audio only (hidden) [URL]',
            arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://youtu.be/dQw4w9WgXcQ' } }
          },
          {
            opcode: 'playBoth',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play video + audio [URL]',
            arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://youtu.be/dQw4w9WgXcQ' } }
          },
          '---',
          { opcode: 'pause', blockType: Scratch.BlockType.COMMAND, text: 'pause' },
          { opcode: 'resume', blockType: Scratch.BlockType.COMMAND, text: 'resume' },
          { opcode: 'stopPlayback', blockType: Scratch.BlockType.COMMAND, text: 'stop' },
          {
            opcode: 'seekTo',
            blockType: Scratch.BlockType.COMMAND,
            text: 'seek to [SECONDS] seconds',
            arguments: { SECONDS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } }
          },
          {
            opcode: 'setVolume',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set volume to [PCT] %',
            arguments: { PCT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 } }
          },
          {
            opcode: 'showHide',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set video visibility to [STATE]',
            arguments: {
              STATE: { type: Scratch.ArgumentType.STRING, menu: 'visMenu', defaultValue: 'visible' }
            }
          },
          {
            opcode: 'setLoop',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set loop to [STATE]',
            arguments: {
              STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOffMenu', defaultValue: 'on' }
            }
          },
          { opcode: 'isLooping', blockType: Scratch.BlockType.BOOLEAN, text: 'is loop on?' },
          '---',
          { opcode: 'currentTime', blockType: Scratch.BlockType.REPORTER, text: 'current time (s)' },
          { opcode: 'duration', blockType: Scratch.BlockType.REPORTER, text: 'duration (s)' },
          { opcode: 'isPlaying', blockType: Scratch.BlockType.BOOLEAN, text: 'is playing?' },
          { opcode: 'hasEnded', blockType: Scratch.BlockType.BOOLEAN, text: 'has ended?' },
          '---',
          { opcode: 'startCapture', blockType: Scratch.BlockType.COMMAND, text: 'start screen capture (pick a DIFFERENT tab/window, not this one!)' },
          { opcode: 'stopCapture', blockType: Scratch.BlockType.COMMAND, text: 'stop screen capture' },
          { opcode: 'isCapturing', blockType: Scratch.BlockType.BOOLEAN, text: 'is capturing?' },
          {
            opcode: 'drawFrame',
            blockType: Scratch.BlockType.COMMAND,
            text: 'draw current frame with pen (columns [COLS])',
            arguments: { COLS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 24 } }
          },
          {
            opcode: 'drawThumbnail',
            blockType: Scratch.BlockType.COMMAND,
            text: 'draw thumbnail of [URL] with pen (columns [COLS]) — no capture needed',
            arguments: {
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://youtu.be/dQw4w9WgXcQ' },
              COLS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 24 }
            }
          },
          {
            opcode: 'startLiveDraw',
            blockType: Scratch.BlockType.COMMAND,
            text: 'start real-time pen drawing (columns [COLS], fps [FPS])',
            arguments: {
              COLS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 24 },
              FPS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 8 }
            }
          },
          { opcode: 'stopLiveDraw', blockType: Scratch.BlockType.COMMAND, text: 'stop real-time pen drawing' },
          { opcode: 'isLiveDrawing', blockType: Scratch.BlockType.BOOLEAN, text: 'is real-time drawing running?' },
          {
            opcode: 'setScanlines',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set CRT scanlines to [STATE]',
            arguments: {
              STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOffMenu', defaultValue: 'on' }
            }
          },
          { opcode: 'isScanlines', blockType: Scratch.BlockType.BOOLEAN, text: 'are scanlines on?' },
          {
            opcode: 'setPersistence',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set phosphor persistence to [PCT] % (0 = instant clear)',
            arguments: { PCT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } }
          },
          { opcode: 'clearPenFrame', blockType: Scratch.BlockType.COMMAND, text: 'clear pen frame' }
        ],
        menus: {
          visMenu: { acceptReporters: true, items: ['visible', 'hidden'] },
          onOffMenu: { acceptReporters: true, items: ['on', 'off'] }
        }
      };
    }

    playVideo(args) {
      this.yt.setVisible(true);
      this.yt.load(args.URL);
      this.yt.whenReady(() => this.yt.player.mute());
    }

    playAudio(args) {
      this.yt.setVisible(false);
      this.yt.load(args.URL);
      this.yt.whenReady(() => this.yt.player.unMute());
    }

    playBoth(args) {
      this.yt.setVisible(true);
      this.yt.load(args.URL);
      this.yt.whenReady(() => this.yt.player.unMute());
    }

    pause() { this.yt.player?.pauseVideo?.(); }
    resume() { this.yt.player?.playVideo?.(); }
    stopPlayback() { this.yt.player?.stopVideo?.(); }
    seekTo(args) { this.yt.player?.seekTo?.(Number(args.SECONDS), true); }
    setVolume(args) { this.yt.player?.setVolume?.(Math.max(0, Math.min(100, Number(args.PCT)))); }
    showHide(args) { this.yt.setVisible(args.STATE === 'visible'); }
    setLoop(args) { this.yt.loop = args.STATE === 'on'; }
    isLooping() { return this.yt.loop; }

    currentTime() { return this.yt.player?.getCurrentTime?.() ?? 0; }
    duration() { return this.yt.player?.getDuration?.() ?? 0; }
    isPlaying() { return this.yt.player?.getPlayerState?.() === 1; }
    hasEnded() { return this.yt.ended; }

    async startCapture() {
      if (this.captureStream) return;
      try {
        this.captureStream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'browser' },
          audio: false
        });
      } catch (e) {
        console.warn('[youtubeplayer] screen capture denied or cancelled:', e);
        this.captureStream = null;
        return;
      }
      this.captureVideo = document.createElement('video');
      this.captureVideo.srcObject = this.captureStream;
      this.captureVideo.muted = true;
      await this.captureVideo.play();
      console.warn(
        '[youtubeplayer] reminder: if you picked THIS tab, every capture will include ' +
        'your own last pen drawing (feedback loop) — pick a separate tab/window instead.'
      );
      const track = this.captureStream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          this.captureStream = null;
          this.captureVideo = null;
        };
      }
    }

    stopCapture() {
      this.stopLiveDraw();
      this.captureStream?.getTracks().forEach((t) => t.stop());
      this.captureStream = null;
      this.captureVideo = null;
    }

    isCapturing() {
      return !!this.captureStream;
    }

    drawFrame(args, util) {
      if (!this.captureVideo) {
        console.warn('[youtubeplayer] call "start screen capture" first');
        return;
      }
      this._drawSourceWithPen(this.captureVideo, args.COLS, util);
    }

    async drawThumbnail(args, util) {
      const id = this.yt.extractId(args.URL);
      let img;
      try {
        img = await this._loadImage(`https://img.youtube.com/vi/${id}/hqdefault.jpg`);
      } catch (e) {
        console.warn('[youtubeplayer] could not load thumbnail (bad URL or network):', e);
        return;
      }
      this._drawSourceWithPen(img, args.COLS, util);
    }

    _loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    _drawSourceWithPen(source, colsArg, util) {
      const primitives = vm.runtime._primitives;
      if (!primitives.pen_penDown) {
        console.warn('[youtubeplayer] Pen extension not loaded yet');
        return;
      }

      const cols = Math.max(2, Math.min(1000, Math.round(Number(colsArg) || 24)));
      const stageW = vm.runtime.stageWidth || 480;
      const stageH = vm.runtime.stageHeight || 360;
      const rows = Math.max(2, Math.round(cols * (stageH / stageW)));

      if (!this.sampleCanvas) {
        this.sampleCanvas = document.createElement('canvas');
        this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
      }
      this.sampleCanvas.width = cols;
      this.sampleCanvas.height = rows;
      this.sampleCtx.drawImage(source, 0, 0, cols, rows);

      let data;
      try {
        data = this.sampleCtx.getImageData(0, 0, cols, rows).data;
      } catch (e) {
        console.warn('[youtubeplayer] frame read blocked (CORS):', e);
        return;
      }

      const cellW = stageW / cols;
      const cellH = stageH / rows;
      const dotSize = Math.sqrt(cellW * cellW + cellH * cellH) * 1.15;

      const field = this._field;
      if (!this._scanlinesOn) {
        this._washFrame(primitives, util, stageW, stageH);
      } else if (this._needsClear) {
        this._washFrame(primitives, util, stageW, stageH);
        this._needsClear = false;
      }
      primitives.pen_penUp(null, util);
      primitives.pen_setPenSizeTo({ SIZE: dotSize }, util);

      // subtle frame-to-frame brightness instability, like an unregulated CRT beam
      const flicker = this._scanlinesOn ? 0.92 + Math.random() * 0.08 : 1;
      const CURVE_K = 0.18; // barrel curvature strength
      const CURVE_NORM = 1 + CURVE_K * 2; // normalizes corners back to the frame edge
      const VIGNETTE_STRENGTH = 0.35;
      const QUANT = 16; // color bucket size — lets near-identical cells merge into one run

      const colX = (col) => -stageW / 2 + cellW * (col + 0.5);
      const colY = (row) => stageH / 2 - cellH * (row + 0.5);
      // in curved mode, a run this long or longer gets forcibly split, so a straight
      // line segment never has to stand in for too much of the true curve at once
      const MAX_RUN = this._scanlinesOn ? Math.max(2, Math.ceil(cols / 12)) : Infinity;

      for (let row = 0; row < rows; row++) {
        if (this._scanlinesOn && row % 2 !== field) continue;

        let runStart = -1;
        let runHex = null;

        const flushRun = (endColExclusive) => {
          if (runStart === -1) return;
          const startCol = runStart;
          const endCol = endColExclusive - 1;
          let xStart, xEnd, yStart, yEnd;
          if (this._scanlinesOn) {
            const nyRow = ((row + 0.5) / rows) * 2 - 1;
            const nxS = ((startCol + 0.5) / cols) * 2 - 1;
            const nxE = ((endCol + 0.5) / cols) * 2 - 1;
            const r2S = nxS * nxS + nyRow * nyRow;
            const r2E = nxE * nxE + nyRow * nyRow;
            const cfS = (1 + CURVE_K * r2S) / CURVE_NORM;
            const cfE = (1 + CURVE_K * r2E) / CURVE_NORM;
            xStart = nxS * cfS * (stageW / 2);
            xEnd = nxE * cfE * (stageW / 2);
            yStart = -nyRow * cfS * (stageH / 2);
            yEnd = -nyRow * cfE * (stageH / 2);
          } else {
            xStart = colX(startCol);
            xEnd = colX(endCol);
            yStart = yEnd = colY(row);
          }
          util.target.setXY(xStart, yStart, true);
          primitives.pen_setPenColorToColor({ COLOR: runHex }, util);
          primitives.pen_penDown(null, util);
          util.target.setXY(xEnd, yEnd, true);
          primitives.pen_penUp(null, util);
          runStart = -1;
          runHex = null;
        };

        for (let col = 0; col < cols; col++) {
          const i = (row * cols + col) * 4;
          const a = data[i + 3];

          let hex = null;
          if (a >= 10) {
            let r = data[i], g = data[i + 1], b = data[i + 2];
            if (this._scanlinesOn) {
              const nx = ((col + 0.5) / cols) * 2 - 1;
              const ny = ((row + 0.5) / rows) * 2 - 1;
              const r2 = nx * nx + ny * ny;
              const vignette = (1 - VIGNETTE_STRENGTH * (r2 / 2)) * flicker;
              r *= vignette; g *= vignette; b *= vignette;
            }
            hex = this._rgbToHex(
              Math.round(r / QUANT) * QUANT,
              Math.round(g / QUANT) * QUANT,
              Math.round(b / QUANT) * QUANT
            );
          }

          if (hex !== runHex || (col - runStart) >= MAX_RUN) {
            flushRun(col);
            if (hex !== null) {
              runStart = col;
              runHex = hex;
            }
          }
        }
        flushRun(cols);
      }

      if (this._scanlinesOn) {
        this._field = 1 - field;
      }
    }

    startLiveDraw(args, util) {
      this.stopLiveDraw();
      this._liveUtil = util;
      this._liveCols = Number(args.COLS) || 24;
      this._needsClear = true;
      const fps = Math.max(1, Math.min(30, Number(args.FPS) || 8));
      this._liveTimer = setInterval(() => {
        if (!this.captureVideo) return;
        this._drawSourceWithPen(this.captureVideo, this._liveCols, this._liveUtil);
      }, 1000 / fps);
    }

    stopLiveDraw() {
      if (this._liveTimer) {
        clearInterval(this._liveTimer);
        this._liveTimer = null;
      }
    }

    isLiveDrawing() {
      return this._liveTimer !== null;
    }

    setScanlines(args) {
      this._scanlinesOn = args.STATE === 'on';
      this._field = 0;
      this._needsClear = true;
    }

    isScanlines() {
      return this._scanlinesOn;
    }

    setPersistence(args) {
      this._persistence = Math.max(0, Math.min(99, Number(args.PCT) || 0));
    }

    _washFrame(primitives, util, stageW, stageH) {
      if (this._persistence <= 0) {
        primitives.pen_clear(null, util);
        return;
      }
      // draw one thick translucent black bar across the whole stage instead of
      // clearing — old pen content fades rather than cutting instantly, like
      // phosphor decay. transparency param: 0 = opaque wash (full clear),
      // 100 = invisible wash (infinite trail) — persistence maps directly.
      primitives.pen_penUp(null, util);
      primitives.pen_setPenSizeTo({ SIZE: stageH * 1.1 }, util);
      primitives.pen_setPenColorToColor({ COLOR: '#000000' }, util);
      primitives.pen_setPenColorParamTo({ COLOR_PARAM: 'transparency', VALUE: this._persistence }, util);
      util.target.setXY(-stageW / 2, 0, true);
      primitives.pen_penDown(null, util);
      util.target.setXY(stageW / 2, 0, true);
      primitives.pen_penUp(null, util);
      // reset transparency so subsequent dot colors aren't accidentally translucent
      primitives.pen_setPenColorParamTo({ COLOR_PARAM: 'transparency', VALUE: 0 }, util);
    }

    clearPenFrame(args, util) {
      vm.runtime._primitives.pen_clear?.(null, util);
    }

    _rgbToHex(r, g, b) {
      const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
      return '#' + HEX_BYTE[clamp(r)] + HEX_BYTE[clamp(g)] + HEX_BYTE[clamp(b)];
    }
  }

  Scratch.extensions.register(new YouTubeBlocks());
})(Scratch);
