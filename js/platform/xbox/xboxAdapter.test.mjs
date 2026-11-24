import test from "node:test";
import assert from "node:assert/strict";

import { Platform } from "../index.js";
import { Environment } from "../environment.js";
import { isBackEvent, normalizeKeyEvent } from "../sharedKeys.js";
import {
  createXboxGamepadBridge,
  mapGamepadSnapshotToActions
} from "./xboxGamepadBridge.js";
import { createXboxAvPlayBridge } from "./xboxAvPlayBridge.js";
import { resolvePlatformAvplayEngine } from "../../core/player/engines/platformAvplayEngine.js";

test("Platform and Environment detect Xbox via query param or __NUVIO_XBOX_HOST__", () => {
  const prevCurrent = Platform.current;
  const prevPlatform = globalThis.__NUVIO_PLATFORM__;
  const prevHost = globalThis.__NUVIO_XBOX_HOST__;

  try {
    Platform.current = null;
    delete globalThis.__NUVIO_PLATFORM__;
    globalThis.__NUVIO_XBOX_HOST__ = true;

    assert.equal(Platform.getName(), "xbox");
    assert.equal(Platform.isXbox(), true);
    assert.equal(Environment.isXbox(), true);
    assert.equal(Platform.getDeviceLabel(), "Xbox Series X|S");
    assert.equal(resolvePlatformAvplayEngine("xbox").name, "xbox-avplay");
  } finally {
    Platform.current = prevCurrent;
    if (prevPlatform === undefined) {
      delete globalThis.__NUVIO_PLATFORM__;
    } else {
      globalThis.__NUVIO_PLATFORM__ = prevPlatform;
    }
    if (prevHost === undefined) {
      delete globalThis.__NUVIO_XBOX_HOST__;
    } else {
      globalThis.__NUVIO_XBOX_HOST__ = prevHost;
    }
  }
});

test("sharedKeys normalizes Xbox UWP Gamepad VirtualKey codes", () => {
  assert.equal(normalizeKeyEvent({ keyCode: 195 }, [196]).keyCode, 13);
  assert.equal(normalizeKeyEvent({ keyCode: 195 }, [196]).isEnter, true);
  assert.equal(normalizeKeyEvent({ keyCode: 196 }, [196]).isBack, true);
  assert.equal(isBackEvent({ keyCode: 196 }, [196]), true);
  assert.equal(normalizeKeyEvent({ keyCode: 203 }, [196]).keyCode, 38);
  assert.equal(normalizeKeyEvent({ keyCode: 204 }, [196]).keyCode, 40);
  assert.equal(normalizeKeyEvent({ keyCode: 205 }, [196]).keyCode, 37);
  assert.equal(normalizeKeyEvent({ keyCode: 206 }, [196]).keyCode, 39);
  assert.equal(normalizeKeyEvent({ keyCode: 211 }, [196]).keyCode, 38);
  assert.equal(normalizeKeyEvent({ keyCode: 214 }, [196]).keyCode, 37);
});

test("mapGamepadSnapshotToActions maps D-Pad, left stick, face buttons, and player shortcuts", () => {
  const actionsMenu = mapGamepadSnapshotToActions(
    [
      {
        connected: true,
        axes: [-0.8, 0.0],
        buttons: Array.from({ length: 16 }, (_, idx) => ({
          pressed: idx === 0 || idx === 2 || idx === 12
        }))
      }
    ],
    { playerActive: false }
  );

  assert.equal(actionsMenu.has("up"), true);
  assert.equal(actionsMenu.has("left"), true);
  assert.equal(actionsMenu.has("enter"), true);
  assert.equal(actionsMenu.has("playpause"), false);

  const actionsPlayer = mapGamepadSnapshotToActions(
    [
      {
        connected: true,
        axes: [0, 0],
        buttons: Array.from({ length: 16 }, (_, idx) => ({
          pressed: idx === 2 || idx === 4 || idx === 5
        }))
      }
    ],
    { playerActive: true }
  );

  assert.equal(actionsPlayer.has("playpause"), true);
  assert.equal(actionsPlayer.has("rewind"), true);
  assert.equal(actionsPlayer.has("fastforward"), true);
});

test("createXboxGamepadBridge deduplicates back events across host-back and native keydown within 140ms", () => {
  let fakeNow = 1000;
  const dispatched = [];
  const listeners = new Map();

  const fakeTarget = {
    tagName: "DIV",
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    }
  };

  const fakeDoc = {
    activeElement: fakeTarget,
    body: fakeTarget,
    contains: () => true,
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    createEvent() {
      return {
        initEvent(type) {
          this.type = type;
        }
      };
    }
  };

  const bridge = createXboxGamepadBridge({
    doc: fakeDoc,
    nav: { getGamepads: () => [] },
    raf: null,
    now: () => fakeNow,
    dedupWindowMs: 140
  });

  bridge.start();

  // First back via host message dispatches Escape
  assert.equal(bridge.emitAction("back", "host-back"), true);
  assert.equal(dispatched.length, 1);

  // Native GamepadB keydown 50ms later is suppressed by deduplication guard
  let prevented = false;
  fakeNow = 1050;
  bridge.onNativeKeyDown({
    keyCode: 196,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {}
  });
  assert.equal(prevented, true);

  // Gamepad poll B button 60ms later is also suppressed
  fakeNow = 1060;
  assert.equal(bridge.emitAction("back", "gamepad"), false);
  assert.equal(dispatched.length, 1);

  // After 200ms, another press works again
  fakeNow = 1300;
  assert.equal(bridge.emitAction("back", "gamepad"), true);
  assert.equal(dispatched.length, 2);

  bridge.stop();
});

test("createXboxAvPlayBridge manages lifecycle states, track selection, and underlay toggle", () => {
  const commands = [];
  const underlayStates = [];
  let emitHostEvent = null;

  const avplay = createXboxAvPlayBridge({
    postCommand(command, payload) {
      commands.push({ command, ...payload });
    },
    subscribeEvents(cb) {
      emitHostEvent = cb;
      return () => {
        emitHostEvent = null;
      };
    },
    onUnderlayChange(active) {
      underlayStates.push(active);
    }
  });

  assert.equal(avplay.getState(), "NONE");
  avplay.open("https://debrid.example/movie.mkv");
  assert.equal(avplay.getState(), "IDLE");
  assert.deepEqual(underlayStates, [true]);

  avplay.setStreamingProperty("USER_AGENT", "NuvioXbox/1.0");
  let prepared = false;
  avplay.prepareAsync(() => {
    prepared = true;
  });

  emitHostEvent({
    type: "xbox-player-event",
    event: "prepared",
    durationMs: 7200000,
    tracks: [
      { type: "AUDIO", index: 0, language: "eng", label: "English 5.1", selected: true },
      { type: "AUDIO", index: 1, language: "ron", label: "Romanian", selected: false }
    ]
  });

  assert.equal(prepared, true);
  assert.equal(avplay.getState(), "READY");
  assert.equal(avplay.getDuration(), 7200000);
  assert.equal(avplay.getTotalTrackInfo().length, 2);

  avplay.play();
  assert.equal(avplay.getState(), "PLAYING");

  avplay.setSelectTrack("AUDIO", 1);
  const selectedTrack = avplay.getTotalTrackInfo().find((t) => t.selected);
  assert.equal(selectedTrack.index, 1);

  avplay.pause();
  assert.equal(avplay.getState(), "PAUSED");

  avplay.close();
  assert.equal(avplay.getState(), "NONE");
  assert.deepEqual(underlayStates, [true, true, false]);
  assert.equal(commands.some((c) => c.command === "setSelectTrack" && c.index === 1), true);
});
