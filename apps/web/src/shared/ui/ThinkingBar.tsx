import './traveller.css';

/**
 * Sara thinking: a bar that fills once in about 4 s and then stays full. It never loops; the
 * sentence beside it says what she is doing.
 */
export function ThinkingBar({ label }: { label: string }) {
  return (
    <div className="thinking" role="status">
      <span>{label}</span>
      <span className="thinking-bar" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}
