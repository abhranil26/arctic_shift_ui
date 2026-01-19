<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		onclick: () => void;
		disabled?: boolean;
		children: Snippet;
	}

	let { onclick, disabled = false, children }: Props = $props();
</script>

<button
	class="thread-action-button"
	{onclick}
	{disabled}
>
	{@render children()}
</button>

<style lang="scss">
	.thread-action-button {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		width: max-content;
		padding: 0.2rem 0.3rem;
		background: var(--bg-el2-color);
		border: 1px solid var(--border-color);
		border-radius: 0.25rem;
		cursor: pointer;

		:global(span) {
			font-size: 0.8rem;
		}
		
		&:hover:not(:disabled) {
			background: var(--switcher-bg-hover);
		}
		
		&:disabled {
			opacity: 0.5;
			cursor: default;
		}
	}
</style>
