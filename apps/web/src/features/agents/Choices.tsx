import { useLang } from '../../shared/i18n/lang';
import './choices.css';

const WORDS = {
  en: {
    origin: 'Choose where you start',
    destination: 'Choose where you are going',
    pick: (n: number) => `Option ${String(n)}`,
  },
  es: {
    origin: 'Elige desde dónde sales',
    destination: 'Elige adónde vas',
    pick: (n: number) => `Opción ${String(n)}`,
  },
} as const;

/** "CENTRAL PARK ZOO, New York, NY, USA" as a name and where it is. */
function parts(label: string): { readonly name: string; readonly where: string } {
  const [name = label, ...rest] = label.split(',');
  return { name: name.trim(), where: rest.join(',').trim() };
}

/**
 * The places Sara offers, as buttons: pressing one answers her with its number, which she reads
 * as that choice. Only her latest question can be answered.
 */
export function Choices({
  slot,
  options,
  disabled,
  onPick,
}: {
  slot: 'origin' | 'destination';
  options: readonly string[];
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const t = WORDS[useLang()];
  return (
    <div className="agents-choices" role="group" aria-label={t[slot]}>
      {options.map((label, index) => {
        const { name, where } = parts(label);
        return (
          <button
            key={label}
            type="button"
            className="agents-choice"
            disabled={disabled}
            onClick={() => {
              onPick(t.pick(index + 1));
            }}
          >
            <span className="agents-choice-number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="agents-choice-text">
              <strong>{name}</strong>
              {where !== '' && <small>{where}</small>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
