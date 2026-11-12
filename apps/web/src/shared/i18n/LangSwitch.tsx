import { setLang, useLang, type Lang } from './lang';

const LANGS: readonly { id: Lang; short: string; name: string }[] = [
  { id: 'en', short: 'EN', name: 'English' },
  { id: 'es', short: 'ES', name: 'Español' },
];

/** EN | ES at the right end of the header. The active language is filled. */
export function LangSwitch() {
  const lang = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="Language / Idioma">
      {LANGS.map((option, index) => (
        <span key={option.id} className="lang-item">
          {index > 0 && <span aria-hidden="true">|</span>}
          <button
            type="button"
            lang={option.id}
            aria-label={option.name}
            aria-pressed={lang === option.id}
            onClick={() => {
              setLang(option.id);
            }}
          >
            {option.short}
          </button>
        </span>
      ))}
    </div>
  );
}
