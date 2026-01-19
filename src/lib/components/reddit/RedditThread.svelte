<script lang="ts">
	import { setContext, onMount, tick } from "svelte";
	import type { RedditCommentData, RedditCommentObj, RedditMoreCommentsObj, RedditListingObj, RedditPostData } from "$lib/redditTypes";
	import { apiUrl } from "$lib/const";
	import { COMMENT_TREE_CONTEXT_KEY, type CommentTreeContext, type CommentTreeNode } from "./commentTreeTypes";
	import CommentNode from "./CommentNode.svelte";
	import RedditPost from "./RedditPost.svelte";
	import ThreadActionButton from "./ThreadActionButton.svelte";
	import PresetSvg from "../icons/PresetSvg.svelte";

	interface Props {
		initialPost?: RedditPostData;
		initialComment?: RedditCommentData;
	}

	let { initialPost, initialComment }: Props = $props();

	let tree = $state<CommentTreeNode[]>([]);
	let nodeElements = $state<Map<string, HTMLElement>>(new Map());
	let isLoadingParent = $state(false);
	let isLoadingPost = $state(false);
	let isLoadingTopLevelComments = $state(false);
	let post = $state<RedditPostData | null>(null);
	let topLevelCommentsLoaded = $state(false);
	let hasMoreTopLevelComments = $state(false);
	let moreTopLevelCommentsCount = $state<number | undefined>(undefined);

	onMount(() => {
		if (initialPost) {
			post = initialPost;
		}
		if (initialComment) {
			tree = [createNode(initialComment)];
		}
	});

	function createNode(data: RedditCommentData, includeReplies = false): CommentTreeNode {
		const node: CommentTreeNode = {
			data,
			children: [],
			collapsed: false,
			hasMoreChildren: false,
			isLoadingChildren: false,
			childrenLoaded: false,
		};

		// Process existing replies if present
		if (includeReplies) {
			// Mark as loaded since the API response tells us the full state
			node.childrenLoaded = true;
			
			if (data.replies && typeof data.replies === 'object' && data.replies.data?.children) {
				const { children, hasMore, moreCount } = processReplies(data.replies);
				node.children = children;
				node.hasMoreChildren = hasMore;
				node.moreChildrenCount = moreCount;
			}
		}

		return node;
	}

	function processReplies(listing: RedditListingObj<RedditCommentObj | RedditMoreCommentsObj>): {
		children: CommentTreeNode[];
		hasMore: boolean;
		moreCount?: number;
	} {
		const children: CommentTreeNode[] = [];
		let hasMore = false;
		let moreCount: number | undefined;

		for (const child of listing.data.children) {
			if (child.kind === "t1") {
				const commentData = child.data as RedditCommentData;
				children.push(createNode(commentData, true));
			} else if (child.kind === "more") {
				hasMore = true;
				moreCount = child.data.count;
			}
		}

		return { children, hasMore, moreCount };
	}

	function findNode(nodes: CommentTreeNode[], id: string): CommentTreeNode | null {
		for (const node of nodes) {
			if (node.data.id === id) return node;
			const found = findNode(node.children, id);
			if (found) return found;
		}
		return null;
	}

	function registerNodeElement(id: string, element: HTMLElement | null) {
		if (element) {
			nodeElements.set(id, element);
		} else {
			nodeElements.delete(id);
		}
	}

	function getScrollOffset(nodeId: string): { element: HTMLElement; offsetTop: number } | null {
		const element = nodeElements.get(nodeId);
		if (!element) return null;
		const rect = element.getBoundingClientRect();
		return { element, offsetTop: rect.top };
	}

	async function restoreScrollPosition(nodeId: string, previousOffset: number) {
		await tick();
		const element = nodeElements.get(nodeId);
		if (!element) return;
		const newRect = element.getBoundingClientRect();
		const delta = newRect.top - previousOffset;
		if (Math.abs(delta) > 1) {
			window.scrollBy(0, delta);
		}
	}

	async function loadParent(nodeId: string): Promise<void> {
		// Find the node that wants to load its parent
		const node = findNode(tree, nodeId);
		if (!node) return;

		// Check if there's actually a parent to load
		const parentId = node.data.parent_id;
		if (!parentId || !parentId.startsWith("t1_")) return;

		// Save scroll position before loading
		const scrollState = getScrollOffset(nodeId);

		isLoadingParent = true;
		try {
			const url = `${apiUrl}/api/comments/ids?ids=${node.data.parent_id}&md2html=true&meta-app=search-tool`;
			const response = await fetch(url);
			const json = await response.json();
			
			if (json.error) {
				console.error("Error loading parent:", json.error);
				return;
			}

			const parents: RedditCommentData[] = json.data;
			if (parents.length > 0) {
				// Find and remove the node from its current position in the tree
				const removeFromTree = (nodes: CommentTreeNode[], targetId: string): CommentTreeNode | null => {
					for (let i = 0; i < nodes.length; i++) {
						if (nodes[i].data.id === targetId) {
							return nodes.splice(i, 1)[0];
						}
						const found = removeFromTree(nodes[i].children, targetId);
						if (found) return found;
					}
					return null;
				};

				// Remove the node from tree (it's currently a top-level node)
				const removedNode = removeFromTree(tree, nodeId);
				if (!removedNode) return;

				// Create parent nodes and attach the removed node as child
				// Parents come in order from direct parent to oldest ancestor
				let currentChild = removedNode;
				for (const parentData of parents) {
					const parentNode = createNode(parentData);
					parentNode.children = [currentChild];
					currentChild = parentNode;
				}

				// Add the new parent chain to the tree
				tree = [currentChild, ...tree];
			}

			// Restore scroll position
			if (scrollState) {
				await restoreScrollPosition(nodeId, scrollState.offsetTop);
			}
		} catch (e) {
			console.error("Failed to load parent:", e);
		} finally {
			isLoadingParent = false;
		}
	}

	async function loadChildren(nodeId: string): Promise<void> {
		const node = findNode(tree, nodeId);
		if (!node) return;

		// Save scroll position before loading
		const scrollState = getScrollOffset(nodeId);

		// Collect existing top-level child IDs to exclude from the response
		const existingChildIds = node.children.map(c => c.data.id);
		const excludedIds = existingChildIds.join(",");

		node.isLoadingChildren = true;
		try {
			const linkId = node.data.link_id;
			const parentId = `t1_${node.data.id}`;
			let url = `${apiUrl}/api/comments/tree?link_id=${linkId}&parent_id=${parentId}&start_breadth=2&start_depth=3&limit=6&md2html=true&meta-app=search-tool`;
			if (excludedIds) {
				url += `&excluded_ids=${excludedIds}`;
			}
			const response = await fetch(url);
			const json = await response.json();

			if (json.error) {
				console.error("Error loading children:", json.error);
				return;
			}

			// The response's top level is the parent comment we already have
			// We need to look at its replies (children) instead
			const responseData: (RedditCommentObj | RedditMoreCommentsObj)[] = json.data;
			
			// Find the parent comment in the response and get its replies
			let childObjs: (RedditCommentObj | RedditMoreCommentsObj)[] = [];
			let hasMore = false;
			let moreCount: number | undefined;

			for (const item of responseData) {
				if (item.kind === "t1" && item.data.id === node.data.id) {
					// This is the parent comment, extract its replies
					const parentData = item.data as RedditCommentData;
					if (parentData.replies && typeof parentData.replies === 'object' && parentData.replies.data?.children) {
						childObjs = parentData.replies.data.children;
					}
					break;
				}
			}

			const newChildren: CommentTreeNode[] = [];

			for (const child of childObjs) {
				if (child.kind === "t1") {
					const commentData = child.data as RedditCommentData;
					newChildren.push(createNode(commentData, true));
				} else if (child.kind === "more") {
					hasMore = true;
					moreCount = child.data.count;
				}
			}

			// Merge with existing children, avoiding duplicates
			const existingIds = new Set(node.children.map(c => c.data.id));
			for (const newChild of newChildren) {
				if (!existingIds.has(newChild.data.id)) {
					node.children.push(newChild);
				}
			}
			
			node.hasMoreChildren = hasMore;
			node.moreChildrenCount = moreCount;
			node.childrenLoaded = true;

			// Restore scroll position
			if (scrollState) {
				await restoreScrollPosition(nodeId, scrollState.offsetTop);
			}
		} catch (e) {
			console.error("Failed to load children:", e);
		} finally {
			node.isLoadingChildren = false;
		}
	}

	function toggleCollapse(nodeId: string): void {
		const node = findNode(tree, nodeId);
		if (node) {
			node.collapsed = !node.collapsed;
		}
	}

	const context: CommentTreeContext = {
		loadParent,
		loadChildren,
		toggleCollapse,
		registerNodeElement,
	};

	setContext(COMMENT_TREE_CONTEXT_KEY, context);

	// Derived to check if the root has a parent comment (not a post)
	const topHasParent = $derived(tree[0]?.data.parent_id?.startsWith("t1_") ?? false);
	const canLoadPost = $derived(!post && tree[0]?.data.link_id);
	const canLoadTopLevelComments = $derived(post && !topLevelCommentsLoaded);

	async function loadPost(): Promise<void> {
		const topNode = tree[0];
		if (!topNode || post) return;

		const linkId = topNode.data.link_id;
		if (!linkId) return;

		// Extract post ID from link_id (format: t3_xxxxx)
		const postId = linkId.startsWith("t3_") ? linkId.slice(3) : linkId;

		// Save scroll position before loading
		const scrollState = getScrollOffset(topNode.data.id);

		isLoadingPost = true;
		try {
			const url = `${apiUrl}/api/posts/ids?ids=${postId}&md2html=true&meta-app=search-tool`;
			const response = await fetch(url);
			const json = await response.json();

			if (json.error) {
				console.error("Error loading post:", json.error);
				return;
			}

			const posts: RedditPostData[] = json.data;
			if (posts.length > 0) {
				post = posts[0];
			}

			// Restore scroll position
			if (scrollState) {
				await restoreScrollPosition(topNode.data.id, scrollState.offsetTop);
			}
		} catch (e) {
			console.error("Failed to load post:", e);
		} finally {
			isLoadingPost = false;
		}
	}

	async function loadTopLevelComments(): Promise<void> {
		if (!post) return;

		// Collect existing top-level comment IDs to exclude
		const existingIds = tree.map(n => n.data.id);
		const excludedIds = existingIds.join(",");

		isLoadingTopLevelComments = true;
		try {
			const linkId = `t3_${post.id}`;
			let url = `${apiUrl}/api/comments/tree?link_id=${linkId}&parent_id=&start_breadth=2&start_depth=3&limit=6&md2html=true&meta-app=search-tool`;
			if (excludedIds) {
				url += `&excluded_ids=${excludedIds}`;
			}
			const response = await fetch(url);
			const json = await response.json();

			if (json.error) {
				console.error("Error loading top-level comments:", json.error);
				return;
			}

			const responseData: (RedditCommentObj | RedditMoreCommentsObj)[] = json.data;
			const newComments: CommentTreeNode[] = [];
			let hasMore = false;
			let moreCount: number | undefined;

			for (const item of responseData) {
				if (item.kind === "t1") {
					const commentData = item.data as RedditCommentData;
					newComments.push(createNode(commentData, true));
				} else if (item.kind === "more") {
					hasMore = true;
					moreCount = item.data.count;
				}
			}

			// Merge with existing comments, avoiding duplicates
			const existingIdSet = new Set(tree.map(n => n.data.id));
			for (const newComment of newComments) {
				if (!existingIdSet.has(newComment.data.id)) {
					tree.push(newComment);
				}
			}

			topLevelCommentsLoaded = !hasMore;
			hasMoreTopLevelComments = hasMore;
			moreTopLevelCommentsCount = moreCount;
		} catch (e) {
			console.error("Failed to load top-level comments:", e);
		} finally {
			isLoadingTopLevelComments = false;
		}
	}
</script>

<div class="reddit-thread pane">
	{#if !post}
		<div class="tree-actions">
			{#if canLoadPost}
				<ThreadActionButton
					onclick={() => loadPost()}
					disabled={isLoadingPost}
				>
					{#if isLoadingPost}<span>Loading...</span>{:else}<PresetSvg name="arrow-up" size={14} /> <span>Load post</span>{/if}
				</ThreadActionButton>
			{/if}
			{#if topHasParent}
				<ThreadActionButton
					onclick={() => loadParent(tree[0].data.id)}
					disabled={isLoadingParent}
				>
					{#if isLoadingParent}<span>Loading...</span>{:else}<PresetSvg name="arrow-up" size={14} /> <span>Load parent comment</span>{/if}
				</ThreadActionButton>
			{/if}
		</div>
	{/if}

	{#if post}
		<div class="post-container">
			<RedditPost data={post} embedded={true} />
		</div>
	{/if}

	{#if post && topHasParent}
		<div class="load-parent-between">
			<ThreadActionButton
				onclick={() => loadParent(tree[0].data.id)}
				disabled={isLoadingParent}
			>
				{#if isLoadingParent}<span>Loading...</span>{:else}<PresetSvg name="arrow-up" size={14} /> <span>Load parent comment</span>{/if}
			</ThreadActionButton>
		</div>
	{/if}
	
	{#each tree as node (node.data.id)}
		<CommentNode {node} isRoot={true} />
	{/each}

	{#if canLoadTopLevelComments || hasMoreTopLevelComments}
		<div class="load-comments-button">
			<ThreadActionButton
				onclick={() => loadTopLevelComments()}
				disabled={isLoadingTopLevelComments}
			>
				{#if isLoadingTopLevelComments}
					<span>Loading...</span>
				{:else if moreTopLevelCommentsCount}
					<PresetSvg name="arrow-down" size={14} /> <span>Load {moreTopLevelCommentsCount} more comments</span>
				{:else}
					<PresetSvg name="arrow-down" size={14} /> <span>Load comments</span>
				{/if}
			</ThreadActionButton>
		</div>
	{/if}
</div>

<style lang="scss">
	.reddit-thread {
		display: flex;
		flex-direction: column;
	}

	.tree-actions {
		display: flex;
		flex-direction: row;
		gap: 0.5rem;
		margin-bottom: 0.5rem;

		&:empty {
			display: none;
		}
	}

	.load-parent-between {
		margin-bottom: 0.5rem;
	}

	.load-comments-button {
		margin-top: 0.5rem;
	}

	.post-container {
		margin-bottom: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-color);
	}
</style>
