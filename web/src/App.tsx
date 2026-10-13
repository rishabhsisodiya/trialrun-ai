import { HomePage } from './pages/HomePage.tsx';
import { InterviewPage } from './pages/InterviewPage.tsx';
import { ReportPage } from './pages/ReportPage.tsx';
import { links, useRoute } from './router.ts';

export function App() {
  const route = useRoute();
  return (
    <>
      <a className="skip-link" href="#main" onClick={(event) => {
        // The hash is the router, so move focus by hand instead of changing it.
        event.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>
      <header className="shell-header">
        <div className="shell-header-inner">
          <a className="wordmark" href={links.home}>
            trialrun<span>ai</span>
          </a>
          <span className="tagline">Mock interviews on the coding agent you already use</span>
        </div>
      </header>
      {route.page === 'home' && <HomePage />}
      {route.page === 'interview' && <InterviewPage key={route.id} id={route.id} />}
      {route.page === 'report' && <ReportPage key={route.id} id={route.id} />}
    </>
  );
}
