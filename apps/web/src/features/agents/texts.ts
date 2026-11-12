import { useLang } from '../../shared/i18n/lang';
const words = {
  en: {
    title: 'Agent',
    lead:
      'Sara is your travel agent. Tell her where you are going and the stops you need: she ' +
      'plans the route, watches delays and incidents live, and buys your tickets with PayPal.',
    you: 'You',
    greeting:
      'Hi, I am Sara. Tell me where you are going, when, and any stops you need on the way.\n' +
      'I will plan the route, keep an eye on delays and, if you let me, buy the tickets with ' +
      'PayPal.',
    suggestionsLabel: 'Try asking',
    suggestions: [
      'I need to be at the Brooklyn Museum tomorrow at 10:00 am, leaving from Times Square',
      'Buy the tickets for my trip',
      'Are there delays on the 4 line right now?',
      'Watch the 7 line for me',
    ],
    placeholder: 'Where are you going? Add the stops you need on the way.',
    enterHint: 'Enter sends · Shift + Enter adds a line',
    thinking: 'Sara is thinking…',
    abilities: 'What Sara does',
    plans: 'Plans your route',
    plansText: 'From your words to a trip with every stop you asked for.',
    watchesLive: 'Watches delays live',
    watchesLiveText: 'Checks published MTA and PATH alerts while you travel.',
    buys: 'Buys your tickets with PayPal',
    paypalOn: 'PayPal connected',
    clearChat: 'Clear chat',
    paypalTestBuyer: 'PayPal Sandbox connected · test buyer, no sign-in needed',
    paypalSetup: 'Set up PayPal',
    paypalChecking: 'Checking PayPal…',
    permissions: 'What Sara can do for you',
    allowBuy: 'Let Sara buy tickets for me with PayPal',
    approveOnce: 'Approve once in PayPal; from then on Sara pays what each trip needs.',
    connect: 'Connect PayPal',
    connecting: 'Opening PayPal…',
    disconnect: 'Disconnect',
    paypalMissing: 'PayPal sandbox is not configured on this server, so Sara cannot pay yet.',
    noBuy: 'Sara will not buy anything for you.',
    returnedOk: 'PayPal approved. Sara can now buy your tickets.',
    returnedFailed: 'PayPal did not finish the approval. Try connecting again.',
    paypalError: 'Could not check your PayPal settings right now.',
    home: 'MovIQ home',
    skip: 'Skip to content',
    chat: 'Conversation',
    message: 'Message',
    send: 'Send',
    privacy:
      'Personal details are removed before saving or sending messages. Sara’s planning context ' +
      'expires after 30 minutes of inactivity.',
    watches: 'Sara watches for you',
    watchesLead:
      'Tell Sara which line or street matters to you. She checks the published alerts and the ' +
      'measured speeds, and leaves a notice here when an alert clears or traffic picks up again.',
    watchCount: (count: number) => (count === 0 ? 'None active' : `${String(count)} active`),
    addWatch: 'Add a watch',
    aLine: 'A line',
    aStreet: 'A street',
    quickLines: 'Popular lines',
    quickWatch: (line: string) => `Watch the ${line}`,
    alreadyWatched: (line: string) => `The ${line} is already watched`,
    yourWatches: 'Your watches',
    empty:
      'Nothing watched yet. Tap the 7 if you ride it to Queens, or find the avenue you drive ' +
      'every morning.',
    statusWatching: 'Watching',
    statusAlert: 'Alert in force',
    statusCleared: 'Cleared',
    statusRecovered: 'Speed recovered',
    statusWaiting: 'First check soon',
    statusUnavailable: 'Source unavailable',
    statusSetup: 'Not monitoring',
    streetTag: 'Street',
    lineName: (line: string) => (line === 'PATH' ? 'PATH' : `Line ${line}`),
    speedNow: (kmh: number) => `${String(kmh)} km/h now`,
    speedLimit: (kmh: number) => `notify above ${String(kmh)} km/h`,
    notices: 'Notices',
    noNotices: 'No notices yet. When an alert clears or a street speeds up, it shows up here.',
    resultsFound: (count: number) =>
      count === 1 ? '1 measured segment' : `${String(count)} measured segments`,
    measured: 'Measured',
    thresholdHelp: (kmh: number, mph: number) =>
      `Sara writes to you once two fresh readings go above ${String(kmh)} km/h (about ` +
      `${String(mph)} mph) after the street was slower.`,
    notesLabel: 'About these watches',
    line: 'Line, for example 7, M15 or PATH',
    watch: 'Watch line',
    pause: 'Pause',
    resume: 'Resume',
    delete: 'Delete',
    street: 'Find a measured street or road',
    findStreet: 'Find segments',
    chooseSegment: 'Measured segment',
    threshold: 'Notify above this speed (km/h)',
    streetSource: 'NYC DOT reports measured speed; this does not establish that the road is clear.',
    noSegments: 'No current segments found, or the source is unavailable.',
    roadAlert: 'Two measurements exceeded your speed threshold',
    roadCurrent: 'Latest measured speed',
    roadThreshold: 'Threshold',
    saveStreet: 'Save street task',
    needs_setup:
      'Not monitoring: selecting a measured segment and speed threshold is not available yet.',
    waiting: 'Waiting for a check',
    active: 'Alert reported',
    clear: 'No alert reported by this source',
    unavailable: 'Source unavailable or too old',
    paused: 'Paused',
    cleared: 'A previously reported alert cleared',
    checked: 'Checked',
    source: 'Source',
    failed: 'Could not complete this action. Check the connection or try another line.',
    refresh: 'Retry',
    loadFailed: 'Could not open the conversation with Sara. Check the connection and retry.',
    notice: 'These watches check published alerts, not every delay or road condition.',
    trip: 'Recommended trip',
    tripLegs: 'Legs of the trip, in order',
    walkFor: (minutes: number) => `Walk ${String(minutes)} min`,
    spare: (minutes: number) =>
      minutes >= 0 ? `${String(minutes)} min to spare` : `${String(-minutes)} min late`,
    transfers: (count: number) =>
      count === 0 ? 'No transfers' : count === 1 ? '1 transfer' : `${String(count)} transfers`,
    fare: 'Fare',
    buyTrip: 'Buy the tickets for this trip',
    bought: 'Tickets Sara bought',
  },
  es: {
    title: 'Agente',
    lead:
      'Sara es tu agente de viaje. Dile adónde vas y qué paradas necesitas: calcula la ruta, ' +
      'vigila retrasos e incidencias en directo y compra tus billetes con PayPal.',
    you: 'Tú',
    greeting:
      'Hola, soy Sara. Dime adónde vas, cuándo y qué paradas necesitas por el camino.\n' +
      'Calcularé la ruta, vigilaré los retrasos y, si me lo permites, compraré los billetes ' +
      'con PayPal.',
    suggestionsLabel: 'Prueba a preguntar',
    suggestions: [
      'Tengo que estar en el Brooklyn Museum mañana a las 10:00, saliendo de Times Square',
      'Compra los billetes de mi viaje',
      '¿Hay retrasos en la línea 4 ahora mismo?',
      'Vigila la línea 7 por mí',
    ],
    placeholder: '¿Adónde vas? Añade las paradas que necesitas por el camino.',
    enterHint: 'Intro envía · Mayús + Intro añade una línea',
    thinking: 'Sara está pensando…',
    abilities: 'Qué hace Sara',
    plans: 'Calcula tu ruta',
    plansText: 'De tus palabras a un viaje con cada parada que pediste.',
    watchesLive: 'Vigila retrasos en directo',
    watchesLiveText: 'Consulta las alertas publicadas de MTA y PATH mientras viajas.',
    buys: 'Compra tus billetes con PayPal',
    paypalOn: 'PayPal conectado',
    clearChat: 'Borrar chat',
    paypalTestBuyer: 'PayPal Sandbox conectado · comprador de pruebas, sin iniciar sesión',
    paypalSetup: 'Configurar PayPal',
    paypalChecking: 'Comprobando PayPal…',
    permissions: 'Qué puede hacer Sara por ti',
    allowBuy: 'Permito que Sara compre billetes por mí con PayPal',
    approveOnce:
      'Lo apruebas una vez en PayPal; desde entonces Sara paga lo que necesite cada viaje.',
    connect: 'Conectar PayPal',
    connecting: 'Abriendo PayPal…',
    disconnect: 'Desconectar',
    paypalMissing:
      'PayPal de pruebas no está configurado en este servidor; Sara aún no puede pagar.',
    noBuy: 'Sara no comprará nada por ti.',
    returnedOk: 'PayPal aprobado. Sara ya puede comprar tus billetes.',
    returnedFailed: 'PayPal no terminó la aprobación. Vuelve a conectarlo.',
    paypalError: 'No se han podido comprobar tus ajustes de PayPal ahora mismo.',
    home: 'Inicio de MovIQ',
    skip: 'Saltar al contenido',
    chat: 'Conversación',
    message: 'Mensaje',
    send: 'Enviar',
    privacy:
      'Los datos personales se eliminan antes de guardar o enviar mensajes. El contexto de ' +
      'planificación de Sara caduca tras 30 minutos sin actividad.',
    watches: 'Sara vigila por ti',
    watchesLead:
      'Dile a Sara qué línea o calle te importa. Consulta las alertas publicadas y las ' +
      'velocidades medidas, y te deja un aviso aquí cuando una alerta termina o el tráfico ' +
      'vuelve a moverse.',
    watchCount: (count: number) =>
      count === 0 ? 'Ninguna activa' : count === 1 ? '1 activa' : `${String(count)} activas`,
    addWatch: 'Añadir una vigilancia',
    aLine: 'Una línea',
    aStreet: 'Una calle',
    quickLines: 'Líneas habituales',
    quickWatch: (line: string) => `Vigilar la ${line}`,
    alreadyWatched: (line: string) => `La ${line} ya está vigilada`,
    yourWatches: 'Tus vigilancias',
    empty:
      'Aún no vigilas nada. Toca la 7 si la usas para ir a Queens, o busca la avenida por la ' +
      'que conduces cada mañana.',
    statusWatching: 'Vigilando',
    statusAlert: 'Alerta en vigor',
    statusCleared: 'Resuelta',
    statusRecovered: 'Velocidad recuperada',
    statusWaiting: 'Primera consulta en breve',
    statusUnavailable: 'Fuente no disponible',
    statusSetup: 'Sin seguimiento',
    streetTag: 'Calle',
    lineName: (line: string) => (line === 'PATH' ? 'PATH' : `Línea ${line}`),
    speedNow: (kmh: number) => `${String(kmh)} km/h ahora`,
    speedLimit: (kmh: number) => `aviso por encima de ${String(kmh)} km/h`,
    notices: 'Avisos',
    noNotices:
      'Aún no hay avisos. Cuando termine una alerta o una calle recupere velocidad, aparecerá aquí.',
    resultsFound: (count: number) =>
      count === 1 ? '1 tramo medido' : `${String(count)} tramos medidos`,
    measured: 'Medido',
    thresholdHelp: (kmh: number, mph: number) =>
      `Sara te escribe cuando dos mediciones nuevas superan ${String(kmh)} km/h (unas ` +
      `${String(mph)} mph) después de que la calle fuera más lenta.`,
    notesLabel: 'Sobre estas vigilancias',
    line: 'Línea, por ejemplo 7, M15 o PATH',
    watch: 'Seguir línea',
    pause: 'Pausar',
    resume: 'Reanudar',
    delete: 'Eliminar',
    street: 'Buscar una calle o vía medida',
    findStreet: 'Buscar tramos',
    chooseSegment: 'Tramo medido',
    threshold: 'Avisar por encima de esta velocidad (km/h)',
    streetSource:
      'NYC DOT informa de velocidad medida; esto no demuestra que la vía esté despejada.',
    noSegments: 'No hay tramos actuales para esa búsqueda o la fuente no está disponible.',
    roadAlert: 'Dos mediciones superaron tu umbral de velocidad',
    roadCurrent: 'Última velocidad medida',
    roadThreshold: 'Umbral',
    saveStreet: 'Guardar tarea de calle',
    needs_setup:
      'Sin seguimiento: aún no se puede seleccionar el tramo medido ni el umbral de velocidad.',
    waiting: 'Pendiente de consulta',
    active: 'Alerta publicada',
    clear: 'Esta fuente no informa de alertas',
    unavailable: 'Fuente no disponible o demasiado antigua',
    paused: 'Pausado',
    cleared: 'Ha terminado una alerta publicada anteriormente',
    checked: 'Consultado',
    source: 'Fuente',
    failed: 'No se ha podido completar. Comprueba la conexión o prueba otra línea.',
    refresh: 'Reintentar',
    loadFailed:
      'No se ha podido abrir la conversación con Sara. Comprueba la conexión y reintenta.',
    notice:
      'Este seguimiento comprueba alertas publicadas, no todos los retrasos o el estado de las calles.',
    trip: 'Viaje recomendado',
    tripLegs: 'Tramos del viaje, en orden',
    walkFor: (minutes: number) => `A pie ${String(minutes)} min`,
    spare: (minutes: number) =>
      minutes >= 0 ? `${String(minutes)} min de margen` : `${String(-minutes)} min tarde`,
    transfers: (count: number) =>
      count === 0
        ? 'Sin transbordos'
        : count === 1
          ? '1 transbordo'
          : `${String(count)} transbordos`,
    fare: 'Tarifa',
    buyTrip: 'Compra los billetes de este viaje',
    bought: 'Billetes que ha comprado Sara',
  },
} as const;
export function useAgentsT() {
  return words[useLang()];
}
export type AgentsWords = ReturnType<typeof useAgentsT>;
