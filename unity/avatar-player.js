class AvatarPlayer {
  constructor(container, options = {}) {
    this.container = container;
    this.avatarUrl = options.avatarUrl || 'https://tafahom.io/avatar-bridge.html';
    this.unityReady = false;
    this.iframe = null;
    this.pendingAnimations = null;
    this._readyCallbacks = [];
    this._init();
  }

  _init() {
    this.iframe = document.createElement('iframe');
    this.iframe.src = this.avatarUrl;
    this.iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:inherit;';
    this.iframe.allow = 'autoplay; fullscreen';
    this.iframe.title = 'Tafahom Sign Language Avatar';
    this.container.appendChild(this.iframe);

    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'UNITY_READY' && event.data.source === 'tafahom-avatar') {
        this.unityReady = true;
        this._readyCallbacks.forEach((cb) => cb());
        this._readyCallbacks = [];

        if (this.pendingAnimations) {
          this.play(this.pendingAnimations);
          this.pendingAnimations = null;
        }
      }
    });
  }

  onReady(callback) {
    if (this.unityReady) {
      callback();
    } else {
      this._readyCallbacks.push(callback);
    }
  }

  play(animations) {
    if (!animations || animations.length === 0) return;

    if (!this.unityReady) {
      this.pendingAnimations = animations;
      return;
    }

    this.iframe.contentWindow.postMessage(
      { type: 'PLAY_ANIMATION', animations },
      '*'
    );
  }

  replay(animations) {
    this.play(animations);
  }

  isReady() {
    return this.unityReady;
  }

  destroy() {
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    this.unityReady = false;
    this._readyCallbacks = [];
    this.pendingAnimations = null;
  }
}
