import { isBackEvent, normalizeKeyEvent } from "../sharedKeys.js";
import { getXboxAvPlayApi } from "../xbox/xboxAvPlayBridge.js";
import { initXboxGamepadBridge } from "../xbox/xboxGamepadBridge.js";
import {
  initXboxHostBridge,
  isXboxWebViewHost,
  requestAppExit
} from "../xbox/xboxHostBridge.js";

const XBOX_BACK_CODES = [461, 10009, 27, 8, 196];

function applyXboxViewport() {
  const documentRef = globalThis.document;
  if (!documentRef?.head) {
    return;
  }

  let viewport = documentRef.querySelector("meta[name='viewport']");
  if (!viewport) {
    viewport = documentRef.createElement("meta");
    viewport.name = "viewport";
    documentRef.head.appendChild(viewport);
  }

  viewport.setAttribute(
    "content",
    "width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
  );
  documentRef.documentElement?.classList?.add("xbox-tv");
  documentRef.body?.classList?.add("xbox-tv");

  try {
    globalThis.dispatchEvent?.(new Event("resize"));
  } catch (_) {}
}

export const xboxAdapter = {
  name: "xbox",

  init() {
    applyXboxViewport();
    initXboxHostBridge();
    initXboxGamepadBridge();
    if (isXboxWebViewHost()) {
      getXboxAvPlayApi();
    }
  },

  exitApp() {
    return requestAppExit();
  },

  isBackEvent(event) {
    return isBackEvent(event, XBOX_BACK_CODES);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, XBOX_BACK_CODES);
  },

  getDeviceLabel() {
    return "Xbox Series X|S";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: false,
      xboxAvplay: Boolean(isXboxWebViewHost())
    };
  },

  prepareVideoElement() {}
};
