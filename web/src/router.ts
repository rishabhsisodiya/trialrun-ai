import { useEffect, useState } from 'react';

export type Route = { page: 'home' } | { page: 'interview'; id: string } | { page: 'report'; id: string };

function parse(hash: string): Route {
  const [, page, id] = hash.split('/');
  if ((page === 'interview' || page === 'report') && id) return { page, id };
  return { page: 'home' };
}

export const links = {
  home: '#/',
  interview: (id: string) => `#/interview/${id}`,
  report: (id: string) => `#/report/${id}`,
};

export function navigate(to: string): void {
  window.location.hash = to;
}

/** The current page, read from the URL hash so every screen can be reloaded or bookmarked. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
