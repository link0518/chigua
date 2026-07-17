import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { ViewType } from '@/types';

const STREAK7_LOCAL_SEEN_KEY = 'easter:streak7:seen:v1';

interface UseStreakCelebrationOptions {
  backgroundTasksReady: boolean;
  currentView: ViewType;
}

export const useStreakCelebration = ({
  backgroundTasksReady,
  currentView,
}: UseStreakCelebrationOptions) => {
  const [streakCelebrationOpen, setStreakCelebrationOpen] = useState(false);
  const [streakCelebrationDays, setStreakCelebrationDays] = useState(7);
  const streakCelebrationMarkedRef = useRef(false);

  useEffect(() => {
    if (!backgroundTasksReady) {
      return;
    }
    if (currentView !== ViewType.HOME) {
      return;
    }
    if (window.location.pathname !== '/') {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const localSeen = localStorage.getItem(STREAK7_LOCAL_SEEN_KEY) === '1';
        if (localSeen) {
          return;
        }
        const data = await api.getStreak7Status();
        if (cancelled) {
          return;
        }
        if (data?.unlocked && !data?.alreadyShown) {
          streakCelebrationMarkedRef.current = false;
          setStreakCelebrationDays(Number(data?.streakDays || 7));
          setStreakCelebrationOpen(true);
        }
      } catch {
        // 忽略彩蛋检查失败
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [backgroundTasksReady, currentView]);

  const closeStreakCelebration = useCallback(() => {
    setStreakCelebrationOpen(false);
    if (streakCelebrationMarkedRef.current) {
      return;
    }
    streakCelebrationMarkedRef.current = true;
    try {
      localStorage.setItem(STREAK7_LOCAL_SEEN_KEY, '1');
    } catch {
      // ignore
    }
    api.markStreak7Seen().catch(() => { });
  }, []);

  useEffect(() => {
    if (currentView === ViewType.HOME) {
      return;
    }
    if (!streakCelebrationOpen) {
      return;
    }
    closeStreakCelebration();
  }, [closeStreakCelebration, currentView, streakCelebrationOpen]);

  return {
    streakCelebrationOpen,
    streakCelebrationDays,
    closeStreakCelebration,
  };
};
