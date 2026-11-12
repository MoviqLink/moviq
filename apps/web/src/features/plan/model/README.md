# Conversation model

- `conversation.ts`: what was said, Sara's latest answer, the message on its way and the one that
  failed, as pure steps. A message is sent only when none is waiting.
- `store.ts`: sends each message with the conversation id and the language, keeps only the newest
  request alive, records failures by kind and sends the same message again on retry.
- `city.ts`: the sources under a city answer as the discreet line says them: the time of their
  data, or their state when they cannot be relied on, never a time for those.
