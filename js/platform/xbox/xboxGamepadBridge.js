import { onXboxBackRequest, onXboxSmtcAction } from "./xboxHostBridge.js";

const STICK_DEADZONE = 0.55;
const INITIAL_REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 110;
const DEDUP_WINDOW_MS = 140;

const ACTION_DEFS = Object.freeze({
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38, repeatable: true },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40, repeatable: true },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, repeatable: true },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39, repeatable: true },
  enter: { key: "Enter", code: "Enter", keyCode: 13, repeatable: false },
  back: { key: "Escape", code: "Escape", keyCode: 27, repeatable: false },
  playpause: { key: "MediaPlayPause", code: "MediaPlayPause", keyCode: 179, repeatable: false },
  rewind: { key: "MediaRewind", code: "MediaRewind", keyCode: 412, repeatable: true },
  fastforward: { key: "MediaFastForward", code: "MediaFastForward", keyCode: 417, repeatable: true },
  play: { key: "MediaPlay", code: "MediaPlay", keyCode: 415, repeatable: false },
  pause: { key: "MediaPause", code: "MediaPause", keyCode: 19, repeatable: false },
  stop: { key: "MediaStop", code: "MediaStop", keyCode: 413, repeatable: false },
  next: { key: "MediaTrackNext", code: "MediaTrackNext", keyCode: 176, repeatable: false },
  previous: { key: "MediaTrackPrevious", code: "MediaTrackPrevious", keyCode: 177, repeatable: false }
});

const NATIVE_GAMEPAD_KEYCODE_TO_ACTION = new Map([
  [195, "enter"],
  [196, "back"],
  [197, "playpause"],
  [199, "fastforward"],
  [200, "rewind"],
  [203, "up"],
  [204, "down"],
  [205, "left"],
  [206, "right"],
  [211, "up"],
  [212, "down"],
  [213, "right"],
  [214, "left"]
]);

const SMTC_TO_ACTION = Object.freeze({
  play: "play",
  pause: "pause",
  stop: "stop",
  next: "next",
  previous: "previous",
  fastforward: "fastforward",
  rewind: "rewind",
  playpause: "playpause"
});

function isButtonPressed(button) {
  if (typeof button === "number") {
    return button > 0.5;
  }
  return Boolean(button?.pressed || Number(button?.value || 0) > 0.5);
}

function isPlayerScreenVisible(doc = globalThis.document) {
  const playerEl = doc?.getElementById?.("player");
  if (!playerEl) {
    return false;
  }
  const display = String(playerEl.style?.display || "").toLowerCase();
  if (display && display !== "none") {
    return true;
  }
  return Boolean(
    playerEl.classList?.contains("is-active") || doc?.body?.classList?.contains("route-player")
  );
}

export function mapGamepadSnapshotToActions(gamepads, { playerActive = false } = {}) {
  const actions = new Set();
  const list = Array.isArray(gamepads) ? gamepads : Array.from(gamepads || []);

  for (const pad of list) {
    if (!pad || pad.connected === false) {
      continue;
    }
    const buttons = pad.buttons || [];
    const axes = pad.axes || [];
    const axisX = Number(axes[0] || 0);
    const axisY = Number(axes[1] || 0);

    if (isButtonPressed(buttons[12]) || axisY < -STICK_DEADZONE) {
      actions.add("up");
    }
    if (isButtonPressed(buttons[13]) || axisY > STICK_DEADZONE) {
      actions.add("down");
    }
    if (isButtonPressed(buttons[14]) || axisX < -STICK_DEADZONE) {
      actions.add("left");
    }
    if (isButtonPressed(buttons[15]) || axisX > STICK_DEADZONE) {
      actions.add("right");
    }
    if (isButtonPressed(buttons[0])) {
      actions.add("enter");
    }
    if (isButtonPressed(buttons[1])) {
      actions.add("back");
    }
    if (isButtonPressed(buttons[4])) {
      actions.add("rewind");
    }
    if (isButtonPressed(buttons[5])) {
      actions.add("fastforward");
    }
    if (playerActive && (isButtonPressed(buttons[2]) || isButtonPressed(buttons[9]))) {
      actions.add("playpause");
    }
  }

  return actions;
}

export function createXboxGamepadBridge({
  doc = globalThis.document,
  nav = globalThis.navigator,
  raf = globalThis.requestAnimationFrame,
  now = () => Date.now(),
  dedupWindowMs = DEDUP_WINDOW_MS
} = {}) {
  let started = false;
  let rafId = null;
  let unsubBack = null;
  let unsubSmtc = null;
  const heldState = new Map();
  const recentSourceAt = new Map();

  function markRecent(action, source, timestamp = now()) {
    recentSourceAt.set(`${action}:${source}`, timestamp);
  }

  function wasRecentlyHandledByOtherSource(action, currentSource, timestamp = now()) {
    for (const [key, at] of recentSourceAt.entries()) {
      const [keyAction, keySource] = key.split(":");
      if (keyAction === action && keySource !== currentSource && timestamp - at < dedupWindowMs) {
        return true;
      }
    }
    return false;
  }

  function dispatchSyntheticKey(type, actionDef, repeat = false) {
    if (!doc) {
      return false;
    }
    const target =
      doc.activeElement && doc.contains?.(doc.activeElement)
        ? doc.activeElement
        : doc.body || doc.documentElement || doc;
    if (!target || typeof target.dispatchEvent !== "function") {
      return false;
    }

    let event = null;
    if (typeof globalThis.KeyboardEvent === "function") {
      event = new globalThis.KeyboardEvent(type, {
        key: actionDef.key,
        code: actionDef.code,
        keyCode: actionDef.keyCode,
        which: actionDef.keyCode,
        repeat,
        bubbles: true,
        cancelable: true
      });
    } else if (typeof doc.createEvent === "function") {
      event = doc.createEvent("Event");
      event.initEvent(type, true, true);
      event.key = actionDef.key;
      event.code = actionDef.code;
      event.repeat = repeat;
    }

    if (!event) {
      return false;
    }
    try {
      Object.defineProperty(event, "keyCode", { value: actionDef.keyCode, configurable: true });
      Object.defineProperty(event, "which", { value: actionDef.keyCode, configurable: true });
    } catch (_) {}

    if (
      type === "keydown" &&
      !repeat &&
      actionDef.key === "Enter" &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(String(target.tagName || "").toUpperCase())
    ) {
      try {
        target.focus?.();
        target.click?.();
      } catch (_) {}
    }

    return target.dispatchEvent(event);
  }

  function emitAction(action, source, { repeat = false } = {}) {
    const actionDef = ACTION_DEFS[action];
    if (!actionDef) {
      return false;
    }
    const timestamp = now();
    if (!repeat && wasRecentlyHandledByOtherSource(action, source, timestamp)) {
      return false;
    }
    markRecent(action, source, timestamp);
    return dispatchSyntheticKey("keydown", actionDef, repeat);
  }

  function releaseAction(action) {
    const actionDef = ACTION_DEFS[action];
    if (!actionDef) {
      return false;
    }
    return dispatchSyntheticKey("keyup", actionDef, false);
  }

  function onNativeKeyDown(event) {
    const rawCode = Number(event?.keyCode || event?.which || 0);
    const action = NATIVE_GAMEPAD_KEYCODE_TO_ACTION.get(rawCode);
    if (!action) {
      return;
    }
    const timestamp = now();
    if (!event?.repeat && wasRecentlyHandledByOtherSource(action, "native-key", timestamp)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      return;
    }
    markRecent(action, "native-key", timestamp);
  }

  function pollFrame() {
    if (!started) {
      return;
    }
    try {
      const pads = typeof nav?.getGamepads === "function" ? nav.getGamepads() : [];
      const activeActions = mapGamepadSnapshotToActions(pads, {
        playerActive: isPlayerScreenVisible(doc)
      });
      const timestamp = now();

      for (const action of activeActions) {
        const def = ACTION_DEFS[action];
        const state = heldState.get(action);
        if (!state) {
          heldState.set(action, {
            pressedAt: timestamp,
            lastRepeatAt: timestamp
          });
          emitAction(action, "gamepad", { repeat: false });
        } else if (
          def?.repeatable &&
          timestamp - state.pressedAt >= INITIAL_REPEAT_DELAY_MS &&
          timestamp - state.lastRepeatAt >= REPEAT_INTERVAL_MS
        ) {
          state.lastRepeatAt = timestamp;
          emitAction(action, "gamepad", { repeat: true });
        }
      }

      for (const action of Array.from(heldState.keys())) {
        if (!activeActions.has(action)) {
          heldState.delete(action);
          releaseAction(action);
        }
      }
    } catch (_) {
      // Ignore transient gamepad polling issues.
    }

    if (typeof raf === "function") {
      rafId = raf(pollFrame);
    }
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    doc?.addEventListener?.("keydown", onNativeKeyDown, true);
    unsubBack = onXboxBackRequest(() => {
      if (emitAction("back", "host-back", { repeat: false })) {
        releaseAction("back");
      }
    });
    unsubSmtc = onXboxSmtcAction((msg) => {
      const mapped = SMTC_TO_ACTION[String(msg?.action || "").toLowerCase()];
      if (mapped && emitAction(mapped, "host-smtc", { repeat: false })) {
        releaseAction(mapped);
      }
    });
    if (typeof raf === "function") {
      rafId = raf(pollFrame);
    }
  }

  function stop() {
    started = false;
    if (rafId !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(rafId);
      rafId = null;
    }
    doc?.removeEventListener?.("keydown", onNativeKeyDown, true);
    unsubBack?.();
    unsubBack = null;
    unsubSmtc?.();
    unsubSmtc = null;
    heldState.clear();
  }

  return {
    start,
    stop,
    emitAction,
    releaseAction,
    onNativeKeyDown
  };
}

let defaultGamepadBridge = null;

export function initXboxGamepadBridge() {
  if (!defaultGamepadBridge) {
    defaultGamepadBridge = createXboxGamepadBridge();
    defaultGamepadBridge.start();
  }
  return defaultGamepadBridge;
}
