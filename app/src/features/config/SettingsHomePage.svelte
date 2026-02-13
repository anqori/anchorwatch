<script lang="ts">
  import { List, ListItem, Navbar } from "konsta/svelte";

  interface ConfigSection {
    id: string;
    label: string;
    icon: string;
  }

  export let configSections: ConfigSection[] = [];
  export let onOpenConfig: (id: string) => void = () => {};
</script>

<Navbar title="Settings" large transparent centerTitle />
<List strong inset aria-label="Settings pages">
  {#each configSections as configSection}
    <ListItem
      link
      title={configSection.label}
      onClick={() => onOpenConfig(configSection.id)}
    >
      {#snippet media()}
        <span class="material-symbols-rounded am-tab-material-icon" aria-hidden="true">{configSection.icon}</span>
      {/snippet}
    </ListItem>
  {/each}
</List>
