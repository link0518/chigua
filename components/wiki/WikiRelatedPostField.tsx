import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Empty, Input, LayerCard } from '@cloudflare/kumo';
import {
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  LinkSimple,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';

import { api } from '../../api';
import type { Post } from '../../types';
import { buildPostPath } from '../clipboard';
import { getWikiMarkdownExcerpt } from './wikiMarkdownPlainText';
import { WIKI_RELATED_POST_MAX_COUNT } from './wikiConstants';
import type { WikiRelatedPost } from './wikiTypes';

const RELATED_POST_ID_MAX_LENGTH = 128;

const normalizePostId = (value: string) => {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

export const getWikiRelatedPostIdFromInput = (value: string) => {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  const pathMatch = input.match(/(?:^|\/)post\/([^/?#]+)(?:[/?#]|$)/i);
  const postId = normalizePostId(pathMatch?.[1] || input);
  if (
    !postId
    || postId.length > RELATED_POST_ID_MAX_LENGTH
    || /[\s/?#]/.test(postId)
  ) {
    return '';
  }
  return postId;
};

export const resolveWikiRelatedPost = async (postId: string): Promise<WikiRelatedPost> => {
  const result = await api.getPostById(postId) as { post?: Post };
  if (!result?.post?.id) {
    throw new Error('帖子不存在或已不可用');
  }
  return {
    id: result.post.id,
    available: true,
    excerpt: getWikiMarkdownExcerpt(result.post.content || '', 140) || '该帖子暂无可展示的文字摘要',
  };
};

interface WikiRelatedPostFieldProps {
  value: WikiRelatedPost[];
  onChange: (value: WikiRelatedPost[]) => void;
  onCheckingChange?: (checking: boolean) => void;
  disabled?: boolean;
}

export const WikiRelatedPostField: React.FC<WikiRelatedPostFieldProps> = ({
  value,
  onChange,
  onCheckingChange,
  disabled = false,
}) => {
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (disabled || checking) {
      return;
    }
    if (value.length >= WIKI_RELATED_POST_MAX_COUNT) {
      setError(`最多关联 ${WIKI_RELATED_POST_MAX_COUNT} 个帖子`);
      return;
    }

    const postId = getWikiRelatedPostIdFromInput(input);
    if (!postId) {
      setError('请输入有效的帖子链接或帖子 ID');
      return;
    }
    if (value.some((post) => post.id === postId)) {
      setError('该帖子已关联');
      return;
    }

    setChecking(true);
    onCheckingChange?.(true);
    setError('');
    try {
      const post = await resolveWikiRelatedPost(postId);
      if (value.some((item) => item.id === post.id)) {
        setError('该帖子已关联');
        return;
      }
      onChange([...value, post]);
      setInput('');
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : '帖子校验失败，请稍后重试');
    } finally {
      setChecking(false);
      onCheckingChange?.(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Input
          label="相关帖子（选填）"
          value={input}
          onChange={(event) => {
            setInput(event.currentTarget.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="粘贴帖子链接或输入帖子 ID"
          className="w-full"
          disabled={disabled || checking}
        />
        <Button
          type="button"
          variant="secondary"
          className="wiki-motion-button min-h-10 justify-center sm:min-w-24"
          loading={checking}
          disabled={disabled || checking || value.length >= WIKI_RELATED_POST_MAX_COUNT}
          onClick={() => void handleAdd()}
          icon={checking ? <CircleNotch size={16} className="animate-spin" /> : <Plus size={16} />}
        >
          {checking ? '校验中' : '添加'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-kumo-subtle">
        <span>添加前会校验帖子是否公开可用。</span>
        <span className="tabular-nums">{value.length} / {WIKI_RELATED_POST_MAX_COUNT}</span>
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-kumo-danger/25 bg-kumo-danger/5 px-3 py-2 text-sm text-kumo-danger">
          <WarningCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {value.length > 0 ? (
        <ul className="space-y-2">
          {value.map((post, index) => (
            <li key={post.id} className="wiki-surface-soft flex items-start gap-3 rounded-xl border border-kumo-line bg-kumo-base px-3 py-3">
              <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${post.available ? 'bg-kumo-success/10 text-kumo-success' : 'bg-kumo-danger/10 text-kumo-danger'}`}>
                {post.available ? <CheckCircle size={18} weight="duotone" /> : <WarningCircle size={18} weight="duotone" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-kumo-strong">相关帖子 {index + 1}</span>
                  <Badge variant="outline">#{post.id}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-kumo-subtle">
                  {post.available ? (post.excerpt || '帖子已通过校验') : '帖子已不可用，请移除后再提交。'}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                shape="square"
                size="sm"
                className="wiki-motion-button shrink-0 text-kumo-subtle hover:text-kumo-danger"
                aria-label={`移除相关帖子 ${post.id}`}
                disabled={disabled || checking}
                onClick={() => onChange(value.filter((item) => item.id !== post.id))}
                icon={<Trash size={16} />}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

interface WikiRelatedPostListProps {
  posts: WikiRelatedPost[];
  title?: string;
  className?: string;
}

export const WikiRelatedPostList: React.FC<WikiRelatedPostListProps> = ({
  posts,
  title = '相关帖子',
  className = '',
}) => {
  const visiblePosts = posts.slice(0, WIKI_RELATED_POST_MAX_COUNT);

  return (
    <LayerCard className={`wiki-sidebar-card wiki-surface-soft flex min-h-0 flex-col overflow-hidden p-0 shadow-sm ${className}`}>
      <LayerCard.Secondary className="wiki-sidebar-card-header flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-kumo-strong">
          <LinkSimple size={18} />
          {title}
        </div>
        <Badge variant="outline">{visiblePosts.length} 条</Badge>
      </LayerCard.Secondary>
      <LayerCard.Primary className="wiki-related-post-body min-h-0 flex-1 p-0">
        {visiblePosts.length === 0 ? (
          <div className="flex h-full min-h-32 items-center justify-center">
            <Empty
              size="sm"
              icon={<LinkSimple size={28} />}
              title="无"
              description="当前瓜条未关联帖子"
            />
          </div>
        ) : (
          <ul className="wiki-related-post-list divide-y divide-kumo-line">
            {visiblePosts.map((post, index) => (
              <li key={post.id}>
                {post.available ? (
                <a
                  href={buildPostPath(post.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wiki-motion-button wiki-focus-ring group flex min-h-11 items-center gap-3 px-4 py-2 transition-colors hover:bg-kumo-tint"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-kumo-brand">
                    <LinkSimple size={16} weight="duotone" />
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-kumo-strong">帖子{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-xs leading-5 text-kumo-subtle">
                    {post.excerpt || '点击查看相关帖子'}
                  </span>
                  <ArrowSquareOut size={14} className="shrink-0 text-kumo-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </a>
              ) : (
                <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-danger/10 text-kumo-danger">
                    <WarningCircle size={16} weight="duotone" />
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-kumo-subtle">帖子{index + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-xs leading-5 text-kumo-subtle">该帖子已删除、隐藏或暂时不可访问。</p>
                </div>
              )}
              </li>
            ))}
          </ul>
        )}
      </LayerCard.Primary>
    </LayerCard>
  );
};

interface WikiResolvedRelatedPostListProps {
  postIds: string[];
  title?: string;
  className?: string;
}

export const WikiResolvedRelatedPostList: React.FC<WikiResolvedRelatedPostListProps> = ({
  postIds,
  title,
  className,
}) => {
  const normalizedIds = useMemo(() => Array.from(new Set(
    postIds.map((postId) => String(postId || '').trim()).filter(Boolean)
  )).slice(0, WIKI_RELATED_POST_MAX_COUNT), [postIds]);
  const idsKey = normalizedIds.join('\u0000');
  const [posts, setPosts] = useState<WikiRelatedPost[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!idsKey) {
      setPosts([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    // 历史版本只保存帖子 ID，这里按当前公开状态解析，避免泄露已隐藏帖子的旧摘要。
    void Promise.all(normalizedIds.map(async (postId) => {
      try {
        return await resolveWikiRelatedPost(postId);
      } catch {
        return { id: postId, available: false } satisfies WikiRelatedPost;
      }
    })).then((resolvedPosts) => {
      if (!cancelled) {
        setPosts(resolvedPosts);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  if (normalizedIds.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <LayerCard className={`wiki-surface-soft p-4 shadow-sm ${className || ''}`}>
        <div className="flex items-center gap-2 text-sm text-kumo-subtle">
          <CircleNotch size={17} className="animate-spin" />
          正在检查历史版本中的相关帖子…
        </div>
      </LayerCard>
    );
  }

  return <WikiRelatedPostList posts={posts} title={title} className={className} />;
};

export default WikiRelatedPostField;
