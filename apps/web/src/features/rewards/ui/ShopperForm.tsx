import { allergenSchema, type Taste } from '@moviq/contracts';
import { useId, useState, type SubmitEvent } from 'react';

import type { Shopper } from '../model/shopper';
import { useRewardsT } from '../texts';

const DIETS: readonly Taste['diet'][] = ['any', 'vegetarian', 'vegan'];

/** The nine major allergens, each one ruled out on every menu when ticked. */
function Allergies(props: {
  readonly chosen: Taste['allergies'];
  readonly onChange: (allergies: Taste['allergies']) => void;
}) {
  const t = useRewardsT();
  return (
    <fieldset>
      <legend>{t.shopper.allergies}</legend>
      {allergenSchema.options.map((allergen) => (
        <label key={allergen} className="reward-check">
          <input
            type="checkbox"
            checked={props.chosen.includes(allergen)}
            onChange={(event) => {
              const others = props.chosen.filter((a) => a !== allergen);
              props.onChange(event.target.checked ? [...others, allergen] : others);
            }}
          />
          {t.allergens[allergen]}
        </label>
      ))}
    </fieldset>
  );
}

interface Props {
  readonly shopper: Shopper;
  /** Saves on this device; false when the contract refuses it. */
  readonly onSave: (shopper: Shopper) => boolean;
}

/** What Sara may tell the merchants, shown in full and changed here: alias, diet, alcohol, allergies. */
export function ShopperForm({ shopper, onSave }: Props) {
  const t = useRewardsT();
  const s = t.shopper;
  const ids = useId();
  const [alias, setAlias] = useState(shopper.alias);
  const [taste, setTaste] = useState<Taste>(shopper.taste);
  const [said, setSaid] = useState<'saved' | 'invalid' | null>(null);
  const change = (next: Partial<Taste>) => {
    setTaste({ ...taste, ...next });
    setSaid(null);
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaid(onSave({ alias: alias.trim(), taste }) ? 'saved' : 'invalid');
  };
  return (
    <details className="reward-shopper">
      <summary>{s.title}</summary>
      <form onSubmit={submit}>
        <p className="reward-quiet">{s.lead}</p>
        <label htmlFor={`${ids}-alias`}>{s.alias}</label>
        <input
          id={`${ids}-alias`}
          value={alias}
          maxLength={24}
          autoComplete="off"
          aria-describedby={`${ids}-alias-help`}
          onChange={(event) => {
            setAlias(event.target.value);
            setSaid(null);
          }}
        />
        <p id={`${ids}-alias-help`} className="reward-quiet">
          {s.aliasHelp}
        </p>
        <label htmlFor={`${ids}-diet`}>{s.diet}</label>
        <select
          id={`${ids}-diet`}
          value={taste.diet}
          onChange={(event) => {
            change({ diet: DIETS.find((diet) => diet === event.target.value) ?? 'any' });
          }}
        >
          {DIETS.map((diet) => (
            <option key={diet} value={diet}>
              {s.diets[diet]}
            </option>
          ))}
        </select>
        <label className="reward-check">
          <input
            type="checkbox"
            checked={taste.noAlcohol}
            onChange={(event) => {
              change({ noAlcohol: event.target.checked });
            }}
          />
          {s.noAlcohol}
        </label>
        <Allergies
          chosen={taste.allergies}
          onChange={(allergies) => {
            change({ allergies });
          }}
        />
        <button type="submit" className="btn small">
          {s.save}
        </button>
        {said !== null && (
          <p className="reward-quiet" role="status">
            {said === 'saved' ? s.saved : s.invalid}
          </p>
        )}
      </form>
    </details>
  );
}
