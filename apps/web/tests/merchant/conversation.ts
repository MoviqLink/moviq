import { conversationEntrySchema, type ConversationEntry } from '@moviq/contracts';

const AT = '2026-11-11T16:00:00.000Z';

/** A conversation with every kind of message, as the server writes it for one request. */
export const CONVERSATION: ConversationEntry[] = [
  {
    type: 'need',
    from: 'sara',
    alias: 'Mia',
    craving: 'ramen',
    category: 'meal',
    pickupAfter: '2026-11-11T16:10:00.000Z',
    pickupBefore: '2026-11-11T16:40:00.000Z',
    preferences: {
      allergies: ['peanuts'],
      avoid: ['scallions'],
      noAlcohol: true,
      diet: 'any',
      drink: 'cola',
    },
  },
  {
    type: 'clarification',
    from: 'merchant-agent',
    topic: 'spice',
    question: 'Mild or hot for the Tonkotsu ramen?',
    options: ['mild', 'hot'],
  },
  { type: 'answer', from: 'sara', topic: 'spice', answer: 'hot', basis: 'profile' },
  {
    type: 'offer',
    from: 'merchant-agent',
    lines: [{ itemId: 'tr-tonkotsu', quantity: 1, remove: ['scallions'], add: ['chili oil'] }],
    priceMinor: 1616,
    pickupAt: '2026-11-11T16:20:00.000Z',
    note: 'Made for you: Tonkotsu ramen, without scallions, with chili oil.',
  },
  {
    type: 'check',
    from: 'server',
    verdict: 'rejected',
    refusals: [{ reason: 'discount-above-maximum', message: 'The discount is above 5%.' }],
    reward: null,
  },
  {
    type: 'refused-message',
    from: 'server',
    of: 'merchant-agent',
    reason: 'The price was written as text.',
  },
  {
    type: 'offer',
    from: 'merchant-agent',
    lines: [{ itemId: 'tr-gyoza', quantity: 2, remove: [], add: [] }],
    priceMinor: 1611,
    pickupAt: '2026-11-11T16:20:00.000Z',
    note: 'Two portions.',
  },
  {
    type: 'check',
    from: 'server',
    verdict: 'accepted',
    refusals: [],
    reward: {
      listPrice: { amountMinor: 1790, currency: 'USD' },
      price: { amountMinor: 1611, currency: 'USD' },
      earned: { amountMinor: 179, currency: 'USD' },
      percent: 10,
    },
  },
  { type: 'recommendation', from: 'sara', offerId: 'offer-1', reason: 'The best reward.' },
  {
    type: 'payment',
    from: 'server',
    step: 'authorized',
    amount: { amountMinor: 1611, currency: 'USD' },
  },
  { type: 'order', from: 'server', code: 'T-1001', status: 'reserved' },
  { type: 'declined', from: 'sara', offerId: 'offer-2' },
  {
    type: 'closed',
    from: 'server',
    reason: 'no-valid-offer',
    message: 'No offer passed the checks.',
  },
].map((message, index) => conversationEntrySchema.parse({ seq: index + 1, at: AT, message }));
