const PLAYBACK_STATE_THROTTLE_MS = 1000;

let hostBridgeInitialized = false;
let lastPlaybackStateSentAt = 0;
let lastPlaybackStatusSent = "";
const playerEventListeners = new Set();
const backListeners = new Set();
const smtcListeners = new Set();

export function isXboxUserAgent(userAgent = globalThis.navigator?.userAgent) {
  return String(userAgent || "")
    .toLowerCase()
    .includes("xbox");
}

export function isXboxQueryParam(search = globalThis.location?.search) {
  return String(search || "")
    .toLowerCase()
    .includes("platform=xbox");
}

export function isXboxWebViewHost() {
  if (globalThis.__NUVIO_XBOX_HOST__ === false) {
    return false;
  }
  const hasWebView2 = Boolean(globalThis.chrome?.webview?.postMessage);
  if (globalThis.__NUVIO_XBOX_HOST__ === true) {
    return hasWebView2 || true;
  }
  return Boolean(
    hasWebView2 &&
    (globalThis.__NUVIO_PLATFORM__ === "xbox" || isXboxQueryParam() || isXboxUserAgent())
  );
}

export function postToXboxHost(type, payload = {}) {
  const postMessage = globalThis.chrome?.webview?.postMessage;
  if (typeof postMessage !== "function") {
    return false;
  }
  try {
    postMessage.call(
      globalThis.chrome.webview,
      JSON.stringify({
        type: String(type || ""),
        ...payload
      })
    );
    return true;
  } catch (_) {
    return false;
  }
}

export function onXboxPlayerEvent(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  playerEventListeners.add(listener);
  return () => {
    playerEventListeners.delete(listener);
  };
}

export function onXboxBackRequest(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  backListeners.add(listener);
  return () => {
    backListeners.delete(listener);
  };
}

export function onXboxSmtcAction(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  smtcListeners.add(listener);
  return () => {
    smtcListeners.delete(listener);
  };
}

export function handleXboxHostMessage(rawData) {
  let message = rawData;
  if (typeof rawData === "string") {
    try {
      message = JSON.parse(rawData);
    } catch (_) {
      return false;
    }
  }
  if (!message || typeof message !== "object") {
    return false;
  }

  const type = String(message.type || "").trim();
  if (type === "xbox-back") {
    backListeners.forEach((listener) => {
      try {
        listener(message);
      } catch (_) {}
    });
    return true;
  }

  if (type === "xbox-smtc") {
    smtcListeners.forEach((listener) => {
      try {
        listener(message);
      } catch (_) {}
    });
    return true;
  }

  if (type === "xbox-player-event") {
    playerEventListeners.forEach((listener) => {
      try {
        listener(message);
      } catch (_) {}
    });
    return true;
  }

  return false;
}

export function initXboxHostBridge() {
  if (hostBridgeInitialized) {
    return;
  }
  hostBridgeInitialized = true;

  const webview = globalThis.chrome?.webview;
  if (webview && typeof webview.addEventListener === "function") {
    webview.addEventListener("message", (event) => {
      handleXboxHostMessage(event?.data);
    });
  }
}

export function requestAppExit() {
  if (postToXboxHost("ExitApp")) {
    return true;
  }
  try {
    globalThis.close?.();
  } catch (_) {}
  return false;
}

export function setXboxUnderlayActive(active) {
  const isActive = Boolean(active);
  try {
    globalThis.document?.documentElement?.classList?.toggle("xbox-avplay-active", isActive);
  } catch (_) {}
  return postToXboxHost("SetUnderlayActive", { active: isActive });
}

export function notifyPlaybackState({
  status = "stopped",
  currentTime = 0,
  duration = 0,
  title = "",
  subtitle = ""
} = {}) {
  const normalizedStatus = String(status || "stopped").toLowerCase();
  const now = Date.now();
  if (
    normalizedStatus === "playing" &&
    lastPlaybackStatusSent === "playing" &&
    now - lastPlaybackStateSentAt < PLAYBACK_STATE_THROTTLE_MS
  ) {
    return false;
  }
  lastPlaybackStatusSent = normalizedStatus;
  lastPlaybackStateSentAt = now;
  return postToXboxHost("PlaybackState", {
    status: normalizedStatus,
    currentTime: Math.max(0, Number(currentTime) || 0),
    duration: Math.max(0, Number(duration) || 0),
    title: String(title || ""),
    subtitle: String(subtitle || "")
  });
}
