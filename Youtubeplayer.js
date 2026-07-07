(function (Scratch) {
  'use strict';
  if (!Scratch.extensions.unsandboxed) {
    throw new Error('youtube-player must be loaded unsandboxed');
  }

  const vm = Scratch.vm;

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
          { opcode: 'hasEnded', blockType: Scratch.BlockType.BOOLEAN, text: 'has ended?' }
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
  }

  Scratch.extensions.register(new YouTubeBlocks());
})(Scratch);
