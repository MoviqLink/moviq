import { WEEKDAYS } from '@moviq/contracts';

import { Icon } from '../../../shared/ui/Icon';
import { MAX_STRETCHES, withStretch, type HoursForm, type StretchForm } from '../model/hours';
import type { Weekday } from '../schemas';
import { useMerchantT } from '../texts';

const minutesOf = (time: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
};

/** A day as a line of 24 hours, with its open stretches drawn on it. */
function DayLine({ slots }: { slots: readonly StretchForm[] }) {
  const day = 24 * 60;
  return (
    <span className="mc-dayline" aria-hidden="true">
      {slots.map((slot, index) => {
        const opens = minutesOf(slot.opens);
        const closes = minutesOf(slot.closes);
        if (opens === null || closes === null || closes <= opens) return null;
        return (
          <span
            key={index}
            className="mc-dayline-open"
            style={{
              left: `${String((opens / day) * 100)}%`,
              width: `${String(((closes - opens) / day) * 100)}%`,
            }}
          />
        );
      })}
    </span>
  );
}

function Stretch(props: {
  day: string;
  n: number;
  slot: StretchForm;
  invalid: boolean;
  onChange: (slot: StretchForm) => void;
  onRemove: () => void;
}) {
  const t = useMerchantT().hours;
  const time = (field: 'opens' | 'closes', label: string) => (
    <input
      className="mono mc-time"
      inputMode="numeric"
      aria-label={label}
      aria-invalid={props.invalid}
      value={props.slot[field]}
      maxLength={5}
      onChange={(event) => {
        props.onChange({ ...props.slot, [field]: event.target.value });
      }}
    />
  );
  return (
    <span className="mc-stretch">
      {time('opens', t.opens(props.day, props.n))}
      <span className="mc-unit">{t.to}</span>
      {time('closes', t.closes(props.day, props.n))}
      <button
        type="button"
        className="mc-icon-btn"
        aria-label={t.remove(props.day, props.n)}
        onClick={props.onRemove}
      >
        <Icon name="close" />
      </button>
    </span>
  );
}

/** The opening hours of "Your agent": each day of the week, its stretches and its line. */
export function AgentHours(props: {
  form: HoursForm;
  errors: Partial<Record<Weekday | 'week', string>>;
  onChange: (form: HoursForm) => void;
}) {
  const t = useMerchantT().hours;
  const { form, errors } = props;
  const setSlot = (day: Weekday, index: number, slot: StretchForm) => {
    props.onChange({ ...form, [day]: form[day].map((old, at) => (at === index ? slot : old)) });
  };
  return (
    <fieldset className="mc-hours" aria-describedby="mc-hours-hint">
      <legend>{t.title}</legend>
      <p className="mc-note">{t.lead}</p>
      <ul>
        {WEEKDAYS.map((day) => {
          const name = t.days[day];
          const slots = form[day];
          return (
            <li key={day} className="mc-hours-day">
              <span className="mc-hours-name">{name}</span>
              <DayLine slots={slots} />
              <span className="mc-hours-slots">
                {slots.length === 0 && <span className="mc-note">{t.closed}</span>}
                {slots.map((slot, index) => (
                  <Stretch
                    key={index}
                    day={name}
                    n={index + 1}
                    slot={slot}
                    invalid={errors[day] !== undefined}
                    onChange={(next) => {
                      setSlot(day, index, next);
                    }}
                    onRemove={() => {
                      props.onChange(withStretch(form, day, index));
                    }}
                  />
                ))}
                {slots.length < MAX_STRETCHES && (
                  <button
                    type="button"
                    className="btn small mc-add"
                    aria-label={t.add(name)}
                    onClick={() => {
                      props.onChange(withStretch(form, day, 'add'));
                    }}
                  >
                    {t.addShort}
                  </button>
                )}
              </span>
              {errors[day] !== undefined && <p className="error mc-hours-error">{errors[day]}</p>}
            </li>
          );
        })}
      </ul>
      <p id="mc-hours-hint" className={errors.week === undefined ? 'hint' : 'error'}>
        {errors.week ?? t.hint}
      </p>
    </fieldset>
  );
}
