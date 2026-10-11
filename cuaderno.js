// El cuaderno de laboratorio, sin pantalla (vale también en Node, para pruebas/cuaderno.js).
// Un cuaderno por receta: grupos de muestras que van a distinto ritmo, y la bitácora.
//
// quimica.cuaderno = {
//   grupos: [{ id, nombre, recetaId, muestras, padre?, desde?, siguiente? }]
//     muestras: cuántas tiene ahora (null si no se sabe)
//     siguiente: la fase que le toca, puesta a mano (si no está, la que sigue a la última hecha)
//     orden: su sitio en la lista (se cambia manteniendo pulsado y arrastrando; va en el grupo para
//     que el orden pase también al PC)
//     padre/desde: si salió de separar otro grupo, de cuál y cuándo (hereda su historia de antes)
//     vieneDe/vieneDesde/vieneCuaderno: si llegó de otro CUADERNO (pasar): el grupo de origen, cuándo y
//     el nombre de ese cuaderno. NO hereda su historia: está en el grupo de origen (botón para verla)
//     pasadoA/pasadoDesde/pasadoCuaderno: si todas sus muestras pasaron a otro cuaderno: el grupo
//     nuevo, cuándo y el nombre del cuaderno. Se queda cerrado, con su historia (estado «pasado»)
//   entradas: [{ id, fecha, tipo, recetaId, receta, grupoId, grupo, nota, fotos: [idFoto], … }]
//     tipo 'empezar'  { fase, otraVez }              ▶ empieza una fase (puede durar varios días)
//     tipo 'fase'     { fase }                        🏁 termina una fase
//     tipo 'analisis' { tecnica, entera? }            🔬 algo para analizar (entera: solo en los de antes)
//     tipo 'separar'  { nuevoId, nuevo, cuantas }     ✂️ unas muestras pasan a otro grupo
//     tipo 'pasar'    { nuevoId, nuevo, cuantas, haciaCuaderno }  📤 muestras que pasan a otro cuaderno
//     tipo 'llegar'   { desdeId, desde, cuantas, deCuaderno }     📥 muestras que llegan de otro cuaderno
//     tipo 'medida'   { medidas: [{ nombre, valor, unidad }] }   📏 lo medido (capacitancia, espesor…)
//     (cualquier apunte de una fase puede llevar `distinto`: «lo que hice distinto a la receta»)
//     tipo 'comparar' { comparadas: [idFoto], de }    ⚖️ lo que se vio al comparar unas fotos (enlazadas,
//                                                     no son suyas: borrar la entrada no las borra)
//     tipo 'nota'                                     ✍️ lo que sea
//     aprox: true   la fecha no es la de verdad (apuntado después, sin saber el día): "por confirmar"
//   (el nombre del grupo y de la receta se copian: la entrada se lee igual aunque se borren)
//   disoluciones: [{ id, recetaId, nombre, fase, fecha, preparada, composicion, estado, queda }]
//     las disoluciones preparadas (en la fase «fase»), que luego usan uno o varios grupos.
//     preparada / queda: texto ("800 mL"); composicion: [{ nombre, texto, cantidad }] tal como
//     estaba la receta al prepararla (Quimica.composicionDe); estado: ESTADOS
//     En las entradas: tipo 'preparar' { disolucionId, disolucion } (🧪 preparada), tipo 'estado'
//     { disolucionId, disolucion, estado } (gastada…), una nota con disolucionId es de esa disolución,
//     y las de un grupo llevan disoluciones: [{ id, nombre }] (las que usó)
//   carpetas: [{ id, recetaId, nombre, nota, orden }]   para juntar grupos ("Ciclo normal",
//     "Tintado repetido"), con una nota de contexto. Un grupo va en una con grupo.carpeta (id);
//     sin carpeta, en «Sin carpeta». Se mueven manteniendo pulsado y arrastrando
//   titulos: { idFoto: 'título puesto a mano' }   (sin título, uno automático: tituloFoto)
//   (en una entrada con fotos, fotosInfo: { idFoto: { aumento: "×1000", zona: "borde", apartado } } y
//   apartados: ["Vista general", …] (los títulos de los grupos de fotos del apunte, en su orden): de qué
//   es cada foto, para compararlas; va en la entrada para que pase al PC sin otra colección)
//   comparar: { recetaId: [idFoto…] }              las fotos elegidas para comparar, en su orden
//   albumes: [{ id, recetaId, cuadernoId?, nombre, nota, fotos: [idFoto], fecha }]   grupos de fotos hechos
//     a mano (colección «albumes»: pasa al PC)
// }
// Las fases son los rótulos de los pasos (Quimica.tramosFases); sin rótulos, fase null = toda la receta.
(function (raiz) {
  'use strict';

  const vacio = () => ({ grupos: [], entradas: [], disoluciones: [], carpetas: [], cuadernos: [], albumes: [], titulos: {}, comparar: {} });
  const objeto = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  const limpiar = (c) => ({
    grupos: Array.isArray(c && c.grupos) ? c.grupos.filter((g) => g && g.id) : [],
    entradas: Array.isArray(c && c.entradas) ? c.entradas.filter((e) => e && e.id) : [],
    disoluciones: Array.isArray(c && c.disoluciones) ? c.disoluciones.filter((d) => d && d.id) : [],
    carpetas: Array.isArray(c && c.carpetas) ? c.carpetas.filter((d) => d && d.id) : [],
    cuadernos: Array.isArray(c && c.cuadernos) ? c.cuadernos.filter((d) => d && d.id) : [],
    albumes: Array.isArray(c && c.albumes) ? c.albumes.filter((d) => d && d.id) : [],
    titulos: objeto(c && c.titulos),
    comparar: objeto(c && c.comparar),
  });
  const grupoDe = (c, id) => c.grupos.find((g) => g.id === id) || null;

  // ─── Varios cuadernos por receta (lo pidió el usuario: un experimento, otro…) ───
  // Lo que no lleva cuadernoId es del «Cuaderno 1» de su receta (id 'p-' + recetaId): así lo
  // apuntado antes de haber cuadernos sigue en su sitio. Las funciones de aquí que piden "recetaId"
  // aceptan también un ámbito { recetaId, cuadernoId } (ambito()): entonces solo cuenta ese cuaderno
  const principal = (recetaId) => `p-${recetaId}`;
  const cuadernoDe = (x) => x.cuadernoId || principal(x.recetaId);
  const ambito = (recetaId, cuadernoId) => ({ recetaId, cuadernoId: cuadernoId || principal(recetaId) });
  const recetaDeAmbito = (a) => (typeof a === 'string' ? a : a.recetaId);
  // Un cuaderno creado a mano se reconoce por su id (vaya con una receta o no: se le puede poner
  // después); el Cuaderno 1 de una receta, por la receta y no llevar cuadernoId
  const casa = (x, a) => {
    if (typeof a === 'string') return x.recetaId === a;
    if (a.cuadernoId === principal(a.recetaId)) return x.recetaId === a.recetaId && !x.cuadernoId;
    return x.cuadernoId === a.cuadernoId;
  };
  // Lo que hay que ponerle a algo nuevo para que sea de ese cuaderno (nada si es el Cuaderno 1)
  const marcaDe = (a) => (typeof a !== 'string' && a.cuadernoId !== principal(a.recetaId) ? { cuadernoId: a.cuadernoId } : {});
  // Las fotos elegidas para comparar se guardan por receta (Cuaderno 1) o por cuaderno
  const claveComparar = (a) => (typeof a === 'string' || a.cuadernoId === principal(a.recetaId) ? recetaDeAmbito(a) : a.cuadernoId);
  // Los cuadernos de una receta: el 1 (aunque no tenga ficha) y los demás por fecha
  const cuadernosDe = (c, recetaId) => {
    const p = c.cuadernos.find((x) => x.id === principal(recetaId)) || { id: principal(recetaId), recetaId, nombre: 'Cuaderno 1', fecha: 0 };
    return [p, ...c.cuadernos.filter((x) => x.recetaId === recetaId && x.id !== p.id).sort((a, b) => a.fecha - b.fecha)];
  };
  // La ficha de un cuaderno (la de verdad, o la que tendría el Cuaderno 1 de una receta)
  const fichaCuaderno = (c, a) => c.cuadernos.find((x) => x.id === a.cuadernoId)
    || { id: a.cuadernoId, recetaId: a.recetaId, nombre: 'Cuaderno 1', fecha: 0, principal: true };
  // Todos los cuadernos que hay que enseñar en 📓: los creados (con receta o sin ella) y el Cuaderno 1
  // de cada receta que tenga algo apuntado o una ficha. [{ ficha, ambito, ultima }], lo último usado primero
  const todosLosCuadernos = (c) => {
    const ambitos = new Map();
    for (const k of c.cuadernos) ambitos.set(k.id, ambito(k.id.startsWith('p-') ? k.recetaId : k.recetaId || null, k.id));
    for (const x of [...c.grupos, ...c.entradas, ...c.disoluciones, ...c.carpetas]) {
      if (!x.cuadernoId && x.recetaId && !ambitos.has(principal(x.recetaId))) ambitos.set(principal(x.recetaId), ambito(x.recetaId));
    }
    return [...ambitos.values()].map((a) => {
      const suyas = c.entradas.filter((e) => casa(e, a));
      return { ficha: fichaCuaderno(c, a), ambito: a, entradas: suyas.length, grupos: gruposDe(c, a).length, ultima: Math.max(0, ...suyas.map((e) => e.fecha)) };
    }).sort((x, y) => (y.ultima - x.ultima) || ((y.ficha.fecha || 0) - (x.ficha.fecha || 0)));
  };
  // Los grupos de una receta en su orden: el que se les ha dado arrastrando (orden) y, los que no lo
  // tienen, detrás y en el orden en que se crearon
  const gruposDe = (c, recetaId) => c.grupos.map((g, i) => [g, i]).filter(([g]) => casa(g, recetaId))
    .sort(([a, i], [b, j]) => (Number.isFinite(a.orden) ? a.orden : 1e9 + i) - (Number.isFinite(b.orden) ? b.orden : 1e9 + j))
    .map(([g]) => g);
  // Las carpetas de una receta, en su orden; y los grupos de una carpeta (null: los que no van en
  // ninguna, o en una que ya no existe)
  const carpetasDe = (c, recetaId) => c.carpetas.filter((x) => casa(x, recetaId))
    .sort((a, b) => (Number.isFinite(a.orden) ? a.orden : 1e9) - (Number.isFinite(b.orden) ? b.orden : 1e9));
  const gruposEnCarpeta = (c, recetaId, carpetaId) => {
    const hay = new Set(carpetasDe(c, recetaId).map((x) => x.id));
    return gruposDe(c, recetaId).filter((g) => (g.carpeta && hay.has(g.carpeta) ? g.carpeta : null) === (carpetaId || null));
  };
  // Tras arrastrar: listas = [{ carpeta: id o null, ids: [grupos en orden] }]. Cada grupo queda en
  // su carpeta y con su orden (seguido, de la primera lista a la última). Cambia c
  const colocarGrupos = (c, recetaId, listas) => {
    let n = 0;
    for (const { carpeta, ids } of listas) {
      for (const id of ids) {
        const g = grupoDe(c, id);
        if (!g || !casa(g, recetaId)) continue;
        if (carpeta) g.carpeta = carpeta; else delete g.carpeta;
        g.orden = n++;
      }
    }
  };
  // Pone el orden de los grupos de una receta (ids en el orden nuevo). Cambia c
  const ordenarGrupos = (c, recetaId, ids) => {
    ids.forEach((id, i) => { const g = grupoDe(c, id); if (g && casa(g, recetaId)) g.orden = i; });
  };

  // Lo que le ha pasado a un grupo, de lo más antiguo a lo más nuevo: lo suyo y, si salió de
  // separar otro, lo de ese grupo hasta ese momento (y así hacia atrás)
  const historiaDe = (c, grupoId) => {
    const lista = [];
    const vistos = new Set();
    let id = grupoId;
    let hasta = Infinity;
    while (id && !vistos.has(id)) {
      vistos.add(id);
      const tope = hasta;
      lista.push(...c.entradas.filter((e) => e.grupoId === id && e.fecha <= tope));
      const g = grupoDe(c, id);
      if (!g || !g.padre) break;
      hasta = g.desde == null ? -Infinity : g.desde;
      id = g.padre;
    }
    return lista.sort((a, b) => a.fecha - b.fecha);
  };

  // Por dónde va un grupo, según su historia y las fases de la receta (lista de títulos):
  //   { estado: 'nada', siguiente }                 no ha empezado
  //   { estado: 'en', fase, fecha }                 ha empezado una fase y no la ha terminado
  //   { estado: 'espera', fase, siguiente, fecha }  ha terminado una fase; le toca la siguiente
  //   { estado: 'terminado', fase, fecha }          ha terminado la última
  // Si el grupo lleva "siguiente" (puesto a mano: "le toca repetir la Fase 2"), manda eso; se quita
  // solo al empezar o terminar una fase (lo hace la app al apuntarlo)
  // ultimas (si la receta tiene subfases): { fase: la última subfase de muestras } (Quimica.ultimasDeMuestras).
  // Terminar una subfase de muestras que no es la última deja el grupo aún "en" la fase
  const estadoDe = (c, grupoId, fases, ultimas) => {
    const est = estadoSegunHistoria(c, grupoId, fases, ultimas || {});
    const g = grupoDe(c, grupoId);
    // Juntado con otro: ya no sigue
    if (g && g.juntadoEn) { const a = grupoDe(c, g.juntadoEn); return { ...est, estado: 'juntado', con: a ? a.nombre : 'otro grupo', fecha: g.juntadoDesde }; }
    // Pasado a otro cuaderno (todas sus muestras): aquí queda su historia y allí sigue
    if (g && g.pasadoA) { const a = grupoDe(c, g.pasadoA); return { ...est, estado: 'pasado', con: a ? a.nombre : g.nombre, cuaderno: g.pasadoCuaderno || 'otro cuaderno', fecha: g.pasadoDesde }; }
    if (!g || !('siguiente' in g) || est.estado === 'en') return est;
    return { ...est, estado: est.estado === 'nada' ? 'nada' : 'espera', siguiente: g.siguiente, aMano: true };
  };
  const estadoSegunHistoria = (c, grupoId, fases, ultimas) => {
    const hitos = historiaDe(c, grupoId).filter((e) => e.tipo === 'empezar' || e.tipo === 'fase');
    const u = hitos[hitos.length - 1];
    if (!u) return { estado: 'nada', siguiente: fases.length ? fases[0] : undefined };
    if (u.tipo === 'empezar') return { estado: 'en', fase: u.fase, fecha: u.fecha };
    if (u.subfase && ultimas[u.fase] && u.subfase !== ultimas[u.fase]) return { estado: 'en', fase: u.fase, subfase: u.subfase, fecha: u.fecha };
    const i = fases.indexOf(u.fase);
    if (i >= 0 && i === fases.length - 1) return { estado: 'terminado', fase: u.fase, fecha: u.fecha };
    return { estado: 'espera', fase: u.fase, siguiente: i >= 0 ? fases[i + 1] : undefined, fecha: u.fecha };
  };

  // Si un grupo ya terminó esa fase alguna vez (para decir "otra vez" al repetirla)
  const yaHizo = (c, grupoId, fase) => historiaDe(c, grupoId).some((e) => e.tipo === 'fase' && e.fase === fase);

  // La fase que se propone al empezar y al terminar
  const faseParaEmpezar = (est, fases) => (est.estado === 'nada' || est.estado === 'espera' ? est.siguiente : est.estado === 'en' ? est.fase : undefined) ?? fases[0];
  const faseParaTerminar = (est, fases) => (est.estado === 'en' ? est.fase : faseParaEmpezar(est, fases));

  // Lo que dice una entrada en una línea: "▶ Empieza Fase 2 (8 muestras)", "🔬 Microscopio electrónico (SEM)"…
  const nombreFase = (fase) => fase || 'Toda la receta';
  const titularDe = (e) => {
    switch (e.tipo) {
      case 'empezar': return `${e.otraVez ? '🔁' : '▶'} ${e.otraVez ? 'Otra vez: ' : 'Empieza '}${nombreFase(e.fase)}${e.muestras ? ` (${e.muestras} ${e.muestras === 1 ? 'muestra' : 'muestras'})` : ''}`;
      case 'fase': return `🏁 Terminada: ${nombreFase(e.fase)}${e.subfase ? ` · ${e.subfase}` : ''}${e.muestras ? ` (${e.muestras} ${e.muestras === 1 ? 'muestra' : 'muestras'})` : ''}`;
      // (los de antes llevan entera: true o false; los nuevos, nada)
      case 'analisis': return `🔬 ${e.tecnica || 'Análisis'}${e.entera ? ' · una muestra entera' : ''}`;
      case 'separar': return `✂️ ${e.cuantas} ${e.cuantas === 1 ? 'muestra pasa' : 'muestras pasan'} a «${e.nuevo}»`;
      case 'juntar': return `🔗 ${e.cuantas != null ? `${e.cuantas} ${e.cuantas === 1 ? 'muestra se junta' : 'muestras se juntan'}` : 'Se junta'} con «${e.nuevo}»`;
      case 'recibir': return `🔗 Se le juntan ${e.cuantas != null ? `${e.cuantas} ${e.cuantas === 1 ? 'muestra' : 'muestras'} ` : ''}de «${e.desde}»`;
      case 'medida': return `📏 ${lineasDeMedidas(e.medidas) || 'Medida'}`;
      case 'pasar': return `📤 ${e.cuantas != null ? `${e.cuantas} ${e.cuantas === 1 ? 'muestra pasa' : 'muestras pasan'}` : 'Pasa'} al cuaderno «${e.haciaCuaderno || 'otro'}»`;
      case 'llegar': return `📥 ${e.cuantas != null ? `Llegan ${e.cuantas} ${e.cuantas === 1 ? 'muestra' : 'muestras'}` : 'Llega'} del cuaderno «${e.deCuaderno || 'otro'}»`;
      case 'preparar': return `🧪 Preparada: ${e.disolucion}`;
      case 'comparar': return `⚖️ Comparación de ${(e.comparadas || []).length} ${(e.comparadas || []).length === 1 ? 'foto' : 'fotos'}`;
      case 'estado': return `🧪 ${e.disolucion}: ${(ESTADOS[e.estado] || e.estado || '').replace(/^\S+ /, '').toLowerCase()}`;
      default: return '✍️ Nota';
    }
  };

  // Separar: cuantas muestras de un grupo pasan a uno nuevo, que hereda la historia. Cambia c.
  // Devuelve { nuevo, entrada } o lanza un error con el motivo
  const separar = (c, grupoId, cuantas, nombre, ahora, ids) => {
    const g = grupoDe(c, grupoId);
    if (!g) throw new Error('Ese grupo ya no está');
    const n = Math.round(Number(cuantas));
    if (!(n >= 1)) throw new Error('Pon cuántas muestras pasan al grupo nuevo');
    if (g.muestras != null && n >= g.muestras) throw new Error(`El grupo tiene ${g.muestras}: pueden pasar como mucho ${g.muestras - 1} (si pasan todas, no hace falta separar)`);
    if (!String(nombre || '').trim()) throw new Error('Ponle nombre al grupo nuevo');
    // (el grupo nuevo, en el mismo cuaderno y la misma carpeta)
    const mismo = { ...(g.cuadernoId ? { cuadernoId: g.cuadernoId } : {}) };
    const nuevo = { id: ids.grupo, nombre: String(nombre).trim().slice(0, 60), recetaId: g.recetaId, ...mismo, ...(g.carpeta ? { carpeta: g.carpeta } : {}), muestras: n, padre: g.id, desde: ahora };
    const entrada = { id: ids.entrada, fecha: ahora, tipo: 'separar', recetaId: g.recetaId, ...mismo, grupoId: g.id, grupo: g.nombre, nuevoId: nuevo.id, nuevo: nuevo.nombre, cuantas: n };
    if (g.muestras != null) g.muestras -= n;
    c.grupos.push(nuevo);
    c.entradas.push(entrada);
    return { nuevo, entrada };
  };

  // ─── Juntar dos grupos (lo pidió el usuario: si van por la misma fase y en la misma carpeta) ───
  // Las muestras del grupo «de» pasan al grupo «a», que sigue; «de» se queda cerrado (juntadoEn).
  // Se apunta en los dos: 'juntar' en «de» y 'recibir' en «a»
  const mismoSitio = (c, g1, g2, fases, ultimas) => {
    if (!g1 || !g2 || g1.id === g2.id || g1.juntadoEn || g2.juntadoEn || g1.pasadoA || g2.pasadoA) return false;
    if (g1.recetaId !== g2.recetaId || cuadernoDe(g1) !== cuadernoDe(g2) || (g1.carpeta || null) !== (g2.carpeta || null)) return false;
    const e1 = estadoDe(c, g1.id, fases, ultimas);
    const e2 = estadoDe(c, g2.id, fases, ultimas);
    return e1.estado === e2.estado && e1.fase === e2.fase && (e1.subfase || null) === (e2.subfase || null);
  };
  const juntar = (c, deId, aId, ahora, ids) => {
    const de = grupoDe(c, deId);
    const a = grupoDe(c, aId);
    if (!de || !a || de === a) throw new Error('Elige otro grupo');
    const n = de.muestras;
    if (a.muestras != null || n != null) a.muestras = (a.muestras || 0) + (n || 0);
    const mismo = { recetaId: de.recetaId, ...(de.cuadernoId ? { cuadernoId: de.cuadernoId } : {}) };
    const e1 = { id: ids.de, fecha: ahora, tipo: 'juntar', ...mismo, grupoId: de.id, grupo: de.nombre, nuevoId: a.id, nuevo: a.nombre, ...(n != null ? { cuantas: n } : {}) };
    const e2 = { id: ids.a, fecha: ahora, tipo: 'recibir', ...mismo, grupoId: a.id, grupo: a.nombre, desdeId: de.id, desde: de.nombre, ...(n != null ? { cuantas: n } : {}) };
    de.juntadoEn = a.id;
    de.juntadoDesde = ahora;
    if (de.muestras != null) de.muestras = 0;
    c.entradas.push(e1, e2);
    return { de, a };
  };

  // ─── Medidas por grupo (versión 114; propuesto en «mejorar el cuaderno»: lo que se mide de cada muestra
  // —capacitancia, resistencia, espesor, masa…— y compararlo entre grupos) ───
  // Una entrada tipo 'medida': { grupoId, grupo, medidas: [{ nombre, valor (número), unidad }], nota?, fotos? }
  const numTexto = (v) => String(Number(Number(v).toPrecision(6))).replace('.', ',');
  const medidaTexto = (m) => `${m.nombre} ${numTexto(m.valor)}${m.unidad ? ` ${m.unidad}` : ''}`;
  const lineasDeMedidas = (medidas) => (Array.isArray(medidas) ? medidas.filter((m) => m && m.nombre && Number.isFinite(m.valor)).map(medidaTexto).join(' · ') : '');
  const claveMedida = (nombre) => sinTildes(String(nombre || '')).replace(/\s+/g, ' ').trim();
  // Lo medido en un cuaderno: filas = lo que se mide, columnas = los grupos. Cada celda trae lo último
  // (por fecha) y todo lo medido (n veces). { grupos: [{ id, nombre }], filas: [{ nombre, celdas: { grupoId: { valor, unidad, fecha, n, todos } } }] }
  const medidasDe = (c, recetaId) => {
    const entradas = c.entradas.filter((e) => e.tipo === 'medida' && casa(e, recetaId) && Array.isArray(e.medidas)).sort((a, b) => a.fecha - b.fecha);
    const filas = new Map();
    const orden = [];
    for (const e of entradas) {
      for (const m of e.medidas) {
        if (!m || !m.nombre || !Number.isFinite(m.valor)) continue;
        const k = claveMedida(m.nombre);
        if (!filas.has(k)) filas.set(k, { nombre: String(m.nombre).trim(), celdas: {} });
        const celda = filas.get(k).celdas[e.grupoId] || (filas.get(k).celdas[e.grupoId] = { todos: [] });
        celda.todos.push({ valor: m.valor, unidad: m.unidad || '', fecha: e.fecha, entradaId: e.id });
        if (!orden.includes(e.grupoId)) orden.push(e.grupoId);
      }
    }
    for (const f of filas.values()) {
      for (const celda of Object.values(f.celdas)) {
        const u = celda.todos[celda.todos.length - 1];
        celda.valor = u.valor; celda.unidad = u.unidad; celda.fecha = u.fecha; celda.n = celda.todos.length;
      }
    }
    // Los grupos en el orden del cuaderno; los que ya no existen, con el nombre que quedó en el apunte
    const enOrden = gruposDe(c, recetaId).map((g) => g.id).filter((id) => orden.includes(id));
    const quitados = orden.filter((id) => !enOrden.includes(id));
    const grupos = [...enOrden, ...quitados].map((id) => {
      const g = grupoDe(c, id);
      const e = entradas.find((x) => x.grupoId === id);
      return { id, nombre: g ? g.nombre : (e && e.grupo) || 'Grupo quitado' };
    });
    return { grupos, filas: [...filas.values()] };
  };
  // Nombres de medidas ya usados (más usados primero) y la última unidad con la que se apuntó cada uno
  const nombresDeMedidas = (c) => {
    const cuenta = new Map();
    for (const e of c.entradas) for (const m of (e.tipo === 'medida' && Array.isArray(e.medidas) ? e.medidas : [])) {
      if (!m || !m.nombre) continue;
      const k = claveMedida(m.nombre);
      const x = cuenta.get(k) || { nombre: String(m.nombre).trim(), n: 0, unidad: '', fecha: -1 };
      x.n++;
      if (e.fecha >= x.fecha) { x.fecha = e.fecha; x.unidad = m.unidad || ''; }
      cuenta.set(k, x);
    }
    return [...cuenta.values()].sort((a, b) => b.n - a.n);
  };
  const unidadDeMedida = (c, nombre) => (nombresDeMedidas(c).find((x) => claveMedida(x.nombre) === claveMedida(nombre)) || {}).unidad || '';

  // ─── Pasar muestras a otro cuaderno (lo pidió el usuario: «las muestras van a pasar por otro proceso;
  // quiero que guarden el historial, y que para acceder a él haya que darle a otro botón o que conecte
  // con el otro cuaderno») ───
  // No se mueve la historia: se queda donde pasó, en el grupo de origen. En el cuaderno de destino
  // nace un grupo nuevo (limpio: su receta es otra, con otras fases) que sabe de dónde viene
  // (vieneDe: id del grupo de origen), y el de origen sabe a cuál pasó (pasadoA). Así, desde cada uno
  // se llega al otro. Si pasan todas, el de origen queda cerrado (estado «pasado»); si solo unas
  // cuantas, sigue con las que le quedan.
  //   destino: { recetaId, cuadernoId, nombre }  (cuadernoId: ámbito(), el del Cuaderno 1 = 'p-<receta>')
  const pasar = (c, grupoId, destino, cuantas, ahora, ids) => {
    const g = grupoDe(c, grupoId);
    if (!g) throw new Error('Ese grupo ya no está');
    // (un cuaderno sin receta todavía vale: sus grupos son suyos por el cuaderno, y cuando se le pone
    // receta, pasan a ser de ella solos)
    if (!destino || (!destino.recetaId && !destino.cuadernoId)) throw new Error('Elige a qué cuaderno pasan');
    if (casa(g, ambito(destino.recetaId || null, destino.cuadernoId))) throw new Error('Elige otro cuaderno: ese es el de ahora');
    if (g.pasadoA || g.juntadoEn) throw new Error('Este grupo ya no sigue aquí');
    const total = g.muestras;
    const n = cuantas == null || cuantas === '' ? total : Math.round(Number(cuantas));
    if (n != null && !(n >= 1)) throw new Error('Pon cuántas muestras pasan (al menos una)');
    if (n != null && total != null && n > total) throw new Error(`El grupo tiene ${total}: no pueden pasar ${n}`);
    const todas = n == null || total == null || n >= total;
    const marca = marcaDe(ambito(destino.recetaId || null, destino.cuadernoId));
    const nuevo = { id: ids.grupo, nombre: g.nombre, recetaId: destino.recetaId || null, ...marca, muestras: n == null ? null : n,
      vieneDe: g.id, vieneDesde: ahora, vieneCuaderno: destino.deNombre || '' };
    const origen = { recetaId: g.recetaId, ...(g.cuadernoId ? { cuadernoId: g.cuadernoId } : {}) };
    const e1 = { id: ids.de, fecha: ahora, tipo: 'pasar', ...origen, grupoId: g.id, grupo: g.nombre, nuevoId: nuevo.id, nuevo: nuevo.nombre,
      haciaCuaderno: destino.nombre || '', ...(n != null ? { cuantas: n } : {}) };
    const e2 = { id: ids.a, fecha: ahora, tipo: 'llegar', recetaId: destino.recetaId || null, ...marca, grupoId: nuevo.id, grupo: nuevo.nombre, desdeId: g.id, desde: g.nombre,
      deCuaderno: destino.deNombre || '', ...(n != null ? { cuantas: n } : {}) };
    if (todas) {
      g.pasadoA = nuevo.id;
      g.pasadoDesde = ahora;
      g.pasadoCuaderno = destino.nombre || '';
      if (g.muestras != null) g.muestras = 0;
    } else if (total != null) {
      g.muestras = total - n;
    }
    c.grupos.push(nuevo);
    c.entradas.push(e1, e2);
    return { nuevo, de: g, todas };
  };

  // La historia de antes de un grupo que llegó de otro cuaderno, de lo más cercano a lo más lejano:
  // [{ cuaderno, grupoId, grupo, entradas }] (siguiendo la cadena si ese también vino de otro; cada tramo
  // lleva su propia historia, con lo heredado de separar). Vacío si no llegó de ningún cuaderno
  const historiaAnterior = (c, grupoId) => {
    const tramos = [];
    const vistos = new Set([grupoId]);
    let g = grupoDe(c, grupoId);
    while (g && g.vieneDe && !vistos.has(g.vieneDe)) {
      const origen = grupoDe(c, g.vieneDe);
      if (!origen) break;
      vistos.add(origen.id);
      tramos.push({ cuaderno: g.vieneCuaderno || 'otro cuaderno', grupoId: origen.id, grupo: origen.nombre, entradas: historiaDe(c, origen.id) });
      g = origen;
    }
    return tramos;
  };

  // Deshacer un «pasar» (por si fue sin querer): el grupo nuevo desaparece y las muestras vuelven al de
  // origen. Solo mientras el nuevo no tenga más apuntes que su «llegan» (si ya ha hecho cosas allí, no
  // se pierde esa historia). nuevoId: el grupo que llegó. Cambia c. Lanza un error con el motivo
  const deshacerPasar = (c, nuevoId) => {
    const n = grupoDe(c, nuevoId);
    if (!n || !n.vieneDe) throw new Error('Ese grupo no llegó de otro cuaderno');
    const e1 = c.entradas.find((x) => x.tipo === 'pasar' && x.nuevoId === n.id);
    const e2 = c.entradas.find((x) => x.tipo === 'llegar' && x.grupoId === n.id);
    const otras = c.entradas.filter((x) => x !== e1 && x !== e2 && (x.grupoId === n.id || x.nuevoId === n.id || x.desdeId === n.id));
    const derivados = c.grupos.some((x) => x.id !== n.vieneDe && (x.padre === n.id || x.juntadoEn === n.id || x.pasadoA === n.id));
    if (otras.length || derivados) {
      throw new Error(`El grupo nuevo ya ha hecho cosas allí (${otras.length} ${otras.length === 1 ? 'apunte' : 'apuntes'}): ya no se puede deshacer. Puedes seguir con él, o quitarlo aparte`);
    }
    const g = grupoDe(c, n.vieneDe);
    const cuantas = e1 && e1.cuantas != null ? e1.cuantas : n.muestras;
    if (g) {
      if (g.pasadoA === n.id) {
        delete g.pasadoA; delete g.pasadoDesde; delete g.pasadoCuaderno;
        g.muestras = n.muestras != null ? n.muestras : cuantas != null ? cuantas : g.muestras;
      } else if (g.muestras != null && cuantas != null) g.muestras += cuantas;
    }
    c.grupos = c.grupos.filter((x) => x.id !== n.id);
    c.entradas = c.entradas.filter((x) => x !== e1 && x !== e2);
    return { de: g, cuantas };
  };

  // ─── Las disoluciones ───
  const ESTADOS = { queda: '🟢 Queda', poca: '🟡 Queda poca', gastada: '⚪ Gastada', desechada: '🗑️ Desechada' };
  const disolucionDe = (c, id) => c.disoluciones.find((d) => d.id === id) || null;
  // Las de una receta, la más nueva primero
  const disolucionesDe = (c, recetaId) => c.disoluciones.filter((d) => casa(d, recetaId)).sort((a, b) => b.fecha - a.fecha);
  const disponible = (d) => d.estado !== 'gastada' && d.estado !== 'desechada';
  // Las que se proponen al pasar unas muestras por una fase: de las que quedan, la última preparada
  // en esa misma fase (un baño que se prepara y se usa) y la última de la fase de justo antes (la
  // tinta de la Fase 1 para el dip coating de la Fase 2). Ids
  const sugeridas = (c, recetaId, fases, fase) => {
    const i = fases.indexOf(fase);
    const vale = [fase, ...(i > 0 ? [fases[i - 1]] : [])];
    const elegidas = [];
    for (const f of vale) {
      const d = disolucionesDe(c, recetaId).find((x) => disponible(x) && x.fase === f);
      if (d) elegidas.push(d.id);
    }
    return elegidas;
  };
  // Lo que le ha pasado a una disolución (prepararla, notas, cambios de estado) y quién la usó
  const historiaDisolucion = (c, id) => c.entradas.filter((e) => e.disolucionId === id || (e.disoluciones || []).some((x) => x.id === id))
    .sort((a, b) => a.fecha - b.fecha);
  // Los grupos que la han usado (sin repetir), con la última vez
  const usadaPor = (c, id) => {
    const r = new Map();
    for (const e of historiaDisolucion(c, id)) if (e.grupoId && (e.disoluciones || []).some((x) => x.id === id)) r.set(e.grupoId, { grupoId: e.grupoId, grupo: e.grupo, fecha: e.fecha, fase: e.fase });
    return [...r.values()];
  };
  // El nombre que se propone: el de la fase sin "Fase 1:" y con su número ("Tinta de grafeno nº 2")
  // (sub: si se prepara en una subfase, su nombre)
  const nombreDisolucion = (c, recetaId, fase, sub) => {
    const base = String(sub || fase || 'Disolución').replace(/^\s*fase\s*\d+\s*[:.\-–]\s*/i, '').trim() || 'Disolución';
    const n = c.disoluciones.filter((d) => casa(d, recetaId) && d.fase === fase && (d.subfase || '') === (sub || '')).length + 1;
    return `${base} nº ${n}`;
  };

  // ─── Las fotos de una receta, para verlas juntas y compararlas ───
  // [{ id, entrada }], de la más antigua a la más nueva
  const fotosDe = (c, recetaId) => c.entradas.filter((e) => casa(e, recetaId) && Array.isArray(e.fotos))
    .sort((a, b) => a.fecha - b.fecha)
    .flatMap((e) => e.fotos.map((id) => ({ id, entrada: e })));
  // El título de una foto: el puesto a mano o, si no, lo que se hizo ("🔬 Microscopio electrónico (SEM)")
  // (con varias fotos en la misma entrada, numeradas)
  const tituloFoto = (c, id, entrada) => {
    if (c.titulos[id]) return c.titulos[id];
    const base = entrada.tipo === 'nota' && entrada.nota ? entrada.nota.split('\n')[0].slice(0, 50) : titularDe(entrada);
    return entrada.fotos.length > 1 ? `${base} (${entrada.fotos.indexOf(id) + 1})` : base;
  };
  // El aumento, la zona y el apartado de una foto ({} si no tiene)
  const infoFoto = (entrada, id) => (entrada && entrada.fotosInfo && entrada.fotosInfo[id]) || {};
  // Las fotos de una entrada repartidas en sus apartados (lo pidió el usuario: ordenar las fotos de
  // un apunte en grupos con título): [{ titulo, fotos }] en el orden de entrada.apartados, y al
  // final las que no van en ninguno (titulo ''). vacios: también los apartados sin fotos
  const apartadosDe = (entrada, vacios) => {
    const fotos = (entrada && entrada.fotos) || [];
    const titulos = [...new Set(((entrada && entrada.apartados) || []).filter(Boolean))];
    const de = (id) => { const t = infoFoto(entrada, id).apartado; return titulos.includes(t) ? t : ''; };
    const lista = titulos.map((titulo) => ({ titulo, fotos: fotos.filter((id) => de(id) === titulo) }));
    const sueltas = fotos.filter((id) => de(id) === '');
    return [...lista.filter((a) => vacios || a.fotos.length), ...(sueltas.length ? [{ titulo: '', fotos: sueltas }] : [])];
  };
  // En qué punto estaba un grupo en un momento (para saber de qué es una foto): "en Fase 3: Sembrado",
  // "tras Fase 2: Lavado · Secado" (con su subfase), "(2.ª vez)" si ya la había hecho; "sin empezar"; '' sin grupo
  const momentoDe = (c, grupoId, fecha) => {
    if (!grupoId || !grupoDe(c, grupoId)) return '';
    const antes = historiaDe(c, grupoId).filter((e) => e.fecha <= fecha && (e.tipo === 'empezar' || e.tipo === 'fase'));
    const u = antes[antes.length - 1];
    if (!u) return 'sin empezar';
    // Cuántas veces ha pasado por esa fase: una pasada son los apuntes seguidos de esa fase (sus
    // subfases incluidas); empezarla otra vez después de haberla terminado es otra pasada
    let vez = 0;
    let previo = null;
    for (const e of antes) {
      if (e.fase === u.fase && (!previo || previo.fase !== u.fase || (e.tipo === 'empezar' && previo.tipo === 'fase'))) vez++;
      previo = e;
    }
    // (con el nombre entero de la fase y su subfase: solo «Fase 2» era escueto, dijo el usuario)
    return `${u.tipo === 'empezar' ? 'en' : 'tras'} ${nombreFase(u.fase)}${u.subfase ? ` · ${u.subfase}` : ''}${vez > 1 ? ` (${vez}.ª vez)` : ''}`;
  };
  // En qué fase estaba lo que se apuntó (para filtrar las fotos por fase, versión 114): la del propio
  // apunte (empezar, terminar, preparar) o, si es un análisis o una nota, la última que ese grupo
  // había empezado o terminado antes. '' si no se sabe (sin grupo, o sin empezar)
  const faseDeEntrada = (c, e) => {
    if (e.fase) return e.fase;
    if (!e.grupoId || !grupoDe(c, e.grupoId)) return '';
    const antes = historiaDe(c, e.grupoId).filter((x) => x.fecha <= e.fecha && (x.tipo === 'empezar' || x.tipo === 'fase'));
    const u = antes[antes.length - 1];
    return u && u.fase ? u.fase : '';
  };
  // Los álbumes de fotos de un cuaderno (lo pidió el usuario: hacer grupos con sus fotos), por orden
  // de creación. { id, recetaId, cuadernoId?, nombre, fotos: [idFoto], fecha }
  const albumesDe = (c, recetaId) => c.albumes.filter((a) => casa(a, recetaId)).sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
  // De qué tipo es lo que se apuntó con unas fotos, para filtrarlas: 'analisis' (microscopio…),
  // 'disoluciones' (prepararla, su estado o una nota suya), 'notas' o 'fases' (empezar, terminar,
  // separar, juntar)
  const tipoFoto = (e) => (e.tipo === 'analisis' || e.tipo === 'medida' ? 'analisis'
    : e.tipo === 'preparar' || e.tipo === 'estado' || e.disolucionId ? 'disoluciones'
      : e.tipo === 'nota' || e.tipo === 'comparar' ? 'notas' : 'fases');
  // Las elegidas para comparar que siguen existiendo, en su orden
  const comparadas = (c, recetaId) => {
    const hay = new Set(fotosDe(c, recetaId).map((f) => f.id));
    return (c.comparar[claveComparar(recetaId)] || []).filter((id) => hay.has(id));
  };
  // Quita de títulos y de comparar las fotos que ya no están (tras borrar una entrada). Cambia c
  const olvidarFotos = (c, ids) => {
    for (const id of ids) delete c.titulos[id];
    for (const r of Object.keys(c.comparar)) c.comparar[r] = c.comparar[r].filter((id) => !ids.includes(id));
  };

  // ─── Buscar en la bitácora (versión 86, lo pidió el usuario: «escribes "poco denso" o "SEM" y
  // salen los apuntes que lo dicen») ───
  // Se busca en todo lo que dice un apunte: lo que se hizo, la nota, el grupo, la técnica, la fase,
  // las disoluciones, los apartados y lo apuntado de sus fotos. Sin mayúsculas ni tildes. Cada
  // palabra tiene que salir; una de más de 4 letras vale también con otra terminación ("denso" →
  // "densas"); una corta (SEM, CuO), solo como palabra entera ("SEM" no es "sembrado")
  const sinTildes = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const textoDeEntrada = (c, e) => [titularDe(e), e.grupo, e.nota, e.tecnica, e.fase, e.subfase, e.disolucion, e.nuevo, e.desde, e.haciaCuaderno, e.deCuaderno, lineasDeMedidas(e.medidas), e.distinto,
    ...(e.disoluciones || []).map((x) => x.nombre), ...(e.de || []), ...(e.apartados || []),
    ...Object.values(e.fotosInfo || {}).flatMap((i) => [i.aumento, i.zona, i.apartado]),
    ...(e.fotos || []).map((id) => c.titulos && c.titulos[id])].filter(Boolean).join('\n');
  const palabrasDe = (texto) => sinTildes(texto).split(/[^\p{L}\p{N}×]+/u).filter(Boolean).map((p) => (p.length > 4
    ? { raiz: p.replace(/(os|as|es|o|a|e|s)$/, '') } : { entera: p }));
  const dice = (texto, palabras) => {
    const t = sinTildes(texto);
    const enteras = new Set(t.split(/[^\p{L}\p{N}×]+/u));
    return palabras.every((p) => (p.entera ? enteras.has(p.entera) : t.includes(p.raiz)));
  };
  const buscar = (c, entradas, texto) => {
    const palabras = palabrasDe(texto);
    return palabras.length ? entradas.filter((e) => dice(textoDeEntrada(c, e), palabras)) : entradas;
  };

  // ─── Lo que le toca a un grupo, con fecha (versión 86, lo pidió el usuario: avisos de «le toca») ───
  // grupo.toca = 'AAAA-MM-DD': el día en que tiene que empezar lo que le toca (puesto a mano; se quita
  // al empezar una fase). avisosToca(c, hoy, estadoDe) → los que tocan hoy, mañana o ya se pasaron:
  // [{ grupo, fase (la que le toca), dia, dias (0 hoy, 1 mañana, negativo: hace tantos días) }],
  // lo más urgente primero. estadoDe(g): el estado del grupo (solo avisa si espera o no ha empezado)
  const diasHasta = (hoy, dia) => {
    const aUTC = (s) => { const [a, m, d] = String(s).split('-').map(Number); return Date.UTC(a, m - 1, d); };
    return Math.round((aUTC(dia) - aUTC(hoy)) / 864e5);
  };
  const avisosToca = (c, hoy, estadoDe, hasta = 1) => c.grupos
    .filter((g) => g.toca && !g.juntadoEn && !g.pasadoA && /^\d{4}-\d{2}-\d{2}$/.test(g.toca))
    .map((g) => {
      const est = estadoDe(g);
      if (!est || (est.estado !== 'espera' && est.estado !== 'nada')) return null;
      const dias = diasHasta(hoy, g.toca);
      return dias <= hasta ? { grupo: g, fase: est.siguiente, dia: g.toca, dias } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.dias - b.dias);

  const Cuaderno = { vacio, limpiar, grupoDe, gruposDe, ordenarGrupos, mismoSitio, juntar, pasar, deshacerPasar, historiaAnterior, faseDeEntrada, medidasDe, nombresDeMedidas, unidadDeMedida, numTexto, lineasDeMedidas, principal, cuadernoDe, ambito, casa, marcaDe, claveComparar, cuadernosDe, fichaCuaderno, todosLosCuadernos, carpetasDe, gruposEnCarpeta, colocarGrupos, historiaDe, estadoDe, yaHizo, faseParaEmpezar, faseParaTerminar, nombreFase, titularDe, separar,
    buscar, textoDeEntrada, avisosToca, diasHasta,
    fotosDe, tituloFoto, comparadas, olvidarFotos, infoFoto, apartadosDe, momentoDe, albumesDe, tipoFoto,
    ESTADOS, disolucionDe, disolucionesDe, disponible, sugeridas, historiaDisolucion, usadaPor, nombreDisolucion };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cuaderno;
  else raiz.Cuaderno = Cuaderno;
})(typeof window !== 'undefined' ? window : globalThis);
