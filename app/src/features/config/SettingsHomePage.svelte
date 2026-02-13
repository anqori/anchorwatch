<script lang="ts">
  import { BlockTitle, List, ListItem, Navbar } from "konsta/svelte";
  import type { ConfigSectionId, ConfigSectionStatusItem } from "../../core/types";

  export let configSections: ConfigSectionStatusItem[] = [];
  export let onOpenConfig: (id: ConfigSectionId) => void = () => {};
</script>

<Navbar title="Settings" />

<List strong inset aria-label="Settings pages">
  {#each configSections as configSection}
    <ListItem
      menuListItem
      title={configSection.label}
      subtitle={configSection.status ?? ""}
      class={configSection.disabled ? "settings-disabled-row" : ""}
      onClick={() => {
        if (!configSection.disabled) {
          onOpenConfig(configSection.id);
        }
      }}
      aria-disabled={configSection.disabled ? "true" : "false"}
    >
      {#snippet media()}
        <span class="material-symbols-rounded am-tab-material-icon" aria-hidden="true">{configSection.icon}</span>
      {/snippet}
    </ListItem>
  {/each}
</List>

<style>
  :global(.settings-disabled-row) {
    opacity: 0.45;
    pointer-events: none;
    filter: saturate(0.55);
  }
</style>
