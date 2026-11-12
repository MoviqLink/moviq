const s = String;

// The opening hours of "Your agent" and the preview of what it composes.
export const agentEn = {
  hours: {
    title: 'Opening hours',
    lead:
      'New York time. Your agent promises a pickup only inside these stretches, and no more ' +
      'orders in a quarter hour than your kitchen makes.',
    days: {
      mon: 'Monday',
      tue: 'Tuesday',
      wed: 'Wednesday',
      thu: 'Thursday',
      fri: 'Friday',
      sat: 'Saturday',
      sun: 'Sunday',
    },
    closed: 'Closed',
    to: 'to',
    opens: (day: string, n: number) => `${day}, stretch ${s(n)}, opens`,
    closes: (day: string, n: number) => `${day}, stretch ${s(n)}, closes`,
    add: (day: string) => `Add a stretch on ${day}`,
    addShort: 'Add',
    remove: (day: string, n: number) => `Remove stretch ${s(n)} on ${day}`,
    hint: 'HH:MM. 24:00 closes at midnight. Up to three stretches a day.',
    format: 'Write each time as HH:MM, for example 09:30; 24:00 closes at midnight.',
    overlap: 'These stretches overlap or are out of order. Put them one after the other.',
    endsBeforeStart: 'A stretch closes before it opens. Correct its times.',
    closedAllWeek: 'Open at least one stretch in the week, or your agent cannot offer anything.',
  },
  preview: {
    title: 'What your agent would offer now',
    lead:
      'Composed from your saved rules for three example customers and checked by the server as ' +
      'a real offer. Nothing is saved or sent, and the AI model is not used.',
    label: 'Example offers',
    exampleMark: 'example',
    asks: (craving: string) => `Asks for ${craving}`,
    noTags: 'Nothing that touches your menu',
    nothing: 'Your rules leave nothing to offer this customer.',
    nothingTodo: 'Feature another dish, or let the kitchen leave out more.',
    accepted: 'The server would accept it',
    rejected: 'The server would reject it',
    reward: (percent: number) => `${s(percent)} % reward`,
    ready: (time: string) => `Ready at ${time}`,
    composedAt: (time: string) => `Composed at ${time}`,
    again: 'Compose again',
    composing: 'Composing…',
  },
  talk: {
    title: 'Talk with your agent',
    lead:
      'Ask why it refused an offer, or change a rule in your own words. It answers from its ' +
      'real rules; a change is checked by the server and saved only when you confirm it.',
    label: 'Conversation with your agent',
    you: 'You',
    agent: 'Your agent',
    message: 'Message to your agent',
    placeholder: 'Why did you refuse the last offer? Raise the maximum discount to 30 %.',
    send: 'Send',
    sending: 'Your agent is thinking…',
    off:
      'Talking with your agent needs the AI model, and this server does not have it. ' +
      'Change the rules in the form: your agent follows them the same.',
    toForm: 'Go to the rules',
    unavailable:
      'Your agent could not answer right now. Try again, or change the rules in the form.',
    refused: 'The server would refuse that change:',
    proposal: 'Proposed change',
    change: (what: string, from: string, to: string) => `${what}: ${from} → ${to}`,
    none: 'none',
    nothingChanges: 'This proposal leaves every rule as it is.',
    apply: 'Save this change',
    applying: 'Saving…',
    dismiss: 'Not now',
    applied: 'Saved. Your agent follows the new rules from the next request.',
    dismissed: 'Left as it was. Nothing was saved.',
    stale: 'Your rules changed since this proposal. Ask again.',
  },
};
