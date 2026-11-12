import { useT } from '../i18n';
import { Icon, type IconName } from '../ui/Icon';
import { setTheme, useThemeChoice, type ThemeChoice } from './theme';

const CHOICES: readonly { id: ThemeChoice; icon: IconName }[] = [
  { id: 'light', icon: 'sun' },
  { id: 'dark', icon: 'moon' },
  { id: 'auto', icon: 'contrast' },
];

/** Light, dark or the system's choice, as three pressed-or-not buttons. */
export function ThemeSwitch() {
  const t = useT().prefs;
  const choice = useThemeChoice();
  return (
    <div className="seg" role="group" aria-label={t.theme}>
      {CHOICES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={choice === option.id}
          aria-label={t[option.id]}
          title={t[option.id]}
          onClick={() => {
            setTheme(option.id);
          }}
        >
          <Icon name={option.icon} />
        </button>
      ))}
    </div>
  );
}
