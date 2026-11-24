import {
  isXboxWebViewHost,
  onXboxPlayerEvent,
  postToXboxHost,
  setXboxUnderlayActive
} from "./xboxHostBridge.js";

const SEEK_FALLBACK_TIMEOUT_MS = 12000;

export function createXboxAvPlayBridge({
  postCommand = (command, payload = {}) =>
    postToXboxHost("AvPlayCommand", { command, ...payload }),
  subscribeEvents = onXboxPlayerEvent,
  onUnderlayChange = setXboxUnderlayActive
} = {}) {
  let state = "NONE";
  let currentUrl = "";
  let currentTimeMs = 0;
  let durationMs = 0;
  let totalTracks = [];
  let currentStreams = [];
  let listener = {};
  let pendingPrepare = null;
  let pendingSeek = null;
  let streamingProperties = {};
  let displayRect = { x: 0, y: 0, width: 1920, height: 1080 };
  let displayMethod = "PLAYER_DISPLAY_MODE_FULL_SCREEN";
  let playbackRate = 1;
  let unsubscribe = null;

  function ensureSubscribed() {
    if (unsubscribe || typeof subscribeEvents !== "function") {
      return;
    }
    unsubscribe = subscribeEvents(handleHostEvent);
  }

  function clearPendingSeek(success, errorValue = null) {
    if (!pendingSeek) {
      return;
    }
    const current = pendingSeek;
    pendingSeek = null;
    if (current.timer) {
      clearTimeout(current.timer);
    }
    if (success) {
      current.onSuccess?.();
    } else {
      current.onError?.(errorValue || "seek_failed");
    }
  }

  function handleHostEvent(event = {}) {
    const kind = String(event.event || "").trim();
    if (!kind) {
      return;
    }

    if (typeof event.currentTimeMs === "number" && Number.isFinite(event.currentTimeMs)) {
      currentTimeMs = Math.max(0, Math.round(event.currentTimeMs));
    }
    if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
      durationMs = Math.max(0, Math.round(event.durationMs));
    }
    if (Array.isArray(event.tracks)) {
      totalTracks = event.tracks.slice();
    }
    if (Array.isArray(event.streams)) {
      currentStreams = event.streams.slice();
    }

    switch (kind) {
      case "prepared": {
        state = "READY";
        const prepareCallbacks = pendingPrepare;
        pendingPrepare = null;
        prepareCallbacks?.onSuccess?.();
        break;
      }
      case "prepareError": {
        state = "IDLE";
        const prepareCallbacks = pendingPrepare;
        pendingPrepare = null;
        prepareCallbacks?.onError?.(event.error || "prepare_failed");
        break;
      }
      case "bufferingStart":
        listener?.onbufferingstart?.();
        break;
      case "bufferingProgress":
        listener?.onbufferingprogress?.(Number(event.percent || 0));
        break;
      case "bufferingComplete":
        listener?.onbufferingcomplete?.();
        break;
      case "timeupdate":
        listener?.oncurrentplaytime?.(currentTimeMs);
        break;
      case "stateChanged": {
        const nextState = String(event.state || "")
          .trim()
          .toUpperCase();
        if (nextState) {
          state = nextState;
        }
        break;
      }
      case "seekCompleted":
        clearPendingSeek(true);
        break;
      case "seekFailed":
        clearPendingSeek(false, event.error || "seek_failed");
        break;
      case "ended":
        state = "READY";
        listener?.onstreamcompleted?.();
        break;
      case "error": {
        const detail = String(event.error || "PLAYER_ERROR_CONNECTION_FAILED");
        if (pendingPrepare) {
          const prepareCallbacks = pendingPrepare;
          pendingPrepare = null;
          prepareCallbacks.onError?.(detail);
        }
        clearPendingSeek(false, detail);
        listener?.onerrormsg?.("PLAYER_ERROR", detail);
        listener?.onerror?.(detail);
        break;
      }
      default:
        break;
    }
  }

  ensureSubscribed();

  return {
    open(url) {
      ensureSubscribed();
      currentUrl = String(url || "").trim();
      if (!currentUrl) {
        throw new Error("URL is required");
      }
      state = "IDLE";
      currentTimeMs = 0;
      durationMs = 0;
      totalTracks = [];
      currentStreams = [];
      streamingProperties = {};
      playbackRate = 1;
      pendingPrepare = null;
      clearPendingSeek(false, "aborted");
      onUnderlayChange?.(true);
      postCommand("open", { url: currentUrl });
    },

    close() {
      pendingPrepare = null;
      clearPendingSeek(false, "closed");
      state = "NONE";
      currentUrl = "";
      currentTimeMs = 0;
      durationMs = 0;
      totalTracks = [];
      currentStreams = [];
      streamingProperties = {};
      onUnderlayChange?.(false);
      postCommand("close");
    },

    setStreamingProperty(name, value) {
      const key = String(name || "").trim();
      if (!key) {
        return;
      }
      streamingProperties[key] = String(value ?? "");
      postCommand("setStreamingProperty", { name: key, value: streamingProperties[key] });
    },

    getStreamingProperty(name) {
      return streamingProperties[String(name || "").trim()] || "";
    },

    setListener(listenerObj) {
      listener = listenerObj && typeof listenerObj === "object" ? listenerObj : {};
    },

    prepareAsync(onSuccess, onError) {
      if (state === "NONE") {
        onError?.("PLAYER_ERROR_INVALID_STATE");
        return;
      }
      pendingPrepare = { onSuccess, onError };
      postCommand("prepare", {
        url: currentUrl,
        headers: streamingProperties
      });
    },

    prepare() {
      this.prepareAsync();
    },

    play() {
      state = "PLAYING";
      onUnderlayChange?.(true);
      postCommand("play");
    },

    pause() {
      if (state === "PLAYING") {
        state = "PAUSED";
      }
      postCommand("pause");
    },

    stop() {
      pendingPrepare = null;
      clearPendingSeek(false, "stopped");
      state = "IDLE";
      postCommand("stop");
    },

    seekTo(ms, onSuccess, onError) {
      const targetMs = Math.max(0, Math.floor(Number(ms) || 0));
      clearPendingSeek(false, "superseded");
      currentTimeMs = targetMs;
      const timer = setTimeout(() => {
        clearPendingSeek(true);
      }, SEEK_FALLBACK_TIMEOUT_MS);
      pendingSeek = { onSuccess, onError, timer };
      postCommand("seekTo", { positionMs: targetMs });
    },

    jumpForward(ms, onSuccess, onError) {
      const delta = Math.max(0, Math.floor(Number(ms) || 0));
      this.seekTo(currentTimeMs + delta, onSuccess, onError);
    },

    jumpBackward(ms, onSuccess, onError) {
      const delta = Math.max(0, Math.floor(Number(ms) || 0));
      this.seekTo(Math.max(0, currentTimeMs - delta), onSuccess, onError);
    },

    getState() {
      return state;
    },

    getCurrentTime() {
      return currentTimeMs;
    },

    getDuration() {
      return durationMs;
    },

    getTotalTrackInfo() {
      return totalTracks.slice();
    },

    getCurrentStreamInfo() {
      return currentStreams.slice();
    },

    setSelectTrack(trackType, index) {
      const normalizedType = String(trackType || "")
        .trim()
        .toUpperCase();
      const targetIndex = Number(index);
      if (!normalizedType || !Number.isFinite(targetIndex) || targetIndex < 0) {
        return;
      }
      if (normalizedType === "AUDIO") {
        totalTracks = totalTracks.map((track) => {
          if (String(track?.type || "").toUpperCase() !== "AUDIO") {
            return track;
          }
          return {
            ...track,
            selected: Number(track.index) === targetIndex
          };
        });
        const matched = totalTracks.find(
          (track) => String(track?.type || "").toUpperCase() === "AUDIO" && Number(track.index) === targetIndex
        );
        if (matched) {
          currentStreams = [
            ...currentStreams.filter((entry) => String(entry?.type || "").toUpperCase() !== "AUDIO"),
            matched
          ];
        }
      }
      postCommand("setSelectTrack", { trackType: normalizedType, index: targetIndex });
    },

    setDisplayRect(x, y, width, height) {
      displayRect = {
        x: Math.round(Number(x || 0)),
        y: Math.round(Number(y || 0)),
        width: Math.max(1, Math.round(Number(width || 1920))),
        height: Math.max(1, Math.round(Number(height || 1080)))
      };
      postCommand("setDisplayRect", displayRect);
    },

    setDisplayMethod(mode) {
      displayMethod = String(mode || "PLAYER_DISPLAY_MODE_FULL_SCREEN");
      postCommand("setDisplayMethod", { mode: displayMethod });
    },

    setSpeed(rate) {
      const numeric = Number(rate);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return;
      }
      playbackRate = numeric;
      postCommand("setSpeed", { rate: playbackRate });
    },

    setSilentSubtitle(silent) {
      postCommand("setSilentSubtitle", { silent: Boolean(silent) });
    },

    setExternalSubtitlePath(path) {
      postCommand("setExternalSubtitlePath", { path: String(path || "") });
    },

    setSubtitlePosition(offsetMs) {
      postCommand("setSubtitlePosition", { offsetMs: Math.round(Number(offsetMs || 0)) });
    },

    setBufferingParam() {},
    setTimeoutForBuffering() {},

    suspend() {
      if (state === "PLAYING") {
        this.pause();
      }
    },

    restore() {},

    _handleHostEvent: handleHostEvent
  };
}

let cachedXboxAvPlay = null;

export function getXboxAvPlayApi() {
  if (!isXboxWebViewHost()) {
    return null;
  }
  if (!cachedXboxAvPlay) {
    cachedXboxAvPlay = createXboxAvPlayBridge();
  }
  globalThis.__NUVIO_XBOX_AVPLAY__ = cachedXboxAvPlay;
  return cachedXboxAvPlay;
}
