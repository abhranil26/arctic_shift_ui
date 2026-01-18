<script lang="ts">
    import ContextMenuOverlay from "$lib/components/contextMenu/ContextMenuOverlay.svelte";
    import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

</script>

<ContextMenuOverlay>
	{@render children?.()}
</ContextMenuOverlay>
