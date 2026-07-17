import { useEffect, useState } from 'react';

/** 响应媒体查询变化，避免组件只在首次渲染时判断移动端。 */
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
};

export default useMediaQuery;
