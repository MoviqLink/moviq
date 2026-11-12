import type { agentEn } from './agent-en';

const s = String;

export const agentEs: typeof agentEn = {
  hours: {
    title: 'Horario',
    lead:
      'Hora de Nueva York. Tu agente solo promete una recogida dentro de estas franjas, y nunca ' +
      'más pedidos por cuarto de hora de los que hace tu cocina.',
    days: {
      mon: 'Lunes',
      tue: 'Martes',
      wed: 'Miércoles',
      thu: 'Jueves',
      fri: 'Viernes',
      sat: 'Sábado',
      sun: 'Domingo',
    },
    closed: 'Cerrado',
    to: 'a',
    opens: (day: string, n: number) => `${day}, franja ${s(n)}, abre`,
    closes: (day: string, n: number) => `${day}, franja ${s(n)}, cierra`,
    add: (day: string) => `Añadir una franja el ${day.toLowerCase()}`,
    addShort: 'Añadir',
    remove: (day: string, n: number) => `Quitar la franja ${s(n)} del ${day.toLowerCase()}`,
    hint: 'HH:MM. 24:00 cierra a medianoche. Hasta tres franjas al día.',
    format: 'Escribe cada hora como HH:MM, por ejemplo 09:30; 24:00 cierra a medianoche.',
    overlap: 'Estas franjas se solapan o están desordenadas. Ponlas una detrás de otra.',
    endsBeforeStart: 'Una franja cierra antes de abrir. Corrige sus horas.',
    closedAllWeek: 'Abre al menos una franja en la semana; si no, tu agente no puede ofrecer nada.',
  },
  preview: {
    title: 'Lo que ofrecería tu agente ahora',
    lead:
      'Compuesto con tus reglas guardadas para tres clientes de ejemplo y comprobado por el ' +
      'servidor como una oferta real. No se guarda ni se envía nada, y no se usa el modelo de IA.',
    label: 'Ofertas de ejemplo',
    exampleMark: 'ejemplo',
    asks: (craving: string) => `Pide ${craving}`,
    noTags: 'Nada que afecte a tu carta',
    nothing: 'Tus reglas no dejan nada que ofrecer a este cliente.',
    nothingTodo: 'Destaca otro plato o deja que la cocina quite más cosas.',
    accepted: 'El servidor la aceptaría',
    rejected: 'El servidor la rechazaría',
    reward: (percent: number) => `${s(percent)} % de recompensa`,
    ready: (time: string) => `Lista a las ${time}`,
    composedAt: (time: string) => `Compuesto a las ${time}`,
    again: 'Componer de nuevo',
    composing: 'Componiendo…',
  },
  talk: {
    title: 'Habla con tu agente',
    lead:
      'Pregúntale por qué rechazó una oferta o cambia una regla con tus palabras. Responde con ' +
      'sus reglas reales; un cambio lo comprueba el servidor y solo se guarda cuando lo confirmas.',
    label: 'Conversación con tu agente',
    you: 'Tú',
    agent: 'Tu agente',
    message: 'Mensaje para tu agente',
    placeholder: '¿Por qué rechazaste la última oferta? Sube el descuento máximo al 30 %.',
    send: 'Enviar',
    sending: 'Tu agente está pensando…',
    off:
      'Hablar con tu agente necesita el modelo de IA, y este servidor no lo tiene. ' +
      'Cambia las reglas en el formulario: tu agente las sigue igual.',
    toForm: 'Ir a las reglas',
    unavailable:
      'Tu agente no ha podido responder ahora. Vuelve a intentarlo o cambia las reglas en el formulario.',
    refused: 'El servidor rechazaría ese cambio:',
    proposal: 'Cambio propuesto',
    change: (what: string, from: string, to: string) => `${what}: ${from} → ${to}`,
    none: 'ninguno',
    nothingChanges: 'Esta propuesta deja todas las reglas como están.',
    apply: 'Guardar este cambio',
    applying: 'Guardando…',
    dismiss: 'Ahora no',
    applied: 'Guardado. Tu agente sigue las reglas nuevas desde la próxima solicitud.',
    dismissed: 'Se queda como estaba. No se ha guardado nada.',
    stale: 'Tus reglas han cambiado desde esta propuesta. Vuelve a preguntar.',
  },
};
