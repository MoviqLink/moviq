import { useId, type KeyboardEvent, type RefObject, type SubmitEvent } from 'react';

import { Icon } from '../../../shared/ui/Icon';
import { usePlanT } from '../texts';

interface Props {
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly onSend: (text: string) => void;
  /** True while Sara is answering: the person can keep typing, not send. */
  readonly waiting: boolean;
  readonly field: RefObject<HTMLTextAreaElement | null>;
  /** True once the conversation has started: the field invites an answer, not a question. */
  readonly started: boolean;
}

/** Where the person writes to Sara. Enter sends; Shift and Enter starts a new line. */
export function Composer({ text, onText, onSend, waiting, field, started }: Props) {
  const t = usePlanT();
  const id = useId();
  const empty = text.trim() === '';

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!empty && !waiting) onSend(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!empty && !waiting) onSend(text);
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        {t.composer}
      </label>
      <textarea
        id={id}
        ref={field}
        rows={2}
        maxLength={2000}
        value={text}
        placeholder={started ? t.reply : t.question}
        onChange={(event) => {
          onText(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="btn primary composer-send" disabled={empty || waiting}>
        {waiting ? t.sending : t.send}
        {!waiting && <Icon name="send" />}
      </button>
    </form>
  );
}
