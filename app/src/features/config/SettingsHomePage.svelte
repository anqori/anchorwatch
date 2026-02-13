<script lang="ts">
  import { BlockTitle, List, ListItem, Navbar } from "konsta/svelte";
  import type { ConfigSectionId } from "../../core/types";

  interface ConfigSection {
    id: ConfigSectionId;
    label: string;
    icon: string;
    status?: string;
  }

  export let configSections: ConfigSection[] = [];
  export let onOpenConfig: (id: ConfigSectionId) => void = () => {};
</script>

<Navbar title="Settings" />

<BlockTitle>Settings</BlockTitle>
<List strong inset aria-label="Settings pages">
  {#each configSections as configSection}
    <ListItem
      menuListItem
      title={configSection.label}
      subtitle={configSection.status ?? ""}
      onClick={() => onOpenConfig(configSection.id)}
    >
      {#snippet media()}
        <span class="material-symbols-rounded am-tab-material-icon" aria-hidden="true">{configSection.icon}</span>
      {/snippet}
    </ListItem>
  {/each}
</List>
