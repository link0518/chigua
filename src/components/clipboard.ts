export const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('复制失败');
  }
};

export const buildPostPath = (
  postId: string,
  commentId?: string | null,
  options?: { homeIndex?: number | null }
) => {
  const params = new URLSearchParams();
  if (commentId) {
    params.set('comment', commentId);
  }
  if (typeof options?.homeIndex === 'number' && Number.isFinite(options.homeIndex) && options.homeIndex >= 0) {
    params.set('homeIndex', String(Math.floor(options.homeIndex)));
  }
  const qs = params.toString();
  const basePath = `/post/${encodeURIComponent(postId)}`;
  return qs ? `${basePath}?${qs}` : basePath;
};

export const buildPostShareUrl = (postId: string) => (
  `${window.location.origin}${buildPostPath(postId)}`
);
