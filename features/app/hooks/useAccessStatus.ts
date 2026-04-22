import { useEffect, useState } from 'react';
import { api } from '@/api';

export const useAccessStatus = () => {
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [accessExpiresAt, setAccessExpiresAt] = useState<number | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    api.getAccessStatus()
      .then((data) => {
        if (data?.blocked || data?.viewBlocked) {
          setAccessBlocked(true);
          setAccessExpiresAt(typeof data?.expiresAt === 'number' ? data.expiresAt : null);
        }
      })
      .catch(() => { })
      .finally(() => {
        setAccessChecked(true);
      });
  }, []);

  return {
    accessBlocked,
    accessExpiresAt,
    accessChecked,
  };
};
