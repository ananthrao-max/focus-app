import React from "react";
import { createRoot } from "react-dom/client";
import FocusFlow from "../focusflow-v2.jsx";

// Polyfill window.storage using localStorage (the original app expects this API)
if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      return value ? { value } : null;
    },
    async set(key, value) {
      localStorage.setItem(key, value);
    },
  };
}

// Initialize Capacitor plugins when running as native app
async function initCapacitor() {
  if (!window.Capacitor?.isNativePlatform()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0C0C12" });
  } catch {}

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {}
}

initCapacitor();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FocusFlow />
  </React.StrictMode>
);
