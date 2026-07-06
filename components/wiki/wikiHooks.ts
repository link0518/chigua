import { useCallback, useEffect, useRef, useState } from 'react';

import { WIKI_MOBILE_FEED_QUERY } from './wikiConstants';
import type { WikiFeedback } from './wikiTypes';

export const useWikiMobileFeed = () => {
  const [enabled, setEnabled] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(WIKI_MOBILE_FEED_QUERY).matches
  ));

  useEffect(() => {
    const media = window.matchMedia(WIKI_MOBILE_FEED_QUERY);
    const handleChange = () => setEnabled(media.matches);
    handleChange();

    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return enabled;
};

export const useEscapeToClose = (enabled: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onClose]);
};

export const useWikiFeedback = () => {
  const [feedback, setFeedback] = useState<WikiFeedback | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const feedbackSeedRef = useRef(0);

  const showFeedback = useCallback((message: string, type: WikiFeedback['type'] = 'success') => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    const duration = type === 'error' ? 4200 : type === 'info' ? 3200 : 2600;
    feedbackSeedRef.current += 1;
    setFeedback({
      id: feedbackSeedRef.current,
      message,
      type,
      duration,
    });
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, duration);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  return { feedback, showFeedback };
};
