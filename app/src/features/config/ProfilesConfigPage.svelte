<script lang="ts">
  import { Block, BlockTitle, Button as KonstaButton } from "konsta/svelte";

  export let profilesMode: "manual" | "auto" = "auto";
  export let profileAutoSwitchSource: "time" | "sun" = "time";
  export let profileDayStartLocal = "07:00";
  export let profileNightStartLocal = "21:30";

  export let profileDayColorScheme: "full" | "red" | "blue" = "full";
  export let profileDayBrightnessPct = "100";
  export let profileDayOutputProfile = "normal";

  export let profileNightColorScheme: "full" | "red" | "blue" = "red";
  export let profileNightBrightnessPct = "20";
  export let profileNightOutputProfile = "night";

  export let notificationPermissionText = "not checked";
  export let notificationStatusText = "No notification checks yet.";

  export let onApply: () => void = () => {};
  export let onRequestPermission: () => void = () => {};
  export let onSendTestNotification: () => void = () => {};
</script>

<Block strong class="space-y-3">
  <BlockTitle>Profiles + Notifications</BlockTitle>
  <div class="hint">Day/night profile settings and local notification reliability checks.</div>
  <div class="row">
    <div>
      <div class="hint field-label">Profile mode</div>
      <select bind:value={profilesMode}>
        <option value="auto">auto</option>
        <option value="manual">manual</option>
      </select>
    </div>
    <div>
      <div class="hint field-label">Auto switch source</div>
      <select bind:value={profileAutoSwitchSource}>
        <option value="time">time</option>
        <option value="sun">sun</option>
      </select>
    </div>
    <div><div class="hint field-label">Day start</div><input type="time" bind:value={profileDayStartLocal}></div>
    <div><div class="hint field-label">Night start</div><input type="time" bind:value={profileNightStartLocal}></div>
  </div>

  <div class="subcard">
    <div class="hint">Day profile</div>
    <div class="row">
      <div>
        <div class="hint field-label">Color scheme</div>
        <select bind:value={profileDayColorScheme}>
          <option value="full">full</option>
          <option value="red">red</option>
          <option value="blue">blue</option>
        </select>
      </div>
      <div><div class="hint field-label">Brightness %</div><input type="number" bind:value={profileDayBrightnessPct}></div>
      <div><div class="hint field-label">Output profile</div><input type="text" bind:value={profileDayOutputProfile}></div>
    </div>
  </div>

  <div class="subcard">
    <div class="hint">Night profile</div>
    <div class="row">
      <div>
        <div class="hint field-label">Color scheme</div>
        <select bind:value={profileNightColorScheme}>
          <option value="full">full</option>
          <option value="red">red</option>
          <option value="blue">blue</option>
        </select>
      </div>
      <div><div class="hint field-label">Brightness %</div><input type="number" bind:value={profileNightBrightnessPct}></div>
      <div><div class="hint field-label">Output profile</div><input type="text" bind:value={profileNightOutputProfile}></div>
    </div>
  </div>

  <div class="actions">
    <KonstaButton onClick={onApply}>Apply Profile Config</KonstaButton>
  </div>

  <div class="subcard" style="margin-top:0.8rem">
    <div class="hint">Notification status: <strong>{notificationPermissionText}</strong></div>
    <div class="hint" style="margin-top:0.3rem">{notificationStatusText}</div>
    <div class="actions">
      <KonstaButton onClick={onRequestPermission}>Request Permission</KonstaButton>
      <KonstaButton onClick={onSendTestNotification}>Send Test Notification</KonstaButton>
    </div>
  </div>
</Block>
