import type { RedditCommentData } from "$lib/redditTypes";

export interface CommentTreeNode {
	data: RedditCommentData;
	children: CommentTreeNode[];
	collapsed: boolean;
	hasMoreChildren: boolean;
	moreChildrenCount?: number;
	isLoadingChildren: boolean;
	childrenLoaded: boolean;
}

export interface CommentTreeContext {
	loadParent: (nodeId: string) => Promise<void>;
	loadChildren: (nodeId: string) => Promise<void>;
	toggleCollapse: (nodeId: string) => void;
	registerNodeElement: (id: string, element: HTMLElement | null) => void;
}

export const COMMENT_TREE_CONTEXT_KEY = Symbol('comment-tree-context');
