import { useId, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react';

import { Icon } from '../../shared/ui/Icon';
import { useHomeT } from './texts';

/**
 * The first words to Sara, on the photo. Enter sends; Shift and Enter starts a new line. The
 * message goes to the conversation, which goes on in `#/plan`.
 */
export function AskSara({ onAsk }: { onAsk: (message: string) => void }) {
  const t = useHomeT();
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const message = text.trim();

  const send = () => {
    if (message !== '') onAsk(message);
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <div className="ask">
      <form className="ask-form" onSubmit={submit}>
        <label htmlFor={id} className="visually-hidden">
          {t.composer}
        </label>
        <textarea
          id={id}
          ref={field}
          rows={2}
          maxLength={2000}
          value={text}
          placeholder={t.placeholder}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="btn primary ask-send" disabled={message === ''}>
          {t.send}
          <Icon name="send" />
        </button>
      </form>
      <p className="ask-example">
        {t.example}{' '}
        <button
          type="button"
          className="ask-use"
          onClick={() => {
            setText(t.exampleText);
            field.current?.focus();
          }}
        >
          {t.useExample}
        </button>
      </p>
    </div>
  );
}
