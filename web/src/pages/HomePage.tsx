import { ArrowRight, Robot, SlidersHorizontal, Timer } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import type { CatalogResponse, InterviewType, InterviewTypeId } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { HistoryList } from '../components/HistoryList.tsx';
import { SetupPanel } from '../components/SetupPanel.tsx';
import { StartForm } from '../components/StartForm.tsx';
import { useResource } from '../hooks/useResource.ts';

const TYPE_ICON: Record<InterviewTypeId, ReactNode> = {
  karat: <Timer size={22} aria-hidden="true" />,
  ai: <Robot size={22} aria-hidden="true" />,
  custom: <SlidersHorizontal size={22} aria-hidden="true" />,
};

function TypeCard({ type, catalog, onChoose }: { type: InterviewType; catalog: CatalogResponse; onChoose: () => void }) {
  const names = new Map(catalog.roundTypes.map((round) => [round.id, round.name]));
  return (
    <li className="card type-card">
      <div className="type-card-head">
        <h2 className="type-card-name">
          {TYPE_ICON[type.id]}
          {type.name}
        </h2>
        <button type="button" className="button button-primary" onClick={onChoose} disabled={!type.available}>
          Set up
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="type-card-summary">{type.summary}</p>
      {type.rounds.length > 0 && (
        <ol className="round-list" aria-label={`Rounds in the ${type.name}`}>
          {type.rounds.map((round, index) => (
            <li key={index} className="round-chip">
              {names.get(round.type)}
              <span className="minutes">{round.minutes} min</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function HomePage() {
  const [catalog, reloadCatalog] = useResource(api.catalog);
  const [setup, recheckSetup] = useResource(api.setup);
  const [history, reloadHistory] = useResource(api.interviews);
  const [chosen, setChosen] = useState<InterviewTypeId | null>(null);

  const chosenType = catalog.data?.interviewTypes.find((type) => type.id === chosen);

  return (
    <main id="main" tabIndex={-1} className="shell-main shell-main-home">
      <div className="stack stack-wide">
        {chosenType && catalog.data ? (
          <StartForm type={chosenType} catalog={catalog.data} setup={setup.data} onBack={() => setChosen(null)} />
        ) : (
          <section aria-labelledby="types-title">
            <h1 id="types-title" className="section-title">
              Choose an interview
            </h1>
            <p className="section-lead">Every interview is timed, asks follow-up questions and ends with a scored report.</p>
            {catalog.status === 'error' && (
              <div className="card notice notice-danger gap-top" role="alert">
                <p>{catalog.message}</p>
                <button type="button" className="button" onClick={reloadCatalog}>
                  Try again
                </button>
              </div>
            )}
            {!catalog.data && catalog.status === 'loading' && (
              <div className="type-list" aria-busy="true">
                <span className="visually-hidden">Loading interview types</span>
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
            )}
            {catalog.data && (
              <ul className="type-list">
                {catalog.data.interviewTypes.map((type) => (
                  <TypeCard key={type.id} type={type} catalog={catalog.data!} onChoose={() => setChosen(type.id)} />
                ))}
              </ul>
            )}
          </section>
        )}
        <HistoryList history={history} onChanged={reloadHistory} />
      </div>
      <SetupPanel setup={setup} onRecheck={recheckSetup} />
    </main>
  );
}
