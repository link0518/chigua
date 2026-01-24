import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import ReportModal from './ReportModal';
import CommentModal from './CommentModal';
import MarkdownRenderer from './MarkdownRenderer';
import { api } from '../api';
import Modal from './Modal';
import { SketchButton } from './SketchUI';
import Turnstile, { TurnstileHandle } from './Turnstile';

const HomeView: React.FC = () => {
  const {
    state,
    getHomePosts,
    likePost,
    dislikePost,
    isLiked,
    isDisliked,
    showToast,
    loadHomePosts,
    viewPost,
    upsertHomePost,
  } = useApp();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackWechat, setFeedbackWechat] = useState('');
  const [feedbackQq, setFeedbackQq] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackTurnstileRef = useRef<TurnstileHandle | null>(null);
  const [mascotClicks, setMascotClicks] = useState(0);
  const [mascotPop, setMascotPop] = useState(false);
  const [mascotBurstKey, setMascotBurstKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingAdvance, setPendingAdvance] = useState(false);
  const prevPostCountRef = useRef(0);

  const posts = getHomePosts();
  const currentPost = posts[currentIndex];

  useEffect(() => {
    let cancelled = false;
    const sharedPathMatch = window.location.pathname.match(/^\/post\/([^/]+)\/?$/);
    const sharedPostId = sharedPathMatch ? decodeURIComponent(sharedPathMatch[1]) : '';
    const searchParams = new URLSearchParams(window.location.search);
    const sharedCommentId = searchParams.get('comment');

    const load = async () => {
      setLoading(true);
      try {
        await loadHomePosts(10);
      } catch {
        // 忽略加载失败，交由空态处理
      }

      if (sharedPostId && !cancelled) {
        try {
          const data = await api.getPostById(sharedPostId);
          if (!cancelled) {
            upsertHomePost(data.post, { prepend: true });
            setCurrentIndex(0);
            if (sharedCommentId) {
              setFocusCommentId(sharedCommentId);
              setCommentModalOpen(true);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '分享的帖子不存在或已删除';
          showToast(message, 'warning');
        }
      }

      if (!cancelled) {
        setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [loadHomePosts, showToast, upsertHomePost]);

  useEffect(() => {
    if (currentPost?.id) {
      viewPost(currentPost.id).catch(() => { });
    }
  }, [currentPost?.id, viewPost]);

  useEffect(() => {
    if (focusCommentId) {
      return;
    }
    setCommentModalOpen(false);
  }, [currentPost?.id, focusCommentId]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ postId: string; commentId?: string | null }>).detail;
      if (!detail?.postId) {
        return;
      }
      api.getPostById(detail.postId)
        .then((data) => {
          upsertHomePost(data.post, { prepend: true });
          setCurrentIndex(0);
          if (detail.commentId) {
            setFocusCommentId(detail.commentId);
            setCommentModalOpen(true);
          }
        })
        .catch(() => {});
    };
    window.addEventListener('notification:navigate', handleNavigate as EventListener);
    return () => {
      window.removeEventListener('notification:navigate', handleNavigate as EventListener);
    };
  }, [upsertHomePost]);

  useEffect(() => {
    const handleRefresh = () => {
      if (loading) {
        return;
      }
      setLoading(true);
      loadHomePosts(10)
        .then(() => {
          setCurrentIndex(0);
        })
        .catch(() => {})
        .finally(() => {
          setLoading(false);
        });
    };
    window.addEventListener('home:refresh', handleRefresh as EventListener);
    return () => {
      window.removeEventListener('home:refresh', handleRefresh as EventListener);
    };
  }, [loadHomePosts, loading, showToast]);

  useEffect(() => {
    if (state.homeTotal > 0) {
      setHasMore(posts.length < state.homeTotal);
    } else {
      setHasMore(false);
    }
  }, [posts.length, state.homeTotal]);

  useEffect(() => {
    const prevCount = prevPostCountRef.current;
    if (pendingAdvance && posts.length > prevCount) {
      setCurrentIndex((prev) => Math.min(prev + 1, posts.length - 1));
      setPendingAdvance(false);
    }
    if (!hasMore && pendingAdvance) {
      setPendingAdvance(false);
    }
    prevPostCountRef.current = posts.length;
  }, [posts.length, pendingAdvance, hasMore]);

  const loadMorePosts = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await loadHomePosts({ limit: 10, offset: posts.length, append: true });
    } catch {
      showToast('加载更多失败，请稍后重试', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (loadingMore || !hasMore) return;
    if (currentIndex >= posts.length - 3) {
      loadMorePosts();
    }
  }, [currentIndex, posts.length, hasMore, loadingMore]);

  const shareUrl = useMemo(() => {
    if (!currentPost?.id) return '';
    return `${window.location.origin}/post/${encodeURIComponent(currentPost.id)}`;
  }, [currentPost?.id]);

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast('分享链接已复制', 'success');
    } catch {
      showToast('复制失败，请手动复制链接', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[80vh]">
        <div className="text-center">
          <span className="text-6xl mb-4 block">🍉</span>
          <h2 className="font-display text-3xl text-ink mb-2">正在预加载...</h2>
          <p className="font-hand text-xl text-pencil">马上就有新瓜了</p>
        </div>
      </div>
    );
  }

  if (!currentPost) {
    return (
      <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-8 flex flex-col justify-center items-center min-h-[80vh]">
        <div className="text-center">
          <span className="text-6xl mb-4 block">🍉</span>
          <h2 className="font-display text-3xl text-ink mb-2">暂无吃瓜内容</h2>
          <p className="font-hand text-xl text-pencil">快去投稿第一个瓜吧！</p>
        </div>
      </div>
    );
  }

  const handleNext = () => {
    if (currentIndex >= posts.length - 1) {
      if (hasMore) {
        setPendingAdvance(true);
        loadMorePosts();
      } else {
        showToast('这是最后一个瓜', 'info');
      }
      return;
    }
    setAnimate(true);
    setTimeout(() => {
      setCurrentIndex((prev) => Math.min(prev + 1, posts.length - 1));
      setAnimate(false);
    }, 200);
  };

  const handlePrev = () => {
    if (currentIndex <= 0) {
      showToast('已是最新', 'info');
      return;
    }
    setAnimate(true);
    setTimeout(() => {
      setCurrentIndex((prev) => Math.max(prev - 1, 0));
      setAnimate(false);
    }, 200);
  };

  const handleLike = async () => {
    const wasLiked = isLiked(currentPost.id);
    try {
      await likePost(currentPost.id);
      if (!wasLiked) {
        showToast('已点赞！', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '点赞失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const handleDislike = async () => {
    const wasDisliked = isDisliked(currentPost.id);
    try {
      await dislikePost(currentPost.id);
      if (!wasDisliked) {
        showToast('已踩', 'info');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const handleMascotClick = () => {
    setMascotPop(true);
    setMascotBurstKey((prev) => prev + 1);
    setTimeout(() => {
      setMascotPop(false);
    }, 320);
    setMascotClicks((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setFeedbackOpen(true);
        return 0;
      }
      return next;
    });
  };

  const resetFeedbackForm = () => {
    setFeedbackContent('');
    setFeedbackEmail('');
    setFeedbackWechat('');
    setFeedbackQq('');
  };

  const closeFeedbackModal = () => {
    setFeedbackOpen(false);
    setFeedbackSubmitting(false);
    resetFeedbackForm();
  };

  const handleFeedbackSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = feedbackContent.trim();
    const email = feedbackEmail.trim();
    const wechat = feedbackWechat.trim();
    const qq = feedbackQq.trim();

    if (!content) {
      showToast('内容不能为空哦！', 'warning');
      return;
    }
    setFeedbackSubmitting(true);
    try {
      if (!feedbackTurnstileRef.current) {
        throw new Error('安全验证加载中，请稍后再试');
      }
      const turnstileToken = await feedbackTurnstileRef.current.execute();
      await api.createFeedback(content, email, wechat, qq, turnstileToken);
      showToast('留言已发送！', 'success');
      closeFeedbackModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : '留言失败，请稍后重试';
      showToast(message, 'error');
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-8 flex flex-col justify-center min-h-[80vh] relative">
      <div className="mascot-anchor">
        <img
          src="/chxb.png"
          alt="吉祥物"
          className={`mascot-float w-20 h-20 md:w-28 md:h-28 object-contain drop-shadow-md select-none cursor-pointer ${mascotPop ? 'mascot-pop' : ''}`}
          onClick={handleMascotClick}
        />
      </div>
      {mascotBurstKey > 0 && (
        <div key={mascotBurstKey} className="mascot-burst">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      {/* Card Container */}
      <article className={`group relative w-full my-auto transition-all duration-200 ${animate ? 'opacity-0 translate-x-10' : 'opacity-100 translate-x-0'}`}>

        {/* Shadow/Layer effect */}
        <div className="absolute inset-0 bg-gray-200 translate-x-2 translate-y-3 rounded-lg doodle-border !rounded-lg opacity-100 transition-opacity"></div>

        {/* Tape Effect */}
        <div className="tape-mask"></div>

        {/* Main Card Content */}
        <div className="relative flex flex-col gap-4 rounded-lg border-2 border-black bg-white p-8 doodle-border !rounded-lg hover:-translate-y-1 transition-transform duration-200 shadow-paper">

          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full border-2 border-black bg-gray-200 flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-xl text-pencil">person_off</span>
              </div>
              <div className="flex flex-col">
                <span className="font-hand font-bold text-xl text-pencil">匿名用户</span>
                <span className="text-xs text-gray-400 font-mono flex items-center gap-1">
                  {currentPost.timestamp}
                </span>
              </div>
            </div>
            {/* Tags */}
            <div className="flex gap-2">
              {currentPost.isHot && (
                <span className="bg-alert border border-ink px-2 py-0.5 text-xs font-bold rounded-sm shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transform -rotate-1">🔥 热门</span>
              )}
              {currentPost.tags?.slice(0, 2).map((tag, i) => (
                <span
                  key={tag}
                  className={`border border-ink px-2 py-0.5 text-xs font-bold rounded-sm shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${['bg-marker-blue', 'bg-marker-green', 'bg-marker-purple', 'bg-marker-orange'][i % 4]
                    } transform ${i % 2 === 0 ? 'rotate-1' : '-rotate-1'}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Body - Markdown Rendered */}
          <div className="text-black text-lg leading-relaxed font-sans py-2">
            <MarkdownRenderer content={currentPost.content} />
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t-2 border-black border-dashed">
            <div className="flex items-center gap-6">
              <button
                onClick={handleLike}
                className={`flex items-center gap-1.5 group/btn transition-colors ${isLiked(currentPost.id) ? 'text-blue-600' : 'hover:text-ink'}`}
              >
                <span className={`material-symbols-outlined text-[22px] group-hover/btn:scale-110 transition-transform ${isLiked(currentPost.id) ? 'font-bold' : ''}`}>
                  thumb_up
                </span>
                <span className="font-hand font-bold text-base">{currentPost.likes}</span>
              </button>
              <button
                onClick={handleDislike}
                className={`flex items-center gap-1.5 group/btn transition-colors ${isDisliked(currentPost.id) ? 'text-red-600' : 'hover:text-ink'}`}
              >
                <span className={`material-symbols-outlined text-[22px] group-hover/btn:translate-y-1 transition-transform ${isDisliked(currentPost.id) ? 'font-bold' : ''}`}>
                  thumb_down
                </span>
              </button>
            </div>
            <div className="flex items-center gap-6">
              <button
                onClick={() => {
                  setFocusCommentId(null);
                  setCommentModalOpen((prev) => !prev);
                }}
                className={`flex items-center gap-1.5 group/btn transition-colors ${commentModalOpen ? 'text-blue-600' : 'hover:text-blue-600'}`}
              >
                <span className="material-symbols-outlined text-[22px]">chat_bubble</span>
                <span className="font-hand font-bold text-base">{currentPost.comments}</span>
              </button>
              <button
                onClick={copyShareLink}
                className="flex items-center gap-1.5 group/btn transition-colors hover:text-blue-600"
              >
                <span className="material-symbols-outlined text-[22px]">share</span>
                <span className="font-hand font-bold text-base">分享</span>
              </button>
              <button
                onClick={() => setReportModalOpen(true)}
                className="flex items-center gap-1 group/btn text-gray-400 hover:text-red-600 transition-colors pl-2 border-l-2 border-gray-200 border-dotted"
              >
                <span className="material-symbols-outlined text-[20px]">flag</span>
                <span className="font-hand font-bold text-sm pt-0.5">举报</span>
              </button>
            </div>
          </div>

        </div>
      </article>

      {/* Navigation Button */}
      <div className="flex items-center gap-3 mt-10 mb-4 w-full max-w-md mx-auto md:max-w-none md:justify-center md:gap-4">
        <button
          onClick={handlePrev}
          className="group relative flex items-center justify-center gap-2 px-4 py-3 bg-white border-[3px] border-black rounded-full shadow-sketch-lg hover:shadow-sketch-hover hover:-translate-y-1 hover:bg-highlight transition-all duration-200 active:shadow-sketch-active active:translate-y-[4px] transform rotate-1 md:px-10 md:py-4 md:gap-3"
        >
          <span className="material-symbols-outlined text-2xl group-hover:rotate-12 transition-transform md:text-3xl">arrow_back</span>
          <span className="font-hand font-bold text-base tracking-widest pt-1 group-hover:animate-wiggle hidden md:inline md:text-2xl">上一个瓜</span>
        </button>
        <button
          onClick={handleNext}
          className="group relative flex flex-1 items-center justify-center gap-3 px-6 py-4 bg-white border-[3px] border-black rounded-full shadow-sketch-lg hover:shadow-sketch-hover hover:-translate-y-1 hover:bg-highlight transition-all duration-200 active:shadow-sketch-active active:translate-y-[4px] transform -rotate-1 md:flex-none md:px-10 md:py-4"
        >
          <span className="font-hand font-bold text-2xl tracking-widest pt-1 group-hover:animate-wiggle">下一个瓜</span>
          <span className="material-symbols-outlined text-3xl group-hover:rotate-12 transition-transform">arrow_forward</span>
        </button>
      </div>

      {/* Report Modal */}
      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        postId={currentPost.id}
        contentPreview={currentPost.content.substring(0, 80)}
      />

      <CommentModal
        isOpen={commentModalOpen}
        onClose={() => {
          setCommentModalOpen(false);
          setFocusCommentId(null);
        }}
        postId={currentPost.id}
        contentPreview={currentPost.content}
        focusCommentId={focusCommentId}
      />

      <Modal
        isOpen={feedbackOpen}
        onClose={closeFeedbackModal}
        title="给开发者留言"
      >
        <form className="flex flex-col gap-4" onSubmit={handleFeedbackSubmit}>
          <div>
            <label className="text-xs text-pencil font-sans">留言内容（必填）</label>
            <textarea
              value={feedbackContent}
              onChange={(e) => setFeedbackContent(e.target.value)}
              className="w-full mt-2 h-28 resize-none border-2 border-gray-200 rounded-lg p-3 text-sm font-sans focus:border-ink outline-none"
              placeholder="说点什么吧..."
              maxLength={2100}
            />
          </div>
          <div>
            <label className="text-xs text-pencil font-sans">邮箱（选填）</label>
            <input
              type="email"
              value={feedbackEmail}
              onChange={(e) => setFeedbackEmail(e.target.value)}
              className="w-full mt-2 h-10 border-2 border-gray-200 rounded-lg px-3 text-sm font-sans focus:border-ink outline-none"
              placeholder="name@example.com"
            />
            <p className="mt-2 text-xs text-pencil font-sans">
              如果期待开发者的回复，请正确填写邮箱信息
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-pencil font-sans">微信（可选）</label>
              <input
                type="text"
                value={feedbackWechat}
                onChange={(e) => setFeedbackWechat(e.target.value)}
                className="w-full mt-2 h-10 border-2 border-gray-200 rounded-lg px-3 text-sm font-sans focus:border-ink outline-none"
                placeholder="微信号"
              />
            </div>
            <div>
              <label className="text-xs text-pencil font-sans">QQ（可选）</label>
              <input
                type="text"
                value={feedbackQq}
                onChange={(e) => setFeedbackQq(e.target.value)}
                className="w-full mt-2 h-10 border-2 border-gray-200 rounded-lg px-3 text-sm font-sans focus:border-ink outline-none"
                placeholder="QQ号"
              />
            </div>
          </div>
          <p className="text-xs text-pencil font-sans">为避免滥用，每小时仅可留言一次。</p>
          <div className="flex gap-3">
            <SketchButton
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={closeFeedbackModal}
            >
              取消
            </SketchButton>
            <SketchButton
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={feedbackSubmitting}
            >
              {feedbackSubmitting ? '发送中...' : '发送留言'}
            </SketchButton>
          </div>
        </form>

        <Turnstile ref={feedbackTurnstileRef} action="feedback" enabled={feedbackOpen} />
      </Modal>
    </div>
  );
};

export default HomeView;
