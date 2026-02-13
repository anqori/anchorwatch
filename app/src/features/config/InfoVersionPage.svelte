<script lang="ts">
  import { List, ListItem, Navbar, NavbarBackLink } from "konsta/svelte";

  export let pwaVersionText = "--";
  export let firmwareVersionText = "--";
  export let cloudVersionText = "--";
  export let onBack: () => void = () => {};
</script>

<Navbar title="Information / Version">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<List strong inset>
  <ListItem title="PWA" after={pwaVersionText} />
  <ListItem title="Firmware" after={firmwareVersionText} />
  <ListItem title="Cloud" after={cloudVersionText} />
</List>
