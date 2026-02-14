<script lang="ts">
  import { Navbar, NavbarBackLink } from "konsta/svelte";
  import type { DebugMessageEntry } from "../../core/types";

  export let messages: DebugMessageEntry[] = [];
  export let onBack: () => void = () => {};

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  }
</script>

<Navbar title="Debugging">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="debugging-page">
  <div class="hint">Live transport log (incoming/outgoing). Starts blank on each app launch.</div>
  <div class="debugging-list" aria-live="polite">
    {#if messages.length === 0}
      <div class="debugging-empty">No messages yet.</div>
    {:else}
      {#each messages as message (message.id)}
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
    display: grid;
    gap: 0.45rem;
    background: rgba(0, 0, 0, 0.08);
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
    opacity: 0.78;
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
  }
</style>
