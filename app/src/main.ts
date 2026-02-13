import App from "./App.svelte";
import { mount } from "svelte";
import "./app.css";
import "@maptiler/sdk/dist/maptiler-sdk.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app mount target");
}

const app = mount(App, { target });

export default app;
