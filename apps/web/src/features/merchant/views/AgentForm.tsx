import { RULE_FIELDS, type RuleField } from '../model/rules';
import type { AgentSetup } from '../schemas';
import { useMerchantT, type MerchantDict } from '../texts';
import { ProblemNote } from '../ui/ProblemNote';
import { AgentHours } from './AgentHours';
import { useAgentDraft } from './useAgentDraft';

function labels(t: MerchantDict['agent'], minimum: number) {
  return {
    maxDiscountPercent: [t.maxDiscount, t.maxDiscountHint(minimum), t.percent],
    minMarginPercent: [t.minMargin, t.minMarginHint, t.percent],
    ordersPerQuarterHour: [t.capacity, t.capacityHint, ''],
    prepMinutes: [t.prep, t.prepHint, t.minutes],
  } as const satisfies Record<RuleField, readonly [string, string, string]>;
}

function NumberField(props: {
  field: RuleField;
  text: readonly [string, string, string];
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const [label, hint, unit] = props.text;
  const id = `mc-rule-${props.field}`;
  return (
    <div className="field mc-rule">
      <label htmlFor={id}>{label}</label>
      <span className="mc-rule-input">
        <input
          id={id}
          className="mono"
          inputMode="numeric"
          value={props.value}
          aria-invalid={props.error !== undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
        {unit !== '' && <span className="mc-unit">{unit}</span>}
      </span>
      <p id={`${id}-hint`} className={props.error === undefined ? 'hint' : 'error'}>
        {props.error ?? hint}
      </p>
    </div>
  );
}

/** The list with `id` taken out if it was in, or added at the end if it was not. */
const toggled = (list: readonly string[], id: string): string[] =>
  list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

/** The dishes the agent offers first, up to five, from the menu. */
function Featured(props: {
  menu: AgentSetup['menu'];
  chosen: readonly string[];
  error: string | undefined;
  onToggle: (id: string) => void;
}) {
  const t = useMerchantT().agent;
  return (
    <fieldset className="mc-checks">
      <legend>{t.featured}</legend>
      <p className={props.error === undefined ? 'hint' : 'error'}>
        {props.error ?? t.featuredHint}
      </p>
      {props.menu.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            checked={props.chosen.includes(item.id)}
            onChange={() => {
              props.onToggle(item.id);
            }}
          />
          {item.name}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The rules and opening hours of "Your agent", checked against the program's minimum and the
 * hours rule before the server sees them, and saved together.
 */
export function AgentForm(props: {
  setup: AgentSetup;
  said: string | null;
  onSaved: (said: string) => void;
}) {
  const { setup } = props;
  const t = useMerchantT().agent;
  const draft = useAgentDraft(setup, props.onSaved);
  const { rules: form, errors, save } = draft;
  const text = labels(t, setup.minRewardPercent);
  const invalid = Object.keys(errors).length > 0;
  return (
    <form
      className="mc-panel mc-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        draft.submit();
      }}
    >
      <div className="mc-rules">
        {RULE_FIELDS.map((field) => (
          <NumberField
            key={field}
            field={field}
            text={text[field]}
            value={form.values[field]}
            error={errors[field]}
            onChange={(value) => {
              draft.setRules({ ...form, values: { ...form.values, [field]: value } });
            }}
          />
        ))}
      </div>
      <Featured
        menu={setup.menu}
        chosen={form.featuredItemIds}
        error={errors.featuredItemIds}
        onToggle={(id) => {
          draft.setRules({ ...form, featuredItemIds: toggled(form.featuredItemIds, id) });
        }}
      />
      <AgentHours form={draft.hours} errors={errors} onChange={draft.setHours} />
      {invalid && (
        <p className="error" role="alert">
          {t.fix}
        </p>
      )}
      <ProblemNote failure={save.failure} />
      <p className="mc-said" role="status">
        {props.said}
      </p>
      <div className="mc-form-end">
        <span className="mc-note mono">{t.version(setup.version)}</span>
        <button type="submit" className="btn primary" disabled={save.pending}>
          {save.pending ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}
