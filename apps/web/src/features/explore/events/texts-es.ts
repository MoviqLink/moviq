import type { EventsDict } from './texts-en';

const s = String;

export const eventsEs: EventsDict = {
  layer: 'Eventos',
  tourist: 'Modo turista',
  touristScope:
    'Explora eventos publicados y monumentos protegidos. Las experiencias turísticas aún no están disponibles aquí.',
  show: 'Mostrar los eventos en el mapa',
  ranges: { label: 'Cuándo', today: 'Hoy', tonight: 'Esta noche', weekend: 'Este fin de semana' },
  all: 'Todos',
  categoriesLabel: 'Tipo de evento',
  categories: {
    music: 'Música',
    sports: 'Deporte',
    arts: 'Artes y teatro',
    family: 'En familia',
    fitness: 'Ejercicio',
    outdoors: 'Al aire libre',
    community: 'Comunidad',
    food: 'Comida',
    festival: 'Festivales',
    other: 'Otros',
  },
  status: {
    scheduled: 'Según lo previsto',
    rescheduled: 'Nueva fecha',
    postponed: 'Aplazado',
    cancelled: 'Cancelado',
  },
  loading: 'Leyendo los eventos de la ciudad…',
  failed: 'Los eventos no han cargado. Volvemos a intentarlo solos.',
  none: 'No hay ningún evento publicado para este momento.',
  count: (n: number) => (n === 1 ? '1 evento' : `${s(n)} eventos`),
  more: (n: number) => `y ${s(n)} más en el mapa`,
  missing: (names: string) => `Faltan ahora, en todo o en parte: ${names}.`,
  open: (name: string) => `Abrir ${name}`,
  card: {
    kind: 'Evento',
    close: 'Cerrar',
    when: 'Cuándo',
    starts: 'Empieza',
    ends: 'Termina',
    noEnd: 'Hora de fin no publicada',
    venue: 'Lugar',
    source: 'Fuente',
    sources: 'Fuentes',
    listedAt: (age: string) => `dato de hace ${age}`,
    official: 'Web oficial',
    officialNote:
      'Se abre en otra pestaña. Si hay entradas, solo se venden allí: MovIQ no vende ninguna.',
    onTime: 'Cómo llegar a tiempo',
    onTimeNote: (time: string) => `Planifica con Sara para llegar antes de las ${time}.`,
    callOff: 'Así lo publica la fuente: consulta su web oficial.',
  },
};
