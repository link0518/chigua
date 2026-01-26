import React, { useEffect, useMemo, useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, MoreHorizontal, Flag, Share2, UserX } from 'lucide-react';
import { Post } from '../types';
import { Badge, roughBorderClassSm } from './SketchUI';
import { useApp } from '../store/AppContext';
import ReportModal from './ReportModal';
import CommentModal from './CommentModal';
import MarkdownRenderer from './MarkdownRenderer';
import DeveloperMiniCard from './DeveloperMiniCard';

type FilterType = 'week' | 'today' | 'all';
const DISPLAY_LIMIT = 10;

const PostItem: React.FC<{
  post: Post;
  rank?: number;
  onLike: () => void;
  onDislike: () => void;
  onComment: () => void;
  onCommentClose: () => void;
  commentOpen: boolean;
  onShare: () => void;
  onReport: () => void;
  isLiked: boolean;
  isDisliked: boolean;
}> = ({ post, rank, onLike, onDislike, onComment, onCommentClose, commentOpen, onShare, onReport, isLiked, isDisliked }) => {
  const isDeveloperPost = post.author === 'admin';
  return (
    <div className={`relative group ${rank ? 'mb-10' : 'mb-6'}`}>
      {/* Rank Badge */}
      {rank && rank <= 3 && (
        <div className="absolute -left-3 md:-left-6 -top-4 z-10 transition-transform group-hover:scale-110 duration-200">
           <div className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center font-display text-2xl md:text-3xl text-ink border-2 border-ink rounded-full shadow-md ${rank === 1 ? 'bg-alert rotate-[-12deg]' : rank === 2 ? 'bg-white rotate-6' : 'bg-highlight rotate-[-3deg]'}`}>
             {rank}
           </div>
        </div>
      )}

      <div className={`bg-white border-2 border-ink p-6 transition-all hover:-translate-y-1 duration-200 ${rank && rank <= 3 ? 'shadow-sketch-lg hover:shadow-sketch-hover ' + roughBorderClassSm : 'shadow-sketch hover:shadow-sketch border-ink rounded-lg'}`}>

        {/* Header Tags */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {post.isHot && <Badge color="bg-highlight">🔥 热门</Badge>}
          {post.tags?.map(tag => (
             <Badge key={tag}>{tag}</Badge>
          ))}
        </div>

        {/* Content - Markdown Rendered */}
        <div className="font-sans text-lg text-ink leading-relaxed mb-4">
          <MarkdownRenderer content={post.content} />
        </div>

        {/* Anonymous Info */}
        <div className="flex items-center gap-2 mb-4 text-sm text-pencil">
          {isDeveloperPost ? (
            <DeveloperMiniCard size="sm" timestamp={post.timestamp} />
          ) : (
            <>
              <UserX className="w-4 h-4" />
              <span className="font-hand font-bold">匿名用户</span>
              <span>•</span>
              <span>{post.timestamp}</span>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t-2 border-dashed border-gray-100">
          <div className="flex items-center gap-6 text-pencil font-hand font-bold">
            <button
              onClick={onLike}
              className={`flex items-center gap-1 transition-colors group/btn ${isLiked ? 'text-blue-600' : 'hover:text-ink'}`}
            >
              <ThumbsUp className={`w-5 h-5 group-hover/btn:scale-110 transition-transform ${isLiked ? 'fill-current' : ''}`} />
              <span>{post.likes > 1000 ? (post.likes / 1000).toFixed(1) + 'k' : post.likes}</span>
            </button>
            <button
              onClick={onDislike}
              className={`flex items-center gap-1 transition-colors ${isDisliked ? 'text-red-600' : 'hover:text-ink'}`}
            >
              <ThumbsDown className={`w-5 h-5 mt-1 ${isDisliked ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={onComment}
              className="flex items-center gap-1 hover:text-ink transition-colors ml-auto"
            >
              <MessageSquare className="w-5 h-5" />
              <span>{post.comments}</span>
            </button>
            <button
              onClick={onShare}
              className="flex items-center gap-1 hover:text-ink transition-colors"
            >
              <Share2 className="w-5 h-5" />
              <span>分享</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onReport}
              className="flex items-center gap-1 text-gray-400 hover:text-red-600 transition-colors text-sm"
            >
              <Flag className="w-4 h-4" />
            </button>
            <button className="text-pencil hover:text-ink">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>

        <CommentModal
          isOpen={commentOpen}
          onClose={onCommentClose}
          postId={post.id}
          contentPreview={post.content}
        />

      </div>
    </div>
  );
};

const FeedView: React.FC = () => {
  const { state, loadFeedPosts, likePost, dislikePost, isLiked, isDisliked, showToast } = useApp();
  const [filter, setFilter] = useState<FilterType>('today');
  const [reportModal, setReportModal] = useState<{ isOpen: boolean; postId: string; content: string }>({
    isOpen: false,
    postId: '',
    content: '',
  });
  const [commentModal, setCommentModal] = useState<{ isOpen: boolean; postId: string; content: string }>({
    isOpen: false,
    postId: '',
    content: '',
  });

  useEffect(() => {
    loadFeedPosts(filter).catch(() => {});
    setCommentModal({ isOpen: false, postId: '', content: '' });
  }, [filter, loadFeedPosts]);

  const posts = useMemo(() => {
    const allPosts = state.feedPosts;
    // Add ranks to top posts
    return allPosts.map((post, index) => ({
      ...post,
      rank: index + 1,
    }));
  }, [state.feedPosts]);

  const displayedPosts = posts.slice(0, DISPLAY_LIMIT);

  const handleLike = async (postId: string) => {
    try {
      await likePost(postId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '点赞失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const handleDislike = async (postId: string) => {
    try {
      await dislikePost(postId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const handleReport = (postId: string, content: string) => {
    setReportModal({ isOpen: true, postId, content });
  };

  const handleShare = async (postId: string) => {
    const shareUrl = `${window.location.origin}/post/${encodeURIComponent(postId)}`;
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

  const handleComment = (postId: string, content: string) => {
    setCommentModal((prev) => {
      if (prev.isOpen && prev.postId === postId) {
        return { isOpen: false, postId: '', content: '' };
      }
      return { isOpen: true, postId, content };
    });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <div className="text-center mb-10 relative">
        <h2 className="font-display text-4xl inline-block relative z-10">
          热门内容
          <div className="absolute -bottom-2 left-0 w-full h-3 bg-alert/50 -z-10 -rotate-1 skew-x-12"></div>
        </h2>

        {/* Filter Tabs */}
        <div className="flex justify-center gap-6 mt-6 font-hand text-xl font-bold text-pencil">
          <button
            onClick={() => { setFilter('today'); }}
            className={`transition-all ${filter === 'today' ? 'text-ink underline decoration-wavy decoration-alert underline-offset-4' : 'hover:text-ink'}`}
          >
            今日
          </button>
          <button
            onClick={() => { setFilter('week'); }}
            className={`transition-all ${filter === 'week' ? 'text-ink underline decoration-wavy decoration-alert underline-offset-4' : 'hover:text-ink'}`}
          >
            近7天
          </button>
          <button
            onClick={() => { setFilter('all'); }}
            className={`transition-all ${filter === 'all' ? 'text-ink underline decoration-wavy decoration-alert underline-offset-4' : 'hover:text-ink'}`}
          >
            历史
          </button>
        </div>

        {/* Post Count */}
        <div className="mt-4 text-sm text-pencil">
          共 {state.feedTotal} 条内容，仅展示前 {DISPLAY_LIMIT} 条
        </div>
      </div>

      {/* Posts List */}
      <div className="flex flex-col">
        {displayedPosts.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-6xl mb-4 block">🍉</span>
            <h3 className="font-display text-2xl text-ink mb-2">暂无内容</h3>
            <p className="font-hand text-lg text-pencil">快去投稿第一个瓜吧！</p>
          </div>
        ) : (
          displayedPosts.map(post => (
            <PostItem
              key={post.id}
              post={post}
              rank={post.rank}
              onLike={() => handleLike(post.id)}
              onDislike={() => handleDislike(post.id)}
              onComment={() => handleComment(post.id, post.content)}
              onCommentClose={() => setCommentModal({ isOpen: false, postId: '', content: '' })}
              commentOpen={commentModal.isOpen && commentModal.postId === post.id}
              onShare={() => handleShare(post.id)}
              onReport={() => handleReport(post.id, post.content)}
              isLiked={isLiked(post.id)}
              isDisliked={isDisliked(post.id)}
            />
          ))
        )}
      </div>

      {/* End of List */}
      {posts.length > 0 && (
        <div className="text-center mt-8 py-4">
          <span className="font-hand text-pencil">~ 已展示前 {DISPLAY_LIMIT} 条 ~</span>
        </div>
      )}

      {/* Report Modal */}
      <ReportModal
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal({ isOpen: false, postId: '', content: '' })}
        postId={reportModal.postId}
        contentPreview={reportModal.content.substring(0, 80)}
      />

    </div>
  );
};

export default FeedView;
