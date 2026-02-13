import type { ConfigViewId, ViewId } from "../core/types";

export interface NavigationCoreState {
  activeView: ViewId;
  activeConfigView: ConfigViewId;
  depth: number;
  suppressedPopEvents: number;
}

export type PopNavigationAction = "none" | "to_settings" | "to_summary";
export type MapLikeView = "map" | "satellite";

export interface ViewTransitionResult {
  previousView: ViewId;
  enteredMapView: MapLikeView | null;
  leftMapView: MapLikeView | null;
}

export function navLevelFor(view: ViewId, configView: ConfigViewId): number {
  if (view === "summary") {
    return 0;
  }
  if (view === "config" && configView !== "settings") {
    return 2;
  }
  return 1;
}

export function currentNavLevel(state: NavigationCoreState): number {
  return navLevelFor(state.activeView, state.activeConfigView);
}

export function pushNavStep(state: NavigationCoreState): void {
  try {
    window.history.pushState({ anchorwatch: "nav-step" }, "", window.location.href);
    state.depth += 1;
  } catch {
    // Ignore history API failures in constrained contexts.
  }
}

export function popNavSteps(state: NavigationCoreState, steps: number): void {
  const count = Math.min(Math.max(steps, 0), state.depth);
  if (count <= 0) {
    return;
  }
  try {
    state.suppressedPopEvents += count;
    state.depth -= count;
    if (count === 1) {
      window.history.back();
    } else {
      window.history.go(-count);
    }
  } catch {
    state.suppressedPopEvents = Math.max(0, state.suppressedPopEvents - count);
    state.depth += count;
  }
}

export function syncToNavLevel(state: NavigationCoreState, targetLevel: number): void {
  const currentLevel = currentNavLevel(state);
  if (targetLevel > currentLevel) {
    for (let i = 0; i < targetLevel - currentLevel; i += 1) {
      pushNavStep(state);
    }
    return;
  }
  if (targetLevel < currentLevel) {
    popNavSteps(state, currentLevel - targetLevel);
  }
}

export function initNavigationHistoryRoot(state: NavigationCoreState): void {
  try {
    window.history.replaceState({ anchorwatch: "root" }, "", window.location.href);
    state.depth = 0;
    state.suppressedPopEvents = 0;
  } catch {
    state.depth = 0;
    state.suppressedPopEvents = 0;
  }
}

export function resolvePopNavigationAction(state: NavigationCoreState): PopNavigationAction {
  if (state.suppressedPopEvents > 0) {
    state.suppressedPopEvents -= 1;
    return "none";
  }

  if (state.depth > 0) {
    state.depth -= 1;
  }

  const level = currentNavLevel(state);
  if (level === 2) {
    return "to_settings";
  }
  if (level === 1) {
    return "to_summary";
  }
  return "none";
}

export function applyViewChange(state: NavigationCoreState, nextView: ViewId): ViewTransitionResult {
  const previousView = state.activeView;
  const targetLevel = nextView === "summary" ? 0 : 1;
  syncToNavLevel(state, targetLevel);

  if (nextView === "config" || state.activeConfigView !== "settings") {
    state.activeConfigView = "settings";
  }
  state.activeView = nextView;

  const previousMapView: MapLikeView | null = previousView === "map" || previousView === "satellite" ? previousView : null;
  const nextMapView: MapLikeView | null = nextView === "map" || nextView === "satellite" ? nextView : null;
  return {
    previousView,
    enteredMapView: nextMapView,
    leftMapView: previousMapView && previousMapView !== nextMapView ? previousMapView : null,
  };
}

export function applyOpenConfigSection(state: NavigationCoreState, nextConfigView: ConfigViewId): void {
  syncToNavLevel(state, 2);
  state.activeView = "config";
  state.activeConfigView = nextConfigView;
}

export function applyGoToSettings(state: NavigationCoreState, syncHistory = true): boolean {
  if (state.activeView !== "config" || state.activeConfigView === "settings") {
    return false;
  }
  if (syncHistory) {
    syncToNavLevel(state, 1);
  }
  state.activeView = "config";
  state.activeConfigView = "settings";
  return true;
}
