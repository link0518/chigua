import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Settings2 } from 'lucide-react';

import { api } from '../api';
import type { UpdateAnnouncementItem } from '../types';
import { useApp } from '../store/AppContext';
import { normalizeHiddenPostTag, normalizeHiddenPostTagList } from '../store/hiddenPostTags';
import MarkdownRenderer from './MarkdownRenderer';
import Modal from './Modal';
import { SketchButton } from './SketchUI';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateAnnouncementsUnread?: boolean;
  onUpdateAnnouncementsSeen?: (updatedAt: number) => void;
}

type SettingsTab = 'hiddenTags' | 'updateAnnouncements';

const TAB_ITEMS: Array<{
  key: SettingsTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: 'hiddenTags', label: '屏蔽标签', icon: <Settings2 className="h-4 w-4" /> },
  { key: 'updateAnnouncements', label: '更新公告', icon: <Bell className="h-4 w-4" /> },
];

const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  isOpen,
  onClose,
  updateAnnouncementsUnread = false,
  onUpdateAnnouncementsSeen,
}) => {
  const { state, toggleHiddenPostTag, clearHiddenPostTags } = useApp();
  const [activeTab, setActiveTab] = useState<SettingsTab>('hiddenTags');
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [updateAnnouncements, setUpdateAnnouncements] = useState<UpdateAnnouncementItem[]>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab('hiddenTags');

    let active = true;
    setLoadingTags(true);
    setLoadingAnnouncements(true);

    api.getPostTags(60)
      .then((data) => {
        if (!active) {
          return;
        }

        const items = Array.isArray(data?.items) ? data.items : [];
        setAvailableTags(
          normalizeHiddenPostTagList(
            items.map((item: any) => normalizeHiddenPostTag(String(item?.name || '')))
          )
        );
      })
      .catch(() => {
        if (active) {
          setAvailableTags([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingTags(false);
        }
      });

    api.getUpdateAnnouncements()
      .then((data) => {
        if (!active) {
          return;
        }
        setUpdateAnnouncements(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (active) {
          setUpdateAnnouncements([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingAnnouncements(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen]);

  const hiddenTagKeys = useMemo(
    () => new Set(state.hiddenPostTags.map((tag) => tag.toLowerCase())),
    [state.hiddenPostTags]
  );

  const selectableTags = useMemo(() => {
    const merged = [...availableTags];
    state.hiddenPostTags.forEach((tag) => {
      if (!merged.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        merged.push(tag);
      }
    });
    return normalizeHiddenPostTagList(merged);
  }, [availableTags, state.hiddenPostTags]);

  const formatAnnouncementTime = (value: number) => new Date(value).toLocaleString('zh-CN');

  useEffect(() => {
    if (!isOpen || activeTab !== 'updateAnnouncements' || updateAnnouncements.length === 0) {
      return;
    }
    const latestUpdatedAt = updateAnnouncements.reduce(
      (latest, item) => Math.max(latest, Number(item.updatedAt || 0)),
      0
    );
    if (latestUpdatedAt > 0) {
      onUpdateAnnouncementsSeen?.(latestUpdatedAt);
    }
  }, [activeTab, isOpen, onUpdateAnnouncementsSeen, updateAnnouncements]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="设置">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-2xl border-2 border-dashed border-ink/20 bg-[#fcfbf7] p-2">
          {TAB_ITEMS.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${active ? 'border-ink bg-highlight text-ink' : 'border-transparent bg-white text-pencil hover:border-ink hover:text-ink'}`}
              >
                <span className="relative inline-flex items-center">
                  {item.icon}
                  {item.key === 'updateAnnouncements' && updateAnnouncementsUnread && (
                    <span className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full bg-red-500 border border-ink" />
                  )}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'hiddenTags' && (
          <div className="space-y-4">
            <div className="rounded-2xl border-2 border-dashed border-ink/20 bg-[#fcfbf7] p-4">
              <div className="flex items-center gap-2 text-ink">
                <Settings2 className="h-4 w-4" />
                <span className="font-sans text-sm font-bold">屏蔽标签</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-pencil">
                选择后，首页和热门里将不再展示对应标签的投稿。
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-sans text-sm font-bold text-ink">已屏蔽标签</span>
                <span className="text-xs text-pencil">{state.hiddenPostTags.length} 个</span>
              </div>
              {state.hiddenPostTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {state.hiddenPostTags.map((tag) => (
                    <button
                      key={`hidden-${tag}`}
                      type="button"
                      onClick={() => toggleHiddenPostTag(tag)}
                      className="rounded-full border border-ink bg-highlight px-3 py-1 text-xs font-bold text-ink transition-opacity hover:opacity-80"
                    >
                      #{tag} ×
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pencil">当前还没有屏蔽任何标签。</p>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-sans text-sm font-bold text-ink">可选标签</span>
                <span className="text-xs text-pencil">点击即可切换</span>
              </div>
              {loadingTags ? (
                <p className="text-sm text-pencil">标签加载中...</p>
              ) : selectableTags.length > 0 ? (
                <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto pr-1">
                  {selectableTags.map((tag) => {
                    const active = hiddenTagKeys.has(tag.toLowerCase());
                    return (
                      <button
                        key={`selectable-${tag}`}
                        type="button"
                        onClick={() => toggleHiddenPostTag(tag)}
                        className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${active ? 'border-ink bg-highlight text-ink' : 'border-gray-300 bg-white text-pencil hover:border-ink hover:text-ink'}`}
                      >
                        #{tag}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-pencil">暂无可设置的标签。</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'updateAnnouncements' && (
          <div className="space-y-4">
            <div className="rounded-2xl border-2 border-dashed border-ink/20 bg-[#fcfbf7] p-4">
              <div className="flex items-center gap-2 text-ink">
                <Bell className="h-4 w-4" />
                <span className="font-sans text-sm font-bold">更新公告</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-pencil">
                这里会展示最近的功能更新和改动说明。
              </p>
            </div>

            {loadingAnnouncements ? (
              <div className="rounded-2xl border-2 border-dashed border-ink/20 bg-[#fcfbf7] p-6 text-center text-sm text-pencil">
                更新公告加载中...
              </div>
            ) : updateAnnouncements.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-ink/20 bg-[#fcfbf7] p-6 text-center text-sm text-pencil">
                暂无更新公告。
              </div>
            ) : (
              <div className="max-h-[22rem] space-y-3 overflow-y-auto pr-1">
                {updateAnnouncements.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-2xl border-2 border-ink/15 bg-white p-4 shadow-[2px_2px_0_0_rgba(0,0,0,0.06)]"
                  >
                    <div className="mb-3 text-xs text-pencil">
                      更新时间：{formatAnnouncementTime(item.updatedAt)}
                    </div>
                    <MarkdownRenderer content={item.content} className="text-sm text-ink" />
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          {activeTab === 'hiddenTags' && (
            <SketchButton
              type="button"
              variant="secondary"
              className="flex-1 text-base"
              onClick={clearHiddenPostTags}
              disabled={state.hiddenPostTags.length === 0}
            >
              清空屏蔽
            </SketchButton>
          )}
          <SketchButton
            type="button"
            variant="primary"
            className={`${activeTab === 'hiddenTags' ? 'flex-1' : 'w-full'} text-base`}
            onClick={onClose}
          >
            完成
          </SketchButton>
        </div>
      </div>
    </Modal>
  );
};

export default UserSettingsModal;
