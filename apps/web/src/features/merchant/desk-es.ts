import type { deskEn } from './desk-en';

const s = String;

export const deskEs: typeof deskEn = {
  scan: {
    title: 'Escanear el código de recogida',
    lead:
      'Al escanear se cobra, una sola vez, lo que PayPal retiene para el pedido. Un código dura ' +
      'diez minutos y solo vale para tus pedidos.',
    camera: 'Usar la cámara',
    stop: 'Parar la cámara',
    cameraHint: 'Apunta la cámara al código del cliente.',
    cameraLabel: 'Cámara',
    noCamera: 'Este navegador no puede leer códigos con la cámara. Pega el código aquí debajo.',
    denied:
      'No se ha permitido la cámara. Pega el código aquí debajo o permítela y vuelve a probar.',
    code: 'Código de recogida',
    codeHint: 'El texto del código QR del cliente.',
    submit: 'Cobrar y entregar',
    submitting: 'Cobrando…',
    charged: 'Cobrado',
    handedOver: (code: string) => `El pedido ${code} está entregado.`,
    confirming: 'PayPal aún está confirmando',
    confirmingTodo: 'Guarda el pedido un momento y vuelve a escanear el mismo código.',
    refused: 'No se ha cobrado',
    nothingCharged: 'No se ha cobrado nada.',
    reasons: {
      'not-moviq': {
        what: 'Este no es un código de recogida de MovIQ.',
        todo: 'Pide al cliente que te enseñe el código de su pedido en MovIQ.',
      },
      expired: {
        what: 'Este código ha caducado: cada código dura diez minutos.',
        todo: 'Pide al cliente que vuelva a abrir su pedido; le saldrá un código nuevo.',
      },
      used: {
        what: 'Este pedido ya se ha recogido.',
        todo: 'No se cobra nada más. Comprueba el pedido en Comandas.',
      },
      'no-order': {
        what: 'No hay ningún pedido con este código.',
        todo: 'Pide al cliente que compruebe que su pedido está en MovIQ.',
      },
      'other-merchant': {
        what: 'Este código es de un pedido de otro comercio.',
        todo: 'Pregunta al cliente dónde reservó; el pedido se recoge allí.',
      },
      cancelled: {
        what: 'Este pedido se canceló, así que no se puede recoger.',
        todo: 'No lo entregues. El cliente puede volver a reservar con Sara.',
      },
      'payments-off': {
        what: 'PayPal no está configurado en este servidor, así que el escaneo no puede cobrar.',
        todo: 'No entregues el pedido hasta que el equipo de MovIQ configure PayPal.',
      },
      unconfirmed: {
        what: 'PayPal aún no ha confirmado el pago de este cliente.',
        todo: 'Pide al cliente que termine la reserva en PayPal y vuelve a escanear.',
      },
      'paypal-unavailable': {
        what: 'PayPal no ha respondido, así que no se ha podido cobrar.',
        todo: 'Vuelve a escanear el mismo código en un momento.',
      },
      'not-charged': {
        what: 'PayPal no ha aceptado este cobro; el dinero sigue retenido.',
        todo: 'Vuelve a escanear en un momento. Si se repite, avisa al equipo de MovIQ.',
      },
    },
  },
  refund: {
    title: '¿Falta algo?',
    lead:
      'Devuelve las líneas de un pedido recogido que no se entregaron. Cada línea se devuelve una ' +
      'vez, con PayPal, por lo que el cliente pagó por ella.',
    order: 'Pedido recogido',
    none: 'Hoy no se ha recogido ningún pedido.',
    lines: 'Líneas que faltaron',
    submit: 'Devolver las líneas',
    submitting: 'Devolviendo…',
    pickOne: 'Elige al menos una línea.',
    done: (amount: string) => `${amount} devueltos con PayPal.`,
    inProgress: (amount: string) => `Reembolso en curso: ${amount}, hasta que PayPal lo confirme.`,
  },
  payouts: {
    title: 'Cobros',
    lead:
      'Cada semana PayPal Payouts te envía lo recogido, menos devoluciones y la comisión de ' +
      'MovIQ. También puedes pedirlo ahora.',
    last: 'Último cobro',
    none: 'Aún no hay cobros',
    noneBody: 'Tu primer cobro incluirá los pedidos recogidos y cobrados antes de él.',
    account: 'Cuenta de cobro',
    change: 'Cambiar la cuenta',
    locked: 'Un comercio de demostración no puede cambiar a dónde van sus cobros.',
    lockedTodo: 'Un comercio real la cambia después de darse de alta en MovIQ.',
    owed: 'Saldo pendiente de devoluciones',
    owedNote: 'Se descontará del próximo pago.',
    payNow: 'Cobrar ahora',
    paying: 'Enviando…',
    paid: (amount: string) => `Va de camino un cobro de ${amount}.`,
    off: 'PayPal Payouts no está configurado en este servidor, así que ahora no se puede enviar nada.',
    label: 'Lotes de cobro',
    created: 'Creado',
    until: 'Ventas hasta',
    gross: 'Recogido',
    refunds: 'Devoluciones',
    fee: 'Comisión',
    net: 'Recibes',
    status: 'Estado',
    detail: 'Detalle',
    states: {
      unknown: 'Esperando a PayPal',
      pending: 'Pendiente',
      processing: 'En proceso',
      success: 'Pagado',
      denied: 'Denegado',
      canceled: 'Cancelado',
      failed: 'Fallido',
    },
  },
  agent: {
    title: 'Tu agente',
    lead:
      'Lo que tu agente puede hacer por su cuenta cuando Sara le pide algo. El servidor comprueba ' +
      'cada oferta con estas reglas antes de que la vean Sara o el viajero.',
    minimum: (n: number) => `${s(n)} %`,
    minimumLabel: 'Recompensa mínima de MovIQ',
    minimumNote: 'Toda oferta debe quedar al menos esto por debajo de tu precio de carta.',
    maxDiscount: 'Descuento máximo',
    maxDiscountHint: (n: number) => `Al menos un ${s(n)} %, el mínimo del programa.`,
    minMargin: 'Margen mínimo',
    minMarginHint: 'Sobre el coste de lo que se ofrece.',
    capacity: 'Pedidos por cuarto de hora',
    capacityHint: 'Lo que tu cocina puede hacer a la vez.',
    prep: 'Tiempo de preparación',
    prepHint: 'Minutos desde el pedido hasta que está listo.',
    featured: 'Platos que ofrecer primero',
    featuredHint:
      'Hasta cinco. Los platos elegibles se muestran como promociones demo en los viajes que pasan por tu parada.',
    percent: '%',
    minutes: 'min',
    kitchen: 'Lo que permite tu cocina',
    kitchenLead: 'Según tu carta. Tu agente solo puede ofrecer estos cambios.',
    leaveOut: 'Puede quitar',
    add: 'Puede añadir',
    noChanges: 'Se hace tal cual',
    save: 'Guardar las reglas',
    saving: 'Guardando…',
    saved: 'Guardadas. Tu agente las sigue desde la próxima solicitud.',
    version: (n: number) => `Versión ${s(n)}`,
    belowMinimum: (n: number) => `Debe ser al menos un ${s(n)} %, la recompensa mínima de MovIQ.`,
    range: (low: number, high: number) => `Un número entero del ${s(low)} al ${s(high)}.`,
    tooMany: 'Elige como mucho cinco platos.',
    fix: 'Corrige los campos marcados y vuelve a guardar.',
  },
};
