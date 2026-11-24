import { Platform } from "./index.js";

export const Environment = {
  isWebOS() {
    return Platform.isWebOS();
  },

  isTizen() {
    return Platform.isTizen();
  },

  isXbox() {
    return Platform.isXbox();
  },

  isBrowser() {
    return Platform.isBrowser();
  },

  isBackEvent(event) {
    return Platform.isBackEvent(event);
  },

  getDeviceLabel() {
    return Platform.getDeviceLabel();
  }
};
