<script lang="ts">
  import {
    Button as KonstaButton,
    List,
    ListInput,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";
  import type { ObstacleDraftEntry, ObstacleType } from "../../core/types";

  export let obstacleItems: ObstacleDraftEntry[] = [];
  export let disabled = false;
  export let disabledReason = "Waiting for server config...";
  export let onBack: () => void = () => {};

  function addObstacle(): void {
    if (disabled) {
      return;
    }
    obstacleItems = [
      ...obstacleItems,
      {
        obstacle_id: `obstacle_${obstacleItems.length + 1}`,
        type: "PERMANENT",
        polygonInput: "",
      },
    ];
  }

  function removeObstacle(index: number): void {
    if (disabled) {
      return;
    }
    obstacleItems = obstacleItems.filter((_, currentIndex) => currentIndex !== index);
  }

  function updateObstacle(index: number, patch: Partial<ObstacleDraftEntry>): void {
    if (disabled) {
      return;
    }
    obstacleItems = obstacleItems.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item);
  }
</script>

<Navbar title="Obstacles">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">Each obstacle defines a polygon the boat must not enter. Enter one `lat,lon` pair per line.</div>
  {#if disabled}
    <div class="hint">{disabledReason}</div>
  {/if}

  <div class:config-disabled={disabled}>
  {#if obstacleItems.length === 0}
    <List strong inset>
      <ListInput label="No obstacles configured yet." type="text" value="" readonly />
    </List>
  {:else}
    {#each obstacleItems as obstacle, index}
      <List strong inset>
        <ListInput
          label="Obstacle ID"
          type="text"
          value={obstacle.obstacle_id}
          onInput={(event) => updateObstacle(index, { obstacle_id: (event.currentTarget as HTMLInputElement).value })}
        />
        <ListInput
          label="Type"
          type="select"
          value={obstacle.type}
          dropdown
          onChange={(event) => updateObstacle(index, { type: (event.currentTarget as HTMLSelectElement).value as ObstacleType })}
        >
          <option value="PERMANENT">PERMANENT</option>
          <option value="TEMPORARY">TEMPORARY</option>
        </ListInput>
        <ListInput
          label="Polygon points"
          type="textarea"
          value={obstacle.polygonInput}
          inputClass="!h-28 resize-none"
          onInput={(event) => updateObstacle(index, { polygonInput: (event.currentTarget as HTMLTextAreaElement).value })}
        />
      </List>
      <div class="obstacle-actions">
        <KonstaButton onClick={() => removeObstacle(index)}>Remove obstacle</KonstaButton>
      </div>
    {/each}
  {/if}

  <div class="obstacle-actions">
    <KonstaButton onClick={addObstacle}>Add obstacle</KonstaButton>
  </div>
  </div>
</div>

<style>
  .config-disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  .obstacle-actions {
    padding: 0 0.4rem;
  }
</style>
