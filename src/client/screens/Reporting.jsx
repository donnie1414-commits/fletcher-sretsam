import { useState } from 'react';
import { Segmented } from '../ui.jsx';
import { Summary } from './reporting/Summary.jsx';
import { Portfolio } from './reporting/Portfolio.jsx';
import { Weekly } from './reporting/Weekly.jsx';
import { Deck } from './reporting/Deck.jsx';

/** Reporting = Summary · Leasing Details · Weekly (§3.1). Present mode is a deck built from the weekly route. */
export function Reporting({ sel, sub, setSub, rt, setRt, density, presentation, boot }) {
  const [deck, setDeck] = useState(false);
  return (
    <div className={sub === 'portfolio' ? 'screen fill' : 'screen'}>
      {!presentation && <div className="subnav"><Segmented ariaLabel="Reporting view" value={sub} onChange={setSub} options={[{ value: 'summary', label: 'Summary' }, { value: 'portfolio', label: 'Leasing Details' }, { value: 'weekly', label: 'Weekly' }]} /></div>}
      {sub === 'summary' && <Summary sel={sel} presentation={presentation} />}
      {sub === 'portfolio' && <Portfolio sel={sel} density={density} rt={rt} setRt={setRt} />}
      {sub === 'weekly' && <Weekly sel={sel} boot={boot} onPresent={() => setDeck(true)} />}
      {deck && <Deck sel={sel} boot={boot} onExit={() => setDeck(false)} />}
    </div>
  );
}
