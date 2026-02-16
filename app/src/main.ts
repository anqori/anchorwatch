import App from "./App.svelte";
import { mount } from "svelte";
import "./app.css";
import "@maptiler/sdk/dist/maptiler-sdk.css";

function preventPwaZoomGestures(): void {
  const prevent = (event: Event): void => {
    event.preventDefault();
  };

  document.addEventListener("gesturestart", prevent, { passive: false });
  document.addEventListener("gesturechange", prevent, { passive: false });
  document.addEventListener("gestureend", prevent, { passive: false });

  document.addEventListener("touchmove", (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("wheel", (event: WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  }, { passive: false });
}

preventPwaZoomGestures();

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app mount target");
}

const app = mount(App, { target });

export default app;
