<script lang="ts">
  import { BlockTitle, Button as KonstaButton, List, ListInput, Navbar, NavbarBackLink } from "konsta/svelte";

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

  export let onBack: () => void = () => {};
  export let onApply: () => void = () => {};
  export let onRequestPermission: () => void = () => {};
  export let onSendTestNotification: () => void = () => {};
</script>

<Navbar title="Profiles + Notifications">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">Day/night profile settings and local notification reliability checks.</div>

  <List strong inset>
    <ListInput label="Profile mode" type="select" bind:value={profilesMode} dropdown>
      <option value="auto">auto</option>
      <option value="manual">manual</option>
    </ListInput>
    <ListInput label="Auto switch source" type="select" bind:value={profileAutoSwitchSource} dropdown>
      <option value="time">time</option>
      <option value="sun">sun</option>
    </ListInput>
    <ListInput label="Day start" type="time" bind:value={profileDayStartLocal} />
    <ListInput label="Night start" type="time" bind:value={profileNightStartLocal} />
  </List>

  <BlockTitle>Day Profile</BlockTitle>
  <List strong inset>
    <ListInput label="Color scheme" type="select" bind:value={profileDayColorScheme} dropdown>
      <option value="full">full</option>
      <option value="red">red</option>
      <option value="blue">blue</option>
    </ListInput>
    <ListInput label="Brightness %" type="number" bind:value={profileDayBrightnessPct} />
    <ListInput label="Output profile" type="text" bind:value={profileDayOutputProfile} />
  </List>

  <BlockTitle>Night Profile</BlockTitle>
  <List strong inset>
    <ListInput label="Color scheme" type="select" bind:value={profileNightColorScheme} dropdown>
      <option value="full">full</option>
      <option value="red">red</option>
      <option value="blue">blue</option>
    </ListInput>
    <ListInput label="Brightness %" type="number" bind:value={profileNightBrightnessPct} />
    <ListInput label="Output profile" type="text" bind:value={profileNightOutputProfile} />
  </List>

  <div class="actions">
    <KonstaButton onClick={onApply}>Apply Profile Config</KonstaButton>
  </div>

  <BlockTitle>Notifications</BlockTitle>
  <List strong inset>
    <ListInput label="Permission" type="text" value={notificationPermissionText} readonly />
    <ListInput label="Status" type="text" value={notificationStatusText} readonly />
  </List>

  <div class="actions">
    <KonstaButton onClick={onRequestPermission}>Request Permission</KonstaButton>
    <KonstaButton onClick={onSendTestNotification}>Send Test Notification</KonstaButton>
  </div>
</div>
