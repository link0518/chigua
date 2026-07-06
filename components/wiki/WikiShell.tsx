import React from 'react';
import { Badge, Button, Input, LayerCard, Sidebar } from '@cloudflare/kumo';
import {
  BookOpen,
  House,
  MagnifyingGlass,
  Plus,
  X,
} from '@phosphor-icons/react';

import type { WikiTagStat } from './wikiTypes';

interface WikiShellProps {
  children: React.ReactNode;
  tags: WikiTagStat[];
  activeTag: string;
  query: string;
  total: number;
  onTagChange: (tag: string) => void;
  onOpenSubmit: () => void;
  onNavigateHome: () => void;
  onQueryChange: (query: string) => void;
}

const WikiShell: React.FC<WikiShellProps> = ({
  children,
  tags,
  activeTag,
  query,
  total,
  onTagChange,
  onOpenSubmit,
  onNavigateHome,
  onQueryChange,
}) => (
  <div data-theme="kumo" className="wiki-page wiki-page-shell w-full min-w-0 overflow-hidden bg-kumo-overlay text-kumo-default">
    <Sidebar.Provider
      collapsible="none"
      mobileBreakpoint={0}
      className="h-full min-h-0"
      style={{ '--sidebar-width': '20rem' } as React.CSSProperties}
    >
      <Sidebar className="hidden lg:flex" contentClassName="bg-kumo-base">
        <Sidebar.Header className="h-auto flex-col items-stretch gap-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onNavigateHome}
              aria-label="返回 Wiki 首页"
              className="wiki-motion-button wiki-focus-ring flex size-10 shrink-0 items-center justify-center rounded-lg bg-kumo-contrast text-kumo-inverse shadow-sm"
            >
              <BookOpen size={20} weight="duotone" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-kumo-strong">JX3 瓜条</h1>
              <p className="text-xs text-kumo-subtle">公开档案库</p>
            </div>
          </div>

          <div>
            <Input
              aria-label="快速检索 Wiki 档案"
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="搜索档案、标签、叙述..."
              size="base"
              className="w-full"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="wiki-motion-button mt-2"
                onClick={() => onQueryChange('')}
                icon={<X size={14} />}
              >
                清空搜索
              </Button>
            )}
          </div>
        </Sidebar.Header>

        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupLabel>目录</Sidebar.GroupLabel>
            <Sidebar.Menu>
              <Sidebar.MenuButton
                type="button"
                active={!activeTag}
                icon={<House size={16} />}
                onClick={() => onTagChange('')}
              >
                <span>全部瓜条</span>
                <Sidebar.MenuBadge>{total}</Sidebar.MenuBadge>
              </Sidebar.MenuButton>
            </Sidebar.Menu>
          </Sidebar.Group>

          <Sidebar.Group>
            <Sidebar.GroupLabel>标签分类</Sidebar.GroupLabel>
            <Sidebar.MenuSub>
              {tags.map((tag) => (
                <Sidebar.MenuSubButton
                  key={tag.name}
                  type="button"
                  active={activeTag === tag.name}
                  onClick={() => onTagChange(tag.name)}
                >
                  <span className="truncate">#{tag.name}</span>
                  <Sidebar.MenuBadge>{tag.count}</Sidebar.MenuBadge>
                </Sidebar.MenuSubButton>
              ))}
            </Sidebar.MenuSub>
          </Sidebar.Group>
        </Sidebar.Content>

        <Sidebar.Footer className="h-auto flex-col items-stretch gap-3 p-4">
          <div className="wiki-surface-soft flex items-center justify-between rounded-lg border border-kumo-line bg-kumo-tint px-3 py-2 text-xs">
            <span className="text-kumo-subtle">公开档案</span>
            <Badge variant="secondary">{total} 条</Badge>
          </div>
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="wiki-motion-button wiki-solid-action w-full justify-center"
            onClick={onOpenSubmit}
            icon={<Plus size={18} />}
          >
            提交瓜条
          </Button>
        </Sidebar.Footer>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-kumo-line bg-kumo-base px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onNavigateHome}
              className="wiki-motion-button wiki-focus-ring flex min-w-0 items-center gap-2 rounded-lg text-left"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-kumo-contrast text-kumo-inverse shadow-sm">
                <House size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-kumo-strong">JX3 瓜条</span>
                <span className="block text-xs text-kumo-subtle">公开档案库</span>
              </span>
            </button>
            <Button
              type="button"
              variant="primary"
              size="base"
              className="wiki-motion-button wiki-solid-action min-h-10 shrink-0"
              onClick={onOpenSubmit}
              icon={<Plus size={16} />}
            >
              投稿
            </Button>
          </div>
          <LayerCard className="wiki-surface-soft mt-3 p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <MagnifyingGlass size={18} className="text-kumo-subtle" />
              <Input
                aria-label="快速检索 Wiki 档案"
                value={query}
                onChange={(event) => onQueryChange(event.currentTarget.value)}
                placeholder="搜索名字、记录或标签"
                size="sm"
                className="min-w-0 flex-1"
              />
            </div>
          </LayerCard>
          {tags.length > 0 && (
            <div className="wiki-action-strip wiki-scrollbar-none mt-3 flex gap-2 overflow-x-auto pb-1 pr-4">
              <button
                type="button"
                onClick={() => onTagChange('')}
                className={`wiki-chip-button wiki-focus-ring min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${!activeTag ? 'border-kumo-contrast bg-kumo-contrast text-kumo-inverse shadow-sm' : 'border-kumo-line bg-kumo-base text-kumo-default'}`}
              >
                全部
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => onTagChange(tag.name)}
                  className={`wiki-chip-button wiki-focus-ring min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${activeTag === tag.name ? 'border-kumo-contrast bg-kumo-contrast text-kumo-inverse shadow-sm' : 'border-kumo-line bg-kumo-base text-kumo-default'}`}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {children}
      </div>
    </Sidebar.Provider>
  </div>
);

export default WikiShell;
