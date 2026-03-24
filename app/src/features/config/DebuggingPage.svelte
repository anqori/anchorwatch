<script lang="ts">
  import { Navbar, NavbarBackLink } from "konsta/svelte";
  import type { DebugMessageEntry, DebugMessageLimit } from "../../core/types";

  let {
    messages = [],
    messageLimit = 1000,
    onMessageLimitChange = () => {},
    onBack = () => {},
  }: {
    messages?: DebugMessageEntry[];
    messageLimit?: DebugMessageLimit;
    onMessageLimitChange?: (limit: DebugMessageLimit) => void;
    onBack?: () => void;
  } = $props();

  let selectedTypes = $state<string[]>([]);

  const limitOptions: Array<{ value: DebugMessageLimit; label: string }> = [
    { value: 1000, label: "1000" },
    { value: 5000, label: "5000" },
    { value: 10000, label: "10000" },
    { value: "unlimited", label: "unlimited" },
  ];

  let availableTypes = $derived(
    Array.from(new Set(messages.map((message) => message.msgType))).sort((left, right) => left.localeCompare(right)),
  );

  let visibleMessages = $derived(
    selectedTypes.length === 0
      ? messages
      : messages.filter((message) => selectedTypes.includes(message.msgType)),
  );

  $effect(() => {
    const available = new Set(availableTypes);
    const nextSelectedTypes = selectedTypes.filter((type) => available.has(type));
    const changed =
      nextSelectedTypes.length !== selectedTypes.length
      || nextSelectedTypes.some((type, index) => type !== selectedTypes[index]);
    if (changed) {
      selectedTypes = nextSelectedTypes;
    }
  });

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  function readSelectedTypes(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement;
    selectedTypes = Array.from(select.selectedOptions).map((option) => option.value);
  }
</script>

<Navbar title="Debugging">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="debugging-page">
  <div class="hint">Live transport log (incoming/outgoing). Starts blank on each app launch.</div>
  <div class="debug-controls">
    <label class="debug-control">
      <span class="debug-control-label">Max kept</span>
      <select
        class="debug-select mono"
        value={String(messageLimit)}
        onchange={(event) => {
          const raw = (event.currentTarget as HTMLSelectElement).value;
          const nextLimit = raw === "unlimited" ? "unlimited" : Number(raw);
          if (nextLimit === 1000 || nextLimit === 5000 || nextLimit === 10000 || nextLimit === "unlimited") {
            onMessageLimitChange(nextLimit);
          }
        }}
      >
        {#each limitOptions as option}
          <option value={String(option.value)}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label class="debug-control debug-control-types">
      <span class="debug-control-label">Message types</span>
      <select
        class="debug-select debug-select-multi mono"
        multiple
        size={Math.min(Math.max(availableTypes.length, 4), 10)}
        onchange={readSelectedTypes}
      >
        {#each availableTypes as type}
          <option value={type} selected={selectedTypes.includes(type)}>{type}</option>
        {/each}
      </select>
      <span class="debug-control-hint">No selection means all types.</span>
    </label>
  </div>
  <div class="debugging-list" aria-live="polite">
    {#if visibleMessages.length === 0}
      <div class="debugging-empty">No messages yet.</div>
    {:else}
      {#each visibleMessages as message (message.id)}
        <article class="debug-message">
          <header class="debug-message-header">
            <span class={`debug-chip direction ${message.direction}`}>{message.direction === "incoming" ? "IN" : "OUT"}</span>
            <span class="debug-chip route">{message.route}</span>
            <span class="debug-chip type">{message.msgType}</span>
            <span class="debug-time mono">{formatTime(message.ts)}</span>
          </header>
          <pre class="debug-message-body mono">{message.body}</pre>
        </article>
      {/each}
    {/if}
  </div>
</div>

<style>
  .debugging-page {
    padding: 0.75rem 0.85rem;
    display: grid;
    gap: 0.6rem;
  }

  .debugging-list {
    border: 1px solid rgba(125, 125, 125, 0.25);
    border-radius: 0.8rem;
    padding: 0.55rem;
    max-height: calc(100dvh - var(--am-tabbar-height) - 7.4rem);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    background: rgba(0, 0, 0, 0.08);
    color: rgba(236, 244, 248, 0.96);
    overflow-y: auto;
    overflow-x: hidden;
  }

  .debug-controls {
    display: grid;
    gap: 0.65rem;
  }

  .debug-control {
    display: grid;
    gap: 0.35rem;
  }

  .debug-control-types {
    align-items: start;
  }

  .debug-control-label {
    font-size: 0.82rem;
    opacity: 0.78;
  }

  .debug-control-hint {
    font-size: 0.75rem;
    opacity: 0.68;
  }

  .debug-select {
    width: 100%;
    border: 1px solid rgba(125, 125, 125, 0.25);
    border-radius: 0.7rem;
    padding: 0.55rem 0.65rem;
    background: rgba(0, 0, 0, 0.16);
    color: rgba(236, 244, 248, 0.96);
  }

  .debug-select-multi {
    min-height: 7.8rem;
  }

  .debugging-empty {
    opacity: 0.72;
    font-size: 0.9rem;
    padding: 0.35rem;
  }

  .debug-message {
    border: 1px solid rgba(125, 125, 125, 0.22);
    border-radius: 0.6rem;
    background: rgba(0, 0, 0, 0.2);
    overflow: hidden;
    color: inherit;
    flex: 0 0 auto;
  }

  .debug-message-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.36rem 0.5rem;
    border-bottom: 1px solid rgba(125, 125, 125, 0.2);
  }

  .debug-chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    font-size: 0.72rem;
    padding: 0.1rem 0.45rem;
    line-height: 1.25;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(241, 247, 251, 0.96);
  }

  .debug-chip.direction.incoming {
    background: rgba(28, 152, 255, 0.2);
  }

  .debug-chip.direction.outgoing {
    background: rgba(52, 184, 92, 0.2);
  }

  .debug-chip.route {
    background: rgba(255, 206, 80, 0.2);
  }

  .debug-chip.type {
    text-transform: none;
  }

  .debug-time {
    margin-left: auto;
    color: rgba(218, 232, 239, 0.88);
    font-size: 0.75rem;
  }

  .debug-message-body {
    margin: 0;
    padding: 0.45rem 0.55rem;
    max-height: 16rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    background: transparent;
    border-radius: 0;
    min-height: 0;
    font-size: 0.72rem;
    line-height: 1.33;
    color: rgba(237, 244, 248, 0.97);
  }
</style>
