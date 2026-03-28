import React, { useEffect, useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../store/AppContext';
import { normalizeHiddenPostTag, normalizeHiddenPostTagList } from '../store/hiddenPostTags';
import Modal from './Modal';
import { SketchButton } from './SketchUI';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const UserSettingsModal: React.FC<UserSettingsModalProps> = ({ isOpen, onClose }) => {
  const { state, toggleHiddenPostTag, clearHiddenPostTags } = useApp();
  const [loadingTags, setLoadingTags] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;
    setLoadingTags(true);

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="设置">
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

        <div className="flex gap-3">
          <SketchButton
            type="button"
            variant="secondary"
            className="flex-1 text-base"
            onClick={clearHiddenPostTags}
            disabled={state.hiddenPostTags.length === 0}
          >
            清空屏蔽
          </SketchButton>
          <SketchButton type="button" variant="primary" className="flex-1 text-base" onClick={onClose}>
            完成
          </SketchButton>
        </div>
      </div>
    </Modal>
  );
};

export default UserSettingsModal;
