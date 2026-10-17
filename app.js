// La pantalla de la app. Todo se guarda en el móvil (localStorage): no hay servidor.
//   quimica.recetas      las recetas
//   quimica.clave        la clave de Gemini (solo se usa para hablar con Gemini; nunca se enseña)
//   quimica.cronometros  los cronómetros en marcha (la hora a la que acaba cada uno)
//   quimica.hechos       los pasos marcados como hechos de cada receta
//   quimica.ciclos       por qué ciclo va cada paso que se repite, de cada receta
//   quimica.donde        por dónde se estaba mirando cada receta (para volver al mismo sitio)
//   quimica.borrador     el texto a medio pegar de "Nueva receta"
//   quimica.calculadora  lo último escrito en la calculadora
//   quimica.cuaderno     los grupos de muestras y la bitácora de cada receta (cuaderno.js)
//   (las fotos del cuaderno van aparte, en IndexedDB: fotos.js)
// Las cuentas están en quimica.js y lo de Gemini en ia.js.
(function () {
  'use strict';
  const Q = window.Quimica;
  const $ = (id) => document.getElementById(id);

  // h('button', { class: 'boton', text: 'Hola', onclick: fn }, hijos…)
  const h = (etiqueta, props, ...hijos) => {
    const el = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      // "list" (la lista de sugerencias de un campo) solo se puede poner como atributo
      else if (k === 'list') el.setAttribute(k, v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const hijo of hijos.flat(Infinity)) if (hijo != null && hijo !== false && hijo !== '') el.append(hijo);
    return el;
  };
  // Cambia lo que hay dentro de un elemento. Como h(), admite listas dentro de la lista y se salta
  // lo que sea null o false (replaceChildren a secas los escribiría como texto)
  const poner = (el, ...hijos) => el.replaceChildren(...hijos.flat(Infinity).filter((x) => x != null && x !== false && x !== ''));

  // Una fórmula en forma de fracción ("build-up"): lo que multiplica arriba, la raya y lo que
  // divide abajo. f = { num, den } (de Q.fraccionConNumeros o Q.fraccionConNombres); sin den, una línea
  const fraccion = (f) => h('span', { class: 'fraccion', 'aria-label': f.den ? `${f.num} ÷ ${/ [×+] /.test(f.den) ? `(${f.den})` : f.den}` : f.num },
    h('span', { class: 'num', text: f.num }), f.den && h('span', { class: 'den', text: f.den }));

  // ─── La "cara" de las fórmulas (Q.fichaFormula): lo mismo en la receta y en la calculadora ───
  // La etiqueta de color con el icono y el nombre corto: "⚖️ Pesar (molaridad)"
  const etiquetaFormula = (tipo) => {
    const f = Q.fichaFormula(tipo);
    return f ? h('span', { class: `etiqueta-formula color-${f.color}`, text: `${f.icono} ${f.corto}` })
      : h('span', { class: 'etiqueta-formula color-libre', text: '✏️ Fórmula propia' });
  };
  // Una letra de una fórmula (c, V, PM…), en su recuadro
  const simbolo = (texto) => h('span', { class: 'simbolo', text: texto });
  // "V₁ = c₂ × V₂ / c₁", con la fracción de verdad
  const igualA = (sale, fr) => h('div', { class: 'ficha-formula' }, h('span', { text: `${sale} =` }), fraccion(fr));
  // La ficha entera: nombre, qué hace y la fórmula con letras. titulo/que/extra: para cambiar lo de la ficha
  const fichaVisual = (tipo, { titulo, que, extra } = {}) => {
    const f = Q.fichaFormula(tipo);
    return h('div', { class: `ficha color-${f.color}` },
      h('div', { class: 'ficha-titulo', text: titulo || `${f.icono} ${f.corto}` }),
      h('div', { class: 'ficha-que', text: que || f.que }),
      igualA(f.sale, f.formula),
      extra && h('div', { class: 'ficha-que', text: extra }));
  };

  const leer = (clave, defecto) => {
    try { const v = JSON.parse(localStorage.getItem(clave)); return v == null ? defecto : v; } catch { return defecto; }
  };
  const guardar = (clave, valor) => {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { avisar('No se ha podido guardar: el móvil no tiene sitio'); }
  };
  const sinTildes = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // ─── Las recetas ───
  let recetas = leer('quimica.recetas', []).filter((r) => r && r.id && Array.isArray(r.pasos) && Array.isArray(r.datos) && Array.isArray(r.calculos));
  // Lo pone la conexión con el PC (más abajo): apunta qué ha cambiado y cuándo, y sincroniza
  let alCambiarDatos = () => {};
  // Lo pone el formulario abierto: guarda un borrador si se sale de la app con cambios sin guardar
  // (quimica.borrador-receta; al volver a abrir la app se ofrece recuperarlo)
  let alSalirDeLaApp = null;
  const quitarBorrador = () => { try { localStorage.removeItem('quimica.borrador-receta'); } catch { /* nada */ } };
  const guardarRecetas = () => { guardar('quimica.recetas', recetas); alCambiarDatos(); };
  const idNuevo = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const recetaDe = (id) => recetas.find((r) => r.id === id);
  // Pone una receta nueva o cambia la que tenga ese id
  const ponerReceta = (receta) => {
    if (!receta.id) receta.id = idNuevo();
    const i = recetas.findIndex((r) => r.id === receta.id);
    if (i >= 0) recetas[i] = receta; else recetas.unshift(receta);
    guardarRecetas();
    pintarLista();
    return receta;
  };

  const clave = () => leer('quimica.clave', '');
  const hayIA = () => Boolean(clave());

  // ─── Paneles por encima y botón atrás ───
  // Cada panel o pregunta abierta apunta un paso en el historial; "atrás" (el botón del móvil o la
  // flecha) cierra el de arriba. En Android lo hace MainActivity con el historial de la web
  const capas = [];
  let trasCerrar = null;
  // Devuelve la capa: si se le pone retener (una función que devuelve true), "atrás" no la cierra
  // (lo usa el formulario para preguntar si se guardan los cambios)
  // (la barra lateral del PC se repinta al abrir y cerrar capas: dice qué está abierto; la pone más abajo)
  let pintarLateral = () => {};
  const abrirCapa = (el, alCerrar) => {
    const capa = { el, alCerrar, retener: null };
    capas.push(capa);
    history.pushState({ capa: capas.length }, '');
    setTimeout(() => pintarLateral(), 0);
    return capa;
  };
  window.addEventListener('popstate', () => {
    const quedan = (history.state && history.state.capa) || 0;
    while (capas.length > quedan) {
      const arriba = capas[capas.length - 1];
      // No se deja cerrar: se vuelve a apuntar en el historial y se queda como estaba
      if (arriba.retener && arriba.retener()) {
        history.pushState({ capa: capas.length }, '');
        trasCerrar = null;
        return;
      }
      const c = capas.pop();
      c.el.remove();
      if (c.alCerrar) c.alCerrar();
    }
    const luego = trasCerrar;
    trasCerrar = null;
    if (luego) luego();
    pintarLateral();
  });
  const atras = () => history.back();
  // En el PC, la tecla Esc es «atrás» (cierra lo de arriba: una pregunta, un panel…) (versión 136)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && capas.length && !e.defaultPrevented) { e.preventDefault(); atras(); }
  });
  // Cierra varias capas de golpe y después hace algo (abrir otra, por ejemplo)
  const cerrarCapas = (cuantas, luego) => {
    trasCerrar = luego || null;
    history.go(-cuantas);
  };

  const abrirPanel = (titulo, acciones, alCerrar) => {
    const cuerpo = h('div', { class: 'panel-cuerpo' });
    const tit = h('h2', { text: titulo });
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-cabecera' },
        h('button', { class: 'icono', 'aria-label': 'Atrás', text: '‹', onclick: atras }), tit, acciones || []),
      cuerpo);
    // En la app del PC, el estado del móvil también dentro de cada pantalla (la barra de arriba queda
    // tapada): el mismo indicador, que se actualiza con el de arriba
    // (en la app del PC, si hay un móvil conectado; en la de internet, si hay cambios sin pasar al PC)
    if (window.chipMovilNuevo) tit.after(window.chipMovilNuevo());
    document.body.append(panel);
    const capa = abrirCapa(panel, alCerrar);
    return { panel, cuerpo, titulo: tit, capa };
  };

  // Una pregunta. Devuelve null (no, o atrás), true, o lo escrito si lleva campo.
  // otro: un tercer botón (a la izquierda); si se pulsa, devuelve 'otro'
  const preguntar = ({ texto, detalle, si = 'Sí', no = 'No', peligro, campo, otro }) => new Promise((resolver) => {
    let respuesta = null;
    // campo.filas: un cuadro de varias líneas en vez de una
    const { filas, ...propsCampo } = campo || {};
    const entrada = campo ? h(filas ? 'textarea' : 'input', { class: 'campo', autocomplete: 'off', rows: filas, ...propsCampo }) : null;
    const fondo = h('div', { class: 'dialogo-fondo', onclick: (e) => { if (e.target === fondo) atras(); } },
      h('div', { class: 'dialogo' },
        h('p', { class: 'dialogo-texto', text: texto }),
        // detalle: un texto, o elementos ya hechos (una fórmula en forma de fracción, por ejemplo)
        typeof detalle === 'string' ? h('p', { class: 'dialogo-detalle', text: detalle }) : detalle,
        entrada,
        otro && h('button', { class: 'boton discreto', text: otro, onclick: () => { respuesta = 'otro'; atras(); } }),
        h('div', { class: 'dialogo-botones' },
          no && h('button', { class: 'boton secundario', text: no, onclick: atras }),
          h('button', { class: `boton${peligro ? ' peligro' : ''}`, text: si, onclick: () => { respuesta = entrada ? entrada.value : true; atras(); } }))));
    document.body.append(fondo);
    abrirCapa(fondo, () => resolver(respuesta));
  });

  // El aviso de abajo, con un botón opcional ({ texto, hacer })
  let relojAviso = null;
  const avisar = (texto, accion) => {
    const a = $('aviso');
    a.replaceChildren(h('span', { text: texto }), accion ? h('button', { text: accion.texto, onclick: () => { a.hidden = true; accion.hacer(); } }) : '');
    a.hidden = false;
    clearTimeout(relojAviso);
    relojAviso = setTimeout(() => { a.hidden = true; }, accion ? 8000 : 4500);
  };

  // ─── Cronómetros ───
  // Se guarda la hora a la que acaba cada uno, no un setTimeout: así siguen bien aunque se cierre la
  // app. En Android, además, cada uno pone una alarma de verdad (plugin nativo Alarma), que suena
  // con la app cerrada. Ojo: en la app Capacitor.registerPlugin no existe; se usa Capacitor.Plugins
  const alarma = window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('Alarma')
    ? window.Capacitor.Plugins.Alarma : null;
  let cronometros = leer('quimica.cronometros', []);
  let reloj = null;
  let alCambiarCronometros = null; // lo pone el detalle abierto, para repintar sus pasos
  const guardarCronometros = () => guardar('quimica.cronometros', cronometros);
  const falta = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  };
  const vibrar = (patron) => { try { if (navigator.vibrate) navigator.vibrate(patron); } catch { /* sin vibración */ } };

  // ─── Ciclos ───
  // El primer paso de un ciclo que se repite (paso.ciclos = cuántos son en total) lleva un contador:
  // sube solo al poner su cronómetro y se corrige con − y ＋ (por si se pulsa sin querer).
  // quimica.ciclos = { idReceta: { nº de paso (desde 0): ciclos empezados } }
  const ciclosDe = (recetaId) => leer('quimica.ciclos', {})[recetaId] || {};
  const ponerCiclo = (recetaId, i, n) => {
    const todos = leer('quimica.ciclos', {});
    const suyos = todos[recetaId] || {};
    if (n > 0) suyos[i] = n; else delete suyos[i];
    if (Object.keys(suyos).length) todos[recetaId] = suyos; else delete todos[recetaId];
    guardar('quimica.ciclos', todos);
  };
  const borrarCiclos = (recetaId) => {
    const todos = leer('quimica.ciclos', {});
    delete todos[recetaId];
    guardar('quimica.ciclos', todos);
  };

  // ─── El cuaderno: un cuaderno por receta, con sus grupos de muestras y su bitácora ───
  // La lógica (historia de cada grupo, por dónde va, separar) está en cuaderno.js y las fotos en
  // fotos.js. Aquí: leer y guardar, las fotos en pantalla y las preguntas.
  const K = window.Cuaderno;
  const leerCuaderno = () => K.limpiar(leer('quimica.cuaderno', null));
  const guardarCuaderno = (c) => { guardar('quimica.cuaderno', c); alCambiarDatos(); };
  // Lee el cuaderno, lo cambia con fn y lo guarda. Devuelve lo que devuelva fn
  const cambiarCuaderno = (fn) => {
    const c = leerCuaderno();
    const r = fn(c);
    guardarCuaderno(c);
    return r;
  };
  const idDe = (letra) => `${letra}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const fechaCorta = (ms) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const horaDe = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const diaDe = (ms) => new Date(ms).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Las fases de una receta (los rótulos de sus pasos); de una receta borrada, ninguna
  const fasesDe = (receta) => (receta && receta.pasos ? Q.tramosFases(receta).map((t) => t.titulo) : []);
  const muestrasTexto = (n) => (n == null ? '' : `${n} ${n === 1 ? 'muestra' : 'muestras'}`);
  // Hoy como 'AAAA-MM-DD' (con la fecha del móvil), y cómo se dice el día en que le toca algo a un
  // grupo (grupo.toca, versión 86): «hoy», «mañana», «el lun 12 oct», «hace 2 días (se pasó)»
  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const cuandoToca = (dia) => {
    const n = K.diasHasta(hoyISO(), dia);
    if (n === 0) return 'hoy';
    if (n === 1) return 'mañana';
    if (n === -1) return 'ayer (se pasó)';
    if (n < 0) return `hace ${-n} días (se pasó)`;
    return `el ${new Date(`${dia}T12:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  };
  const conFecha = (est) => (est.toca ? ` · 📅 ${cuandoToca(est.toca)}` : '');
  // "Fase 3 hecha (5 oct) → le toca Fase 4"
  const textoEstado = (est) => {
    switch (est.estado) {
      case 'nada': return `Sin empezar${est.aMano || est.toca ? ` → le toca ${K.nombreFase(est.siguiente)}${conFecha(est)}` : ''}`;
      case 'en': return est.subfase
        ? `▶ En ${K.nombreFase(est.fase)}: ${est.subfase} hecha (${fechaCorta(est.fecha)})`
        : `▶ En ${K.nombreFase(est.fase)} (desde el ${fechaCorta(est.fecha)})`;
      case 'terminado': return `✅ Terminado (${fechaCorta(est.fecha)})`;
      case 'juntado': return `🔗 Juntado con «${est.con}» (${fechaCorta(est.fecha)})`;
      case 'pasado': return `📤 Pasó al cuaderno «${est.cuaderno}» (${fechaCorta(est.fecha)})`;
      default: return `✔ ${K.nombreFase(est.fase)} hecha (${fechaCorta(est.fecha)})${est.siguiente !== undefined ? ` → le toca ${K.nombreFase(est.siguiente)}${conFecha(est)}` : ''}`;
    }
  };
  // (con las subfases de la receta: hasta terminar la última de muestras no se acaba la fase)
  // (toca: el día en que le toca lo siguiente, si se le puso)
  const estadoGrupo = (c, g) => {
    const r = recetaDe(g.recetaId);
    const est = K.estadoDe(c, g.id, fasesDe(r), r ? Q.ultimasDeMuestras(r) : {});
    return g.toca ? { ...est, toca: g.toca } : est;
  };
  // Los avisos de «le toca» (hoy, mañana o ya pasados), de todo o de un cuaderno (amb). Cada uno, un
  // botón que abre el grupo
  const avisosDeToca = (c, amb, alVolver) => {
    const avisos = K.avisosToca(c, hoyISO(), (g) => estadoGrupo(c, g)).filter((a) => !amb || K.casa(a.grupo, amb));
    if (!avisos.length) return null;
    return h('div', { class: 'avisos-toca' }, avisos.map((a) => h('button', { class: `aviso-toca${a.dias < 0 ? ' tarde' : a.dias === 0 ? ' hoy' : ''}`,
      onclick: () => { const r = recetaDe(a.grupo.recetaId); if (r) abrirGrupo(r, a.grupo.id, alVolver); } },
    h('b', { text: `⏰ ${cuandoToca(a.dia)[0].toUpperCase()}${cuandoToca(a.dia).slice(1)}:` }),
    h('span', { text: ` «${a.grupo.nombre}» tiene que empezar ${K.nombreFase(a.fase)}` }))));
  };
  const apuntar = (entrada) => cambiarCuaderno((c) => {
    const e = { id: idDe('e'), fecha: Date.now(), ...entrada };
    if (!e.fotos || !e.fotos.length) delete e.fotos;
    c.entradas.push(e);
    // Al empezar o terminar una fase, lo que le tocaba puesto a mano ya no hace falta; y al empezar,
    // tampoco el día en que le tocaba
    const g = (e.tipo === 'empezar' || e.tipo === 'fase') && K.grupoDe(c, e.grupoId);
    if (g) delete g.siguiente;
    if (g && e.tipo === 'empezar') delete g.toca;
    return e;
  });
  // Quita una entrada y sus fotos
  const quitarEntrada = (id) => {
    const e = cambiarCuaderno((c) => {
      const x = c.entradas.find((y) => y.id === id);
      c.entradas = c.entradas.filter((y) => y.id !== id);
      if (x && x.fotos) K.olvidarFotos(c, x.fotos);
      return x;
    });
    // (las que sigue enseñando un informe guardado, no: versión 134)
    const enInformes = fotosUsadas();
    for (const f of (e && e.fotos) || []) if (!enInformes.has(f)) window.Fotos.borrar(f).catch(() => {});
  };
  const quitarGrupo = (id) => cambiarCuaderno((c) => { c.grupos = c.grupos.filter((g) => g.id !== id); });

  // ─── Fotos en pantalla ───
  const urlsFotos = new Map(); // id → dirección de la imagen (se hace una vez por foto)
  const urlDe = async (id) => {
    if (!urlsFotos.has(id)) {
      const f = await window.Fotos.leer(id);
      if (!f) return null;
      urlsFotos.set(id, URL.createObjectURL(f.blob));
    }
    return urlsFotos.get(id);
  };
  // La miniatura (400 px; versión 125) para listas, tarjetas y galería: la foto entera solo al verla
  // en grande, al comparar y en el informe
  const urlsMini = new Map();
  const urlMini = async (id) => {
    if (!urlsMini.has(id)) {
      const mini = await window.Fotos.miniaturaDe(id).catch(() => null);
      // (si no sale la miniatura, la foto entera, como antes)
      if (!mini) return urlDe(id);
      urlsMini.set(id, URL.createObjectURL(mini));
    }
    return urlsMini.get(id);
  };
  // La vista (2000 px como mucho; versión 126) para ver una foto en grande o compararla sin ampliar;
  // al ampliar, la foto entera (urlDe), a toda su resolución
  const urlsVista = new Map();
  // La foto para el informe (en la pantalla y en el PDF): con los píxeles que necesita en el papel (versión 141)
  const urlsDocumento = new Map();
  const urlDocumento = async (id, ancho) => {
    const k = `${id}|${ancho}`;
    if (!urlsDocumento.has(k)) {
      const d = await window.Fotos.paraDocumento(id, ancho).catch(() => null);
      if (!d) return urlVista(id);
      urlsDocumento.set(k, URL.createObjectURL(d.blob));
    }
    return urlsDocumento.get(k);
  };
  const urlVista = async (id) => {
    if (!urlsVista.has(id)) {
      const v = await window.Fotos.vistaDe(id).catch(() => null);
      if (!v) return urlDe(id);
      urlsVista.set(id, URL.createObjectURL(v));
    }
    return urlsVista.get(id);
  };
  // Ampliar una imagen dentro de su marco (lo pidió el usuario: «hacer zoom ampliando con los dedos»):
  // con dos dedos se amplía alrededor de donde están; con uno se mueve (si está ampliada); un toque
  // la amplía ×2,5 donde se toca, u otra vez a su tamaño; en el PC, la rueda del ratón. La imagen se
  // mueve con transform: un punto p de la imagen sale en t + s·p (s: aumento, t: desplazamiento)
  // alCambiar({ s, fx, fy }): avisa de cada cambio hecho aquí (fx, fy: el desplazamiento en partes
  // del marco), para ampliar igual otras fotos (al comparar). soloRueda: la rueda del ratón amplía
  // sin Ctrl (en la foto en grande sí; al comparar, no). Devuelve { fijar(estado) }, que pone un
  // estado sin avisar
  // entera (versión 126): () => promesa con la dirección de la foto entera; se pone al empezar a
  // ampliar (hasta entonces, la vista de 2000 px). ancho/alto: los de la foto entera, para poder
  // ampliar hasta ver cada píxel (el doble de eso, como mucho; antes, ×10 fijo)
  const hacerZoom = (marco, img, alCambiar, soloRueda = true, op = {}) => {
    let s = 1;
    let t = { x: 0, y: 0 };
    const dedos = new Map(); // pointerId → { x, y } (dentro del marco)
    let gesto = null; // cómo estaba al empezar a mover o a pellizcar
    let MAX = 10;
    let conEntera = !op.entera;
    const enMarco = (ev) => { const r = marco.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    // Que la imagen no se salga: con s ≥ 1, t entre (tamaño − s·tamaño) y 0
    const ajustar = (avisar = true) => {
      if (op.ancho && marco.clientWidth) MAX = Math.min(60, Math.max(10, 2 * Math.max(op.ancho / marco.clientWidth, (op.alto || 0) / (marco.clientHeight || 1))));
      if (s > 1.1 && !conEntera) {
        conEntera = true;
        op.entera().then((u) => { if (u && img.src !== u) img.src = u; }).catch(() => {});
      }
      s = Math.min(MAX, Math.max(1, s));
      const w = marco.clientWidth;
      const hh = marco.clientHeight;
      t = { x: Math.min(0, Math.max(w - s * w, t.x)), y: Math.min(0, Math.max(hh - s * hh, t.y)) };
      img.style.transform = `translate(${t.x}px, ${t.y}px) scale(${s})`;
      marco.classList.toggle('ampliada', s > 1);
      if (avisar && alCambiar) alCambiar({ s, fx: w ? t.x / w : 0, fy: hh ? t.y / hh : 0 });
    };
    // Ampliar hasta s2 dejando quieto el punto p del marco
    const ampliarEn = (p, s2) => {
      const c = { x: (p.x - t.x) / s, y: (p.y - t.y) / s };
      s = Math.min(MAX, Math.max(1, s2));
      t = { x: p.x - s * c.x, y: p.y - s * c.y };
      ajustar();
    };
    const medio = () => { const [a, b] = [...dedos.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const distancia = () => { const [a, b] = [...dedos.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    // (trasPellizco: el dedo que queda al soltar otro no cuenta como un toque al levantarlo)
    const empezar = (trasPellizco) => {
      gesto = dedos.size >= 2
        ? { tipo: 'pellizco', s: s, t: { ...t }, m: medio(), d: distancia() }
        : { tipo: 'mover', t: { ...t }, p: { ...[...dedos.values()][0] }, cuando: Date.now(), movido: 0, trasPellizco };
    };
    marco.addEventListener('pointerdown', (ev) => {
      // (con el ratón, que no arrastre la imagen ni seleccione; con los dedos no se toca nada: si
      // no, al comparar no se podía mover la página deslizando sobre una foto, visto en el móvil)
      if (ev.pointerType !== 'touch') {
        ev.preventDefault();
        try { marco.setPointerCapture(ev.pointerId); } catch { /* sin captura, igual */ }
      }
      dedos.set(ev.pointerId, enMarco(ev));
      empezar();
    });
    marco.addEventListener('pointermove', (ev) => {
      if (!dedos.has(ev.pointerId) || !gesto) return;
      dedos.set(ev.pointerId, enMarco(ev));
      if (gesto.tipo === 'pellizco' && dedos.size >= 2) {
        // El punto de la imagen que estaba entre los dedos sigue entre los dedos
        const m = medio();
        const c = { x: (gesto.m.x - gesto.t.x) / gesto.s, y: (gesto.m.y - gesto.t.y) / gesto.s };
        s = Math.min(MAX, Math.max(1, gesto.s * distancia() / gesto.d));
        t = { x: m.x - s * c.x, y: m.y - s * c.y };
        ajustar();
      } else if (gesto.tipo === 'mover') {
        const p = dedos.get(ev.pointerId);
        gesto.movido = Math.max(gesto.movido, Math.hypot(p.x - gesto.p.x, p.y - gesto.p.y));
        if (s > 1) { t = { x: gesto.t.x + p.x - gesto.p.x, y: gesto.t.y + p.y - gesto.p.y }; ajustar(); }
      }
    });
    const soltar = (ev) => {
      if (!dedos.has(ev.pointerId)) return;
      const p = dedos.get(ev.pointerId);
      dedos.delete(ev.pointerId);
      // Un toque (sin moverse, rápido): ampliar ahí, o volver a su tamaño. Si el navegador se ha
      // quedado el gesto (pointercancel: al comparar, para mover la página), no es un toque
      if (ev.type === 'pointerup' && gesto && gesto.tipo === 'mover' && !gesto.trasPellizco && !dedos.size && gesto.movido < 8 && Date.now() - gesto.cuando < 400) {
        if (s > 1) { s = 1; t = { x: 0, y: 0 }; ajustar(); } else ampliarEn(p, 2.5);
      }
      // Si queda un dedo, sigue moviendo desde donde está
      if (dedos.size) empezar(true); else gesto = null;
    };
    marco.addEventListener('pointerup', soltar);
    marco.addEventListener('pointercancel', soltar);
    // En el PC, la rueda del ratón
    // (al comparar, solo con Ctrl: si no, la rueda tiene que mover la página)
    marco.addEventListener('wheel', (ev) => {
      if (!soloRueda && !ev.ctrlKey) return;
      ev.preventDefault();
      ampliarEn(enMarco(ev), s * (ev.deltaY < 0 ? 1.2 : 1 / 1.2));
    }, { passive: false });
    return { fijar: (e) => { s = e.s; t = { x: e.fx * marco.clientWidth, y: e.fy * marco.clientHeight }; ajustar(false); } };
  };
  // La foto en grande, con su título (✏️ para cambiarlo). Se amplía con los dedos o tocándola
  // (hacerZoom); se cierra con ✕ o con atrás. alCambiar: para repintar lo de debajo si se cambia el título
  const verFoto = async (id, alCambiar) => {
    const url = await urlVista(id).catch(() => null);
    if (!url) { avisar('Esa foto ya no está'); return; }
    const f = await window.Fotos.leer(id);
    const c = leerCuaderno();
    const entrada = c.entradas.find((e) => (e.fotos || []).includes(id));
    const titulo = h('b', { text: entrada ? K.tituloFoto(c, id, entrada) : f.nombre });
    const img = h('img', { src: url, alt: titulo.textContent });
    const marco = h('div', { class: 'visor-marco' }, img);
    // (al ampliar, la foto entera: a toda su resolución)
    hacerZoom(marco, img, null, true, { entera: () => urlDe(id), ancho: f.ancho, alto: f.alto });
    // Las fotos guardadas antes de la versión 126 se reducían a 2000 px y el original no está en el
    // aparato: se puede cambiar por el original (versión 126, lo pidió el usuario: «verlas a máxima
    // resolución»). Es otra foto (otro id), para que llegue igual a los demás aparatos
    // (las que se redujeron tienen el lado mayor justo de 2000 px; las más pequeñas, como las del SEM
    // del usuario —1280 × 960—, se guardaron enteras y ya se ven a toda su resolución)
    const reducida = f.ancho && f.alto && Math.max(f.ancho, f.alto) === window.Fotos.LADO;
    const archivoOriginal = h('input', { type: 'file', accept: 'image/*,.tif,.tiff', hidden: true, onchange: async () => {
      const a = archivoOriginal.files && archivoOriginal.files[0];
      archivoOriginal.value = '';
      if (!a) return;
      try {
        avisar('Preparando la foto…');
        const nueva = await window.Fotos.convertir(a);
        if (Math.max(nueva.ancho, nueva.alto) <= Math.max(f.ancho, f.alto)) {
          if (!await preguntar({ texto: '¿Cambiarla igual?', detalle: `Esa foto (${nueva.ancho} × ${nueva.alto} px) no tiene más resolución que la de ahora (${f.ancho} × ${f.alto} px).`, si: 'Cambiarla', no: 'Cancelar' })) return;
        }
        await window.Fotos.guardar({ ...nueva, nombre: nueva.nombre || f.nombre });
        cambiarCuaderno((d) => K.cambiarIdFoto(d, id, nueva.id));
        await window.Fotos.borrar(id).catch(() => {});
        for (const m of [urlsFotos, urlsMini, urlsVista]) { const u = m.get(id); if (u) { URL.revokeObjectURL(u); m.delete(id); } }
        avisar(`✅ Cambiada por la original: ${nueva.ancho} × ${nueva.alto} px`);
        if (alCambiar) alCambiar();
        cerrarCapas(1, () => verFoto(nueva.id, alCambiar));
      } catch (e) { avisar(`No se ha podido usar esa foto (${(e && e.message) || 'error'})`); }
    } });
    // El aumento y la zona de la foto (lo pidió el usuario, para comparar al mismo aumento): un toque
    // en un aumento lo pone (otro toque lo quita); «Otro…» y la zona se escriben. Van en la entrada
    // (fotosInfo), así pasan al PC
    const cajaInfo = h('div', { class: 'visor-info' });
    const ponerInfo = (cambios) => {
      cambiarCuaderno((d) => {
        const x = d.entradas.find((y) => y.id === entrada.id);
        if (!x) return;
        const n = { ...K.infoFoto(x, id), ...cambios };
        for (const k of Object.keys(n)) if (!n[k]) delete n[k];
        x.fotosInfo = { ...(x.fotosInfo || {}) };
        if (Object.keys(n).length) x.fotosInfo[id] = n; else delete x.fotosInfo[id];
        if (!Object.keys(x.fotosInfo).length) delete x.fotosInfo;
      });
      pintarInfo();
      if (alCambiar) alCambiar();
    };
    const pintarInfo = () => {
      const d = leerCuaderno();
      const i = K.infoFoto(d.entradas.find((y) => y.id === (entrada && entrada.id)), id);
      const AUMENTOS = ['×100', '×500', '×1000', '×5000', '×10000', '×50000'];
      const otro = i.aumento && !AUMENTOS.includes(i.aumento);
      poner(cajaInfo,
        h('div', { class: 'chips' }, h('span', { class: 'chips-rotulo', text: '🔍' }),
          AUMENTOS.map((a) => h('button', { class: 'chip', 'aria-pressed': String(i.aumento === a), text: a, onclick: () => ponerInfo({ aumento: i.aumento === a ? '' : a }) })),
          h('button', { class: 'chip', 'aria-pressed': String(Boolean(otro)), text: otro ? i.aumento : 'Otro…', onclick: async () => {
            const v = await preguntar({ texto: 'Aumento', campo: { value: otro ? i.aumento : '', placeholder: 'Por ejemplo: 2000 o ×2000', inputmode: 'decimal' }, si: 'Guardar', no: 'Cancelar' });
            if (v === null) return;
            const t = v.trim();
            ponerInfo({ aumento: /^[\d.,]+$/.test(t) ? `×${t}` : t.slice(0, 20) });
          } })),
        h('button', { class: 'visor-zona', text: i.zona ? `📍 ${i.zona} ✏️` : '📍 Zona (si quieres): borde, centro…', onclick: async () => {
          const v = await preguntar({ texto: 'Zona de la muestra', campo: { value: i.zona || '', placeholder: 'Por ejemplo: borde, centro, corte transversal', autocapitalize: 'sentences' }, si: 'Guardar', no: 'Cancelar' });
          if (v === null) return;
          ponerInfo({ zona: v.trim().slice(0, 40) });
        } }));
    };
    if (entrada) pintarInfo();
    const fondo = h('div', { class: 'visor' },
      h('div', { class: 'visor-cabecera' },
        h('div', { class: 'visor-titulo' }, titulo,
          entrada && h('small', { text: [entrada.grupo, K.momentoDe(c, entrada.grupoId, entrada.fecha), `${fechaCorta(entrada.fecha)} ${horaDe(entrada.fecha)}`, f.nombre, f.ancho && `${f.ancho} × ${f.alto} px`].filter(Boolean).join(' · ') })),
        entrada && h('button', { class: 'icono pequeno', 'aria-label': 'Cambiar el título', text: '✏️', onclick: async () => {
          const nuevo = await preguntar({ texto: 'Título de la foto', campo: { value: titulo.textContent, placeholder: 'Por ejemplo: SEM 5000x, grupo B tras el lavado', autocapitalize: 'sentences' }, si: 'Guardar', no: 'Cancelar' });
          if (nuevo === null) return;
          cambiarCuaderno((d) => { if (nuevo.trim()) d.titulos[id] = nuevo.trim().slice(0, 80); else delete d.titulos[id]; });
          const d = leerCuaderno();
          titulo.textContent = K.tituloFoto(d, id, d.entradas.find((e) => e.id === entrada.id) || entrada);
          if (alCambiar) alCambiar();
        } }),
        h('button', { class: 'icono', 'aria-label': 'Cerrar', text: '✕', onclick: atras })),
      entrada && cajaInfo,
      marco,
      h('p', { class: 'visor-ayuda', text: 'Amplía con dos dedos (o tocándola) y muévela con uno: al ampliar se ve a toda su resolución' }),
      entrada && reducida && h('button', { class: 'visor-original', type: 'button', text: '📷 ¿Tienes la original con más resolución? Cámbiala', onclick: () => archivoOriginal.click() }),
      archivoOriginal);
    document.body.append(fondo);
    abrirCapa(fondo);
  };
  const miniaturas = (ids) => (ids && ids.length ? h('div', { class: 'miniaturas' }, ids.map((id) => {
    const img = h('img', { alt: 'Foto', loading: 'lazy', decoding: 'async' });
    urlMini(id).then((u) => { if (u) img.src = u; else img.alt = '(foto borrada)'; }).catch(() => {});
    return h('button', { class: 'miniatura', 'aria-label': 'Ver la foto', onclick: () => verFoto(id) }, img);
  })) : null);
  // Para añadir fotos en una pregunta: { el, guardar() → ids }. Se preparan al elegirlas (las .tiff
  // se convierten) y solo se guardan al dar a Guardar
  const selectorFotos = () => {
    const elegidas = []; // { foto, url }
    const caja = h('div', { class: 'miniaturas' });
    const estado = h('small', { class: 'nota' });
    const archivo = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const pintar = () => poner(caja, elegidas.map((x) => h('span', { class: 'miniatura' },
      h('img', { src: x.url, alt: x.foto.nombre }),
      h('button', { class: 'quitar-foto', type: 'button', 'aria-label': 'Quitar la foto', text: '✕', onclick: () => {
        elegidas.splice(elegidas.indexOf(x), 1);
        URL.revokeObjectURL(x.url);
        pintar();
      } }))));
    let trabajando = Promise.resolve();
    archivo.addEventListener('change', () => {
      const lista = [...archivo.files];
      archivo.value = '';
      trabajando = trabajando.then(async () => {
        for (const [i, a] of lista.entries()) {
          estado.textContent = `Preparando ${lista.length > 1 ? `la foto ${i + 1} de ${lista.length}` : 'la foto'}…`;
          try {
            const foto = await window.Fotos.convertir(a);
            elegidas.push({ foto, url: URL.createObjectURL(foto.blob) });
            pintar();
          } catch { avisar(`No se ha podido abrir «${a.name}»`); }
        }
        estado.textContent = '';
      });
    });
    const el = h('div', { class: 'selector-fotos' },
      h('button', { class: 'boton secundario', type: 'button', text: '📷 Añadir fotos', onclick: () => archivo.click() }), archivo, estado, caja);
    const guardarTodas = async () => {
      await trabajando;
      const ids = [];
      for (const x of elegidas) {
        try {
          await window.Fotos.guardar(x.foto);
          ids.push(x.foto.id);
          urlsFotos.set(x.foto.id, x.url);
        } catch { avisar('No se ha podido guardar una foto: el móvil no tiene sitio'); }
      }
      return ids;
    };
    return { el, guardar: guardarTodas };
  };

  // Una pregunta del cuaderno: lo de arriba (antes: elegir fase, grupo…), las fotos y la nota.
  // Devuelve null (cancelado) o { nota, fotos }
  const pedirApunte = async ({ texto, antes, si = 'Guardar' }) => {
    const sel = selectorFotos();
    const r = await preguntar({ texto, detalle: [antes, sel.el], campo: { filas: 2, placeholder: 'Nota (si quieres): qué has hecho, qué has visto…', autocapitalize: 'sentences' }, si, no: 'Cancelar' });
    if (r === null) return null;
    return { nota: r.trim(), fotos: await sel.guardar() };
  };
  // Las medidas de un apunte (versión 114): una fila por cosa que se mide (nombre, valor, unidad). Los
  // nombres ya usados salen como sugerencia, y al elegir uno se pone su última unidad.
  // { el, valores() → [{ nombre, valor, unidad }] (solo las completas), incompletas() }
  const editorMedidas = (iniciales = [], c = leerCuaderno()) => {
    const idLista = idDe('dl');
    const base = ['Capacitancia', 'Resistencia', 'Espesor', 'Masa', 'Rendimiento'];
    const usados = K.nombresDeMedidas(c).map((x) => x.nombre);
    const nombres = [...usados, ...base.filter((b) => !usados.some((u) => u.toLowerCase() === b.toLowerCase()))];
    const caja = h('div', { class: 'medidas-editor' });
    const filas = [];
    const pintar = () => poner(caja, filas.map((f) => f.el));
    const nueva = (m = {}) => {
      const nombre = h('input', { class: 'campo', list: idLista, placeholder: 'Qué mides: capacitancia, espesor…', value: m.nombre || '', autocomplete: 'off', autocapitalize: 'sentences', 'aria-label': 'Qué se mide' });
      const valor = h('input', { class: 'campo', type: 'text', inputmode: 'decimal', placeholder: 'Valor', value: m.valor == null ? '' : String(m.valor).replace('.', ','), autocomplete: 'off', 'aria-label': 'Valor' });
      const unidad = h('input', { class: 'campo', placeholder: 'Unidad', value: m.unidad || '', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Unidad' });
      nombre.addEventListener('change', () => { if (!unidad.value.trim()) unidad.value = K.unidadDeMedida(c, nombre.value); });
      const f = { nombre, valor, unidad };
      f.el = h('div', { class: 'medida-fila' }, nombre,
        h('div', { class: 'medida-valor' }, valor, unidad,
          h('button', { class: 'icono pequeno', type: 'button', 'aria-label': 'Quitar esta medida', text: '✕', onclick: () => {
            if (filas.length === 1) { nombre.value = ''; valor.value = ''; unidad.value = ''; return; }
            filas.splice(filas.indexOf(f), 1);
            pintar();
          } })));
      return f;
    };
    for (const m of iniciales.length ? iniciales : [{}]) filas.push(nueva(m));
    pintar();
    const el = h('div', {}, h('datalist', { id: idLista }, nombres.map((n) => h('option', { value: n }))), caja,
      h('button', { class: 'boton secundario', type: 'button', text: '＋ Otra medida', onclick: () => {
        const f = nueva();
        filas.push(f);
        pintar();
        f.nombre.focus();
      } }));
    const leerFila = (f) => ({ nombre: f.nombre.value.trim().slice(0, 60), valor: Q.aNumero(f.valor.value), unidad: f.unidad.value.trim().slice(0, 20) });
    return {
      el,
      valores: () => filas.map(leerFila).filter((m) => m.nombre && m.valor != null && Number.isFinite(m.valor)),
      // (las que tienen algo escrito pero les falta el nombre o el número)
      incompletas: () => filas.map(leerFila).filter((m) => {
        const conValor = m.valor != null && Number.isFinite(m.valor);
        return (m.nombre || conValor) && !(m.nombre && conValor);
      }).length,
    };
  };
  // «¿Algo distinto a la receta?» (versión 114): una línea al terminar una fase, para saber luego qué
  // cambió cuando un grupo sale raro. Va en el apunte como `distinto`. { el, valor() }
  const campoDistinto = (inicial = '') => {
    const i = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', value: inicial,
      placeholder: 'Por ejemplo: 12 min en vez de 10; la tinta estaba turbia', 'aria-label': 'Algo distinto a la receta' });
    return { el: h('label', { class: 'etiqueta-campo campo-distinto' }, h('span', { text: '⚠️ ¿Algo distinto a la receta? (si quieres)' }), i), valor: () => i.value.trim().slice(0, 200) };
  };
  // Un desplegable con las fases de la receta: { el, fase() }
  const elegirFase = (fases, marcada) => {
    const s = h('select', { class: 'campo' }, fases.map((f, i) => h('option', { value: String(i), text: K.nombreFase(f), selected: f === marcada })));
    return { el: h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Fase' }), s), fase: () => fases[Number(s.value)] };
  };
  // ─── El cuaderno que se está usando en cada receta (en este aparato) ───
  // quimica.cuaderno-actual = { idReceta: idCuaderno }; si no hay o ya no existe, el Cuaderno 1
  const cuadernoActual = (recetaId) => {
    const id = leer('quimica.cuaderno-actual', {})[recetaId];
    return K.cuadernosDe(leerCuaderno(), recetaId).some((k) => k.id === id) ? id : K.principal(recetaId);
  };
  const ponerCuadernoActual = (recetaId, id) => {
    const t = leer('quimica.cuaderno-actual', {});
    t[recetaId] = id;
    guardar('quimica.cuaderno-actual', t);
  };
  const ambitoActual = (receta) => K.ambito(receta.id, cuadernoActual(receta.id));
  // El de algo ya apuntado (un grupo, una disolución): el suyo
  const ambitoDe = (x) => K.ambito(x.recetaId, K.cuadernoDe(x));

  // Para elegir el grupo al terminar una fase desde la receta: los grupos (con por dónde van),
  // «Sin grupo» si aún no hay ninguno, y «＋ Grupo nuevo» con su nombre y sus muestras.
  // Devuelve { el, elegido() }: el grupo, null (sin grupo), { nuevo, muestras } o undefined (nuevo sin nombre)
  const elegirGrupo = (cuaderno, recetaId, marcado) => {
    // (los que se juntaron con otro ya no siguen)
    const grupos = K.gruposDe(cuaderno, recetaId).filter((g) => !g.juntadoEn && !g.pasadoA);
    let elegido = grupos.find((g) => g.id === marcado) || grupos[0] || null;
    const nombreNuevo = h('input', { class: 'campo', placeholder: 'Nombre: Grupo A…', autocapitalize: 'sentences', autocomplete: 'off' });
    const cuantasNuevo = h('input', { class: 'campo', type: 'text', inputmode: 'numeric', placeholder: 'Nº de muestras (si quieres)', autocomplete: 'off' });
    const radioNuevo = h('input', { type: 'radio', name: 'grupo', onchange: () => { elegido = 'nuevo'; } });
    // Al escribir el nombre se elige esa opción sola
    for (const x of [nombreNuevo, cuantasNuevo]) x.addEventListener('focus', () => { radioNuevo.checked = true; elegido = 'nuevo'; });
    const opcion = (valor, nombre, detalle) => h('label', { class: 'opcion-grupo' },
      h('input', { type: 'radio', name: 'grupo', checked: valor === elegido, onchange: () => { elegido = valor; } }),
      h('span', {}, h('b', { text: nombre }), detalle && h('small', { text: detalle })));
    const el = h('div', { class: 'elegir-grupo' },
      h('p', { class: 'dialogo-detalle', text: '¿De qué grupo de muestras?' }),
      grupos.map((g) => opcion(g, g.nombre, [muestrasTexto(g.muestras), textoEstado(estadoGrupo(cuaderno, g))].filter(Boolean).join(' · '))),
      !grupos.length && opcion(null, 'Sin grupo', 'Si solo llevas una tanda'),
      h('div', { class: 'opcion-grupo' }, radioNuevo, h('span', { class: 'grupo-nuevo' }, h('b', { text: '＋ Grupo nuevo' }), nombreNuevo, cuantasNuevo)));
    const elegidoAhora = () => {
      if (elegido !== 'nuevo') return elegido;
      if (!nombreNuevo.value.trim()) return undefined;
      const n = Q.aNumero(cuantasNuevo.value);
      return { nuevo: nombreNuevo.value.trim().slice(0, 60), muestras: n > 0 ? Math.round(n) : null };
    };
    return { el, elegido: elegidoAhora };
  };

  // ─── Disoluciones en las preguntas ───
  // Para marcar con qué disolución han pasado unas muestras por una fase: solo las preparadas en
  // ESA fase que quedan (lo pidió el usuario), y las que ya vengan marcadas; viene marcada la
  // propuesta (K.sugeridas) o las marcadas. Debajo de cada marcada, cuánto queda y su estado
  // (queda, poca, gastada, desechada), que se guardan con guardar() al aceptar la pregunta.
  // Devuelve { el, elegidas() → [{ id, nombre }], guardar() }
  // (amb: el cuaderno; si no, el que se está usando en esa receta)
  // (si en esa fase no se ha preparado nunca ninguna, las de la fase de antes: una tinta de la
  // Fase 1 para el dip coating de la Fase 2)
  const elegirDisoluciones = (c, receta, fase, marcadas, amb = ambitoActual(receta)) => {
    const todas = K.disolucionesDe(c, amb);
    const fases = fasesDe(receta);
    const i = fases.indexOf(fase);
    const deFase = todas.some((d) => d.fase === fase) || i < 1 ? fase : fases[i - 1];
    const lista = todas.filter((d) => (d.fase === deFase && K.disponible(d)) || (marcadas || []).includes(d.id));
    const marcar = new Set(marcadas || K.sugeridas(c, amb, fasesDe(receta), fase));
    const filas = lista.map((d) => {
      let estado = d.estado || 'queda';
      const x = h('input', { type: 'checkbox', checked: marcar.has(d.id) });
      const queda = h('input', { class: 'campo', autocomplete: 'off', placeholder: 'Cuánto queda: 300 mL (si quieres)', value: d.queda || '' });
      const chips = h('div', { class: 'chips' });
      const pintarChips = () => poner(chips, Object.entries(K.ESTADOS).map(([k, t]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(estado === k), text: t, onclick: () => { estado = k; pintarChips(); } })));
      pintarChips();
      const extra = h('div', { class: 'dis-estado' }, chips, queda);
      const mostrar = () => { extra.hidden = !x.checked; };
      x.addEventListener('change', mostrar);
      mostrar();
      const el = h('div', { class: 'opcion-dis' },
        h('label', { class: 'opcion-grupo' }, x,
          h('span', {}, h('b', { text: d.nombre }), h('small', { text: [`preparada el ${fechaCorta(d.fecha)}`, K.ESTADOS[d.estado || 'queda'], d.queda && `quedan ${d.queda}`].filter(Boolean).join(' · ') }))),
        extra);
      return { d, x, el, estado: () => estado, queda: () => queda.value.trim() };
    });
    const el = h('div', { class: 'elegir-grupo' },
      h('p', { class: 'dialogo-detalle', text: '🧪 ¿Con qué disolución?' }),
      filas.map((f) => f.el),
      !lista.length && h('p', { class: 'nota', text: 'No hay ninguna disolución de esta fase que quede. Cuando la prepares, apúntala («🧪 Disolución preparada» en la receta, o en el cuaderno) y aquí podrás marcarla.' }));
    const guardarEstados = () => {
      for (const f of filas.filter((y) => y.x.checked)) {
        const estado = f.estado();
        const queda = f.queda();
        const antes = f.d.estado || 'queda';
        if (estado === antes && queda === (f.d.queda || '')) continue;
        cambiarCuaderno((y) => { const z = K.disolucionDe(y, f.d.id); if (z) { z.estado = estado; z.queda = queda; } });
        // El cambio de estado se apunta en la bitácora (como en su ficha); lo que queda, no
        if (estado !== antes) apuntar({ tipo: 'estado', disolucionId: f.d.id, disolucion: f.d.nombre, estado, recetaId: receta.id, ...K.marcaDe(ambitoDe(f.d)), receta: receta.nombre });
      }
    };
    return { el, elegidas: () => filas.filter(({ x }) => x.checked).map(({ d }) => ({ id: d.id, nombre: d.nombre })), guardar: guardarEstados };
  };
  // Preparar una disolución en una fase: la crea (con de qué está hecha según la receta de ahora) y
  // la apunta. Devuelve { disolucion, entrada }
  // (sub: la subfase en la que se prepara, si la hay: su composición es solo lo de sus pasos)
  const prepararDisolucion = (receta, fase, { nombre, preparada, nota, fotos, sub, distinto, amb = ambitoActual(receta) }) => {
    // (con una copia de las cuentas de la receta, para poder corregir sus números después)
    const d = { id: idDe('d'), recetaId: receta.id, ...K.marcaDe(amb), nombre: nombre.slice(0, 80), fase, ...(sub ? { subfase: sub.nombre, rango: { desde: sub.desde, hasta: sub.hasta } } : {}), fecha: Date.now(), preparada: preparada || '', composicion: Q.composicionDe(receta, fase, sub), hoja: Q.hojaDe(receta), estado: 'queda', queda: '' };
    cambiarCuaderno((c) => { c.disoluciones.push(d); });
    const entrada = apuntar({ tipo: 'preparar', disolucionId: d.id, disolucion: d.nombre, fase, recetaId: receta.id, ...K.marcaDe(amb), receta: receta.nombre, nota, fotos, ...(distinto ? { distinto } : {}) });
    return { disolucion: d, entrada };
  };
  // Las fases en las que se prepara una disolución: la app se acuerda de lo que se eligió la última vez
  // (en este aparato): quimica.preparan = { 'idReceta|fase': true }
  const preparaEn = (receta, fase) => Boolean(leer('quimica.preparan', {})[`${receta.id}|${fase}`]);
  const recordarPrepara = (receta, fase, si) => {
    const p = leer('quimica.preparan', {});
    if (si) p[`${receta.id}|${fase}`] = true; else delete p[`${receta.id}|${fase}`];
    guardar('quimica.preparan', p);
  };

  // El botón "🏁 Terminar fase" de los pasos de la receta: o han pasado unas muestras por la fase,
  // o en ella se ha preparado una disolución. Con sub (una subfase), ya se sabe cuál de las dos es
  const terminarFase = async (receta, tramo, sub) => {
    const c = leerCuaderno();
    const fases = fasesDe(receta);
    // En el cuaderno que se está usando en esta receta
    const amb = ambitoActual(receta);
    // Se marca el grupo que tiene esta fase en marcha o al que le toca: el más probable
    const sugerido = K.gruposDe(c, amb).find((g) => K.faseParaTerminar(estadoGrupo(c, g), fases) === tramo.titulo);
    const grupo = elegirGrupo(c, amb, sugerido && sugerido.id);
    const disoluciones = elegirDisoluciones(c, receta, tramo.titulo, null, amb);
    // Si es para preparar una disolución: su nombre y cuánta
    const nombreDis = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', value: K.nombreDisolucion(c, amb, tramo.titulo, sub && sub.nombre) });
    const cuanta = h('input', { class: 'campo', autocomplete: 'off', placeholder: 'Por ejemplo: 800 mL (si quieres)' });
    const composicion = Q.composicionDe(receta, tramo.titulo, sub);
    const zonaMuestras = h('div', {}, grupo.el, disoluciones.el);
    const zonaDisolucion = h('div', {},
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre de la disolución' }), nombreDis),
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Cuánta has preparado' }), cuanta),
      composicion.length > 0 && h('p', { class: 'dialogo-detalle', text: `Se apunta de qué está hecha: ${composicion.filter((x) => x.cantidad).map((x) => `${x.nombre} ${x.texto}`).join(', ') || composicion.map((x) => `${x.nombre} ${x.texto}`).join(', ')}.` }));
    let para = sub ? sub.parte : preparaEn(receta, tramo.titulo) ? 'disolucion' : 'muestras';
    const mostrar = () => { zonaMuestras.hidden = para !== 'muestras'; zonaDisolucion.hidden = para !== 'disolucion'; };
    const opcion = (valor, texto, detalle) => h('label', { class: 'opcion-grupo' },
      h('input', { type: 'radio', name: 'para', checked: para === valor, onchange: () => { para = valor; mostrar(); } }),
      h('span', {}, h('b', { text: texto }), h('small', { text: detalle })));
    mostrar();
    const distinto = campoDistinto();
    const r = await pedirApunte({
      texto: !sub ? `🏁 Terminar «${K.nombreFase(tramo.titulo)}»`
        : sub.parte === 'disolucion' ? `🧪 Disolución preparada: ${sub.nombre}` : `🏁 Muestras terminadas: ${sub.nombre}`,
      antes: [
        // Con subfase ya se sabe si es de disolución o de muestras: no se pregunta
        !sub && h('div', { class: 'elegir-para' },
          opcion('muestras', '🧫 Unas muestras han pasado por esta fase', 'Un grupo de muestras'),
          opcion('disolucion', '🧪 He preparado una disolución', 'Para usarla después con uno o varios grupos')),
        sub && h('p', { class: 'dialogo-detalle', text: K.nombreFase(tramo.titulo) }),
        zonaMuestras, zonaDisolucion,
        distinto.el,
        h('p', { class: 'dialogo-detalle', text: (() => {
          // Con varios cuadernos, se dice en cuál (se cambia en 📓)
          const todos = K.cuadernosDe(c, receta.id);
          const este = todos.find((k) => k.id === amb.cuadernoId);
          return todos.length > 1 ? `Se guarda en el cuaderno 📓 «${este ? este.nombre : 'Cuaderno 1'}», con la fecha y la hora (el cuaderno se cambia en 📓).` : 'Se guarda en el cuaderno 📓 de esta receta, con la fecha y la hora.';
        })() })],
    });
    if (!r) return;
    if (!sub) recordarPrepara(receta, tramo.titulo, para === 'disolucion');
    if (para === 'disolucion') {
      const { disolucion, entrada } = prepararDisolucion(receta, tramo.titulo, { nombre: nombreDis.value.trim() || K.nombreDisolucion(leerCuaderno(), amb, tramo.titulo, sub && sub.nombre), preparada: cuanta.value.trim(), nota: r.nota, fotos: r.fotos, sub, amb, distinto: distinto.valor() });
      vibrar(30);
      avisar(`🧪 Apuntada: ${disolucion.nombre}`, { texto: 'Deshacer', hacer: () => { quitarEntrada(entrada.id); cambiarCuaderno((d) => { d.disoluciones = d.disoluciones.filter((x) => x.id !== disolucion.id); }); } });
      return;
    }
    let g = grupo.elegido();
    if (g === undefined) {
      for (const f of r.fotos) window.Fotos.borrar(f).catch(() => {});
      avisar('Escribe el nombre del grupo nuevo');
      return;
    }
    let creado = null;
    if (g && g.nuevo) {
      const datos = g;
      creado = cambiarCuaderno((d) => {
        const x = { id: idDe('g'), nombre: datos.nuevo, recetaId: receta.id, ...K.marcaDe(amb), muestras: datos.muestras };
        d.grupos.push(x);
        return x;
      });
      g = creado;
    }
    const usadas = disoluciones.elegidas();
    const e = apuntar({ tipo: 'fase', fase: tramo.titulo, ...(sub ? { subfase: sub.nombre } : {}), grupoId: g ? g.id : null, grupo: g ? g.nombre : null, recetaId: receta.id, ...K.marcaDe(amb), receta: receta.nombre, nota: r.nota, fotos: r.fotos, ...(distinto.valor() ? { distinto: distinto.valor() } : {}), ...(usadas.length ? { disoluciones: usadas } : {}) });
    disoluciones.guardar();
    vibrar(30);
    // "Deshacer" quita también el grupo que se acaba de crear
    avisar(`📓 Apuntado: ${g ? `${g.nombre} · ` : ''}${K.nombreFase(tramo.titulo)}${sub ? ` · ${sub.nombre}` : ''}`, { texto: 'Deshacer', hacer: () => { quitarEntrada(e.id); if (creado) quitarGrupo(creado.id); } });
  };

  const empezarCronometro = async (receta, i) => {
    const paso = receta.pasos[i];
    const c = { id: `${receta.id}-${i}-${Date.now().toString(36)}`, fin: Date.now() + paso.minutos * 60000, recetaId: receta.id, receta: receta.nombre, paso: i + 1 };
    // Si aquí empieza un ciclo, se cuenta uno más y se dice cuál es en los avisos y en la alarma
    let cual = `paso ${c.paso}`;
    if (paso.ciclos) {
      const n = (ciclosDe(receta.id)[i] || 0) + 1;
      ponerCiclo(receta.id, i, n);
      c.ciclo = `${n}/${paso.ciclos}`;
      cual = `paso ${c.paso}, ciclo ${n} de ${paso.ciclos}`;
    }
    const Cual = cual.charAt(0).toUpperCase() + cual.slice(1);
    cronometros.push(c);
    guardarCronometros();
    pintarCronometros();
    vibrar(30);
    const tiempo = Q.duracion(paso.minutos);
    if (!alarma) { prepararPitido(); avisar(`⏲️ ${Cual}: ${tiempo}. Solo avisará con la app abierta`); return; }
    try {
      const r = await alarma.temporizador({ segundos: Math.max(1, Math.round((c.fin - Date.now()) / 1000)), mensaje: `${receta.nombre} · ${cual}` });
      // Si lo han parado mientras se ponía la alarma (por ejemplo, con el permiso delante), se quita
      if (!cronometros.includes(c)) { alarma.cancelar({ id: r.id }).catch(() => {}); return; }
      c.alarmaId = r.id;
      guardarCronometros();
      avisar(`⏲️ ${Cual}: ${tiempo}. Sonará aunque cierres la app`);
    } catch {
      avisar(`⏲️ ${Cual}: ${tiempo}. No se ha podido poner la alarma: solo avisará con la app abierta`);
    }
  };
  const cancelarCronometro = (id) => {
    const c = cronometros.find((x) => x.id === id);
    if (c && c.alarmaId && alarma) alarma.cancelar({ id: c.alarmaId }).catch(() => {});
    cronometros = cronometros.filter((x) => x.id !== id);
    guardarCronometros();
    pintarCronometros();
  };
  // Sin la alarma de Android (en el iPhone o en un navegador), al acabar un cronómetro con la app
  // abierta suenan tres pitidos. El sonido se prepara al poner el cronómetro: el iPhone solo deja
  // sonar si antes se ha tocado la pantalla
  let audio = null;
  const prepararPitido = () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch { audio = null; }
  };
  const pitar = () => {
    if (!audio) return;
    try {
      const t0 = audio.currentTime;
      for (let i = 0; i < 3; i++) {
        const t = t0 + i * 0.5;
        const onda = audio.createOscillator();
        const volumen = audio.createGain();
        onda.frequency.value = 880;
        volumen.gain.setValueAtTime(0.0001, t);
        volumen.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
        volumen.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        onda.connect(volumen).connect(audio.destination);
        onda.start(t);
        onda.stop(t + 0.4);
      }
    } catch { /* sin sonido */ }
  };
  // Los que se han parado con «Cancelar» en su notificación de Android, con la app cerrada o detrás
  // (versión 124: antes la app no se enteraba, seguía contando y al final decía «terminado»)
  const recogerCancelados = async () => {
    if (!alarma || !alarma.cancelados) return;
    const r = await alarma.cancelados().catch(() => null); // (una APK vieja no lo tiene)
    const ids = r && Array.isArray(r.ids) ? r.ids : [];
    const parados = cronometros.filter((c) => c.alarmaId != null && ids.includes(c.alarmaId));
    if (!parados.length) return;
    cronometros = cronometros.filter((c) => !parados.includes(c));
    guardarCronometros();
    pintarCronometros();
    avisar(`⏲️ ${parados.length === 1 ? 'Parado' : `Parados ${parados.length}`} desde la notificación`);
  };
  const revisarCronometros = () => {
    const acabados = cronometros.filter((c) => c.fin <= Date.now());
    if (acabados.length) {
      cronometros = cronometros.filter((c) => c.fin > Date.now());
      guardarCronometros();
      for (const c of acabados) {
        const tarde = Date.now() - c.fin > 60000 ? ` (hace ${Math.round((Date.now() - c.fin) / 60000)} min)` : '';
        if (!alarma && !tarde) pitar();
        vibrar([400, 150, 400, 150, 400]);
        avisar(`⏲️ ${c.receta}: paso ${c.paso}${c.ciclo ? ` (ciclo ${c.ciclo})` : ''} terminado${tarde}`);
      }
      pintarCronometros();
      return;
    }
    for (const el of document.querySelectorAll('[data-crono]')) {
      const c = cronometros.find((x) => x.id === el.dataset.crono);
      if (c) el.textContent = falta(c.fin - Date.now());
    }
  };
  const pintarCronometros = () => {
    const tira = $('cronometros');
    tira.hidden = !cronometros.length;
    tira.replaceChildren(...[...cronometros].sort((a, b) => a.fin - b.fin).map((c) => h('div', { class: 'crono-fila' },
      h('span', { text: `⏲️ ${c.receta} · paso ${c.paso}${c.ciclo ? ` · ciclo ${c.ciclo}` : ''}`, onclick: () => { if (recetaDe(c.recetaId) && !document.querySelector('.panel')) abrirDetalle(c.recetaId); } }),
      h('span', { class: 'crono-tiempo', 'data-crono': c.id, text: falta(c.fin - Date.now()) }),
      h('button', { class: 'crono-parar', 'aria-label': 'Parar', text: '✕', onclick: () => cancelarCronometro(c.id) }))));
    if (cronometros.length && !reloj) reloj = setInterval(revisarCronometros, 500);
    if (!cronometros.length && reloj) { clearInterval(reloj); reloj = null; }
    if (alCambiarCronometros) alCambiarCronometros();
  };

  // ─── La lista de recetas ───
  const pintarLista = () => {
    const filtro = sinTildes($('buscar').value.trim());
    const visibles = recetas.filter((r) => !filtro
      || sinTildes([r.nombre, r.resumen, ...r.datos.map((d) => `${d.nombre} ${d.formula || ''}`), ...r.calculos.map((c) => c.nombre)].join(' ')).includes(filtro));
    $('lista-recetas').replaceChildren(...visibles.map((r) => {
      const min = Q.minutosTotales(r);
      const avisos = (r.avisos || []).length;
      const enBlanco = r.datos.filter((d) => d.valor == null).length;
      return h('button', { class: 'tarjeta', onclick: () => abrirDetalle(r.id) },
        h('h3', { text: r.nombre }),
        r.resumen && h('p', { text: r.resumen }),
        h('p', { class: 'meta', text: [`${r.pasos.length} ${r.pasos.length === 1 ? 'paso' : 'pasos'}`, min ? `⏲️ ${Q.duracion(min)}` : '', avisos ? `⚠️ ${avisos} para revisar` : '', enBlanco ? `✍️ ${enBlanco === 1 ? 'falta 1 dato' : `faltan ${enBlanco} datos`}` : ''].filter(Boolean).join(' · ') }));
    }));
    $('vacio').hidden = recetas.length > 0;
    $('sin-resultados').hidden = !(recetas.length && !visibles.length);
  };

  // ─── Lo que se está mirando ───
  // Para abrir el formulario por la parte de la receta que se estaba mirando y, al guardar, volver
  // al mismo sitio. En el detalle y en el formulario, cada dato, cantidad y paso lleva su marca
  // (data-dato, data-calculo, data-paso). Devuelve { marca, valor, desfase } o null (si se está arriba del todo)
  // (data-fase: el rótulo de una fase en los pasos; en el formulario va en la fila de su paso)
  const MARCAS = ['data-fase', 'data-paso', 'data-dato', 'data-calculo'];
  const loQueSeMira = (caja) => {
    if (caja.scrollTop < 40) return null;
    const arriba = caja.getBoundingClientRect().top;
    for (const el of caja.querySelectorAll('[data-fase],[data-paso],[data-dato],[data-calculo]')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > arriba + 8) {
        const marca = MARCAS.find((m) => el.hasAttribute(m));
        return { marca, valor: el.getAttribute(marca), desfase: r.top - arriba };
      }
    }
    return null;
  };
  // Deslizar entre pantallas siguiendo al dedo (versión 123, lo pidió el usuario: «que el gesto de
  // pasar de izquierda a derecha se vea más fluido»). Antes, la pantalla cambiaba de golpe al soltar
  // (si pasaban de 70 px). Ahora la pantalla va pegada al dedo mientras se arrastra (con resistencia
  // si ya no hay más en ese lado), cambia al soltar si se arrastró más de 60 px o fue un tirón
  // rápido, y la nueva entra deslizándose desde ese lado; si no, la de antes vuelve suavemente.
  //   cuerpo: el que se desplaza · hojas: selector de las pantallas · orden: sus nombres, de izquierda
  //   a derecha · actual(): cuál se ve · ir(nombre): la cambia · activo(): si el gesto vale ahora
  const deslizarPantallas = (cuerpo, { hojas, orden, actual, ir, activo }) => {
    let d = null;
    // (algo que se desplaza de lado por sí mismo —el árbol, una fila de botones— se queda con el gesto)
    const sePuedeDeLado = (el) => {
      for (let x = el; x && x !== cuerpo; x = x.parentElement) {
        if (x.scrollWidth > x.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(x).overflowX)) return true;
      }
      return false;
    };
    const hojaVisible = () => cuerpo.querySelector(`${hojas}:not([hidden])`);
    const vecinoDe = (dx) => orden[orden.indexOf(actual()) + (dx < 0 ? 1 : -1)] || null;
    cuerpo.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      d = e.touches.length === 1 && activo() && !e.target.closest('input, textarea, select, .arbol-caja, .miniaturas, .tabla-fotos, .tabla-medidas, .galeria, .comp-marco') && !sePuedeDeLado(e.target)
        ? { x: t.clientX, y: t.clientY, t: Date.now(), eje: null, hoja: null } : null;
    }, { passive: true });
    cuerpo.addEventListener('touchmove', (e) => {
      if (!d) return;
      if (e.touches.length !== 1) { d = null; return; }
      const t = e.touches[0];
      const dx = t.clientX - d.x;
      const dy = t.clientY - d.y;
      if (!d.eje) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        d.eje = Math.abs(dx) > 1.2 * Math.abs(dy) ? 'h' : 'v';
        if (d.eje === 'h') d.hoja = hojaVisible();
      }
      if (d.eje !== 'h' || !d.hoja) return;
      if (e.cancelable) e.preventDefault();
      // (con vecino, sigue al dedo casi igual; sin él, cuesta más: «no hay más por ese lado»)
      const k = vecinoDe(dx) ? 0.85 : 0.25;
      d.hoja.style.transform = `translateX(${Math.round(dx * k)}px)`;
      d.hoja.style.opacity = String(1 - Math.min(0.45, Math.abs(dx) / 500));
    }, { passive: false });
    const soltar = (e, cancelado) => {
      const g = d;
      d = null;
      if (!g || g.eje !== 'h' || !g.hoja) return;
      const t = e.changedTouches && e.changedTouches[0];
      const dx = t ? t.clientX - g.x : 0;
      const velocidad = Math.abs(dx) / Math.max(1, Date.now() - g.t); // px por ms
      const vecino = vecinoDe(dx);
      const vale = !cancelado && vecino && (Math.abs(dx) > 60 || (Math.abs(dx) > 28 && velocidad > 0.45));
      const vieja = g.hoja;
      const estilo = { transform: vieja.style.transform || 'none', opacity: vieja.style.opacity || '1' };
      vieja.style.transform = '';
      vieja.style.opacity = '';
      const suave = { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' };
      if (vale) {
        ir(vecino);
        const nueva = hojaVisible();
        if (nueva && nueva.animate) {
          nueva.classList.remove('entra-izq', 'entra-der');
          const desde = dx < 0 ? 56 : -56;
          nueva.animate([{ transform: `translateX(${desde}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], suave);
        }
      } else if (vieja.animate) {
        // (no llega a cambiar: vuelve a su sitio)
        vieja.animate([estilo, { transform: 'none', opacity: '1' }], { duration: 160, easing: 'ease-out' });
      }
    };
    cuerpo.addEventListener('touchend', (e) => soltar(e, false), { passive: true });
    cuerpo.addEventListener('touchcancel', (e) => soltar(e, true), { passive: true });
  };
  const buscarMarca = (caja, m) => (m ? caja.querySelector(`[${m.marca}="${CSS.escape(m.valor)}"]`)
    || (m.marca === 'data-fase' ? caja.querySelector(`[data-paso="${CSS.escape(m.valor)}"]`) : null) : null);
  // Desplaza la caja para que eso quede donde estaba (o, sin desfase, arriba con un margen)
  const irA = (caja, m, desfase) => {
    const el = buscarMarca(caja, m);
    // (solo si se ve: una marca de la otra pantalla de la receta no vale)
    if (el && el.getClientRects().length) caja.scrollTop += el.getBoundingClientRect().top - caja.getBoundingClientRect().top - desfase;
    return el;
  };
  const volverA = (caja, m) => { if (m) irA(caja, m, m.desfase); };

  // ─── El detalle de una receta ───
  const abrirDetalle = (id) => {
    let receta = recetaDe(id);
    if (!receta) return;
    const { cuerpo, titulo } = abrirPanel(receta.nombre,
      [h('button', { class: 'icono', 'aria-label': 'Editar', text: '✏️', onclick: () => {
        // El formulario se abre por lo que se estaba mirando, y al guardar se vuelve al mismo sitio
        const mirando = loQueSeMira(cuerpo);
        abrirFormulario(receta, () => {
          receta = recetaDe(id);
          pintar();
          volverA(cuerpo, mirando);
        }, mirando);
      } })],
      () => { alCambiarCronometros = null; });

    const hechos = () => leer('quimica.hechos', {})[id] || [];
    const ponerHechos = (lista) => {
      const todos = leer('quimica.hechos', {});
      if (lista.length) todos[id] = lista; else delete todos[id];
      guardar('quimica.hechos', todos);
    };

    // Lo que cambia al tocar un dato: las cantidades y los pasos. Los campos de los datos no se
    // vuelven a pintar, para no quitarle el teclado al usuario mientras escribe
    let filasResultado = new Map(); // id de cada cantidad → su fila de resultado
    let avisosSentido = new Map(); // id de cada dato → su aviso de sentido común
    let resumenSentido = null; // arriba: "⚠️ 1 número no cuadra"
    let cajaPasos;
    let botonInicio;
    let botonEmpezar;
    // Al tocar una cantidad calculada: su ficha (qué fórmula es y qué hace), qué es cada letra con su
    // número, la cuenta con los números, y un botón para probar otros números en la calculadora
    const explicarCalculo = (c) => {
      const res = Q.calcular(receta);
      const valor = c.id in res.valores ? Q.cantidad(res.valores[c.id], c.unidad) : (res.errores[c.id] || 'No sale');
      const f = Q.fichaFormula(c.tipo);
      const detalle = Q.esFija(c)
        ? [fichaVisual(c.tipo),
          h('div', { class: 'leyenda' }, Q.leyendaFormula(c, receta, res).map((l) => [
            simbolo(l.simbolo), h('span', { class: 'leyenda-nombre', text: l.nombre }), h('span', { class: `leyenda-valor${l.valor.includes('?') ? ' falta' : ''}`, text: l.valor })])),
          h('div', { class: `ficha-numeros color-${f.color}` }, igualA(f.sale, Q.fraccionConNumeros(c, receta, res)), h('div', { class: 'ficha-resultado', text: `= ${valor}` })),
          h('p', { class: 'dialogo-detalle', text: 'Es una fórmula fija de la app: de los cambios de unidades (mL, L, mM…) se encarga ella.' }),
          h('button', { class: 'boton secundario', text: '🧮 Probar otros números en la calculadora', onclick: () => {
            const prellenado = Q.paraCalculadora(c, receta, res);
            cerrarCapas(1, () => abrirCalculadora({ ...prellenado, desde: receta.nombre }));
          } })]
        : `= ${c.expr}\n\nEs una fórmula escrita a mano o por la IA, con los nombres cortos de los datos. Se cambia con el lápiz ✏️.`;
      preguntar({ texto: `${c.nombre}: ${valor}`, detalle, si: 'Vale', no: '' });
    };
    // La fila del resultado de una cantidad (va debajo de sus datos; ver pintar): su nombre, la etiqueta
    // de color de su fórmula ("💧 Diluir"), la cuenta con sus números (corta y fácil de comprobar; con
    // fórmula libre, tal como está escrita) y el resultado. Al tocarla, su ficha
    const filaResultado = (c) => {
      const f = Q.fichaFormula(c.tipo);
      const el = h('div', { class: `dato calculo resultado-bloque color-${f ? f.color : 'libre'}`, 'data-calculo': c.id, onclick: () => explicarCalculo(c) });
      filasResultado.set(c.id, el);
      return el;
    };
    const pintarCalculado = () => {
      const res = Q.calcular(receta);
      // Los números que no cuadran (Q.comprobar): debajo de su dato o de su cantidad, y un resumen arriba
      const sentido = Q.comprobar(receta, res);
      const avisosDe = (id) => sentido.filter((a) => a.id === id).map((a) => `⚠️ ${a.texto}`);
      for (const [idDato, el] of avisosSentido) {
        const t = avisosDe(idDato);
        el.hidden = !t.length;
        el.textContent = t.join(' ');
      }
      if (resumenSentido) {
        resumenSentido.hidden = !sentido.length;
        resumenSentido.textContent = sentido.length === 1 ? '⚠️ Hay un número que no cuadra: mira el aviso amarillo de abajo.'
          : `⚠️ Hay ${sentido.length} números que no cuadran: mira los avisos amarillos de abajo.`;
      }
      // Solo se cambia lo de dentro de las filas de resultados: los campos de los datos, que van entre
      // ellas, no se tocan (el usuario puede estar escribiendo en uno)
      for (const c of receta.calculos) {
        const el = filasResultado.get(c.id);
        if (!el) continue;
        poner(el,
          h('div', { class: 'dato-nombre' }, c.nombre,
            h('div', { class: 'calculo-formula' }, etiquetaFormula(c.tipo), Q.esFija(c)
              ? fraccion(Q.fraccionConNumeros(c, receta, res))
              : h('small', { class: 'formula', text: `= ${c.expr}` })),
            avisosDe(c.id).map((t) => h('small', { class: 'aviso-sentido', text: t }))),
          c.id in res.valores
            ? h('span', { class: 'calculo-valor', text: Q.cantidad(res.valores[c.id], c.unidad) })
            : h('span', { class: 'calculo-valor error', text: res.errores[c.id] || 'No sale' }));
      }

      const marcados = hechos();
      const ciclos = ciclosDe(id);
      // El contador de un paso donde empieza un ciclo: "🔁 Ciclo 2 de 5  − ＋"
      const contador = (p, i) => {
        const n = ciclos[i] || 0;
        const cambiar = (nuevo) => { ponerCiclo(id, i, Math.max(0, nuevo)); pintarCalculado(); };
        const texto = n === 0 ? `🔁 Ciclos: 0 de ${p.ciclos}`
          : n < p.ciclos ? `🔁 Ciclo ${n} de ${p.ciclos}`
            : n === p.ciclos ? `🔁 Ciclo ${n} de ${p.ciclos}: el último`
              : `🔁 Ciclo ${n} de ${p.ciclos}: ya van de más`;
        return h('div', { class: `ciclos${n === p.ciclos ? ' ultimo' : ''}${n > p.ciclos ? ' pasado' : ''}` },
          h('span', { text: texto }),
          h('button', { 'aria-label': 'Un ciclo menos', text: '−', disabled: n === 0, onclick: () => cambiar(n - 1) }),
          h('button', { 'aria-label': 'Un ciclo más', text: '＋', onclick: () => cambiar(n + 1) }));
      };
      botonEmpezar.hidden = !marcados.length && !Object.keys(ciclos).length;
      // Al final de cada fase, el botón para apuntarla en el cuaderno. Si la fase tiene subfases, uno
      // al final de cada subfase: «🧪 Disolución preparada» o «🏁 Muestras terminadas»
      const finDeFase = new Map();
      const finDeSub = new Map(); // nº de paso → { tramo, sub }
      const empiezaSub = new Map(); // nº de paso → sub
      for (const f of Q.subfasesDe(receta)) {
        const t = Q.tramosFases(receta).find((x) => x.titulo === f.titulo);
        if (!f.subfases.length) { if (t) finDeFase.set(t.hasta, t); continue; }
        for (const s of f.subfases) { finDeSub.set(s.hasta, { tramo: t, sub: s }); empiezaSub.set(s.desde, s); }
      }
      const botonFase = (t) => h('button', { class: 'terminar-fase', text: `🏁 Terminar ${t.titulo ? 'fase' : 'receta'}: apuntar en el cuaderno`, onclick: () => terminarFase(receta, t) });
      const botonSub = ({ tramo, sub }) => h('button', { class: `terminar-fase parte-${sub.parte}`,
        text: sub.parte === 'disolucion' ? `🧪 Disolución preparada: ${sub.nombre}` : `🏁 Muestras terminadas: ${sub.nombre}`,
        onclick: () => terminarFase(receta, tramo, sub) });
      const rotuloSub = (s) => h('div', { class: `subfase parte-${s.parte}`, text: `${s.parte === 'disolucion' ? '🧪' : '🧫'} ${s.nombre}` });
      poner(cajaPasos, receta.pasos.map((p, i) => {
        const enMarcha = cronometros.find((c) => c.recetaId === id && c.paso === i + 1);
        return [p.titulo && h('div', { class: 'fase', 'data-fase': String(i), text: p.titulo }), empiezaSub.has(i) && rotuloSub(empiezaSub.get(i)), h('div', { class: `paso${marcados.includes(i) ? ' hecho' : ''}`, 'data-paso': String(i) },
          h('button', { class: 'paso-numero', 'aria-label': `Marcar el paso ${i + 1}`, text: marcados.includes(i) ? '✓' : String(i + 1),
            onclick: () => { const m = hechos(); ponerHechos(m.includes(i) ? m.filter((x) => x !== i) : [...m, i]); pintarCalculado(); } }),
          h('div', { class: 'paso-contenido' },
            h('div', { class: 'paso-texto' }, Q.trozosPaso(p.texto, receta, res).map((t) => (t.id
              ? h('span', { class: `cant${t.error ? ' error' : ''}`, text: t.texto, onclick: () => avisar(t.error || `${t.nombre}: ${t.texto}`) })
              : t.texto))),
            p.ciclos && contador(p, i),
            p.minutos && (enMarcha
              ? h('button', { class: 'crono-boton en-marcha', onclick: () => cancelarCronometro(enMarcha.id) },
                '⏲️ ', h('span', { 'data-crono': enMarcha.id, text: falta(enMarcha.fin - Date.now()) }), '  ✕ parar')
              : h('button', { class: 'crono-boton', text: `⏲️ ${Q.duracion(p.minutos)}`, onclick: () => empezarCronometro(receta, i) })))),
          finDeSub.has(i) && botonSub(finDeSub.get(i)),
          finDeFase.has(i) && botonFase(finDeFase.get(i))];
      }));
      // Los datos que empezaron en blanco (los que el texto no daba) no cuentan: no hay a qué volver
      botonInicio.hidden = !receta.datos.some((d) => d.inicial != null && d.valor !== d.inicial);
    };

    const filaDato = (d, letra, extra) => {
      const esPM = Q.esPesoMolecular(d);
      const nota = h('small');
      const entrada = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': d.nombre, value: d.valor == null ? '' : String(d.valor).replace('.', ',') });
      // Si mientras tanto ha llegado algo del PC (o del móvil), los datos de la receta son otros
      // objetos (se cambian en su sitio) y esta pantalla, si se estaba escribiendo, no se ha vuelto a
      // pintar: se busca el dato de ahora por su id, para que lo escrito se guarde (si no, se perdía)
      const alDia = () => { d = receta.datos.find((x) => x.id === d.id) || d; };
      const pintarNota = () => {
        alDia();
        entrada.classList.toggle('falta', d.valor == null);
        if (!d.formula) { nota.replaceChildren(d.valor == null ? 'Escribe el valor' : ''); return; }
        const pm = esPM ? Q.masaMolar(d.formula) : null;
        if (esPM && d.manual && pm !== null) {
          nota.replaceChildren(`${d.formula} · escrito a mano `, h('button', { text: `↺ calculado: ${Q.numero(pm)}`, onclick: () => {
            alDia();
            d.manual = false; d.valor = pm; entrada.value = String(pm).replace('.', ','); guardarRecetas(); pintarNota(); pintarCalculado();
          } }));
        } else nota.replaceChildren(esPM && pm !== null ? `${d.formula} · lo calcula la app` : d.formula);
      };
      entrada.addEventListener('input', () => {
        alDia();
        d.valor = Q.aNumero(entrada.value);
        if (esPM) {
          // Vacío: vuelve a calcularlo la app. Con un número: manda lo escrito a mano
          const pm = Q.masaMolar(d.formula);
          if (d.valor === null && pm !== null) { d.valor = pm; delete d.manual; } else d.manual = true;
        }
        guardarRecetas();
        pintarNota();
        pintarCalculado();
      });
      entrada.addEventListener('focus', () => entrada.select());
      pintarNota();
      // Un div y no un label: dentro va el botón "↺ calculado", y en un label tocarlo abriría el teclado
      // letra: la de la fórmula de su cantidad ("c", "V"…); extra: lo de debajo (si no, dónde se usa)
      // El aviso de sentido común de este dato (lo rellena pintarCalculado, que sí se repinta al escribir)
      const avisoSentido = h('small', { class: 'aviso-sentido', hidden: true });
      avisosSentido.set(d.id, avisoSentido);
      return h('div', { class: 'dato', 'data-dato': d.id }, h('div', { class: 'dato-nombre' }, letra && simbolo(letra), d.nombre, nota, extra === undefined ? usosDe(d) : extra, avisoSentido),
        entrada, h('span', { class: 'dato-unidad', text: d.unidad }));
    };
    // Las otras cantidades que usan un dato, además de la que tiene debajo: "→ también en: GNP750 a pesar"
    const tambienEn = (d, c) => {
      const otras = receta.calculos.filter((x) => x !== c && (() => { try { return Q.nombresDe(x.expr).includes(d.id); } catch { return false; } })()).map((x) => x.nombre);
      return otras.length ? h('small', { class: 'usos', text: `→ también en: ${otras.slice(0, 2).join(', ')}${otras.length > 2 ? ` y ${otras.length - 2} más` : ''}` }) : null;
    };
    // Datos y cantidades juntos (Q.bloquesPorFases): en cada fase, cada cantidad con sus datos encima
    const hojaDeCalculo = () => h('div', { class: 'caja hoja' }, Q.bloquesPorFases(receta).map((fase) => [
      fase.titulo && h('div', { class: 'fase', text: fase.titulo }),
      fase.bloques.map((b) => h('div', { class: 'bloque' },
        b.nuevos.map((d) => filaDato(d, Q.letraEn(b.calculo, d.id), tambienEn(d, b.calculo))),
        // (como mucho dos nombres: todos se ven al tocar la cantidad)
        b.usa.length > 0 && h('small', { class: 'bloque-usa', text: `Usa también: ${b.usa.slice(0, 2).map((x) => x.nombre).join(', ')}${b.usa.length > 2 ? ` y ${b.usa.length - 2} más` : ''}` }),
        filaResultado(b.calculo))),
      fase.sueltos.map((d) => filaDato(d))]));
    // "→ se usa en: NaDDBS a pesar, GNP750 a pesar": para saber qué cambia al tocar un dato
    const usosDe = (d) => {
      const usan = receta.calculos.filter((c) => { try { return Q.nombresDe(c.expr).includes(d.id); } catch { return false; } }).map((c) => c.nombre);
      if (usan.length) return h('small', { class: 'usos', text: `→ se usa en: ${usan.slice(0, 2).join(', ')}${usan.length > 2 ? ` y ${usan.length - 2} más` : ''}` });
      const pasos = receta.pasos.map((p, i) => (new RegExp(`\\{\\s*${d.id}\\s*\\}`).test(p.texto) ? i + 1 : null)).filter(Boolean);
      return pasos.length ? h('small', { class: 'usos', text: `→ sale en el paso ${pasos.slice(0, 3).join(', ')}` }) : null;
    };

    // ── Dos pantallas: «🧮 Datos» a la izquierda y «📋 Pasos» a la derecha (versión 95, lo pidió el
    // usuario). Se cambia con las pestañas o deslizando el dedo hacia un lado. Cada una recuerda por
    // dónde iba; la elegida se recuerda por receta (quimica.pagina-receta). Si se prefiere todo
    // seguido, «quimica.receta-junta» en Ajustes
    // (con un cronómetro de esta receta en marcha y sin nada recordado, abre en los pasos)
    const recordada = leer('quimica.pagina-receta', {})[id];
    let paginaActual = recordada === 'pasos' || recordada === 'datos' ? recordada
      : cronometros.some((c) => c.recetaId === id) ? 'pasos' : 'datos';
    const alturas = { datos: 0, pasos: 0 };
    const irPagina = (nombre) => {
      if (nombre === paginaActual || !['datos', 'pasos'].includes(nombre)) return;
      alturas[paginaActual] = cuerpo.scrollTop;
      paginaActual = nombre;
      guardar('quimica.pagina-receta', { ...leer('quimica.pagina-receta', {}), [id]: nombre });
      for (const p of cuerpo.querySelectorAll('.pagina-receta')) p.hidden = p.dataset.pagina !== nombre;
      for (const b of cuerpo.querySelectorAll('.pestana-receta')) b.setAttribute('aria-pressed', String(b.dataset.pagina === nombre));
      cuerpo.scrollTop = alturas[nombre] || 0;
      // (para que «dónde iba» apunte a lo de esta pantalla aunque no se haya movido)
      cuerpo.dispatchEvent(new Event('scroll'));
      const nueva = cuerpo.querySelector(`.pagina-receta[data-pagina="${nombre}"]`);
      if (nueva) { nueva.classList.remove('entra-izq', 'entra-der'); void nueva.offsetWidth; nueva.classList.add(nombre === 'pasos' ? 'entra-der' : 'entra-izq'); }
    };
    // Deslizar: la pantalla sigue al dedo (versión 123; ver deslizarPantallas)
    deslizarPantallas(cuerpo, { hojas: '.pagina-receta', orden: ['datos', 'pasos'], actual: () => paginaActual, ir: irPagina,
      activo: () => leer('quimica.receta-junta', false) !== true });

    const pintar = () => {
      titulo.textContent = receta.nombre;
      filasResultado = new Map();
      avisosSentido = new Map();
      resumenSentido = h('div', { class: 'avisos', hidden: true });
      cajaPasos = h('div', { class: 'caja' });
      botonInicio = h('button', { class: 'boton secundario', text: '↺ Volver a los valores del principio', onclick: () => {
        for (const d of receta.datos) if (d.inicial != null) { d.valor = d.inicial; delete d.manual; }
        receta = ponerReceta(Q.validar(receta).receta);
        pintar();
      } });
      // Sale en cuanto hay algún paso marcado o algún ciclo contado (lo enseña pintarCalculado)
      botonEmpezar = h('button', { class: 'boton secundario', hidden: true, text: '↺ Empezar de nuevo: desmarcar los pasos y poner los ciclos a 0', onclick: () => {
        ponerHechos([]);
        borrarCiclos(id);
        pintarCalculado();
      } });
      const peticion = h('textarea', { class: 'campo', rows: 3, placeholder: 'Por ejemplo: «calcula también cuánto HCl 37 % hace falta para neutralizarlo» o «añade un paso para medir el pH»' });
      const botonIA = h('button', { class: 'boton', text: '✨ Pedir el cambio a Gemini', onclick: async () => {
        botonIA.disabled = true;
        botonIA.textContent = '✨ Gemini está trabajando… (puede tardar un minuto)';
        const antes = JSON.parse(JSON.stringify(receta));
        const r = await window.Gemini.cambiar(receta, peticion.value, clave());
        if (!document.body.contains(botonIA)) { if (r.receta) guardarCambio(r.receta, antes); return; }
        if (r.error) { botonIA.disabled = false; botonIA.textContent = '✨ Pedir el cambio a Gemini'; avisar(r.error); return; }
        guardarCambio(r.receta, antes);
      } });
      const guardarCambio = (nueva, antes) => {
        receta = ponerReceta(nueva);
        pintar();
        avisar('Receta cambiada. Revisa las fórmulas', { texto: 'Deshacer', hacer: () => { receta = ponerReceta(antes); pintar(); } });
      };
      const original = h('p', { class: 'original', hidden: true, text: receta.textoOriginal || '' });

      // El detalle en bloques (versión 95): lo de arriba, los datos, los pasos y lo de abajo. En dos
      // pantallas (datos | pasos, con pestañas y deslizando) o, si se prefiere, todo seguido (Ajustes)
      const bInfo = [
        receta.resumen && h('p', { class: 'resumen', text: receta.resumen }),
        (receta.avisos || []).length > 0 && h('div', { class: 'avisos' },
          h('p', {}, h('b', { text: '⚠️ Para revisar' })),
          receta.avisos.map((a) => h('p', { text: a })),
          h('button', { text: 'Ya lo he revisado: quitar este aviso', onclick: () => { receta.avisos = []; guardarRecetas(); pintarLista(); pintar(); } })),
        receta.seguridad && h('div', { class: 'seguridad', text: `🥽 ${receta.seguridad}` }),
        // Lo del texto que no es un paso pero puede importar: purezas, grados, marcas (la IA lo separa)
        receta.notas && h('div', { class: 'notas-receta' }, h('b', { text: '📝 Del texto original' }), h('p', { text: receta.notas })),
      ];
      const bDatos = [
        (receta.datos.length > 0 || receta.calculos.length > 0) && [
          h('h3', { text: '🧮 Datos y cantidades' }),
          h('p', { class: 'nota', text: 'Cambia un dato y se recalcula todo. Cada cantidad va debajo de los datos que usa; tócala para ver su fórmula.' }),
          resumenSentido,
          hojaDeCalculo(), botonInicio],
      ];
      const bPasos = [
        h('h3', { text: '📋 Pasos' }),
        cajaPasos,
        botonEmpezar,
      ];
      const bMas = [
        hayIA() && [h('h3', { text: '✨ Pedir un cambio a la IA' }), peticion, botonIA],
        h('h3', { text: 'Más' }),
        receta.textoOriginal && h('button', { class: 'boton secundario', text: '📄 Ver el texto que pegaste', onclick: () => { original.hidden = !original.hidden; } }),
        original,
        h('button', { class: 'boton secundario', text: '📑 Hacer una copia de esta receta', onclick: () => {
          const copia = JSON.parse(JSON.stringify(receta));
          copia.id = null;
          copia.nombre = `${receta.nombre} (copia)`.slice(0, 80);
          const nueva = ponerReceta(copia);
          cerrarCapas(1, () => { abrirDetalle(nueva.id); avisar('Copia hecha: esta es la copia'); });
        } }),
        h('button', { class: 'boton discreto', text: '🗑️ Borrar receta', onclick: async () => {
          const si = await preguntar({ texto: `¿Borrar «${receta.nombre}»?`, detalle: 'No se puede deshacer.', si: 'Borrar', no: 'No', peligro: true });
          if (!si) return;
          for (const c of cronometros.filter((x) => x.recetaId === id)) cancelarCronometro(c.id);
          recetas = recetas.filter((r) => r.id !== id);
          guardarRecetas();
          ponerHechos([]);
          borrarCiclos(id);
          pintarLista();
          atras();
        } }),
        receta.modelo && h('p', { class: 'nota', text: `Hecha con Gemini (${receta.modelo}). La IA puede equivocarse: revisa los datos y las fórmulas.` }),
      ];
      if (leer('quimica.receta-junta', false) === true) {
        poner(cuerpo, bInfo, bDatos, bPasos, bMas);
      } else {
        const hojaDe = (nombre, ...bloques) => h('div', { class: 'pagina-receta', 'data-pagina': nombre, hidden: paginaActual !== nombre }, ...bloques);
        const pestana = (nombre, texto) => h('button', { class: 'pestana-receta', type: 'button', 'data-pagina': nombre, 'aria-pressed': String(paginaActual === nombre),
          text: texto, onclick: () => irPagina(nombre) });
        poner(cuerpo,
          h('div', { class: 'pestanas-receta' }, pestana('datos', '🧮 Datos'), pestana('pasos', `📋 Pasos (${receta.pasos.length})`)),
          hojaDe('datos', bInfo, bDatos, bMas),
          hojaDe('pasos', bPasos));
      }
      botonInicio.hidden = true;
      pintarCalculado();
    };

    alCambiarCronometros = () => { if (cajaPasos) pintarCalculado(); };
    // Si llega del PC (o del móvil) un cambio de esta receta, se vuelve a pintar; pero no mientras se
    // escribe en una casilla (se vería al salir y volver a entrar)
    let huella = S.huella(receta);
    alLlegarCambios(cuerpo, (cambiadas) => {
      const ahora = recetaDe(id);
      if (!cambiadas.includes('recetas') || !ahora || S.huella(ahora) === huella) return;
      if (cuerpo.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      receta = ahora;
      huella = S.huella(receta);
      pintar();
    });
    pintar();
    // Al volver a entrar, la receta se abre donde se dejó (lo pidió el usuario: estaba en un paso con
    // cronómetro, salía y al volver estaba arriba del todo). Lo que se mira se apunta al moverse, por
    // receta y en este aparato (localStorage quimica.donde); sin nada apuntado, si hay un cronómetro
    // en marcha de esta receta, se abre en su paso
    let relojDonde = null;
    cuerpo.addEventListener('scroll', () => {
      clearTimeout(relojDonde);
      relojDonde = setTimeout(() => {
        if (!cuerpo.isConnected) return;
        const todos = leer('quimica.donde', {});
        const m = loQueSeMira(cuerpo);
        if (m) todos[id] = m; else delete todos[id];
        guardar('quimica.donde', todos);
      }, 250);
    }, { passive: true });
    const dejado = leer('quimica.donde', {})[id];
    const enMarcha = cronometros.filter((c) => c.recetaId === id).sort((a, b) => a.fin - b.fin)[0];
    requestAnimationFrame(() => {
      if (dejado) volverA(cuerpo, dejado);
      else if (enMarcha) irA(cuerpo, { marca: 'data-paso', valor: String(enMarcha.paso - 1) }, 12);
    });
  };

  // ─── El formulario (receta nueva a mano, o editar una) ───
  // nombre corto a partir del nombre: "Volumen final" → "volumen_final"
  const idDesde = (nombre, usados) => {
    let base = sinTildes(nombre).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'x';
    if (!/^[a-z]/.test(base)) base = `x_${base}`;
    let id = base;
    for (let n = 2; usados.has(id); n++) id = `${base}_${n}`;
    usados.add(id);
    return id;
  };

  // El formulario. Se trabaja sobre una copia de la receta (r): lo que se escribe va a ella y al
  // guardar se valida. Las cantidades se editan con las fichas de las fórmulas (como en la
  // calculadora): se elige la fórmula y, para cada letra, qué dato va ahí, por su nombre; si falta
  // un dato se crea desde ahí; si una unidad no pega, se avisa y se arregla con un toque. La fórmula
  // escrita a mano queda para lo que no encaje ("avanzado")
  // mirando: lo que se estaba mirando en el detalle (loQueSeMira): el formulario se abre por ahí.
  // deBorrador: la receta es un borrador recuperado (cuenta como cambiada: al salir se pregunta)
  const abrirFormulario = (receta, alGuardar, mirando, deBorrador) => {
    const nueva = !receta || !receta.id;
    const r = JSON.parse(JSON.stringify(receta || { nombre: '', resumen: '', seguridad: '', datos: [], calculos: [], pasos: [{ texto: '' }] }));
    const { cuerpo, capa } = abrirPanel(nueva ? 'Receta nueva' : 'Editar receta', null, () => { quitarBorrador(); alSalirDeLaApp = null; });
    const campo = (props) => h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'off', ...props });
    const numeroTexto = (v) => (v == null ? '' : String(v).replace('.', ','));
    const porId = (id) => (id ? [...r.datos, ...r.calculos].find((x) => x.id === id) : undefined);
    const usados = (salvo) => new Set([...r.datos, ...r.calculos].filter((x) => x !== salvo).map((x) => x.id).filter(Boolean));
    // Lo que se ve en la casilla del valor (texto). Un peso molecular que calcula la app va vacío
    for (const d of r.datos) {
      d._valor = Q.esPesoMolecular(d) && !d.manual ? '' : numeroTexto(d.valor);
      d._valorAntes = d._valor;
    }
    // Los pasos que ya empiezan una fase: su título va encima, como un rótulo (filaPaso)
    for (const p of r.pasos) {
      p._conRotulo = Boolean(p.titulo && String(p.titulo).trim());
      p._conSub = Boolean(p.subfase && String(p.subfase).trim());
    }
    // Un dato o una cantidad nuevos llevan un nombre corto provisional; al ponerles nombre se cambia
    // por uno sacado del nombre ("Volumen final" → volumen_final), también en las fórmulas que lo usan
    // Solo la primera vez: después, el nombre corto ya puede estar en algún paso
    const renombrar = (x) => {
      if (!x._idAuto || !x.nombre.trim()) return;
      x._idAuto = false;
      const viejo = x.id;
      x.id = idDesde(x.nombre, usados(x));
      // En los desplegables de las letras: sin volver a pintarlos (podría ser lo siguiente que toque el usuario)
      for (const o of cajaCalculos.querySelectorAll('select.hueco-select option')) {
        if (o.value === viejo || o.value === x.id) { o.value = x.id; o.textContent = `${x.nombre}${x.unidad ? ` (${x.unidad})` : ''}`; }
      }
      for (const c of r.calculos) {
        for (const [rol, v] of Object.entries(c.args || {})) {
          if (Array.isArray(v)) c.args[rol] = v.map((id) => (id === viejo ? x.id : id));
          else if (v === viejo) c.args[rol] = x.id;
        }
        // (versión 125) y en las fórmulas propias, y en los pasos que ya lo nombraban: antes solo se
        // cambiaba en las fórmulas de la app, y un paso con el nombre provisional quedaba roto
        if (!Q.esFija(c) && typeof c.expr === 'string') c.expr = c.expr.replace(new RegExp(`(^|[^A-Za-z0-9_])${viejo}(?![A-Za-z0-9_])`, 'g'), `$1${x.id}`);
      }
      for (const p of r.pasos) if (typeof p.texto === 'string') p.texto = p.texto.replace(new RegExp(`\\{\\s*${viejo}\\s*\\}`, 'g'), `{${x.id}}`);
      if (cajaPasos) for (const t of cajaPasos.querySelectorAll('textarea')) if (t.value.includes(viejo)) t.value = t.value.replace(new RegExp(`\\{\\s*${viejo}\\s*\\}`, 'g'), `{${x.id}}`);
    };
    if (!document.getElementById('unidades-comunes')) {
      document.body.append(h('datalist', { id: 'unidades-comunes' },
        ['mL', 'L', 'µL', 'g', 'mg', 'kg', 'M', 'mM', 'µM', 'g/L', 'mg/mL', '%', 'g/mol', 'g/mL', 'mol', 'mmol', 'partes', 'eq', '°C'].map((u) => h('option', { value: u }))));
    }

    // ── Datos ──
    const cajaDatos = h('div');
    const filaDato = (d) => {
      const esPM = Q.unidadLimpia(d.unidad) === 'g/mol';
      const pmApp = esPM && d.formula ? Q.masaMolar(d.formula) : null;
      const nota = h('small', { class: 'todo nota' });
      const pintarNota = () => poner(nota, [
        esPM && pmApp !== null && !d._valor && `La app calcula: ${Q.numero(pmApp)} g/mol`,
        esPM && d.formula && pmApp === null && 'No entiendo esa fórmula química (escríbela con sus mayúsculas: NaCl)',
        d.id && `En los pasos: {${d.id}}`].filter(Boolean).join(' · '));
      pintarNota();
      // OJO: al acabar de escribir en una casilla (change) NO se vuelve a pintar la lista entera de
      // datos: si no, la casilla que el usuario acaba de tocar se cambiaría por otra y se perdería
      // lo que escribe (pasaba). Solo esta fila, y solo si cambia lo que se ve (la unidad g/mol)
      const repintarFila = () => { const nueva = filaDato(d); fila.replaceWith(nueva); pintarCalculos(); pintarChips(); };
      const fila = h('div', { class: 'fila-form', 'data-dato': d.id },
        campo({ class: 'campo ancho', placeholder: 'Nombre (Volumen final)', autocapitalize: 'sentences', value: d.nombre || '',
          oninput: (e) => { d.nombre = e.target.value; },
          onchange: () => {
            renombrar(d);
            pintarNota();
            // El nombre nuevo, en los desplegables de las letras (sin volver a pintarlos)
            for (const o of cajaCalculos.querySelectorAll('select.hueco-select option')) if (o.value === d.id) o.textContent = `${d.nombre}${d.unidad ? ` (${d.unidad})` : ''}`;
            pintarChips();
          } }),
        h('button', { class: 'quitar', 'aria-label': `Quitar el dato ${d.nombre || ''}`.trim(), text: '🗑️', onclick: () => { r.datos.splice(r.datos.indexOf(d), 1); pintarTodo(); } }),
        campo({ placeholder: pmApp !== null ? `auto: ${Q.numero(pmApp)}` : 'Valor', inputmode: 'decimal', value: d._valor,
          oninput: (e) => { d._valor = e.target.value.trim(); pintarNota(); pintarResultados(); } }),
        campo({ placeholder: 'Unidad (mL)', list: 'unidades-comunes', value: d.unidad || '',
          oninput: (e) => { d.unidad = Q.unidadLimpia(e.target.value); },
          onchange: () => { if ((Q.unidadLimpia(d.unidad) === 'g/mol') !== esPM) repintarFila(); else pintarCalculos(); } }),
        h('span'),
        esPM && campo({ class: 'campo ancho', placeholder: 'Fórmula química (NaCl)', value: d.formula || '',
          oninput: (e) => { d.formula = e.target.value.trim(); }, onchange: () => repintarFila() }),
        nota);
      return fila;
    };
    const pintarDatos = () => poner(cajaDatos, r.datos.map(filaDato));

    // ── Cantidades ──
    // Para elegir fórmula: las mismas tarjetas que la calculadora (y, si se quiere, "Fórmula propia")
    const elegirFormula = (conLibre) => new Promise((resolver) => {
      let elegido = null;
      const tarjeta = (tipo, icono, corto, color) => h('button', { class: `calc-tarjeta color-${color}`, 'data-tipo': tipo, onclick: () => { elegido = tipo; atras(); } },
        h('span', { class: 'calc-tarjeta-icono', text: icono }), h('span', { text: corto }));
      preguntar({ texto: '¿Qué fórmula es?', si: 'Cancelar', no: '',
        detalle: h('div', { class: 'calc-tarjetas elegir-formula' },
          Object.keys(Q.TIPOS).map((t) => { const f = Q.fichaFormula(t); return tarjeta(t, f.icono, f.corto, f.color); }),
          conLibre && tarjeta('libre', '✏️', 'Fórmula propia', 'libre')) })
        .then(() => resolver(elegido));
    });
    // Cambiar de fórmula: los huecos que se llaman igual se quedan rellenos
    const ponerTipo = (c, tipo) => {
      if (tipo === 'libre') { delete c.tipo; delete c.args; c.expr = c.expr || ''; return; }
      const antes = c.args || {};
      c.tipo = tipo;
      c.args = {};
      for (const rol of Object.keys(Q.TIPOS[tipo].huecos)) if (antes[rol]) c.args[rol] = antes[rol];
      const salidas = Q.unidadesResultado(tipo, (porId(c.args.total) || {}).unidad);
      if (!salidas.includes(c.unidad)) c.unidad = salidas[0];
    };
    const cambiarFormula = async (c) => {
      const tipo = await elegirFormula(!Q.esFija(c));
      if (!tipo) return;
      ponerTipo(c, tipo);
      pintarCalculos();
    };
    // De fórmula fija a fórmula propia: la cuenta que montaba la app (con sus cambios de unidades)
    const aMano = (c) => {
      const v = Q.validar(candidata());
      const montada = v.receta && v.receta.calculos.find((x) => x.id === c.id);
      ponerTipo(c, 'libre');
      c.expr = (montada && montada.expr) || c.expr || '';
      pintarCalculos();
      avisar('Ahora es una fórmula tuya: la cuenta lleva dentro los cambios de unidades (× 0.001…)');
    };
    // El nombre que se propone para un dato nuevo: qué es y de qué ("Concentración de CuSO4·5H2O").
    // El «de qué» sale de la fórmula química del peso molecular de esa cantidad o, si no, de su nombre
    // sin «a pesar», «Masa de»… (lo pidió el usuario: antes salía «Concentración (CuSO4·5H2O a pesar)»)
    const QUE_ES = { c: 'Concentración', v: 'Volumen a preparar', pm: 'Peso molecular', pureza: 'Pureza', c_stock: 'Concentración de partida',
      total: 'Volumen total de la mezcla', parte: 'Partes', densidad: 'Densidad', riqueza: 'Riqueza', masa: 'Masa', moles: 'Moles', eq: 'Equivalentes' };
    const QUE_ES_TIPO = { dilucion: { c: 'Concentración final', v: 'Volumen final' } };
    const nombreParaDato = (c, rol) => {
      const base = (QUE_ES_TIPO[c.tipo] || {})[rol] || QUE_ES[rol] || Q.rotuloHueco(c.tipo, rol);
      const pm = porId(c.args && c.args.pm);
      let sujeto = pm && pm.formula ? pm.formula
        : String(c.nombre || '').trim().replace(/^(masa|volumen|cantidad|moles)\s+de(l)?\s+/i, '').replace(/\s+(a|para)\s+(pesar|medir|añadir|usar|preparar)$/i, '').trim();
      // Una fórmula química se queda como está; una palabra, en minúscula ("de disolución madre")
      if (sujeto && !/^[A-Z][a-z]?[A-Z0-9(·]/.test(sujeto)) sujeto = sujeto[0].toLowerCase() + sujeto.slice(1);
      // (en una dilución, el nombre de la cantidad es lo que se mide: «Volumen final» a secas)
      const nombre = rol === 'total' || c.tipo === 'dilucion' || !sujeto ? base : `${base} de ${sujeto}`;
      const nombres = new Set(r.datos.map((d) => d.nombre));
      let n = 2;
      let libre = nombre;
      while (nombres.has(libre)) libre = `${nombre} ${n++}`;
      return libre;
    };
    // Un dato nuevo para un hueco: nombre, número y unidad en el mismo cuadro (antes el número se
    // escribía después, subiendo a Datos), y la fórmula química si es un peso molecular
    const nuevoDatoPara = async (c, rol) => {
      const rotulo = Q.rotuloHueco(c.tipo, rol);
      const unidades = Q.unidadesHueco(c.tipo, rol) || [''];
      const esPM = unidades[0] === 'g/mol';
      const nombre = campo({ class: 'campo', value: nombreParaDato(c, rol), 'aria-label': 'Nombre del dato nuevo', autocapitalize: 'sentences' });
      const valor = campo({ placeholder: esPM ? 'Lo calcula la app' : 'Valor', inputmode: 'decimal', 'aria-label': 'Valor del dato nuevo' });
      const unidad = h('select', { class: 'campo', 'aria-label': 'Unidad del dato nuevo' }, unidades.map((u) => h('option', { value: u, text: u || '(sin unidad)' })));
      const pmNota = h('small', { class: 'nota' });
      const formula = esPM && campo({ placeholder: 'NaCl, Cu(NO3)2·3H2O…', 'aria-label': 'Fórmula química del dato nuevo',
        oninput: (e) => {
          const pm = Q.masaMolar(e.target.value.trim());
          pmNota.textContent = !e.target.value.trim() ? '' : pm === null ? 'No entiendo esa fórmula (escríbela con sus mayúsculas: NaCl)' : `Peso molecular: ${Q.numero(pm)} g/mol`;
        } });
      const si = await preguntar({ texto: 'Dato nuevo', si: 'Crear', no: 'Cancelar', detalle: [
        h('p', { class: 'dialogo-detalle', text: `Para «${rotulo}» de «${c.nombre || 'esta cantidad'}».` }),
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre' }), nombre),
        esPM && h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Fórmula química' }), formula),
        esPM && pmNota,
        h('div', { class: 'etiqueta-campo' }, h('span', { text: esPM ? 'Valor (si no tiene fórmula)' : 'Valor' }),
          h('div', { class: 'valor-unidad' }, valor, unidades.length > 1 ? unidad : h('span', { class: 'unidad-fija', text: unidades[0] })))] });
      if (!si || !nombre.value.trim()) return;
      const d = { id: idDesde(nombre.value, usados()), nombre: nombre.value.trim(), unidad: unidades.length > 1 ? unidad.value : unidades[0],
        _valor: valor.value.trim(), _valorAntes: '' };
      if (esPM && formula.value.trim()) d.formula = formula.value.trim();
      r.datos.push(d);
      c.args[rol] = d.id;
      pintarTodo();
    };
    // ── Atajos (versión 83, lo pidió el usuario): un solo cuadro y salen los datos, la cantidad y el
    // paso, ya enlazados (Q.atajo). Antes eran unos 12 toques por cantidad ──
    const VOLUMENES = ['mL', 'L', 'µL'];
    const conRotulo = (rotulo, el) => h('label', { class: 'etiqueta-campo' }, h('span', { text: rotulo }), el);
    const numeroYUnidad = (rotulo, unidades) => {
      const valor = campo({ inputmode: 'decimal', 'aria-label': rotulo });
      const unidad = h('select', { class: 'campo', 'aria-label': `Unidad: ${rotulo.toLowerCase()}` }, unidades.map((u) => h('option', { value: u, text: u })));
      return { el: h('div', { class: 'etiqueta-campo' }, h('span', { text: rotulo }), h('div', { class: 'valor-unidad' }, valor, unidad)),
        leer: () => ({ valor: valor.value.trim(), unidad: unidad.value }) };
    };
    // Lo que da el atajo, al formulario: los datos con su número como texto, la cantidad y el paso al final
    const anadirAtajo = (hecho) => {
      for (const d of hecho.datos) r.datos.push({ ...d, _valor: Q.esPesoMolecular(d) && d.formula ? '' : numeroTexto(d.valor), _valorAntes: '' });
      r.calculos.push(...hecho.calculos);
      if (r.pasos.length === 1 && !String(r.pasos[0].texto || '').trim() && !r.pasos[0]._conRotulo && !r.pasos[0]._conSub) r.pasos.splice(0, 1);
      r.pasos.push(...hecho.pasos);
      pintarTodo();
      pintarPasos();
      const el = tarjetas.get(hecho.calculos[hecho.calculos.length - 1]);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('resaltado');
        setTimeout(() => el.classList.remove('resaltado'), 1800);
      }
      avisar(`Añadido: ${hecho.calculos.map((c) => `«${c.nombre}»`).join(' y ')}, y su paso al final`);
    };
    // Pregunta hasta que lo escrito vale (o se cancela); hacer() devuelve lo de Q.atajo
    const preguntarAtajo = async (texto, detalle, hacer) => {
      for (;;) {
        if (!await preguntar({ texto, detalle, si: 'Añadir', no: 'Cancelar' })) return;
        const hecho = hacer();
        if (!hecho.error) { anadirAtajo(hecho); return; }
        avisar(hecho.error);
      }
    };
    const notaPM = (formula) => {
      const nota = h('small', { class: 'nota' });
      formula.addEventListener('input', () => {
        const t = formula.value.trim();
        const pm = t ? Q.masaMolar(t) : null;
        nota.textContent = !t ? '' : pm === null ? 'No entiendo esa fórmula (escríbela con sus mayúsculas: NaCl)' : `Peso molecular: ${Q.numero(pm)} g/mol`;
      });
      return nota;
    };
    const atajoSolido = () => {
      const nombreR = campo({ placeholder: 'sulfato de cobre, NaCl…', autocapitalize: 'off', 'aria-label': 'Reactivo' });
      const formula = campo({ placeholder: 'CuSO4·5H2O', 'aria-label': 'Fórmula química del reactivo' });
      const c = numeroYUnidad('Concentración', Q.unidadesSoluto());
      // El volumen: uno nuevo o uno que ya está en la receta (varios sólidos en la misma disolución)
      const yaHay = r.datos.filter((d) => d.id && Q.encajaEnHueco('masa_molar', 'v', d.unidad));
      const v = numeroYUnidad('Volumen a preparar', VOLUMENES);
      const cualV = h('select', { class: 'campo', 'aria-label': 'Qué volumen', onchange: () => { v.el.hidden = Boolean(cualV.value); } },
        h('option', { value: '', text: 'Un volumen nuevo' }), yaHay.map((d) => h('option', { value: d.id, text: `${d.nombre} (${d.unidad})` })));
      const pureza = campo({ inputmode: 'decimal', placeholder: 'opcional', 'aria-label': 'Pureza' });
      const disolvente = campo({ value: 'agua destilada', autocapitalize: 'off', 'aria-label': 'Disolvente' });
      return preguntarAtajo('⚖️ Disolución pesando un sólido', [
        conRotulo('Reactivo', nombreR), conRotulo('Fórmula química (hace falta con M o mM)', formula), notaPM(formula),
        c.el, yaHay.length > 0 && conRotulo('Volumen', cualV), v.el,
        conRotulo('Pureza (%)', pureza), conRotulo('Disuelto en', disolvente)],
      () => Q.atajo('solido', { nombre: nombreR.value, formula: formula.value, c: c.leer(), v: v.leer(), vId: cualV.value || undefined, pureza: pureza.value, disolvente: disolvente.value }, usados()));
    };
    const atajoDilucion = () => {
      const UNIDADES_C = Q.unidadesHueco('dilucion', 'c');
      // De qué disolución: una concentración que ya está en la receta, u otra que se escribe aquí
      const madres = [...r.datos, ...r.calculos].filter((x) => x.id && Q.encajaEnHueco('dilucion', 'c_stock', x.unidad));
      const de = h('select', { class: 'campo', 'aria-label': 'De qué disolución', onchange: () => {
        stock.el.hidden = Boolean(de.value);
        const x = madres.find((m) => m.id === de.value);
        nombreD.value = x ? x.nombre.replace(/^(concentraci[oó]n|molaridad)\s+(de(l)?\s+)?/i, '') : '';
      } }, madres.map((x) => h('option', { value: x.id, text: `${x.nombre} (${x.unidad})` })), h('option', { value: '', text: 'Otra: la escribo aquí' }));
      const nombreD = campo({ placeholder: 'NaCl 1 M, etanol 96 %…', autocapitalize: 'off', 'aria-label': 'Nombre de la disolución de partida' });
      const stock = numeroYUnidad('Concentración de partida', UNIDADES_C);
      const c = numeroYUnidad('Concentración final', UNIDADES_C);
      const v = numeroYUnidad('Volumen final', VOLUMENES);
      const disolvente = campo({ value: 'agua destilada', autocapitalize: 'off', 'aria-label': 'Enrasar con' });
      de.dispatchEvent(new Event('change'));
      return preguntarAtajo('💧 Dilución', [
        madres.length > 0 && conRotulo('De qué disolución', de), conRotulo('Se llama', nombreD), stock.el, c.el, v.el, conRotulo('Enrasar con', disolvente)],
      () => Q.atajo('dilucion', { nombre: nombreD.value, de: de.value || undefined, cStock: stock.leer(), c: c.leer(), v: v.leer(), disolvente: disolvente.value }, usados()));
    };
    const atajoAcido = () => {
      if (!document.getElementById('acidos-comunes')) {
        document.body.append(h('datalist', { id: 'acidos-comunes' }, Object.entries(Q.DENSIDADES).map(([f, x]) => h('option', { value: f, text: x.nombre }))));
      }
      const formula = campo({ placeholder: 'HNO3, HCl, H2SO4…', list: 'acidos-comunes', 'aria-label': 'Fórmula del ácido o la base' });
      const riqueza = campo({ inputmode: 'decimal', placeholder: 'de la etiqueta: 65', 'aria-label': 'Riqueza' });
      const densidad = campo({ inputmode: 'decimal', placeholder: 'de la etiqueta', 'aria-label': 'Densidad' });
      // Si la tabla la conoce, la densidad sale sola (se puede escribir la de la etiqueta)
      const proponer = () => {
        const rho = Q.densidadComercial(formula.value, riqueza.value);
        densidad.placeholder = rho !== null ? `auto: ${Q.numero(rho)}` : 'de la etiqueta';
      };
      formula.addEventListener('input', proponer);
      riqueza.addEventListener('input', proponer);
      const c = numeroYUnidad('Concentración que quieres', ['M', 'mM']);
      const v = numeroYUnidad('Volumen a preparar', VOLUMENES);
      return preguntarAtajo('🧴 Ácido o base comercial diluido', [
        conRotulo('Ácido o base', formula), notaPM(formula), conRotulo('Riqueza (% en peso)', riqueza), conRotulo('Densidad (g/mL)', densidad), c.el, v.el],
      () => Q.atajo('acido', { formula: formula.value, riqueza: riqueza.value, densidad: densidad.value, c: c.leer(), v: v.leer() }, usados()));
    };
    const filaHueco = (c, rol, f) => {
      const rotulo = Q.rotuloHueco(c.tipo, rol);
      const opcional = Q.huecoOpcional(c.tipo, rol);
      const candidatos = [...r.datos, ...r.calculos].filter((x) => x !== c && x.id);
      const cabeza = h('div', { class: 'hueco-fila' }, simbolo(f.simbolos[rol]), h('span', { text: `${rotulo}${opcional ? ' (opcional)' : ''}` }));
      // Las partes de una proporción: se marcan todas las de la mezcla
      if (rol === 'partes') {
        const elegidos = new Set(c.args.partes || []);
        const lista = candidatos.filter((x) => elegidos.has(x.id) || /parte/i.test(x.unidad || ''));
        return h('div', { class: 'hueco' }, cabeza,
          lista.map((x) => h('label', { class: 'parte-opcion' }, h('input', { type: 'checkbox', checked: elegidos.has(x.id), onchange: (e) => {
            if (e.target.checked) elegidos.add(x.id); else elegidos.delete(x.id);
            c.args.partes = candidatos.filter((y) => elegidos.has(y.id)).map((y) => y.id);
          } }), ` ${x.nombre || x.id}`)),
          !lista.length && h('small', { class: 'aviso-hueco', text: 'Crea en Datos un dato por cada parte, con la unidad «partes».' }));
      }
      const elegido = porId(c.args[rol]);
      const sel = h('select', { class: 'campo hueco-select', 'aria-label': `${rotulo} de ${c.nombre || 'la cantidad'}`, 'data-plantilla': `${rotulo} de %`,
        onchange: (e) => {
          if (e.target.value === '__nuevo') { e.target.value = elegido ? elegido.id : ''; nuevoDatoPara(c, rol); return; }
          if (e.target.value) c.args[rol] = e.target.value; else delete c.args[rol];
          pintarCalculos();
        } },
        h('option', { value: '', text: opcional ? '— ninguno —' : '— elige un dato —' }),
        candidatos.map((x) => h('option', { value: x.id, text: `${x.nombre || x.id}${x.unidad ? ` (${x.unidad})` : ''}` })),
        h('option', { value: '__nuevo', text: '＋ Nuevo dato…' }));
      sel.value = elegido ? elegido.id : '';
      let aviso = null;
      if (!elegido && !opcional) aviso = h('small', { class: 'aviso-hueco', text: 'Falta elegir qué dato va aquí.' });
      else if (elegido && !Q.encajaEnHueco(c.tipo, rol, elegido.unidad)) {
        const buena = (Q.unidadesHueco(c.tipo, rol) || [''])[0];
        aviso = h('small', { class: 'aviso-hueco' }, `«${elegido.nombre}» va en ${elegido.unidad || '(sin unidad)'} y aquí hace falta ${Q.queHaceFalta(c.tipo, rol)}. `,
          // Solo a un dato (no a otra cantidad), y sin pasar el número: 0,5 g/L no son 0,5 M
          r.datos.includes(elegido) && h('button', { class: 'enlace', text: `Cambiar su unidad a ${buena}`, onclick: () => {
            elegido.unidad = buena;
            elegido._valor = '';
            delete elegido.manual;
            pintarTodo();
            avisar(`Escribe en Datos el nuevo valor de «${elegido.nombre}», en ${buena}`);
          } }));
      }
      return h('div', { class: 'hueco' }, cabeza, sel, aviso);
    };
    const cajaCalculos = h('div');
    const tarjetas = new Map(); // cantidad → su tarjeta en pantalla
    // Al cambiar el nombre de una cantidad, su tarjeta NO se vuelve a pintar (se perdería la casilla
    // que el usuario toque después): se le cambian los rótulos y el nombre corto, y se pintan las demás
    const ponerNombres = (c) => {
      const el = tarjetas.get(c);
      const cual = c.nombre || 'la cantidad';
      for (const x of el.querySelectorAll('[data-plantilla]')) x.setAttribute('aria-label', x.dataset.plantilla.replace('%', cual));
      const pie = el.querySelector('.pie-id');
      if (pie) pie.textContent = `En los pasos: {${c.id}}`;
      return el;
    };
    const tarjetaCalculo = (c) => {
      const cual = c.nombre || `la cantidad ${r.calculos.indexOf(c) + 1}`;
      const cabecera = h('div', { class: 'soluto-cabecera' },
        campo({ class: 'campo', placeholder: 'Nombre (NaCl a pesar)', autocapitalize: 'sentences', value: c.nombre || '',
          oninput: (e) => { c.nombre = e.target.value; }, onchange: () => { renombrar(c); pintarCalculos(c); pintarChips(); } }),
        h('button', { class: 'quitar', 'aria-label': `Quitar ${cual}`, 'data-plantilla': 'Quitar %', text: '🗑️', onclick: () => { r.calculos.splice(r.calculos.indexOf(c), 1); pintarTodo(); } }));
      const pie = h('small', { class: 'nota pie-id', text: c.id ? `En los pasos: {${c.id}}` : '' });
      // El resultado, al momento, con los números de ahora (pintarResultados)
      const vivo = h('div', { class: `resultado-vivo color-${Q.esFija(c) ? Q.fichaFormula(c.tipo).color : 'libre'}` });
      vivos.set(c, vivo);
      if (!Q.esFija(c)) {
        return h('div', { class: 'caja editor-calculo', 'data-calculo': c.id }, cabecera,
          h('div', { class: 'editor-formula' }, etiquetaFormula(null), h('button', { class: 'enlace', text: 'Usar una fórmula de la app', onclick: () => cambiarFormula(c) })),
          h('div', { class: 'fila-form sin-marco' },
            campo({ class: 'campo todo formula', placeholder: 'Fórmula: c_nacl * v_final / 1000 * pm_nacl', value: c.expr || '', oninput: (e) => { c.expr = e.target.value; pintarResultados(); } }),
            campo({ placeholder: 'Unidad (g)', list: 'unidades-comunes', value: c.unidad || '', oninput: (e) => { c.unidad = e.target.value; pintarResultados(); } })),
          vivo, pie);
      }
      const f = Q.fichaFormula(c.tipo);
      c.args = c.args || {};
      const salidas = Q.unidadesResultado(c.tipo, (porId(c.args.total) || {}).unidad);
      if (!salidas.includes(c.unidad)) c.unidad = salidas[0];
      const unidad = h('select', { 'aria-label': `Unidad del resultado de ${cual}`, 'data-plantilla': 'Unidad del resultado de %', onchange: (e) => { c.unidad = e.target.value; pintarResultados(); } },
        salidas.map((u) => h('option', { value: u, text: u })));
      unidad.value = c.unidad;
      return h('div', { class: 'caja editor-calculo', 'data-calculo': c.id }, cabecera,
        h('div', { class: 'editor-formula' }, etiquetaFormula(c.tipo),
          h('button', { class: 'enlace', 'aria-label': `Cambiar la fórmula de ${cual}`, 'data-plantilla': 'Cambiar la fórmula de %', text: 'Cambiar ▾', onclick: () => cambiarFormula(c) })),
        h('div', { class: `ficha color-${f.color}` }, igualA(f.sale, f.formula)),
        Object.keys(Q.TIPOS[c.tipo].huecos).map((rol) => filaHueco(c, rol, f)),
        h('div', { class: 'hueco hueco-fila' }, simbolo(f.sale), h('span', { class: 'hueco-rotulo', text: 'El resultado sale en' }), unidad),
        vivo,
        h('div', { class: 'editor-pie' }, pie, h('button', { class: 'enlace', text: 'Escribir la fórmula a mano (avanzado)', onclick: () => aMano(c) })));
    };
    // El resultado de cada cantidad mientras se escribe (lo pidió el usuario: antes solo se veía al
    // guardar). Cada una se calcula aparte, con los datos y solo las cantidades que usa: así una
    // cantidad a medio rellenar no impide ver las demás
    const vivos = new Map(); // cantidad → su recuadro de resultado
    const loQueUsa = (cand, id) => {
      const porIdC = new Map(cand.calculos.map((x) => [x.id, x]));
      const lista = [];
      const vistos = new Set();
      const anadir = (x) => {
        if (!x || vistos.has(x.id)) return;
        vistos.add(x.id);
        const ids = x.args ? Object.values(x.args).flat() : String(x.expr || '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
        for (const otro of ids) anadir(porIdC.get(otro));
        lista.push(x);
      };
      anadir(porIdC.get(id));
      return lista;
    };
    const resultadoVivo = (cand, c) => {
      const v = Q.validar({ nombre: 'x', datos: cand.datos, calculos: loQueUsa(cand, c.id), pasos: [{ texto: 'x' }] });
      if (v.error) {
        const sinElegir = Q.esFija(c) && Object.keys(Q.TIPOS[c.tipo].huecos).some((rol) => !Q.huecoOpcional(c.tipo, rol) && !(c.args || {})[rol]);
        return h('span', { class: 'vivo-falta', text: sinElegir ? 'Elige los datos de todas las letras para ver el resultado' : `Aún no se puede calcular: ${v.error}` });
      }
      const res = Q.calcular(v.receta);
      const cv = v.receta.calculos.find((x) => x.id === c.id);
      if (!cv) return null;
      if (!(c.id in res.valores)) return h('span', { class: 'vivo-falta', text: `${res.errores[c.id] || 'No se puede calcular'}: escribe su número en Datos` });
      const valor = Q.cantidad(res.valores[c.id], cv.unidad);
      if (!Q.esFija(cv)) return h('span', { class: 'vivo-valor', text: `= ${valor}` });
      const f = Q.fichaFormula(cv.tipo);
      return [h('div', { class: 'vivo-cuenta' }, igualA(f.sale, Q.fraccionConNumeros(cv, v.receta, res))), h('span', { class: 'vivo-valor', text: `= ${valor}` })];
    };
    const pintarResultados = () => {
      const cand = candidata();
      for (const c of r.calculos) {
        const el = vivos.get(c);
        if (!el) continue;
        let dentro;
        try { dentro = resultadoVivo(cand, c); } catch { dentro = null; }
        poner(el, dentro);
      }
    };
    // salvo: la cantidad cuya tarjeta se deja como está (solo se le ponen los nombres nuevos)
    const pintarCalculos = (salvo) => {
      poner(cajaCalculos, r.calculos.map((c) => {
        if (c === salvo && tarjetas.has(c)) return ponerNombres(c);
        const el = tarjetaCalculo(c);
        tarjetas.set(c, el);
        return el;
      }));
      pintarResultados();
    };
    const anadirCantidad = async () => {
      const tipo = await elegirFormula(true);
      if (!tipo) return;
      const c = { id: idDesde('cantidad', usados()), _idAuto: true, nombre: '', unidad: '' };
      ponerTipo(c, tipo);
      r.calculos.push(c);
      pintarTodo();
      const nombres = cajaCalculos.querySelectorAll('.editor-calculo .soluto-cabecera .campo');
      if (nombres.length) nombres[nombres.length - 1].focus();
    };

    // ── Pasos ──
    // Las cantidades se ponen en el texto con un toque: se toca dónde va y luego su nombre
    let ultimoPaso = null;
    const cajaPasos = h('div');
    const chips = h('div', { class: 'chips' });
    const pintarChips = () => poner(chips, [...r.datos, ...r.calculos].filter((x) => x.id && x.nombre).map((x) => h('button', {
      class: 'chip', text: x.nombre,
      // (con mousedown se evita que el texto pierda el sitio donde estaba el cursor)
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        const el = (ultimoPaso && document.body.contains(ultimoPaso)) ? ultimoPaso : cajaPasos.querySelector('textarea:last-of-type');
        if (!el) return;
        el.setRangeText(`{${x.id}}`, el.selectionStart, el.selectionEnd, 'end');
        el.dispatchEvent(new Event('input'));
        el.focus();
      } })));
    // Un paso que empieza una fase lleva el título encima, como un rótulo (como en la receta: así se
    // ven las fases separadas). Los demás, el enlace «＋ Aquí empieza una fase», que lo pone enseguida
    const rotuloFase = (p, i) => h('div', { class: 'fase-editor', 'data-fase': String(i) },
      campo({ class: 'campo', 'aria-label': 'Título de la fase', placeholder: 'Título de la fase', autocapitalize: 'sentences', value: p.titulo || '', oninput: (e) => { p.titulo = e.target.value; } }),
      h('button', { class: 'quitar', 'aria-label': 'Quitar el título de la fase', text: '✕', onclick: () => { p.titulo = ''; p._conRotulo = false; pintarPasos(); } }));
    // Una subfase dentro de la fase: su nombre y, con un toque, si es de preparar una disolución o
    // de las muestras. Sale en cuanto se añade (con «＋ Aquí empieza una subfase»); ✕ la quita
    const rotuloSubfase = (p) => {
      const boton = (parte, texto) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String((p.parte || 'muestras') === parte), text: texto,
        onclick: () => { p.parte = parte; pintarPasos(); } });
      const nombreSub = campo({ class: 'campo', 'aria-label': 'Nombre de la subfase', placeholder: 'Nombre de la subfase (Disolución de sembrado…)', autocapitalize: 'sentences', value: p.subfase || '', oninput: (e) => { p.subfase = e.target.value; } });
      return h('div', { class: `subfase-editor parte-${p.parte || 'muestras'}` },
        h('div', { class: 'subfase-fila' }, nombreSub,
          h('button', { class: 'quitar', type: 'button', 'aria-label': 'Quitar la subfase', text: '✕', onclick: () => { delete p.subfase; delete p.parte; p._conSub = false; pintarPasos(); } })),
        h('div', { class: 'chips' }, boton('disolucion', '🧪 Disolución'), boton('muestras', '🧫 Muestras')));
    };
    const filaPaso = (p, i) => [p._conRotulo && rotuloFase(p, i), p._conSub && rotuloSubfase(p), filaDelPaso(p, i)];
    // Debajo del texto de cada paso, lo que la app propone al leerlo (versión 83, lo pidió el usuario):
    // que una cantidad escrita con su número pase a ser un dato. (En la 83 los pasos se acortaron, con
    // el cronómetro, los ciclos y la fase detrás de «⋯» y una sugerencia de cronómetro; al usuario no
    // le gustó y se quitó en la 84: las casillas se ven siempre, como antes)
    const sugerenciasDe = (p, caja) => {
      const cantidades = Q.cantidadesDelPaso(String(p.texto || '')).slice(0, 3);
      poner(caja, cantidades.map((q) => h('button', { class: 'chip sugerencia', type: 'button', text: `🔢 Que «${q.texto}» cambie con la receta`, onclick: () => aDato(p, q) })));
    };
    // Una cantidad escrita con su número en el texto de un paso pasa a ser un dato (y en el texto, {su id})
    const aDato = async (p, q) => {
      const nombreQ = campo({ value: Q.nombreDeCantidad(q), autocapitalize: 'sentences', 'aria-label': 'Nombre del dato' });
      if (!await preguntar({ texto: `🔢 «${q.texto}» como dato`, si: 'Hacer dato', no: 'Cancelar', detalle: [
        h('p', { class: 'dialogo-detalle', text: `Saldrá en Datos con ${q.texto}, y si lo cambias allí, el paso dice el número nuevo.` }),
        conRotulo('Nombre', nombreQ)] })) return;
      const t = String(p.texto || '');
      // (por si el texto ha cambiado mientras: se vuelve a buscar)
      const ahora = Q.cantidadesDelPaso(t).find((x) => x.texto === q.texto) || q;
      if (t.slice(ahora.inicio, ahora.fin) !== ahora.texto) return;
      const d = { id: idDesde(nombreQ.value || 'dato', usados()), nombre: nombreQ.value.trim() || ahora.texto, unidad: ahora.unidad, _valor: numeroTexto(ahora.valor), _valorAntes: '' };
      r.datos.push(d);
      p.texto = `${t.slice(0, ahora.inicio)}{${d.id}}${t.slice(ahora.fin)}`;
      pintarTodo();
      pintarPasos();
      avisar(`«${ahora.texto}» es ahora el dato «${d.nombre}»`);
    };
    const filaDelPaso = (p, i) => {
      const sugerencias = h('div', { class: 'todo sugerencias-paso' });
      let reloj = null;
      const fila = h('div', { class: 'fila-form', 'data-paso': String(i) },
        h('textarea', { class: 'campo ancho', rows: 3, placeholder: 'Pesa {m_nacl} de NaCl…', value: p.texto || '',
          oninput: (e) => { p.texto = e.target.value; clearTimeout(reloj); reloj = setTimeout(() => sugerenciasDe(p, sugerencias), 400); },
          onfocus: (e) => { ultimoPaso = e.target; } }),
        h('button', { class: 'quitar', 'aria-label': 'Quitar el paso', text: '🗑️', onclick: () => { r.pasos.splice(r.pasos.indexOf(p), 1); pintarPasos(); } }),
        sugerencias,
        campo({ placeholder: 'Minutos (cronómetro)', inputmode: 'decimal', value: numeroTexto(p.minutos), oninput: (e) => { p.minutos = e.target.value; } }),
        campo({ placeholder: 'Ciclos (si se repite)', inputmode: 'numeric', value: p.ciclos ? String(p.ciclos) : '', oninput: (e) => { p.ciclos = e.target.value; } }),
        // Una fase nueva, igual que una subfase (versión 85, lo pidió el usuario): su título sale enseguida
        // encima del paso (antes era una casilla en la fila y salía encima la próxima vez que se abría)
        !p._conRotulo && h('button', { class: 'enlace todo', type: 'button', text: '＋ Aquí empieza una fase', onclick: () => {
          p._conRotulo = true;
          p.titulo = '';
          pintarPasos();
          const t = cajaPasos.querySelector(`.fase-editor[data-fase="${r.pasos.indexOf(p)}"] input`);
          if (t) t.focus();
        } }),
        !p._conSub && h('button', { class: 'enlace todo', type: 'button', text: '＋ Aquí empieza una subfase (disolución o muestras)', onclick: () => {
          p._conSub = true;
          p.subfase = '';
          p.parte = 'muestras';
          pintarPasos();
          const t = cajaPasos.querySelector(`.fila-form[data-paso="${r.pasos.indexOf(p)}"]`);
          const nombreSub = t && t.previousElementSibling && t.previousElementSibling.querySelector('input');
          if (nombreSub) nombreSub.focus();
        } }));
      sugerenciasDe(p, sugerencias);
      return fila;
    };
    const pintarPasos = () => poner(cajaPasos, r.pasos.map(filaPaso));
    const pintarTodo = () => { pintarDatos(); pintarCalculos(); pintarChips(); };

    const nombre = campo({ placeholder: 'Nombre de la receta', value: r.nombre, autocapitalize: 'sentences' });
    const resumen = h('textarea', { class: 'campo', rows: 2, placeholder: 'Qué se prepara o qué se hace', value: r.resumen || '' });
    const seguridad = h('textarea', { class: 'campo', rows: 2, placeholder: 'Guantes, gafas, vitrina…', value: r.seguridad || '' });
    const notas = h('textarea', { class: 'campo', rows: 3, placeholder: 'Purezas, grados, marcas, referencias… (lo que no es un paso pero importa)', value: r.notas || '' });

    // La receta tal como quedaría (sin lo que solo usa el formulario)
    const candidata = () => ({
      id: r.id || null, nombre: nombre.value, resumen: resumen.value, seguridad: seguridad.value, notas: notas.value,
      textoOriginal: r.textoOriginal, modelo: r.modelo, avisos: [],
      // Un peso molecular cuenta como escrito a mano si ya lo era o si se ha cambiado el número aquí
      // (con el valor vacío lo vuelve a calcular la app)
      datos: r.datos.map((d) => ({ id: d.id, nombre: d.nombre, valor: d._valor, unidad: d.unidad, formula: d.formula,
        manual: d._valor !== '' && (Boolean(d.manual) || d._valor !== d._valorAntes) })),
      calculos: r.calculos.map((c) => (Q.esFija(c)
        ? { id: c.id, nombre: c.nombre, unidad: c.unidad, tipo: c.tipo, args: c.args }
        : { id: c.id, nombre: c.nombre, expr: c.expr, unidad: c.unidad })),
      pasos: r.pasos.map((p) => ({ texto: p.texto, minutos: p.minutos, titulo: p.titulo, ciclos: p.ciclos, subfase: p.subfase, parte: p.parte })),
    });
    let guardado = false;
    const guardarFormulario = () => {
      const v = Q.validar(candidata());
      if (v.error) { avisar(v.error); return; }
      // Los pasos que nombran algo que no existe se avisan, pero se guarda
      v.receta.avisos = Q.revisar(v.receta).filter((a) => a.startsWith('Un paso'));
      const guardada = ponerReceta(v.receta);
      guardado = true;
      if (alGuardar) cerrarCapas(1, () => alGuardar(guardada));
      else cerrarCapas(2, () => abrirDetalle(guardada.id));
    };
    // Si se sale (atrás, la flecha) con cambios sin guardar, se pregunta. Lo de partida se apunta al
    // final, ya pintado el formulario (al pintarlo se completan cosas, como la unidad del resultado)
    let deInicio = null;
    const hayCambios = () => !guardado && deInicio !== null && JSON.stringify(candidata()) !== deInicio;
    capa.retener = () => {
      if (!hayCambios()) return false;
      // La pregunta, después: antes, el historial tiene que volver a apuntar el formulario
      setTimeout(async () => {
        const r = await preguntar({ texto: '¿Guardar los cambios?', detalle: 'Has cambiado la receta y aún no lo has guardado.', si: 'Guardar', no: 'Seguir editando', otro: 'Salir sin guardar' });
        if (r === true) guardarFormulario();
        else if (r === 'otro') { guardado = true; atras(); }
      }, 0);
      return true;
    };
    // Si se sale de la app a medias, se guarda un borrador (por si Android la cierra mientras tanto)
    alSalirDeLaApp = () => {
      if (hayCambios()) guardar('quimica.borrador-receta', { fecha: Date.now(), nueva, receta: { ...candidata(), id: r.id || null } });
    };

    poner(cuerpo,
      h('span', { class: 'etiqueta', text: 'Nombre' }), nombre,
      h('span', { class: 'etiqueta', text: 'Resumen' }), resumen,
      h('span', { class: 'etiqueta', text: 'Seguridad' }), seguridad,
      h('span', { class: 'etiqueta', text: 'Notas' }), notas,
      h('h3', { text: '🔢 Datos' }),
      h('p', { class: 'nota', text: 'Los números que querrás cambiar: volumen, concentración, pureza, densidad… Con la unidad g/mol, escribe la fórmula química y el peso molecular lo calcula la app.' }),
      cajaDatos,
      h('button', { class: 'boton secundario', text: '＋ Añadir un dato', onclick: () => {
        r.datos.push({ id: idDesde('dato', usados()), _idAuto: true, nombre: '', unidad: '', _valor: '', _valorAntes: '' });
        pintarTodo();
        const nombres = cajaDatos.querySelectorAll('.fila-form .campo.ancho');
        if (nombres.length) nombres[nombres.length - 1].focus();
      } }),
      h('h3', { text: '⚖️ Cantidades calculadas' }),
      h('p', { class: 'nota', text: 'Elige la fórmula y, en cada letra, qué dato va. De las unidades se encarga la app.' }),
      cajaCalculos,
      h('p', { class: 'nota atajos-nota', text: '⚡ Rápido: escribe lo que preparas y salen los datos, la cuenta y el paso.' }),
      h('div', { class: 'calc-tarjetas atajos' },
        h('button', { class: 'calc-tarjeta color-pesar', type: 'button', onclick: atajoSolido }, h('span', { class: 'calc-tarjeta-icono', text: '⚖️' }), h('span', { text: 'Disolución de un sólido' })),
        h('button', { class: 'calc-tarjeta color-diluir', type: 'button', onclick: atajoDilucion }, h('span', { class: 'calc-tarjeta-icono', text: '💧' }), h('span', { text: 'Dilución' })),
        h('button', { class: 'calc-tarjeta color-acido', type: 'button', onclick: atajoAcido }, h('span', { class: 'calc-tarjeta-icono', text: '🧴' }), h('span', { text: 'Ácido comercial' }))),
      h('button', { class: 'boton secundario', text: '＋ Añadir una cantidad (eligiendo la fórmula)', onclick: anadirCantidad }),
      h('h3', { text: '📋 Pasos' }),
      h('p', { class: 'nota', text: 'Para poner una cantidad en un paso, toca en el texto dónde va y luego su nombre aquí:' }),
      chips,
      cajaPasos,
      h('button', { class: 'boton secundario', text: '＋ Añadir un paso', onclick: () => { r.pasos.push({ texto: '' }); pintarPasos(); const t = cajaPasos.querySelectorAll('textarea'); t[t.length - 1].focus(); } }),
      h('p', { class: 'nota', text: 'Si unos pasos se repiten varias veces, pon cuántos ciclos son en el primero de ellos: saldrá un contador.' }),
      h('button', { class: 'boton', text: 'Guardar', onclick: guardarFormulario }));
    pintarTodo();
    pintarPasos();
    deInicio = deBorrador ? '' : JSON.stringify(candidata());
    // Se abre por donde se estaba mirando, y eso se resalta un momento para encontrarlo
    if (mirando) {
      requestAnimationFrame(() => {
        const el = irA(cuerpo, mirando, 12);
        if (!el) return;
        el.classList.add('resaltado');
        setTimeout(() => el.classList.remove('resaltado'), 1800);
      });
    }
  };


  // ─── Receta nueva: pegar el texto para Gemini, a mano o la de ejemplo ───
  const abrirNueva = () => {
    const { cuerpo } = abrirPanel('Nueva receta');
    const texto = h('textarea', { class: 'campo', rows: 10, value: leer('quimica.borrador', ''),
      placeholder: 'Pega o escribe aquí el procedimiento: qué se hace, con qué reactivos y en qué cantidades.\n\nCon las marcas:\n# Disolución de sal\n🧪 Preparar la disolución\nPesar 5,84 g de NaCl en 1 L de agua.',
      oninput: () => guardar('quimica.borrador', texto.value) });
    const boton = h('button', { class: 'boton', text: '✨ Convertir en receta con Gemini', onclick: async () => {
      if (!hayIA()) { abrirAjustes(); return; }
      boton.disabled = true;
      boton.textContent = '✨ Gemini está trabajando… (puede tardar un minuto)';
      const r = await window.Gemini.convertir(texto.value, clave());
      if (r.receta) {
        const nueva = ponerReceta(r.receta);
        guardar('quimica.borrador', '');
        const abrir = () => { abrirDetalle(nueva.id); avisar(nueva.avisos.length ? 'Receta hecha. Mira lo que hay que revisar' : 'Receta hecha. Revisa los datos y las fórmulas'); };
        // Si el usuario ya ha salido de este panel, la receta queda en la lista
        if (document.body.contains(boton)) cerrarCapas(1, abrir); else avisar(`Receta hecha: ${nueva.nombre}`);
        return;
      }
      boton.disabled = false;
      boton.textContent = '✨ Convertir en receta con Gemini';
      avisar(r.error);
    } });
    // Las marcas (versión 90, lo pidió el usuario: «que lo escriba simple e indicando si algo es una
    // disolución, para que a la IA le sea más fácil»): tres botones que las escriben al empezar una
    // línea nueva donde está el cursor, y un ejemplo
    const ponerMarca = (marca) => {
      const t = texto.value;
      const a = texto.selectionStart == null ? t.length : texto.selectionStart;
      const b = texto.selectionEnd == null ? a : texto.selectionEnd;
      const antes = t.slice(0, a);
      const salto = antes && !antes.endsWith('\n') ? '\n' : '';
      texto.setRangeText(`${salto}${marca} `, a, b, 'end');
      texto.dispatchEvent(new Event('input'));
      texto.focus();
    };
    const botonMarca = (marca, rotulo, ayuda) => h('button', { class: 'chip', type: 'button', text: rotulo, title: ayuda,
      onmousedown: (e) => e.preventDefault(), onclick: () => ponerMarca(marca) });
    const EJEMPLO_MARCADO = '# Disolución de sal\n🧪 Preparar la disolución\nPesar 5,84 g de NaCl y disolverlos en 1 L de agua destilada.\nAgitar 5 minutos.\n\n# Lavado de las muestras\n🧫 Lavar y secar\nSumergir las muestras 10 minutos en la disolución.\nSecar 20 minutos a 60 °C. Repetir 3 veces.';
    poner(cuerpo,
      h('p', { class: 'nota', text: 'Gemini ordena el texto en pasos, pone los cronómetros y elige las fórmulas. Las cuentas las hace la app.' }),
      h('p', { class: 'nota', text: 'Le sale mejor si marcas las partes: toca un botón y escribe a continuación su nombre. Lo que escribas debajo de cada marca son sus pasos. Si lo pegas sin marcar, también funciona.' }),
      h('div', { class: 'chips marcas-receta' },
        botonMarca('#', '＋ Fase', 'Empieza una fase nueva'),
        botonMarca('🧪', '＋ 🧪 Disolución', 'Aquí se prepara una disolución'),
        botonMarca('🧫', '＋ 🧫 Muestras', 'Aquí las muestras pasan por algo: lavar, secar, sumergir…'),
        h('button', { class: 'chip', type: 'button', text: '👀 Ver un ejemplo', onclick: async () => {
          if (texto.value.trim() && !await preguntar({ texto: '¿Poner el ejemplo?', detalle: 'Cambia lo que tienes escrito por un ejemplo.', si: 'Poner el ejemplo', no: 'No' })) return;
          texto.value = EJEMPLO_MARCADO;
          texto.dispatchEvent(new Event('input'));
        } })),
      texto,
      boton,
      !hayIA() && h('p', { class: 'nota', text: 'Para usar Gemini hace falta una clave gratuita: al pulsar el botón se abren los Ajustes para ponerla.' }),
      h('h3', { text: 'Sin la IA' }),
      h('button', { class: 'boton secundario', text: '✍️ Escribirla a mano', onclick: () => abrirFormulario(null) }),
      h('button', { class: 'boton secundario', text: '🧪 Añadir una receta de ejemplo', onclick: () => {
        const nueva = ponerReceta(Q.validar(JSON.parse(JSON.stringify(Q.EJEMPLO))).receta);
        cerrarCapas(1, () => abrirDetalle(nueva.id));
      } }));
  };

  // ─── La calculadora ───
  // Las fórmulas fijas de la app (Q.TIPOS), sueltas: se elige una, se escriben los números y sale
  // el resultado al momento. Lo escrito se recuerda (quimica.calculadora), cada fórmula lo suyo
  // prellenado (desde una receta, "Probar otros números en la calculadora"): { disolucion } o
  // { tipo, entradas }, de Q.paraCalculadora, y desde: el nombre de la receta. Así abierta, lo que
  // se escribe no se guarda: no estropea lo que hubiera en la calculadora ni cambia la receta
  const abrirCalculadora = (prellenado) => {
    const { cuerpo, panel: panelCalc } = abrirPanel('Calculadora');
    panelCalc.dataset.lateral = 'calculadora';
    const guardado = leer('quimica.calculadora', {});
    const estado = prellenado ? JSON.parse(JSON.stringify(guardado)) : guardado;
    // "disolucion" es la primera opción: una disolución con uno o varios solutos (junta las fórmulas
    // masa_molar y masa_gl, que por eso no salen sueltas en la lista)
    const SUELTAS = Object.keys(Q.TIPOS).filter((t) => t !== 'masa_molar' && t !== 'masa_gl');
    if (!estado.entradas || typeof estado.entradas !== 'object') estado.entradas = {};
    if (prellenado && prellenado.disolucion) { estado.tipo = 'disolucion'; estado.disolucion = prellenado.disolucion; }
    if (prellenado && prellenado.tipo) { estado.tipo = prellenado.tipo; estado.entradas[prellenado.tipo] = prellenado.entradas; }
    if (!SUELTAS.includes(estado.tipo)) estado.tipo = 'disolucion';
    const recordar = () => { if (!prellenado) guardar('quimica.calculadora', estado); };
    // Un número con su unidad en un desplegable (o la unidad escrita, si solo hay una)
    const selectorUnidad = (e, unidades, rotulo, alCambiar) => {
      if (unidades.length < 2) return h('span', { class: 'dato-unidad', text: unidades[0] || '' });
      const s = h('select', { 'aria-label': `Unidad de ${rotulo}`, onchange: () => { e.unidad = s.value; recordar(); alCambiar(); } },
        unidades.map((u) => h('option', { value: u, text: u })));
      if (!unidades.includes(e.unidad)) e.unidad = unidades[0];
      s.value = e.unidad;
      return s;
    };
    const campoNumero = (e, rotulo, alCambiar, extra) => {
      const entrada = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', 'aria-label': rotulo, value: e.valor || '',
        oninput: () => { e.valor = entrada.value; recordar(); alCambiar(); }, ...extra });
      return entrada;
    };
    // «📋 Hacer una receta con esto» (versión 83, lo pidió el usuario): lo escrito en la calculadora
    // pasa a ser una receta nueva, con sus datos, sus cantidades y un paso (Q.atajo para pesar
    // sólidos y diluir), que se abre en el formulario para terminarla y guardarla
    const recetaDeLaCalculadora = () => {
      const usados = new Set();
      const datos = [];
      const calculos = [];
      const pasos = [];
      const juntar = (t) => { datos.push(...t.datos); calculos.push(...t.calculos); pasos.push(...t.pasos); };
      if (estado.tipo === 'disolucion') {
        const d = estado.disolucion;
        const nombres = [];
        let vId;
        for (const [i, s] of d.solutos.entries()) {
          if (!s.c || !String(s.c.valor || '').trim()) continue;
          const pm = String((s.pm || {}).valor || '').trim();
          const esNumero = Q.aNumero(pm) !== null;
          const nombre = String(s.nombre || '').trim() || (!esNumero && pm) || `soluto ${i + 1}`;
          const t = Q.atajo('solido', { nombre, formula: esNumero ? '' : pm, pm: esNumero ? pm : undefined, c: s.c, v: d.v, vId, pureza: (s.pureza || {}).valor }, usados);
          if (t.error) return { error: t.error };
          vId = vId || t.calculos[0].args.v;
          juntar(t);
          nombres.push(nombre);
        }
        if (!nombres.length) return { error: 'Escribe al menos la concentración de un soluto' };
        // Varios solutos en la misma disolución: se pesa cada uno y se disuelve todo junto
        if (nombres.length > 1) {
          datos.find((x) => x.id === vId).nombre = 'Volumen de disolución';
          pasos.splice(0, pasos.length, ...calculos.map((c, i) => ({ texto: `Pesa {${c.id}} de ${nombres[i]}.` })), { texto: `Disuelve todo en agua destilada hasta {${vId}}.` });
        }
        return { nombre: `Disolución de ${nombres.join(', ')}`, datos, calculos, pasos };
      }
      const suyas = estado.entradas[estado.tipo] || {};
      if (estado.tipo === 'dilucion') {
        const t = Q.atajo('dilucion', { nombre: 'la disolución de partida', cStock: suyas.c_stock, c: suyas.c, v: suyas.v }, usados);
        if (t.error) return { error: t.error };
        juntar(t);
        return { nombre: 'Dilución', datos, calculos, pasos };
      }
      // Las demás: un dato por casilla escrita y la cantidad, con un paso que la nombra
      const args = {};
      for (const hueco of Q.huecosCalculadora(estado.tipo)) {
        const e = suyas[hueco.rol] || {};
        const escrito = String(e.valor == null ? '' : e.valor).trim();
        if (!escrito) continue;
        const formula = hueco.esPM && Q.aNumero(escrito) === null ? escrito : '';
        const id = Q.idNuevo(hueco.rotulo, usados);
        datos.push({ id, nombre: hueco.rotulo, valor: formula ? null : Q.aNumero(escrito), unidad: hueco.esPM ? 'g/mol' : e.unidad || hueco.unidades[0] || '', ...(formula ? { formula } : {}) });
        if (hueco.rol === 'otras' || hueco.rol === 'parte') args.partes = [...(args.partes || []), id];
        if (hueco.rol !== 'otras') args[hueco.rol] = id;
      }
      const ficha = Q.fichaFormula(estado.tipo);
      const id = Q.idNuevo(ficha.corto, usados);
      const total = datos.find((x) => x.id === args.total);
      calculos.push({ id, nombre: ficha.corto, unidad: Q.unidadesResultado(estado.tipo, total && total.unidad)[0], tipo: estado.tipo, args });
      pasos.push({ texto: `${ficha.icono} ${ficha.corto}: {${id}}` });
      return { nombre: Q.TIPOS[estado.tipo].nombre, datos, calculos, pasos };
    };
    const botonReceta = () => h('button', { class: 'boton secundario', text: '📋 Hacer una receta con esto', onclick: () => {
      const hecha = recetaDeLaCalculadora();
      if (hecha.error) { avisar(hecha.error); return; }
      abrirFormulario({ resumen: '', seguridad: '', ...hecha }, (guardada) => abrirDetalle(guardada.id), null, true);
    } });
    // El resultado: "V₁ = 311,7 mL" y debajo la cuenta con los números escritos
    const pintarResultado = (caja, r, sale) => {
      caja.className = `resultado${r.texto ? '' : r.error ? ' error' : ' pendiente'}`;
      poner(caja, r.texto
        ? [h('span', { class: 'resultado-valor', text: `${sale} = ${r.texto}` }), h('small', { class: 'resultado-formula' }, fraccion(r.fraccionNumeros)),
          r.pm && h('small', { text: `Peso molecular calculado: ${Q.numero(r.pm)} g/mol` }),
          (r.avisos || []).map((t) => h('small', { class: 'aviso-sentido', text: `⚠️ ${t}` }))]
        : h('span', { text: r.falta ? `Falta escribir: ${r.falta.toLowerCase()}` : r.error }));
    };
    // El rótulo de una casilla con su letra delante: "[c₂] Concentración que quieres"
    const rotuloCon = (letra, texto) => h('div', { class: 'dato-nombre' }, letra && simbolo(letra), texto);

    // ── Una disolución con uno o varios solutos: el volumen es de todos; cada soluto, lo suyo ──
    const pintarDisolucion = (zona) => {
      // Lo que hubiera escrito con la calculadora de antes (un sólido cada vez, versiones 13 a 16) pasa a ser el primer soluto
      const deAntes = () => {
        const m = estado.entradas.masa_molar || estado.entradas.masa_gl;
        if (!m) return { v: { valor: '', unidad: 'mL' }, solutos: [{}] };
        delete estado.entradas.masa_molar;
        delete estado.entradas.masa_gl;
        return { v: m.v, solutos: [{ c: m.c, pm: m.pm, pureza: m.pureza }] };
      };
      const d = estado.disolucion = estado.disolucion && Array.isArray(estado.disolucion.solutos) && estado.disolucion.solutos.length
        ? estado.disolucion : deAntes();
      d.v = d.v || { valor: '', unidad: 'mL' };
      const actualizar = []; // lo que hay que recalcular al cambiar el volumen
      const tarjeta = (s, i) => {
        const n = i + 1;
        s.c = s.c || { valor: '', unidad: 'M' };
        s.pm = s.pm || { valor: '' };
        s.pureza = s.pureza || { valor: '' };
        const caja = h('div', { class: 'resultado' });
        const calcular = () => pintarResultado(caja, Q.calculoSoluto(d.v, s), 'm');
        actualizar.push(calcular);
        const nombre = h('input', { class: 'campo soluto-nombre', type: 'text', autocomplete: 'off', 'aria-label': `Nombre del soluto ${n}`, placeholder: `Soluto ${n} (nombre, si quieres)`, value: s.nombre || '',
          oninput: () => { s.nombre = nombre.value; recordar(); } });
        const el = h('div', { class: 'caja soluto' },
          h('div', { class: 'soluto-cabecera' }, nombre,
            d.solutos.length > 1 && h('button', { class: 'quitar', 'aria-label': `Quitar el soluto ${n}`, text: '🗑️', onclick: () => { d.solutos.splice(i, 1); recordar(); pintarZona(); } })),
          h('div', { class: 'dato' }, rotuloCon('c', 'Concentración'),
            campoNumero(s.c, `Concentración del soluto ${n}`, calcular),
            // Al pasar de molar a masa (o al revés) aparece o desaparece el peso molecular
            selectorUnidad(s.c, Q.unidadesSoluto(), `concentración del soluto ${n}`, pintarZona)),
          Q.esMolar(s.c.unidad) && h('div', { class: 'dato' }, rotuloCon('PM', 'Peso molecular'),
            campoNumero(s.pm, `Peso molecular del soluto ${n}`, calcular, { inputmode: 'text', placeholder: 'nº o NaCl' }), h('span', { class: 'dato-unidad', text: 'g/mol' })),
          h('div', { class: 'dato' }, rotuloCon('pureza', 'Pureza'),
            campoNumero(s.pureza, `Pureza del soluto ${n}`, calcular, { placeholder: 'opcional' }), h('span', { class: 'dato-unidad', text: '%' })),
          caja);
        calcular();
        return el;
      };
      poner(zona,
        fichaVisual('masa_molar', { titulo: '⚖️ Pesar sólidos', que: 'Cuánto hay que pesar de uno o varios sólidos para preparar una disolución.',
          extra: 'Si la concentración va en g/L, mg/mL o %, no hace falta el peso molecular: m = c × V / pureza.' }),
        h('h3', { text: '🔢 La disolución' }),
        h('div', { class: 'caja' }, h('div', { class: 'dato' }, rotuloCon('V', 'Volumen de disolución'),
          campoNumero(d.v, 'Volumen de disolución', () => actualizar.forEach((f) => f())),
          selectorUnidad(d.v, Q.huecosCalculadora('masa_molar')[1].unidades, 'volumen de disolución', () => actualizar.forEach((f) => f())))),
        h('h3', { text: '⚖️ Lo que hay que pesar de cada soluto' }),
        d.solutos.map(tarjeta),
        h('button', { class: 'boton', text: '＋ Añadir otro soluto', onclick: () => { d.solutos.push({}); recordar(); pintarZona(); zona.querySelector('.soluto:last-of-type .soluto-nombre').focus(); } }),
        botonReceta(),
        h('button', { class: 'boton secundario', text: 'Borrar estos números', onclick: () => { delete estado.disolucion; recordar(); pintarZona(); } }));
    };

    // ── Las demás fórmulas: sus datos y un resultado ──
    const pintarSuelta = (zona) => {
      const suyas = estado.entradas[estado.tipo] = estado.entradas[estado.tipo] || {};
      const ficha = Q.fichaFormula(estado.tipo);
      const resultado = h('div', { class: 'resultado' });
      const calcular = () => pintarResultado(resultado, Q.calculoSuelto(estado.tipo, suyas), ficha.sale);
      poner(zona,
        fichaVisual(estado.tipo),
        h('h3', { text: '🔢 Datos' }),
        h('div', { class: 'caja' }, Q.huecosCalculadora(estado.tipo).map((hueco) => {
          const e = suyas[hueco.rol] = suyas[hueco.rol] || { valor: '', unidad: hueco.unidades[0] || '' };
          return h('div', { class: 'dato' }, rotuloCon(ficha.simbolos[hueco.rol], hueco.rotulo),
            campoNumero(e, hueco.rotulo, calcular, { inputmode: hueco.esPM ? 'text' : 'decimal', placeholder: hueco.opcional ? 'opcional' : hueco.esPM ? 'nº o NaCl' : '' }),
            selectorUnidad(e, hueco.unidades, hueco.rotulo.toLowerCase(), calcular));
        })),
        h('h3', { text: '⚖️ Resultado' }),
        resultado,
        botonReceta(),
        h('button', { class: 'boton secundario', text: 'Borrar estos números', onclick: () => { delete estado.entradas[estado.tipo]; recordar(); pintarZona(); } }));
      calcular();
    };

    const zona = h('div');
    // Para elegir la fórmula: una tarjeta de su color por cada una (la elegida, marcada)
    const OPCIONES = [{ id: 'disolucion', icono: '⚖️', corto: 'Pesar sólidos', color: 'pesar' },
      ...SUELTAS.map((id) => ({ id, ...Q.fichaFormula(id) }))];
    const tarjetas = h('div', { class: 'calc-tarjetas' }, OPCIONES.map((o) => h('button', {
      class: `calc-tarjeta color-${o.color}`, 'data-tipo': o.id, 'aria-pressed': String(o.id === estado.tipo),
      onclick: () => {
        estado.tipo = o.id;
        recordar();
        for (const b of tarjetas.children) b.setAttribute('aria-pressed', String(b.dataset.tipo === o.id));
        pintarZona();
      } }, h('span', { class: 'calc-tarjeta-icono', text: o.icono }), h('span', { text: o.corto }))));
    const pintarZona = () => (estado.tipo === 'disolucion' ? pintarDisolucion(zona) : pintarSuelta(zona));

    // Aparte: el peso molecular de una fórmula química
    const formula = h('input', { class: 'campo', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Fórmula química',
      placeholder: 'NaCl, CuSO4·5H2O, Ca(OH)2…', value: estado.formula || '',
      oninput: () => { estado.formula = formula.value; recordar(); pintarPM(); } });
    const pm = h('div', { class: 'resultado pendiente' });
    const pintarPM = () => {
      const escrito = formula.value.trim();
      const masa = escrito ? Q.masaMolar(escrito) : null;
      pm.className = `resultado${masa !== null ? '' : escrito ? ' error' : ' pendiente'}`;
      poner(pm, masa !== null ? h('span', { class: 'resultado-valor', text: `${Q.numero(masa)} g/mol` })
        : h('span', { text: escrito ? 'No entiendo esa fórmula: escríbela con sus mayúsculas y minúsculas (NaCl, no nacl)' : 'Escribe una fórmula' }));
    };

    poner(cuerpo,
      prellenado && h('div', { class: 'avisos', text: `🧪 Con los números de «${prellenado.desde}». Lo que cambies aquí no cambia la receta ni se guarda.` }),
      h('h3', { text: '¿Qué quieres calcular?' }),
      tarjetas,
      zona,
      h('h3', { text: '🧪 Peso molecular de una fórmula' }),
      formula,
      pm,
      h('p', { class: 'nota', text: 'Son las mismas fórmulas que usan las recetas. Los hidratos se escriben con un punto: CuSO4·5H2O o CuSO4.5H2O.' }));
    pintarZona();
    pintarPM();
  };

  // ─── Mantener pulsado y arrastrar, para cambiar de sitio los grupos (y de carpeta) ───
  // Un toque normal hace lo de siempre, y deslizar el dedo sin esperar mueve la pantalla. Con el
  // dedo quieto medio segundo, vibra y la tarjeta sigue al dedo, también a otra lista de la caja
  // (otra carpeta: encima de una tarjeta, se pone antes o después; encima del título o del hueco de
  // una carpeta, al final de su lista). Cerca del borde de arriba o de abajo, la pantalla se mueve.
  // En la caja: listas con data-lista (su valor: la carpeta, o '' sin carpeta), dentro de una zona
  // data-zona (la carpeta entera, con su título); las tarjetas, hijas directas de una lista, con data-id.
  // Al soltar: alSoltar([{ lista, ids }]), todas las listas en orden
  // rejilla (versión 135, las fotos de un informe): las tarjetas van en filas de varias; antes o después
  // se decide por la mitad de izquierda a derecha (si no, por la de arriba abajo)
  const mantenerYArrastrar = (caja, alSoltar, { rejilla = false } = {}) => {
    let reloj = null;
    let tarjeta = null;
    let arrastrando = false;
    let inicio = null;
    let dedo = null;
    let ignorarClic = false;
    const scroller = () => caja.closest('.panel-cuerpo');
    // Mientras se arrastra, el dedo no mueve la pantalla
    const sinDesplazar = (e) => { if (arrastrando) e.preventDefault(); };
    const mover = (e) => {
      if (e.pointerId !== dedo) return;
      if (!arrastrando) {
        // Se ha movido antes de tiempo: es para mover la pantalla, no para arrastrar
        if (Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 10) terminar();
        return;
      }
      const s = scroller();
      if (s) {
        const r = s.getBoundingClientRect();
        if (e.clientY < r.top + 50) s.scrollTop -= 12;
        else if (e.clientY > r.bottom - 50) s.scrollTop += 12;
      }
      const bajo = document.elementFromPoint(e.clientX, e.clientY);
      if (!bajo || !caja.contains(bajo)) return;
      const otra = bajo.closest('[data-id]');
      if (otra && otra !== tarjeta && otra.parentNode.hasAttribute('data-lista')) {
        const r = otra.getBoundingClientRect();
        const despues = rejilla ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        otra.parentNode.insertBefore(tarjeta, despues ? otra.nextSibling : otra);
        return;
      }
      if (otra) return;
      const zona = bajo.closest('[data-zona]');
      const lista = zona ? zona.querySelector('[data-lista]') : bajo.closest('[data-lista]');
      if (lista && tarjeta.parentNode !== lista) lista.append(tarjeta);
    };
    const soltar = (e) => { if (e.pointerId === dedo) terminar(); };
    const terminar = () => {
      clearTimeout(reloj);
      document.removeEventListener('pointermove', mover);
      document.removeEventListener('pointerup', soltar);
      document.removeEventListener('pointercancel', soltar);
      document.removeEventListener('touchmove', sinDesplazar);
      dedo = null;
      if (!arrastrando) return;
      arrastrando = false;
      if (rejilla) for (const l of caja.querySelectorAll('[data-lista]')) l.style.minHeight = '';
      tarjeta.classList.remove('arrastrando');
      caja.classList.remove('arrastrando-dentro');
      // El toque con el que se suelta no abre la tarjeta
      ignorarClic = true;
      setTimeout(() => { ignorarClic = false; }, 400);
      alSoltar([...caja.querySelectorAll('[data-lista]')].map((l) => ({
        lista: l.dataset.lista, ids: [...l.children].map((x) => x.dataset.id).filter(Boolean) })));
    };
    caja.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('[data-id]');
      // (mantener pulsado un texto que se escribe es para escribir o seleccionar, no para arrastrar)
      if (e.target.closest('.escribible')) return;
      if (!t || !caja.contains(t) || !t.parentNode.hasAttribute('data-lista') || dedo !== null) return;
      tarjeta = t;
      inicio = { x: e.clientX, y: e.clientY };
      dedo = e.pointerId;
      document.addEventListener('pointermove', mover);
      document.addEventListener('pointerup', soltar);
      document.addEventListener('pointercancel', soltar);
      document.addEventListener('touchmove', sinDesplazar, { passive: false });
      reloj = setTimeout(() => {
        arrastrando = true;
        // (en una rejilla —las fotos del informe—, cada lista guarda su alto mientras se arrastra: si no, al pasar
        // una foto de una figura a otra todo se movía bajo el dedo y se soltaba un sitio más allá; versión 145)
        if (rejilla) for (const l of caja.querySelectorAll('[data-lista]')) l.style.minHeight = `${l.offsetHeight}px`;
        tarjeta.classList.add('arrastrando');
        // (mientras, las carpetas vacías enseñan dónde se puede soltar)
        caja.classList.add('arrastrando-dentro');
        vibrar(25);
      }, 450);
    });
    caja.addEventListener('click', (e) => { if (ignorarClic) { e.stopPropagation(); e.preventDefault(); } }, true);
    // (en el móvil, mantener pulsado sacaría el menú de copiar)
    caja.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-id]')) e.preventDefault(); });
  };

  // ─── El cuaderno (📓 de la cabecera): un cuaderno por receta ───
  // Primero las recetas, con lo que lleva apuntado cada una; al tocar una, su cuaderno
  // ─── Las notas libres de un cuaderno: un panel que sale por la derecha ───
  // Lo pidió el usuario: «al entrar en un cuaderno, un desplegable a la derecha con la parte de
  // notas para escribir». Un texto largo, que se guarda solo (en la ficha del cuaderno: notas)
  const abrirNotas = (cid, recetaId) => {
    const ficha = K.fichaCuaderno(leerCuaderno(), { cuadernoId: cid, recetaId });
    const area = h('textarea', { class: 'notas-texto', value: ficha.notas || '', autocapitalize: 'sentences', placeholder: 'Escribe aquí lo que quieras: ideas, dudas, cálculos, cosas que mirar…' });
    const estado = h('small', { class: 'notas-estado', text: ficha.notas ? 'Se guarda solo' : '' });
    let reloj = null;
    const guardarNotas = () => {
      clearTimeout(reloj);
      reloj = null;
      cambiarCuaderno((d) => {
        let x = d.cuadernos.find((y) => y.id === cid);
        // (el Cuaderno 1 de una receta no tiene ficha hasta que se le escribe algo)
        if (!x) { x = { id: cid, recetaId: recetaId || null, nombre: ficha.nombre, fecha: 0 }; d.cuadernos.push(x); }
        x.notas = area.value;
      });
      estado.textContent = '✓ Guardado';
    };
    area.addEventListener('input', () => {
      estado.textContent = 'Guardando…';
      clearTimeout(reloj);
      reloj = setTimeout(guardarNotas, 700);
    });
    const fondo = h('div', { class: 'cajon-fondo', onclick: (e) => { if (e.target === fondo) atras(); } },
      h('aside', { class: 'cajon' },
        h('div', { class: 'cajon-cabecera' },
          h('div', { class: 'cajon-titulo' }, h('b', { text: '📝 Notas' }), h('small', { text: ficha.nombre })),
          h('button', { class: 'icono', 'aria-label': 'Cerrar las notas', text: '✕', onclick: atras })),
        area, estado));
    document.body.append(fondo);
    // Al cerrarlo, se guarda lo que quedara por guardar
    abrirCapa(fondo, () => { if (reloj) guardarNotas(); });
    requestAnimationFrame(() => fondo.classList.add('abierto'));
  };

  // El nombre de una receta (o el que se copió en lo apuntado, si se borró)
  const nombreDeReceta = (c, rid) => {
    const r = recetaDe(rid);
    if (r) return r.nombre;
    const e = c.entradas.find((x) => x.recetaId === rid && x.receta);
    return e ? `${e.receta} (borrada)` : 'Receta borrada';
  };
  // Crear un cuaderno (k null) o cambiar uno: nombre, con qué receta va (o ninguna) y una nota.
  // recetaInicial: la que se propone al crear. Devuelve su id, 'quitado', o null si se cancela.
  // El Cuaderno 1 de una receta no cambia de receta; uno vacío (que no sea ese) se puede quitar
  // Una foto del almacén de fotos, para ponerla donde sea (usa urlDe, que ya la guarda en memoria)
  const imagenFoto = (id) => {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    urlMini(id).then((u) => { if (u) img.src = u; else img.alt = '(foto borrada)'; }).catch(() => {});
    return img;
  };
  const editarFichaCuaderno = async (k, recetaInicial) => {
    const c = leerCuaderno();
    const esPrincipal = Boolean(k && k.recetaId && k.id === K.principal(k.recetaId));
    const amb = k && K.ambito(k.recetaId || null, k.id);
    const tieneAlgo = Boolean(k && c.grupos.concat(c.entradas, c.disoluciones, c.carpetas).some((x) => K.casa(x, amb)));
    const nombre = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', value: k ? k.nombre : `Cuaderno ${K.todosLosCuadernos(c).length + 1}`, placeholder: 'Por ejemplo: Noviembre, o Con 3 ciclos' });
    const actual = k ? k.recetaId || '' : recetaInicial || '';
    const receta = h('select', { class: 'campo', disabled: esPrincipal },
      h('option', { value: '', text: 'Sin receta (solo notas)', selected: actual === '' }),
      recetas.map((r) => h('option', { value: r.id, text: r.nombre, selected: r.id === actual })));
    const nota = h('textarea', { class: 'campo', rows: 2, autocapitalize: 'sentences', value: k ? k.nota || '' : '', placeholder: 'De qué va (si quieres): qué cambia en este experimento…' });
    // La foto del cuaderno (versión 121, lo pidió el usuario): un recuadro a la derecha en la lista de
    // cuadernos. Se guarda como cualquier foto (así pasa también al PC) y su id va en la ficha (`foto`)
    let foto = k ? k.foto || null : null;
    const fotoDeAntes = foto;
    const subidas = [];
    const vistaFoto = h('div', { class: 'foto-cuaderno-ficha' });
    const archivoFoto = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const a = archivoFoto.files && archivoFoto.files[0];
      archivoFoto.value = '';
      if (!a) return;
      try {
        const f = await window.Fotos.convertir(a);
        await window.Fotos.guardar(f);
        subidas.push(f.id);
        foto = f.id;
        pintarFoto();
      } catch { avisar('No se ha podido leer esa foto'); }
    } });
    const pintarFoto = () => {
      poner(vistaFoto,
        foto ? imagenFoto(foto) : h('small', { class: 'nota', text: 'Sin foto' }),
        h('div', { class: 'foto-cuaderno-botones' },
          h('button', { class: 'boton secundario', type: 'button', text: foto ? '📷 Cambiar la foto' : '📷 Poner una foto', onclick: () => archivoFoto.click() }),
          foto && h('button', { class: 'boton discreto', type: 'button', text: 'Quitar', onclick: () => { foto = null; pintarFoto(); } })));
    };
    pintarFoto();
    const soltarSubidas = (conservar) => { for (const id of subidas) if (id !== conservar) window.Fotos.borrar(id).catch(() => {}); };
    const r = await preguntar({ texto: k ? '📓 Cambiar el cuaderno' : '📓 Nuevo cuaderno', detalle: [
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre' }), nombre),
      h('div', { class: 'etiqueta-campo' }, h('span', { text: 'Foto (se ve a la derecha en la lista de cuadernos)' }), vistaFoto, archivoFoto),
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Va con la receta' }), receta),
      esPrincipal && h('p', { class: 'dialogo-detalle', text: 'Es el cuaderno de siempre de esta receta: su receta no se cambia.' }),
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'De qué va' }), nota),
      !k && h('p', { class: 'dialogo-detalle', text: 'Empieza vacío. La receta se le puede poner o cambiar después con ✏️.' })],
    si: k ? 'Guardar' : 'Crear', no: 'Cancelar', otro: k && !esPrincipal && !tieneAlgo ? '🗑️ Quitar este cuaderno (está vacío)' : null });
    if (r === 'otro') {
      cambiarCuaderno((d) => { d.cuadernos = d.cuadernos.filter((x) => x.id !== k.id); });
      soltarSubidas(null);
      if (fotoDeAntes) window.Fotos.borrar(fotoDeAntes).catch(() => {});
      return 'quitado';
    }
    if (!r || !nombre.value.trim()) { soltarSubidas(fotoDeAntes); return null; }
    const nuevaReceta = esPrincipal ? k.recetaId : receta.value || null;
    const cambiaReceta = k && !esPrincipal && (k.recetaId || null) !== nuevaReceta;
    if (cambiaReceta && c.grupos.some((g) => K.casa(g, amb))
      && !await preguntar({ texto: '¿Cambiar la receta del cuaderno?', detalle: 'Sus grupos de muestras siguen las fases de la receta: con otra, sus fases pueden no cuadrar.', si: 'Cambiar', no: 'Cancelar' })) { soltarSubidas(fotoDeAntes); return null; }
    const id = k ? k.id : idDe('n');
    cambiarCuaderno((d) => {
      let x = d.cuadernos.find((y) => y.id === id);
      // (el Cuaderno 1 de una receta no tiene ficha hasta que se le cambia algo)
      if (!x) { x = { id, recetaId: k ? k.recetaId : nuevaReceta, fecha: k ? 0 : Date.now() }; d.cuadernos.push(x); }
      x.nombre = nombre.value.trim().slice(0, 60);
      x.nota = nota.value.trim();
      if (foto) x.foto = foto; else delete x.foto;
      if (cambiaReceta) {
        // Lo suyo pasa a ser de esa receta
        x.recetaId = nuevaReceta;
        for (const y of [...d.grupos, ...d.entradas, ...d.disoluciones, ...d.carpetas, ...d.albumes, ...(d.informes || [])]) {
          if (y.cuadernoId !== id) continue;
          y.recetaId = nuevaReceta;
          if ('receta' in y) y.receta = nuevaReceta ? nombreDeReceta(d, nuevaReceta) : null;
        }
      }
    });
    // (las fotos que ya no se usan: las subidas y cambiadas aquí, y la de antes si se quitó o se cambió)
    soltarSubidas(foto);
    if (fotoDeAntes && fotoDeAntes !== foto) window.Fotos.borrar(fotoDeAntes).catch(() => {});
    return id;
  };

  // ─── La pantalla principal: los cuadernos ───
  // Todos: los creados (con o sin receta) y el de cada receta que tenga algo, lo último usado arriba
  // (en la app de internet conectada al PC: «💻 Tienes cambios sin pasar al PC»; se pone más abajo)
  let avisoPendientePC = () => null;
  // Lo escrito en «Buscar en todos los cuadernos» (versión 114): se recuerda mientras la app está abierta
  let busquedaGlobal = '';
  const pintarCuadernos = () => {
    const caja = $('vista-cuadernos');
    const c = leerCuaderno();
    const lista = K.todosLosCuadernos(c);
    // Los resultados de buscar en TODOS los cuadernos: al tocar uno, se abre su cuaderno ya buscado
    const resultados = h('div', { class: 'resultados-globales' });
    const tarjetas = h('div', { class: 'lista-cuadernos' });
    const verBusqueda = () => {
      const q = busquedaGlobal.trim();
      tarjetas.hidden = Boolean(q);
      if (!q) { poner(resultados); return; }
      const todos = K.buscar(c, c.entradas, q).sort((a, b) => b.fecha - a.fecha);
      const vistos = todos.slice(0, 60);
      poner(resultados,
        h('p', { class: 'nota resultado-busqueda', text: todos.length ? `🔎 ${todos.length} ${todos.length === 1 ? 'apunte dice' : 'apuntes dicen'} «${q}» en todos los cuadernos${todos.length > vistos.length ? ` (los ${vistos.length} más nuevos)` : ''}` : `🔎 Ningún apunte de ningún cuaderno dice «${q}»` }),
        vistos.map((e) => {
          const cid = K.cuadernoDe(e);
          const ficha = K.fichaCuaderno(c, K.ambito(e.recetaId || null, cid));
          return h('button', { class: 'tarjeta resultado-global', onclick: () => abrirCuadernoDe(cid, e.recetaId || null, pintarCuadernos, q) },
            h('b', { text: K.titularDe(conNombresDeAhora(c, e)) }),
            h('small', { text: `📓 ${ficha.nombre}${e.grupo ? ` · 🧫 ${e.grupo}` : ''} · ${fechaCorta(e.fecha)}` }),
            e.distinto && h('small', { class: 'entrada-distinto', text: `⚠️ ${e.distinto}` }),
            e.nota && h('span', { class: 'entrada-nota', text: e.nota.length > 140 ? `${e.nota.slice(0, 140)}…` : e.nota }));
        }));
    };
    const buscador = lista.length > 0 && c.entradas.length > 0 && h('input', { class: 'campo buscar-todos', type: 'search', value: busquedaGlobal, enterkeyhint: 'search',
      placeholder: '🔎 Buscar en todos los cuadernos: SEM, grupo B…', 'aria-label': 'Buscar en todos los cuadernos',
      oninput: (e) => { busquedaGlobal = e.target.value; verBusqueda(); } });
    // Arriba, lo que les toca hoy o mañana a los grupos (o ya se pasó)
    poner(tarjetas, lista.length
      ? lista.map((x) => h('button', { class: `tarjeta cuaderno-tarjeta${x.ficha.foto ? ' con-foto' : ''}`, onclick: () => abrirCuadernoDe(x.ambito.cuadernoId, x.ambito.recetaId, pintarCuadernos) },
        x.ficha.foto && h('div', { class: 'cuaderno-foto' }, imagenFoto(x.ficha.foto)),
        h('h3', { text: `📓 ${x.ficha.nombre}` }),
        h('p', { text: x.ambito.recetaId ? `📋 ${nombreDeReceta(c, x.ambito.recetaId)}` : 'Sin receta (solo notas)' }),
        h('p', { class: 'meta', text: [x.grupos && `🧫 ${x.grupos} ${x.grupos === 1 ? 'grupo' : 'grupos'}`, x.entradas && `📖 ${x.entradas} ${x.entradas === 1 ? 'apunte' : 'apuntes'}`, x.ultima && `último: ${fechaCorta(x.ultima)}`].filter(Boolean).join(' · ') || 'Nada apuntado todavía' })))
      : h('div', { id: 'vacio-cuadernos' },
        h('p', { class: 'vacio-dibujo', text: '📓' }),
        h('p', { text: 'Aún no hay ningún cuaderno.' }),
        h('p', { class: 'nota', text: 'Cada cuaderno es un experimento: sus grupos de muestras, sus disoluciones, sus fotos y lo que vas apuntando. Crea uno con «＋ Nuevo cuaderno», o abre una receta (📋, arriba) y pulsa «🏁 Terminar fase»: se apunta en su cuaderno.' })));
    poner(caja, avisoPendientePC(), avisosDeToca(c, null, pintarCuadernos), buscador, resultados, tarjetas);
    pintarLateral();
    verBusqueda();
  };
  const nuevoCuaderno = async () => {
    const id = await editarFichaCuaderno(null, null);
    if (!id || id === 'quitado') return;
    pintarCuadernos();
    const k = K.fichaCuaderno(leerCuaderno(), { cuadernoId: id });
    abrirCuadernoDe(id, k.recetaId || null, pintarCuadernos);
  };
  // Las dos vistas de la pantalla principal: los cuadernos (al abrir) y las recetas (con 📋). Ver
  // las recetas apunta un paso en el historial, para que «atrás» vuelva a los cuadernos
  let vista = 'cuadernos';
  const ponerVista = (v) => {
    vista = v;
    $('vista-cuadernos').hidden = v !== 'cuadernos';
    $('vista-recetas').hidden = v !== 'recetas';
    $('b-recetas').hidden = v === 'recetas';
    $('b-cuaderno').hidden = v !== 'recetas';
    $('titulo-principal').textContent = v === 'recetas' ? '📋 Recetas' : '📓 Cuadernos';
    $('b-nueva').textContent = v === 'recetas' ? '＋ Nueva receta' : '＋ Nuevo cuaderno';
    if (v === 'cuadernos') pintarCuadernos();
    $('principal').scrollTop = 0;
    pintarLateral();
  };
  const verRecetas = () => {
    if (vista === 'recetas') return;
    const marca = h('span', { hidden: true });
    document.body.append(marca);
    abrirCapa(marca, () => ponerVista('cuadernos'));
    ponerVista('recetas');
  };

  // Tocar un apunte (en la bitácora, o en Fotos con ✏️): cambiar su nota, su fecha, sus fotos y sus
  // apartados, sus muestras, sus disoluciones… alCambiar: para repintar después
  const editarApunte = async (e, alCambiar) => {
    const local = new Date(e.fecha - new Date(e.fecha).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const cuando = h('input', { class: 'campo', type: 'datetime-local', value: local });
    // Si unas muestras pasaron por una fase, se pueden marcar (o cambiar) sus disoluciones
    const receta = (e.tipo === 'fase' || e.tipo === 'empezar') && e.recetaId && recetaDe(e.recetaId);
    const dis = receta && elegirDisoluciones(leerCuaderno(), receta, e.fase, (e.disoluciones || []).map((x) => x.id), ambitoDe(e));
    // Cuántas muestras pasaron por la fase (lo apuntado entonces; el grupo no cambia)
    const conMuestras = e.tipo === 'empezar' || e.tipo === 'fase';
    const muestras = conMuestras && h('input', { class: 'campo', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Nº de muestras (si quieres)', value: e.muestras == null ? '' : String(e.muestras) });
    // Al separar: cuántas pasaron al grupo nuevo (al cambiarlo, cambian también los dos grupos)
    const pasan = e.tipo === 'separar' && h('input', { class: 'campo', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: e.cuantas == null ? '' : String(e.cuantas) });
    // Una medida: sus filas se corrigen aquí (nombre, valor, unidad)
    const distintoEd = (e.tipo === 'fase' || e.tipo === 'preparar' || e.distinto) && campoDistinto(e.distinto || '');
    const medidasEd = e.tipo === 'medida' && editorMedidas(Array.isArray(e.medidas) ? e.medidas : [], leerCuaderno());
    // Sus fotos: se quitan con ✕ y se añaden otras, y se reparten en apartados con título (lo pidió
    // el usuario: «ordenar las fotos en grupos y ponerles título», que luego se ve en Fotos). Todo se
    // guarda al dar a Guardar. Cada apartado lleva una clave suya (k) para poder cambiarle el título
    let quedan = [...(e.fotos || [])];
    let aparts = K.apartadosDe(e, true).filter((a) => a.titulo).map((a) => ({ k: idDe('a'), titulo: a.titulo }));
    const enAp = new Map(quedan.map((id) => { const a = aparts.find((x) => x.titulo === K.infoFoto(e, id).apartado); return [id, a ? a.k : '']; }));
    const cajaFotos = h('div', { class: 'apartados-editor' });
    const miniatura = (id) => {
      const img = h('img', { alt: 'Foto', loading: 'lazy', decoding: 'async' });
      urlMini(id).then((u) => { if (u) img.src = u; else img.alt = '(foto borrada)'; }).catch(() => {});
      return h('span', { class: 'miniatura con-apartado' }, img,
        h('button', { class: 'quitar-foto', type: 'button', 'aria-label': 'Quitar la foto', text: '✕', onclick: () => { quedan = quedan.filter((x) => x !== id); pintarFotos(); } }),
        aparts.length > 0 && h('select', { class: 'mover-foto', 'aria-label': 'Apartado de la foto', onchange: (ev) => { enAp.set(id, ev.target.value); pintarFotos(); } },
          h('option', { value: '', text: 'Sin apartado', selected: !enAp.get(id) }),
          aparts.map((a) => h('option', { value: a.k, text: a.titulo || '(sin título)', selected: enAp.get(id) === a.k }))));
    };
    const pintarFotos = () => {
      const sueltas = quedan.filter((id) => !aparts.some((a) => a.k === enAp.get(id)));
      poner(cajaFotos,
        aparts.map((a) => h('div', { class: 'apartado-editor' },
          h('div', { class: 'apartado-cabecera' },
            h('input', { class: 'campo', value: a.titulo, placeholder: 'Título: vista general, detalle del borde…', autocapitalize: 'sentences', oninput: (ev) => {
              a.titulo = ev.target.value;
              // (y en el desplegable de cada foto, al momento)
              for (const o of cajaFotos.querySelectorAll('.mover-foto option')) if (o.value === a.k) o.textContent = a.titulo || '(sin título)';
            }, onchange: pintarFotos }),
            h('button', { class: 'icono pequeno', type: 'button', 'aria-label': 'Quitar el apartado (sus fotos se quedan sin apartado)', text: '✕', onclick: () => { aparts = aparts.filter((x) => x !== a); pintarFotos(); } })),
          h('div', { class: 'miniaturas' }, quedan.filter((id) => enAp.get(id) === a.k).map(miniatura)))),
        sueltas.length > 0 && [aparts.length > 0 && h('p', { class: 'dialogo-detalle', text: 'Sin apartado (elige uno debajo de cada foto)' }), h('div', { class: 'miniaturas' }, sueltas.map(miniatura))],
        quedan.length > 0 && h('button', { class: 'boton secundario', type: 'button', text: '📂 Nuevo apartado de fotos', onclick: () => {
          aparts.push({ k: idDe('a'), titulo: '' });
          pintarFotos();
          const campos = cajaFotos.querySelectorAll('.apartado-cabecera input');
          if (campos.length) campos[campos.length - 1].focus();
        } }));
    };
    pintarFotos();
    const nuevas = selectorFotos();
    const nota = await preguntar({ texto: K.titularDe(e),
      detalle: [h('label', { class: 'etiqueta-campo' }, h('span', { text: e.aprox ? 'Fecha y hora (por confirmar: pon la de verdad)' : 'Fecha y hora' }), cuando),
        muestras && h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nº de muestras' }), muestras),
        pasan && h('label', { class: 'etiqueta-campo' }, h('span', { text: `Muestras que pasan a «${e.nuevo}»` }), pasan),
        pasan && h('p', { class: 'nota', text: `Si lo cambias, cambia también cuántas tiene cada grupo (las que no pasan se quedan en «${e.grupo}»).` }),
        medidasEd && medidasEd.el,
        distintoEd && distintoEd.el,
        dis && dis.el, cajaFotos, nuevas.el],
      campo: { filas: 3, value: e.nota || '', placeholder: 'Nota', autocapitalize: 'sentences' }, si: 'Guardar', no: 'Cancelar' });
    if (nota === null) return;
    const fotosNuevas = await nuevas.guardar();
    const quitadas = (e.fotos || []).filter((id) => !quedan.includes(id));
    const n = muestras ? Q.aNumero(muestras.value) : null;
    const fecha = new Date(cuando.value).getTime();
    cambiarCuaderno((c) => {
      const x = c.entradas.find((y) => y.id === e.id);
      if (!x) return;
      x.nota = nota.trim();
      if (muestras) { if (n > 0) x.muestras = Math.round(n); else delete x.muestras; }
      if (medidasEd) { const v = medidasEd.valores(); if (v.length) x.medidas = v; }
      if (distintoEd) { const v = distintoEd.valor(); if (v) x.distinto = v; else delete x.distinto; }
      const m = pasan ? Math.round(Q.aNumero(pasan.value)) : null;
      if (pasan && m >= 1 && m !== x.cuantas) {
        const dif = m - (x.cuantas || 0);
        const de = K.grupoDe(c, x.grupoId);
        const a = K.grupoDe(c, x.nuevoId);
        if (de && de.muestras != null) de.muestras = Math.max(0, de.muestras - dif);
        if (a && a.muestras != null) a.muestras = Math.max(0, a.muestras + dif);
        x.cuantas = m;
      }
      const fotos = [...quedan, ...fotosNuevas];
      if (fotos.length) x.fotos = fotos; else delete x.fotos;
      for (const id of quitadas) delete c.titulos[id];
      // Los apartados: sus títulos (sin repetir ni vacíos) y el de cada foto
      const titulos = [...new Set(aparts.map((a) => a.titulo.trim().slice(0, 60)).filter(Boolean))];
      if (titulos.length) x.apartados = titulos; else delete x.apartados;
      const info = { ...(x.fotosInfo || {}) };
      for (const id of Object.keys(info)) if (!fotos.includes(id)) delete info[id];
      for (const id of fotos) {
        const a = aparts.find((y) => y.k === enAp.get(id));
        const t = a ? a.titulo.trim().slice(0, 60) : '';
        const n2 = { ...(info[id] || {}) };
        if (t && titulos.includes(t)) n2.apartado = t; else delete n2.apartado;
        if (Object.keys(n2).length) info[id] = n2; else delete info[id];
      }
      if (Object.keys(info).length) x.fotosInfo = info; else delete x.fotosInfo;
      if (dis) {
        const usadas = dis.elegidas();
        if (usadas.length) x.disoluciones = usadas; else delete x.disoluciones;
      }
      if (Number.isFinite(fecha) && cuando.value !== local) {
        x.fecha = fecha;
        delete x.aprox;
        // Si es una separación, el grupo nuevo hereda la historia hasta la fecha nueva
        const nuevo = x.tipo === 'separar' && K.grupoDe(c, x.nuevoId);
        if (nuevo) nuevo.desde = fecha;
        // Si es la de preparar una disolución, la disolución pasa a estar preparada ese día
        const d = x.tipo === 'preparar' && K.disolucionDe(c, x.disolucionId);
        if (d) d.fecha = fecha;
        // Al juntar dos grupos hay dos apuntes (uno en cada grupo): se mueven los dos
        if (x.tipo === 'juntar' || x.tipo === 'recibir') {
          const otro = c.entradas.find((y) => y.fecha === e.fecha && (x.tipo === 'juntar'
            ? y.tipo === 'recibir' && y.grupoId === x.nuevoId && y.desdeId === x.grupoId
            : y.tipo === 'juntar' && y.grupoId === x.desdeId && y.nuevoId === x.grupoId));
          if (otro) otro.fecha = fecha;
          const de = K.grupoDe(c, x.tipo === 'juntar' ? x.grupoId : x.desdeId);
          if (de && de.juntadoEn) de.juntadoDesde = fecha;
        }
        // Lo mismo al pasar muestras a otro cuaderno: la salida, la llegada y las marcas de los dos grupos
        if (x.tipo === 'pasar' || x.tipo === 'llegar') {
          const otro = c.entradas.find((y) => y.fecha === e.fecha && (x.tipo === 'pasar'
            ? y.tipo === 'llegar' && y.grupoId === x.nuevoId && y.desdeId === x.grupoId
            : y.tipo === 'pasar' && y.grupoId === x.desdeId && y.nuevoId === x.grupoId));
          if (otro) otro.fecha = fecha;
          const origen = K.grupoDe(c, x.tipo === 'pasar' ? x.grupoId : x.desdeId);
          const llegado = K.grupoDe(c, x.tipo === 'pasar' ? x.nuevoId : x.grupoId);
          if (origen && origen.pasadoA === (llegado && llegado.id)) origen.pasadoDesde = fecha;
          if (llegado) llegado.vieneDesde = fecha;
        }
      }
    });
    if (dis) dis.guardar();
    for (const id of quitadas) window.Fotos.borrar(id).catch(() => {});
    alCambiar();
  };
  // Un apunte con los grupos que nombra (separar, juntar) con su nombre de ahora, por si se les cambió
  const conNombresDeAhora = (c, e) => {
    const n = e.nuevoId && K.grupoDe(c, e.nuevoId);
    const d = (e.tipo === 'recibir' || e.tipo === 'llegar') && e.desdeId && K.grupoDe(c, e.desdeId);
    return n || d ? { ...e, ...(n ? { nuevo: n.nombre } : {}), ...(d ? { desde: d.nombre } : {}) } : e;
  };
  // La bitácora: las entradas por días, lo último arriba. desde: el grupo que se está mirando
  // (lo heredado de otro grupo sale con su nombre); alCambiar: para repintar tras cambiar o borrar
  const bitacora = (entradas, { desde, alCambiar } = {}) => {
    const dias = [];
    // Los grupos que se nombran (separar, juntar), con su nombre de ahora (por si se les cambió)
    const hoy = leerCuaderno();
    const conNombres = (e) => conNombresDeAhora(hoy, e);
    for (const e of entradas.map(conNombres).sort((a, b) => b.fecha - a.fecha)) {
      const dia = diaDe(e.fecha);
      if (!dias.length || dias[dias.length - 1].dia !== dia) dias.push({ dia, lista: [] });
      dias[dias.length - 1].lista.push(e);
    }
    const cambiarNota = (e) => editarApunte(e, alCambiar);
    const borrarEntrada = async (e) => {
      const avisoMas = e.tipo === 'separar' ? ' El grupo nuevo se queda (si quieres, quítalo aparte).' : '';
      if (!await preguntar({ texto: '¿Borrar esto de la bitácora?', detalle: `${K.titularDe(e)}${e.fotos ? ` (y sus ${e.fotos.length} fotos)` : ''}.${avisoMas}`, si: 'Borrar', peligro: true })) return;
      quitarEntrada(e.id);
      alCambiar();
    };
    const fila = (e) => h('div', { class: `entrada${desde && e.grupoId !== desde ? ' heredada' : ''}` },
      h('span', { class: 'entrada-hora', text: horaDe(e.fecha) }),
      h('div', { class: 'entrada-texto' },
        h('button', { class: 'entrada-tocar', onclick: () => cambiarNota(e) },
          h('b', { text: K.titularDe(e) }),
          e.grupo && (!desde || e.grupoId !== desde) && h('small', { text: `🧫 ${e.grupo}` }),
          e.evento && (() => {
            const otros = hoy.entradas.filter((x) => x.evento === e.evento && x.id !== e.id).map((x) => x.grupo).filter(Boolean);
            return otros.length > 0 && h('small', { text: `👥 A la vez que ${otros.join(', ')}` });
          })(),
          e.disoluciones && e.disoluciones.length > 0 && h('small', { text: `🧪 con ${e.disoluciones.map((x) => x.nombre).join(', ')}` }),
          e.tipo === 'nota' && e.disolucion && h('small', { text: `🧪 ${e.disolucion}` }),
          e.distinto && h('small', { class: 'entrada-distinto', text: `⚠️ Distinto a la receta: ${e.distinto}` }),
          e.tipo === 'comparar' && (e.de || []).length > 0 && h('small', { text: `De: ${e.de.join(', ')}` }),
          e.aprox && h('small', { class: 'por-confirmar', text: '📅 Fecha por confirmar: toca para cambiarla' }),
          e.nota && h('span', { class: 'entrada-nota', text: e.nota })),
        // Las fotos que se compararon (no son suyas: solo enlazadas)
        e.tipo === 'comparar' && miniaturas(e.comparadas),
        // Sus fotos, repartidas en sus apartados (si los tiene)
        (e.apartados || []).length
          ? K.apartadosDe(e).map((a) => [h('small', { class: 'entrada-apartado', text: a.titulo ? `📂 ${a.titulo}` : 'Sin apartado' }), miniaturas(a.fotos)])
          : miniaturas(e.fotos)),
      h('button', { class: 'icono pequeno', 'aria-label': 'Borrar', text: '🗑️', onclick: () => borrarEntrada(e) }));
    return dias.map((d) => h('div', { class: 'caja bitacora' }, h('div', { class: 'fase', text: d.dia }), d.lista.map(fila)));
  };
  // La bitácora en texto, de lo más antiguo a lo más nuevo, para pegarla en un correo o una nota
  const bitacoraEnTexto = (titulo, entradas) => {
    const lineas = [titulo.toUpperCase()];
    let dia = null;
    for (const e of [...entradas].sort((a, b) => a.fecha - b.fecha)) {
      const d = diaDe(e.fecha);
      if (d !== dia) { lineas.push('', d); dia = d; }
      lineas.push(`${horaDe(e.fecha)}  ${[e.grupo, K.titularDe(e), e.disoluciones && e.disoluciones.length && `con ${e.disoluciones.map((x) => x.nombre).join(', ')}`, e.tipo === 'nota' && e.disolucion].filter(Boolean).join(' · ')}${e.fotos ? ` (📷 ${e.fotos.length})` : ''}`);
      if (e.distinto) lineas.push(`       ⚠️ Distinto a la receta: ${e.distinto}`);
      if (e.nota) lineas.push(`       ${e.nota}`);
    }
    return lineas.join('\n');
  };
  const botonCopiar = (titulo, entradas) => entradas.length > 0 && h('button', { class: 'boton secundario', text: '📋 Copiar la bitácora como texto', onclick: async () => {
    try { await navigator.clipboard.writeText(bitacoraEnTexto(titulo, entradas)); avisar('Copiada: pégala donde quieras'); } catch { avisar('No se ha podido copiar'); }
  } });

  // ─── El árbol de las muestras (lo dibujó el usuario) ───
  // Hacia abajo, las fases (a la izquierda); cada grupo, una línea vertical de su color que baja
  // hasta por dónde va; cada separación, una rama desde el grupo del que salió, a la altura a la que
  // iba entonces. Al final de cada línea, una raya y el nombre (✅ terminado, ▶ en una fase).
  // Un trozo para analizar es un puntito en su línea. Tocar un grupo lo abre. abrir(grupoId)
  const SVG = 'http://www.w3.org/2000/svg';
  const s = (etiqueta, attrs, ...hijos) => {
    const el = document.createElementNS(SVG, etiqueta);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
    for (const x of hijos.flat(Infinity)) if (x != null && x !== false) el.append(x);
    return el;
  };
  const COLORES_GRUPO = ['#3949ab', '#e53935', '#00897b', '#f9a825', '#8e24aa', '#6d4c41', '#039be5', '#7cb342', '#d81b60', '#546e7a'];
  // El color de un grupo que llegó de otro cuaderno es el que tenía allí (lo pidió el usuario: «no se
  // pasaron los colores»); prof corta las cadenas largas. Sin árbol (cuaderno sin fases), los grupos
  // llevan color igual (coloresSinArbol)
  const colorHeredado = (c, g, prof) => {
    const o = g.vieneDe && prof < 4 ? K.grupoDe(c, g.vieneDe) : null;
    if (!o) return null;
    const receta = recetaDe(o.recetaId) || { id: o.recetaId || null, nombre: '', pasos: [], datos: [], calculos: [] };
    const a = arbolDeMuestras(c, receta, () => {}, ambitoDe(o), prof + 1);
    return (a ? a.colores : coloresSinArbol(c, ambitoDe(o), prof + 1)).get(o.id) || null;
  };
  // Los colores en el orden de siempre; los que llegaron de otro cuaderno, con el suyo, y a los demás
  // se les da el primero de la paleta que no esté ya en uso
  const asignarColores = (c, lista, prof) => {
    const mapa = new Map();
    for (const g of lista) { const k = colorHeredado(c, g, prof); if (k) mapa.set(g.id, k); }
    const usados = new Set(mapa.values());
    let i = 0;
    for (const g of lista) {
      if (mapa.has(g.id)) { i++; continue; }
      const libres = COLORES_GRUPO.filter((k) => !usados.has(k));
      const k = libres.length ? libres[0] : COLORES_GRUPO[i % COLORES_GRUPO.length];
      usados.add(k);
      mapa.set(g.id, k);
      i++;
    }
    return mapa;
  };
  const coloresSinArbol = (c, amb, prof = 0) => {
    const carpetas = K.carpetasDe(c, amb);
    const lista = carpetas.length
      ? [...carpetas.flatMap((k) => K.gruposEnCarpeta(c, amb, k.id)), ...K.gruposEnCarpeta(c, amb, null)]
      : K.gruposDe(c, amb);
    return asignarColores(c, lista, prof);
  };
  // informe (versión 128): el dibujo para el informe: nombres enteros (columnas tan anchas como haga
  // falta), sin emojis (◆ análisis, ↺ vuelta atrás, ▼ llegó de otro cuaderno) y sin el 📁 de las carpetas
  const arbolDeMuestras = (c, receta, abrir, amb = ambitoActual(receta), prof = 0, informe = false) => {
    const r = recetaDe(receta.id);
    const fases = fasesDe(r);
    const ultimas = r ? Q.ultimasDeMuestras(r) : {};
    const grupos = K.gruposDe(c, amb);
    if (!grupos.length || !fases.length) return null;
    // Hasta dónde había llegado un grupo en un momento: 0 = sin empezar; i + 0,5 = en la fase i;
    // i + 1 = fase i terminada (si es una subfase de muestras que no es la última, aún "en" ella)
    const nivel = (gid, hasta) => {
      const hitos = K.historiaDe(c, gid).filter((e) => (e.tipo === 'empezar' || e.tipo === 'fase') && e.fecha <= hasta && fases.includes(e.fase));
      const u = hitos[hitos.length - 1];
      return u ? nivelDe(u) : 0;
    };
    // El nivel al que deja un apunte de empezar o terminar una fase
    const nivelDe = (u) => {
      const i = fases.indexOf(u.fase);
      if (u.tipo === 'empezar' || (u.subfase && ultimas[u.fase] && u.subfase !== ultimas[u.fase])) return i + 0.5;
      return i + 1;
    };
    // Las veces que un grupo volvió atrás a repetir fases (lo pidió el usuario: el árbol no enseñaba
    // que repitió parte del ciclo): { desde: hasta dónde había llegado, hasta: la fase a la que volvió
    // (su índice), llega: hasta dónde llegó al repetir, abierta: aún no ha vuelto a donde estaba,
    // t: cuándo volvió }.
    // tope: hasta dónde había llegado antes de su propia historia (al separarse)
    const vueltasDe = (g, tope) => {
      const vueltas = [];
      let v = null;
      for (const e of K.historiaDe(c, g.id)) {
        if (e.grupoId !== g.id || (e.tipo !== 'empezar' && e.tipo !== 'fase') || !fases.includes(e.fase)) continue;
        const L = nivelDe(e);
        if (v) {
          v.llega = Math.max(v.llega, L);
          if (L >= v.desde) { v.abierta = false; tope = Math.max(tope, L); v = null; }
        } else if (L < tope) {
          v = { desde: tope, hasta: fases.indexOf(e.fase), llega: L, abierta: true, t: e.fecha };
          vueltas.push(v);
        } else tope = L;
      }
      return vueltas;
    };
    // Por carpetas: cada carpeta, su parte del árbol con su nombre arriba. Dentro, cada grupo y, a su
    // derecha, los que salieron de él (por fecha). Sin carpetas, una sola parte, como antes.
    // Entre carpetas (lo pidió el usuario): si un grupo queda dibujado a la IZQUIERDA del grupo del
    // que salió, su línea empieza arriba en gris (lo que hicieron juntos hasta separarse) y el otro
    // grupo sale de ella donde se separaron; si queda a la derecha, sale del otro como una rama más
    const carpetas = K.carpetasDe(c, amb);
    const partes = carpetas.length
      ? [...carpetas.map((k) => ({ nombre: informe ? k.nombre : `📁 ${k.nombre}`, grupos: K.gruposEnCarpeta(c, amb, k.id) })),
        { nombre: 'Sin carpeta', grupos: K.gruposEnCarpeta(c, amb, null) }].filter((p) => p.grupos.length)
      : [{ nombre: null, grupos }];
    const todos = new Set(grupos.map((g) => g.id));
    const hijosEn = (id, lista) => lista.filter((g) => g.padre === id).sort((a, b) => (a.desde || 0) - (b.desde || 0));
    // Hasta dónde llega la línea de un grupo, de arriba abajo (sin saber aún dónde se dibuja): desde
    // donde se separó (o lo más arriba a lo que volvió) hasta lo más lejos de lo suyo
    const extension = (g) => {
      const P = g.padre && todos.has(g.padre) ? K.grupoDe(c, g.padre) : null;
      const inicio = P ? nivel(P.id, g.desde || 0) : 0;
      const vueltas = vueltasDe(g, inicio);
      const suyos = grupos.filter((x2) => x2.padre === g.id).map((x2) => nivel(g.id, x2.desde || 0));
      const recibidos = grupos.filter((x2) => x2.juntadoEn === g.id).map((x2) => nivel(x2.id, x2.juntadoDesde || Infinity));
      return { arriba: Math.min(inicio, ...vueltas.map((v) => v.hasta)), abajo: Math.max(inicio, nivel(g.id, Infinity), ...suyos, ...recibidos, ...vueltas.map((v) => v.desde)) };
    };
    // Los grupos que salen de uno, en el orden con menos cruces (lo pidió el usuario: «la línea se
    // cruza»): la rama hacia uno pasa por las columnas de los que van antes que él (y las de lo que
    // salió de ellos), y las cruza si sus líneas pasan por esa altura (pasar justo por una punta
    // cuenta menos). Con pocos, se prueban todos los órdenes; si empatan, por fecha
    const ordenHijos = (id, lista) => {
      const hijos = hijosEn(id, lista);
      if (hijos.length < 2 || hijos.length > 6) return hijos;
      const debajo = (g) => [g, ...hijosEn(g.id, lista).flatMap(debajo)];
      const info = hijos.map((h2) => ({ h: h2, en: nivel(id, h2.desde || 0), altos: debajo(h2).map(extension) }));
      const cruce = (en, a) => (a.arriba < en && en < a.abajo ? 1 : a.arriba <= en && en <= a.abajo ? 0.4 : 0);
      const coste = (orden) => orden.reduce((s, b2, j) => s + orden.slice(0, j).reduce((s2, a2) => s2 + a2.altos.reduce((s3, a) => s3 + cruce(b2.en, a), 0), 0), 0);
      let mejor = info;
      let menor = coste(info);
      const probar = (hecho, quedan) => {
        if (!quedan.length) { const k = coste(hecho); if (k < menor - 1e-9) { menor = k; mejor = hecho; } return; }
        quedan.forEach((x2, i2) => probar([...hecho, x2], quedan.filter((_, j2) => j2 !== i2)));
      };
      probar([], info);
      return mejor.map((x2) => x2.h);
    };
    const columnas = []; // { g, parte }
    for (const p of partes) {
      const suyos = new Set(p.grupos.map((g) => g.id));
      p.raices = p.grupos.filter((g) => !g.padre || !suyos.has(g.padre));
      p.desde = columnas.length;
      const recorrer = (g) => { columnas.push({ g, parte: p }); for (const x of ordenHijos(g.id, p.grupos)) recorrer(x); };
      for (const g of p.raices) recorrer(g);
    }
    const columnaDe = (id) => columnas.findIndex((col) => col.g && col.g.id === id);
    const IZQ = 84;
    // Las columnas, más estrechas si hay muchos grupos, para que quepan en la pantalla (entre 62 y 92 px)
    // (en el informe, tan anchas como el nombre más largo: ahí no se corta ningún nombre)
    const ANCHO = informe ? Math.max(70, Math.min(150, 7 * Math.max(...columnas.map((col) => [...col.g.nombre].length)) + 22))
      : Math.max(62, Math.min(92, Math.floor((Math.min(window.innerWidth, 860) - 34 - IZQ - 30) / columnas.length)));
    const LETRAS = Math.max(7, Math.floor((ANCHO - 8) / 7));
    // (con carpetas, arriba va el nombre de cada una)
    const ARRIBA = carpetas.length ? 30 : 14;
    const ALTO = 46;
    // Dónde va cada columna: por partes, y cada carpeta al menos tan ancha como su nombre (hasta 190 px)
    let cursor = IZQ;
    for (const p of partes) {
      const suyas = columnas.filter((col) => col.parte === p);
      p.x0 = cursor;
      p.ancho = Math.max(suyas.length * ANCHO, p.nombre ? Math.min(190, [...p.nombre].length * 7.5 + 24) : 0);
      suyas.forEach((col, k) => { col.x = cursor + k * ANCHO + 14; });
      cursor += p.ancho;
    }
    // (con sitio a la derecha: la pestaña de «📝 Notas» tapa el borde; deslizando se ve todo)
    const ancho = cursor + 70;
    const alto = ARRIBA + fases.length * ALTO + 44;
    const y = (n) => ARRIBA + n * ALTO;
    const x = (i) => columnas[i].x;
    const corto = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
    const nombreFila = (f) => { const m = /^\s*fase\s*\d+/i.exec(f || ''); return m ? m[0].trim() : corto(K.nombreFase(f), 11); };
    const filas = fases.map((f, i) => [
      s('rect', { x: 0, y: y(i), width: ancho, height: ALTO, class: i % 2 ? 'arbol-fila' : 'arbol-fila par' }),
      s('text', { x: 6, y: y(i) + ALTO / 2 + 4, class: 'arbol-fase' }, s('title', {}, K.nombreFase(f)), nombreFila(f))]);
    // El nombre de cada carpeta arriba, y una raya de puntos entre una carpeta y la siguiente
    const cabeceras = partes.map((p, k) => p.nombre && [
      k > 0 && s('line', { x1: p.x0 + 2, y1: 2, x2: p.x0 + 2, y2: alto - 2, class: 'arbol-separa' }),
      s('text', { x: p.x0 + 8, y: 19, class: 'arbol-carpeta' }, s('title', {}, p.nombre), corto(p.nombre, Math.max(8, Math.floor((p.ancho - 14) / 7.5))))]);
    let n = 0;
    // (los colores, por el orden de siempre —por carpetas y por fecha—, no por el de las columnas,
    // que se cambia para que no se crucen: si no, un grupo cambiaba de color, y con él sus tarjetas
    // y sus fotos)
    const porFecha = [];
    for (const p of partes) {
      const suyos = new Set(p.grupos.map((g) => g.id));
      const recorrer = (g) => { porFecha.push(g); for (const x2 of hijosEn(g.id, p.grupos)) recorrer(x2); };
      for (const g of p.grupos.filter((g2) => !g2.padre || !suyos.has(g2.padre))) recorrer(g);
    }
    const colores = asignarColores(c, porFecha, prof);
    // Por dónde va la línea de cada grupo: si ha vuelto atrás a repetir fases, después de cada vuelta
    // sigue por una línea nueva a su derecha (lo pidió el usuario: «la línea roja debería seguir
    // recto»). xEn(t): en qué x va su línea en el momento t (ahí salen ramas, trozos y el final)
    const trayectos = new Map(columnas.map((col, i) => {
      const g = col.g;
      const P = g.padre && todos.has(g.padre) ? K.grupoDe(c, g.padre) : null;
      const vueltas = vueltasDe(g, P ? nivel(P.id, g.desde || 0) : 0);
      // (la línea sigue siempre en su columna; la vuelta es un bucle por su derecha: lo pidió el
      // usuario, antes lo repetido iba 13 px a la derecha y el bucle quedaba a su izquierda)
      vueltas.forEach((v) => { v.xr = x(i); });
      const xEn = (t) => vueltas.reduce((r, v) => (v.t <= t ? v.xr : r), x(i));
      return [g.id, { vueltas, xEn }];
    }));
    const xDe = (id, t) => trayectos.get(id).xEn(t);
    // Las líneas de lado (ramas y juntas) que van a la misma altura se pisaban (lo dijo el usuario:
    // «hay líneas que se cruzan»): cada una va en su carril, 9 px más abajo que la anterior, y
    // las más cortas, más arriba. carril: clave → cuánto baja
    const horizontales = [];
    columnas.forEach((col, i) => {
      const g = col.g;
      const P = g.padre && todos.has(g.padre) ? K.grupoDe(c, g.padre) : null;
      const linea = (clave, en, x1, x2, t) => horizontales.push({ clave, en, a: Math.min(x1, x2), b: Math.max(x1, x2), i, t });
      if (P) linea(`r:${g.id}`, nivel(P.id, g.desde || 0), x(i), xDe(P.id, g.desde || 0), g.desde || 0);
      if (g.juntadoEn && todos.has(g.juntadoEn)) linea(`j:${g.id}`, nivel(g.id, g.juntadoDesde || Infinity), xDe(g.id, g.juntadoDesde || Infinity), x(columnaDe(g.juntadoEn)), g.juntadoDesde || 0);
    });
    // Por alturas: cada una, en el primer carril donde no se monta con otra; tocarse en una punta
    // también cuenta (una rama que llega a una línea y otra que sale de ella a la misma altura
    // parecían una sola que la atravesaba: lo vio el usuario)
    const carril = new Map();
    const porAltura = new Map();
    for (const hz of horizontales) {
      const k = hz.en.toFixed(2);
      if (!porAltura.has(k)) porAltura.set(k, []);
      porAltura.get(k).push(hz);
    }
    // Las líneas de los grupos, más o menos (de lo más arriba a lo más abajo de cada uno), para que
    // cada línea de lado elija un carril que no las cruce
    const lineasDe = columnas.map((col, i) => { const e = extension(col.g); return { x: x(i), y1: y(e.arriba), y2: y(e.abajo) }; });
    // (y los bucles de las vueltas, a la izquierda de su línea: una rama que llegaba a «Pre tinte»
    // por encima atravesaba su propio bucle; lo vio el usuario)
    const buclesDe = columnas.flatMap((col, i) => trayectos.get(col.g.id).vueltas
      .map((v, k) => ({ x1: x(i) - 16 - 7 * k, x2: x(i) - 4, y1: y(v.hasta) + 6, y2: y(v.desde) })));
    const cruces = (hz, dy) => {
      const yb = y(hz.en) + dy;
      return lineasDe.reduce((n2, l) => n2 + (l.x > hz.a + 1 && l.x < hz.b - 1
        ? (l.y1 < yb && yb < l.y2 ? 1 : l.y1 <= yb && yb <= l.y2 && l.y2 > l.y1 ? 0.4 : 0) : 0), 0)
        // (por el medio del bucle; llegar a su punta de abajo, donde empieza, no cuenta)
        + buclesDe.filter((b) => hz.a < b.x2 && hz.b > b.x1 && b.y1 - 2 < yb && yb < b.y2 - 2).length;
    };
    // Los carriles: a la altura de la fase, 9 px más abajo, 9 más arriba, 18 más abajo… Cada línea
    // va al que no se monte con otra y cruce menos líneas (lo pidió el usuario: el «Grupo B» salía
    // del mismo sitio que el «A» y su rama, por debajo, cruzaba la línea del A; por encima, no)
    const CARRILES = [0, 9, -9, 18, -18, 27, -27, 36];
    for (const lista of porAltura.values()) {
      const ocupados = new Map(); // dy → las que van en ese carril
      // (de izquierda a derecha, y de las que empiezan en el mismo sitio, la más corta primero: así
      // la que llega a una línea se queda a su altura, y de las que salen de ella, la que va más
      // cerca va más arriba)
      for (const hz of lista.sort((p, q) => p.a - q.a || (p.b - p.a) - (q.b - q.a) || p.t - q.t)) {
        const libres = CARRILES.filter((dy) => !(ocupados.get(dy) || []).some((o) => hz.a <= o.b + 1 && o.a <= hz.b + 1));
        const dy = libres.reduce((mejor, d) => (cruces(hz, d) < cruces(hz, mejor) - 1e-9 ? d : mejor), libres[0] ?? 45);
        ocupados.set(dy, [...(ocupados.get(dy) || []), hz]);
        carril.set(hz.clave, dy);
      }
    }
    // Una línea de lado a la altura yy (bajada dy, a su carril), de x1 a x2. Si va bajada, un
    // tramito vertical en cada punta la une a sus líneas. props: el trazo (color, puntos…). Se
    // apunta en «deLados», para ponerle un puente donde cruce por encima de una línea de otro grupo
    const deLados = []; // { yb, a, b, props }
    const verticales = []; // { x, y1, y2 }: las líneas de los grupos
    // De quién es cada cosa dibujada y de cuándo (desde ta hasta tb), para resaltar el camino de un
    // grupo (resaltar, más abajo)
    const deQuien = (id, ta, tb = ta) => ({ 'data-dueno': id, 'data-ta': String(ta), 'data-tb': String(tb) });
    let dueno = null; // de quién es la línea de lado que se está dibujando
    let momento = 0; // y de cuándo
    const apuntarDeLado = (yb, x1, x2, props) => deLados.push({ yb, a: Math.min(x1, x2), b: Math.max(x1, x2), props, dueno, momento });
    // Una línea de lado de un grupo y de un momento: envuelta con quién y cuándo
    const conDueno = (id, t, dibujar) => { dueno = id; momento = t; return s('g', deQuien(id, t), dibujar()); };
    // Los tramitos verticales que bajan una línea de lado a su carril van en una capa debajo de
    // todo (bajadas): donde la línea del grupo sigue, la tapa (si no, se pintaba encima de ella con
    // otro color), y donde no sigue, se ve y une la línea de lado con ella
    const bajadas = [];
    const bajada = (xx, y1, y2, props) => { if (y1 !== y2) bajadas.push(s('path', { d: `M ${xx} ${y1} V ${y2}`, 'stroke-width': 3, fill: 'none', ...props, ...deQuien(dueno, momento) })); };
    const deLado = (yy, dy, x1, x2, props) => {
      const yb = y(yy) + dy;
      apuntarDeLado(yb, x1, x2, props);
      bajada(x1, y(yy), yb, props);
      bajada(x2, y(yy), yb, props);
      return s('path', { d: `M ${x1} ${yb} H ${x2}`, 'stroke-width': 3, fill: 'none', ...props });
    };
    // Los nombres van aparte y se pintan los últimos: si no, las líneas (y sus puentes) de los
    // grupos de después los tapaban
    const etiquetas = [];
    const lineas = columnas.map((col, i) => {
      const g = col.g;
      const color = colores.get(g.id);
      const xi = x(i);
      const { vueltas, xEn } = trayectos.get(g.id);
      const P = g.padre && todos.has(g.padre) ? K.grupoDe(c, g.padre) : null;
      const iP = P ? columnaDe(P.id) : -1;
      // A qué altura se separó del grupo del que salió
      const separado = P ? nivel(P.id, g.desde || 0) : 0;
      // Dibujado a la izquierda del grupo del que salió: su línea empieza arriba del todo, en su
      // color (lo pidió el usuario: «debería empezar en azul porque todas venían de ese»)
      const desdeArriba = P && iP > i;
      const hijos = grupos.filter((x2) => x2.padre === g.id).map((h2) => ({ h: h2, i: columnaDe(h2.id), en: nivel(g.id, h2.desde || 0), t: h2.desde || 0 }));
      const izquierda = hijos.filter((x2) => x2.i < i);
      const trozos = K.historiaDe(c, g.id).filter((e) => e.tipo === 'analisis' && e.grupoId === g.id);
      // Dónde empieza su línea de color: donde se separó; un grupo del principio cuya historia de
      // antes ya se ve en gris en un grupo de su izquierda, donde se separó de él (o antes, si antes
      // le salió otra rama o le cortaron un trozo)
      let inicio = P && !desdeArriba ? separado : 0;
      if (!P && izquierda.length) inicio = Math.min(...hijos.map((x2) => x2.en), ...trozos.map((e) => nivel(g.id, e.fecha)));
      // Una rama entre una columna de su izquierda (en desdeX) y este grupo (en hastaX): si viene de
      // otra carpeta, en gris hasta que entra en la zona de la suya, y luego en su color
      // (clave: la de su carril, ver deLado)
      // (alBucle: llega desde la izquierda justo donde empieza el bucle de su primera vuelta: se
      // queda donde arranca la curva del bucle, a 5 px de la línea, sin tocarla —lo
      // pidió el usuario—: se lee seguido, llega, vuelve atrás por el bucle y sigue por la línea)
      const rama = (iDesde, yy, desdeX, hastaX0, clave, alBucle) => {
        const otra = columnas[iDesde].parte !== col.parte;
        const borde = col.parte.x0 + 2;
        const dy = carril.get(clave) || 0;
        // (también si va en otro carril: entonces sube o baja por fuera de la línea, a 5 px, hasta la
        // punta del bucle; si no, tocaba la línea —lo vio el usuario en la de «Pre tinte»—)
        const hastaX = alBucle && desdeX < hastaX0 ? hastaX0 - 5 : hastaX0;
        if (!otra) return deLado(yy, dy, desdeX, hastaX, { stroke: color });
        // De otra carpeta: en gris hasta el borde de la suya (con la bajada del principio), y en su
        // color desde ahí (con la del final)
        const yb = y(yy) + dy;
        apuntarDeLado(yb, desdeX, borde, { class: 'arbol-tronco' });
        apuntarDeLado(yb, borde, hastaX, { stroke: color });
        bajada(desdeX, y(yy), yb, { class: 'arbol-tronco' });
        bajada(hastaX, y(yy), yb, { stroke: color });
        return [s('path', { d: `M ${desdeX} ${yb} H ${borde}`, class: 'arbol-tronco', 'stroke-width': 3, fill: 'none' }),
          s('path', { d: `M ${borde} ${yb} H ${hastaX}`, stroke: color, 'stroke-width': 3, fill: 'none' })];
      };
      const ahora = nivel(g.id, Infinity);
      const est = estadoGrupo(c, g);
      // Juntado con otro: una línea de puntos hasta él, a la altura a la que iba al juntarse; y el
      // que recibe, su línea llega hasta ahí
      const iJunta = g.juntadoEn ? columnaDe(g.juntadoEn) : -1;
      const enJunta = g.juntadoEn ? nivel(g.id, g.juntadoDesde || Infinity) : 0;
      const recibidos = grupos.filter((x2) => x2.juntadoEn === g.id).map((x2) => ({ en: nivel(x2.id, x2.juntadoDesde || Infinity), t: x2.juntadoDesde || 0 }));
      // Lo que le pasa en cada momento y hasta dónde había llegado entonces (sus ramas, sus trozos,
      // lo que recibe): cada trozo de su línea llega hasta lo más lejos de lo suyo
      const hitos = [...hijos.map((x2) => ({ en: x2.en, t: x2.t })), ...trozos.map((e) => ({ en: nivel(g.id, e.fecha), t: e.fecha })), ...recibidos,
        ...(g.juntadoEn ? [{ en: enJunta, t: g.juntadoDesde || Infinity }] : [])];
      // Los trozos de su línea: el primero, en su columna, desde donde empieza; después de cada
      // vuelta, uno a su derecha, desde la fase a la que volvió. Cada uno llega hasta donde había
      // llegado antes de la vuelta siguiente (o, el último, hasta donde va ahora)
      const tramos = [{ x: xi, desde: inicio, t: -Infinity }, ...vueltas.map((v) => ({ x: v.xr, desde: v.hasta, t: v.t, arriba: true }))];
      tramos.forEach((tr, k) => {
        const sig = vueltas[k];
        const suyos = hitos.filter((x2) => x2.t >= tr.t && (!sig || x2.t < sig.t)).map((x2) => x2.en);
        tr.hasta = sig ? sig.desde : Math.max(tr.desde, ahora, ...suyos);
      });
      const ultimo = tramos[tramos.length - 1];
      const xFin = ultimo.x;
      // El final: donde va ahora, en su último trozo. El nombre, debajo; si su línea sigue más
      // abajo (de ella salió algo más lejos), a su derecha
      const fin = Math.max(ultimo.arriba ? ultimo.desde : inicio, ahora);
      // (si aún está repitiendo, debajo de toda su línea: junto a la marca taparía la vuelta)
      const arribaDel = Math.min(...tramos.map((tr) => tr.desde));
      const abajoDel = Math.max(...tramos.map((tr) => tr.hasta));
      const repitiendo = vueltas.length > 0 && vueltas[vueltas.length - 1].abierta;
      const aLaDerecha = !repitiendo && ultimo.hasta > fin;
      // (en el informe, todos en una fila debajo del dibujo, cada uno bajo su columna: junto al final de su
      // línea, alguno caía encima de la línea de otro grupo —versión 129, «Pos lavado» en el del usuario—)
      const nombreX = informe ? xi - 10 : repitiendo ? xi - 10 : aLaDerecha ? xFin + 9 : xFin - 10;
      const nombreY = informe ? y(fases.length) + 17 : repitiendo ? y(abajoDel) + 17 : y(fin) + (aLaDerecha ? -6 : 17);
      return s('g', { class: 'arbol-grupo', 'data-grupo': g.id, tabindex: 0, role: 'button', 'aria-label': `Abrir ${g.nombre}` },
        s('title', {}, `${g.nombre}${g.muestras != null ? ` · ${muestrasTexto(g.muestras)}` : ''} · ${textoEstado(est)}`),
        // La rama desde el grupo del que salió, si está a su izquierda (desde por donde iba entonces)
        P && iP < i && conDueno(g.id, g.desde || 0, () => rama(iP, separado, xDe(P.id, g.desde || 0), xi, `r:${g.id}`,
          vueltas.length > 0 && Math.abs(vueltas[0].desde - separado) < 1e-9)),
        // Y, al revés, las ramas hacia este grupo desde los que salieron de él y están a su izquierda
        izquierda.map((x2) => conDueno(x2.h.id, x2.t, () => rama(x2.i, x2.en, x(x2.i), xEn(x2.t), `r:${x2.h.id}`))),
        // Su línea, por trozos (y entre ellos, la vuelta atrás: un arco de puntos con 🔁 que sube
        // por su derecha hasta la fase que repitió)
        // Cada tramo, partido donde pasó algo (salió un grupo, se le juntó otro): al seguir un
        // grupo, de los que salió solo se resalta hasta que se separó, y del que se juntó, desde
        // que se juntó (lo pidió el usuario: lo demás «ya no pertenece a la muestra que ves»)
        tramos.map((tr, k) => {
          if (!(tr.hasta > tr.desde || !tr.arriba)) return null;
          const y0 = y(tr.desde) + (tr.arriba ? 6 : 0);
          verticales.push({ x: tr.x, y1: y0, y2: y(tr.hasta) });
          const sig = vueltas[k];
          const fin2 = sig ? sig.t : Infinity;
          // (también lo que pasó justo al final del tramo: si no, el último trozo no acababa cuando
          // salió de ahí otro grupo y, al seguir a ese, salía aclarado y su camino, cortado: pasó
          // con el «Grupo B», que salió del final de la línea de «Pre tinte». Los trozos que se
          // quedan sin largo no se pintan, pero marcan el momento)
          const cortes = [...hijos.map((x2) => ({ en: x2.en, t: x2.t })), ...recibidos]
            .filter((x2) => x2.t >= tr.t && x2.t < fin2 && x2.en >= tr.desde && x2.en <= tr.hasta)
            .sort((p, q) => p.t - q.t);
          const puntos = [{ yy: y0, t: tr.t }, ...cortes.map((x2) => ({ yy: Math.max(y0, y(x2.en)), t: x2.t })), { yy: y(tr.hasta), t: fin2 }];
          return puntos.slice(1).map((q, j) => q.yy !== puntos[j].yy && s('line', { x1: tr.x, y1: puntos[j].yy, x2: tr.x, y2: q.yy, stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round', ...deQuien(g.id, puntos[j].t, q.t) }));
        }),
        vueltas.map((v, k) => {
          const arriba = y(v.hasta) + 6;
          const abajo = y(v.desde);
          // (un bucle pegado por la izquierda —lo pidió así el usuario—: sale de donde había llegado
          // y vuelve a la fase que repite; si hay varios, cada uno un poco más abierto)
          // (sus puntas, a 5 px de la línea, sin tocarla: lo pidió así)
          const fuera = xi - 15 - 7 * k;
          const punta = xi - 5;
          return s('g', { class: 'arbol-vuelta', ...deQuien(g.id, v.t) },
            s('title', {}, `🔁 Volvió a «${K.nombreFase(fases[v.hasta])}»${v.abierta ? ' (la está repitiendo)' : ''}`),
            s('path', { d: `M ${punta} ${abajo} C ${fuera} ${abajo} ${fuera} ${arriba} ${punta} ${arriba}`, stroke: color, 'stroke-width': 2, 'stroke-dasharray': '4 3', fill: 'none' }),
            s('text', { x: fuera - 13, y: (arriba + abajo) / 2 + 4, class: 'arbol-vuelta-icono' }, informe ? '↺' : '🔁'));
        }),
        iJunta >= 0 && s('g', { class: 'arbol-junta' }, s('title', {}, `Se juntó con «${est.con}»`),
          conDueno(g.id, g.juntadoDesde || 0, () => deLado(enJunta, carril.get(`j:${g.id}`) || 0, xEn(g.juntadoDesde || Infinity), x(iJunta), { stroke: color, 'stroke-dasharray': '5 4' }))),
        // Los trozos para analizar: un puntito a la altura a la que iba
        // (un 🔬 pequeño a la derecha de la línea, un poco por encima (a la izquierda va el bucle de las vueltas): el círculo de antes caía encima del final y se
        // confundía con él; varios en el mismo sitio, uno al lado de otro)
        (() => {
          const usados = new Map();
          return trozos.map((e) => {
            const cx = xEn(e.fecha);
            const cy = y(nivel(g.id, e.fecha));
            const k = `${cx}|${cy}`;
            const n2 = usados.get(k) || 0;
            usados.set(k, n2 + 1);
            return s('text', { x: cx + 6 + 13 * n2, y: cy - 3, class: 'arbol-analisis', ...deQuien(g.id, e.fecha) }, s('title', {}, `${K.titularDe(e)} · ${fechaCorta(e.fecha)}`), informe ? '◆' : '🔬');
          });
        })(),
        // El final: una raya (o ● si está en una fase) y el nombre
        est.estado === 'en'
          ? s('circle', { cx: xFin, cy: y(fin), r: 6, fill: color, ...deQuien(g.id, Infinity) })
          : s('line', { x1: xFin - 10, y1: y(fin), x2: xFin + 10, y2: y(fin), stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round', ...deQuien(g.id, Infinity) }),
        void etiquetas.push(s('g', { class: 'arbol-etiqueta', 'data-grupo': g.id, 'data-dueno': g.id, 'data-nombre': '1' }, g.vieneDe && s('text', { x: xi, y: y(0) - 5, 'text-anchor': 'middle', class: 'arbol-llegada' }, informe ? '▼' : '📥', s('title', {}, `Llegó del cuaderno «${g.vieneCuaderno || 'otro'}»: su historia anterior está allí`)),
          s('text', { x: nombreX, y: nombreY, class: 'arbol-nombre', fill: color }, `${informe ? '' : est.estado === 'terminado' ? '✅ ' : est.estado === 'juntado' ? '🔗 ' : est.estado === 'pasado' ? '📤 ' : ''}${corto(g.nombre, est.estado === 'terminado' || est.estado === 'juntado' || est.estado === 'pasado' ? LETRAS - 2 : LETRAS)}`),
        // (en corto, para que no se monte con el de al lado; un grupo juntado ya no tiene)
        g.muestras != null && est.estado !== 'juntado' && est.estado !== 'pasado' && s('text', { x: nombreX, y: nombreY + 14, class: 'arbol-muestras' }, informe ? `n = ${g.muestras}` : `🧫 ${g.muestras}`))),
        // Una zona invisible ancha, para que sea fácil tocarlo
        s('rect', { x: xi - 14, y: y(arribaDel) - 6, width: ANCHO - 8 + 13 * vueltas.length, height: y(abajoDel) - y(arribaDel) + 44, fill: 'transparent' }));
    });
    // Los puentes: donde una línea de lado pasa por encima de la línea de otro grupo (no en sus
    // puntas, donde llega a su línea), un hueco del color del fondo y otra vez su trozo encima, para
    // que se vea que pasa por encima y no que se juntan
    const puentes = deLados.flatMap((l) => verticales
      .filter((v) => v.x > l.a + 6 && v.x < l.b - 6 && v.y1 < l.yb - 3 && v.y2 > l.yb + 3)
      .map((v) => s('g', { 'data-grupo': l.dueno, ...deQuien(l.dueno, l.momento) },
        s('path', { d: `M ${v.x - 6} ${l.yb} H ${v.x + 6}`, class: 'arbol-halo', 'stroke-width': 9, fill: 'none' }),
        s('path', { d: `M ${v.x - 7} ${l.yb} H ${v.x + 7}`, 'stroke-width': 3, fill: 'none', ...l.props }))));
    const svg = s('svg', { class: 'arbol', width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, role: 'img', 'aria-label': 'Árbol de los grupos de muestras por fases' }, filas, cabeceras, bajadas, lineas, puentes, etiquetas);
    svg.addEventListener('click', (e) => { const g = e.target.closest('[data-grupo]'); if (g) abrir(g.dataset.grupo); });
    // Seguir el camino de un grupo (lo pidió el usuario: con varias líneas costaba): unos botones con
    // su nombre; al tocar uno se resalta su camino entero (el grupo, de los que salió y en el que se
    // juntó) y lo demás se aclara; otro toque lo quita
    let resaltado = null;
    // El camino de un grupo: él entero; de los que salió, solo hasta que se separó (lo que hicieron
    // después ya no es suyo: lo pidió el usuario); y en el que se juntó, desde que se juntó
    const caminoDe = (id) => {
      const roles = new Map([[id, { rol: 'yo' }]]);
      for (let hijo = K.grupoDe(c, id); hijo && hijo.padre && todos.has(hijo.padre) && !roles.has(hijo.padre); hijo = K.grupoDe(c, hijo.padre)) {
        roles.set(hijo.padre, { rol: 'antes', hasta: hijo.desde || 0 });
      }
      for (let x2 = K.grupoDe(c, id); x2 && x2.juntadoEn && todos.has(x2.juntadoEn) && !roles.has(x2.juntadoEn); x2 = K.grupoDe(c, x2.juntadoEn)) {
        roles.set(x2.juntadoEn, { rol: 'despues', desde: x2.juntadoDesde || 0 });
      }
      return roles;
    };
    // Si algo dibujado es del camino (por de quién es y de cuándo: data-dueno, data-ta, data-tb)
    const enCamino = (el, roles) => {
      const r = roles.get(el.dataset.dueno);
      if (!r) return false;
      if (r.rol === 'yo' || el.dataset.nombre) return true;
      return r.rol === 'antes' ? Number(el.dataset.tb) <= r.hasta + 1 : Number(el.dataset.ta) >= r.desde - 1;
    };
    const botones = h('div', { class: 'chips arbol-seguir' });
    const resaltar = (id) => {
      resaltado = resaltado === id ? null : id;
      const roles = resaltado ? caminoDe(resaltado) : new Map();
      svg.classList.toggle('apagada', Boolean(resaltado));
      for (const el of svg.querySelectorAll('[data-dueno]')) el.classList.toggle('resaltada', enCamino(el, roles));
      for (const b of botones.children) if (b.dataset.grupo) b.setAttribute('aria-pressed', String(b.dataset.grupo === resaltado));
    };
    if (columnas.length > 1) {
      poner(botones, h('span', { class: 'chips-rotulo', text: 'Seguir:' }),
        columnas.map((col) => h('button', { class: 'chip', 'data-grupo': col.g.id, 'aria-pressed': 'false', onclick: () => resaltar(col.g.id) },
          h('span', { class: 'punto-grupo', style: `background: ${colores.get(col.g.id)}` }), col.g.nombre)));
    }
    const zona = h('div', { class: 'arbol-zona' },
      columnas.length > 1 && botones,
      h('div', { class: 'arbol-caja' }, svg),
      // Qué es cada cosa
      h('p', { class: 'arbol-leyenda', text: '● va por aquí · ━ terminó ahí · 🔁 repitió fases · 🔬 análisis · ┅ se juntó con otro · 📥 llegó de otro cuaderno · 📤 pasó a otro cuaderno · un hueco en una línea: la otra pasa por encima sin tocarla · en gris: lo que hizo en otra carpeta' }));
    // (el color de cada grupo, para que sus tarjetas lleven el mismo)
    zona.colores = colores;
    return zona;
  };

  // ─── El informe de un cuaderno ───
  // Versión 86 (lo pidió el usuario: «toda la historia de un cuaderno en un documento ordenado», para la
  // memoria o para el tutor). Versión 127 (el usuario: «mejorar el informe para que sea más científico y
  // formal, y que luego lo pueda editar, añadir cosas…»): con la forma de un informe científico —portada,
  // resumen, 1. Introducción, 2. Objetivos, 3. Materiales y métodos, 4. Resultados, 5. Discusión,
  // 6. Conclusiones, referencias y anexos—, tablas y figuras numeradas con su pie, y sin emojis. Lo que
  // escribe el usuario (título, autores, resumen, introducción…) va en la ficha del cuaderno
  // (ficha.informe: pasa al PC con ella). Se guarda en PDF (🖨️) o en Word (.docx, para seguir editándolo).
  // Primero se hace el «modelo» (modeloInforme: una lista de bloques) y luego se dibuja en la pantalla
  // (informeHtml, que es lo que se imprime) o se pasa a Word (informeDocx): así los dos dicen lo mismo.
  const TEXTOS_INFORME = [
    ['titulo', 'Título', 'Por ejemplo: Recubrimiento de fibra de carbono con GNP y crecimiento de CuO', 0],
    ['autores', 'Autor o autores', 'Nombre y apellidos', 0],
    ['institucion', 'Centro, departamento o grupo', 'Por ejemplo: Universidad de…, Departamento de…', 0],
    ['resumen', 'Resumen', 'En pocas líneas: qué se hizo, cómo y qué salió', 4],
    ['introduccion', 'Introducción', 'El contexto: por qué se hace este trabajo', 5],
    ['objetivos', 'Objetivos', 'Qué se quería conseguir (uno por línea)', 3],
    ['discusion', 'Discusión', 'Qué significan los resultados: comparación entre grupos, problemas, explicaciones…', 6],
    ['conclusiones', 'Conclusiones', 'Lo principal (una por línea)', 4],
    ['referencias', 'Referencias', 'Una por línea (artículos, protocolos, fichas técnicas…)', 3],
  ];
  // Sin emojis (en un informe formal no van): «🔬 Microscopio electrónico» → «Microscopio electrónico»
  const sinEmoji = (s) => String(s == null ? '' : s)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ').trim();
  // (lo mismo, pero respetando los saltos de línea)
  const sinEmojiLineas = (s) => String(s == null ? '' : s).split('\n').map(sinEmoji).filter(Boolean).join('\n');
  const fechaLargaDe = (ms) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  // ── Lenguaje formal (versión 128: el usuario, sobre el informe de la 127: «no me gusta cómo quedan,
  // ¿tú publicarías así un informe?»; hablaba como la app —«Empieza», «Terminada», «Juntado con», «16 sept»—) ──
  const fechaNum = (ms) => new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fasesNombre = (f) => sinEmoji(K.nombreFase(f));
  const muestrasDe = (n) => (n != null ? ` (${n} ${n === 1 ? 'muestra' : 'muestras'})` : '');
  // Lo que se hizo en un apunte, dicho como en un informe
  const actividadFormal = (e) => {
    switch (e.tipo) {
      case 'empezar': return `${e.otraVez ? 'Repetición' : 'Inicio'} de ${fasesNombre(e.fase)}${muestrasDe(e.muestras)}`;
      case 'fase': return `Fin de ${fasesNombre(e.fase)}${e.subfase ? ` (${e.subfase})` : ''}${muestrasDe(e.muestras)}`;
      case 'analisis': return `Caracterización: ${e.tecnica || 'análisis'}`;
      case 'separar': return `Separación de ${e.cuantas} ${e.cuantas === 1 ? 'muestra' : 'muestras'} al grupo ${e.nuevo}`;
      case 'juntar': return `Unión al grupo ${e.nuevo}${muestrasDe(e.cuantas)}`;
      case 'recibir': return `Incorporación de ${e.cuantas != null ? `${e.cuantas} ${e.cuantas === 1 ? 'muestra' : 'muestras'} ` : 'las muestras '}del grupo ${e.desde}`;
      case 'medida': return `Medida: ${K.lineasDeMedidas(e.medidas) || '—'}`;
      case 'pasar': return `Traslado${muestrasDe(e.cuantas)} al cuaderno ${e.haciaCuaderno || 'siguiente'}`;
      case 'llegar': return `Recepción${muestrasDe(e.cuantas)} desde el cuaderno ${e.deCuaderno || 'anterior'}`;
      case 'preparar': return `Preparación de la disolución ${e.disolucion}`;
      case 'comparar': return `Comparación de ${(e.comparadas || []).length} imágenes`;
      case 'estado': return `Cambio de estado: ${sinEmoji(K.ESTADOS[e.estado] || e.estado || '').toLowerCase()}`;
      default: return 'Observación';
    }
  };
  // Cómo quedó un grupo, dicho como en un informe
  const estadoFormal = (est) => {
    switch (est.estado) {
      case 'nada': return 'Sin iniciar';
      case 'en': return `En curso: ${fasesNombre(est.fase)}`;
      case 'terminado': return `Completado (${fechaNum(est.fecha)})`;
      case 'juntado': return `Unido al grupo ${est.con} (${fechaNum(est.fecha)})`;
      case 'pasado': return `Trasladado al cuaderno ${est.cuaderno} (${fechaNum(est.fecha)})`;
      default: return `${fasesNombre(est.fase)} completada${est.siguiente !== undefined ? `; pendiente: ${fasesNombre(est.siguiente)}` : ''}`;
    }
  };
  // «Fase 2: Lavado» → «Fase 2» (para las listas cortas de la tabla de seguimiento)
  const faseCorta = (f) => { const m = /^\s*fase\s*\d+/i.exec(f || ''); return m ? m[0].trim().replace(/^fase\s*/i, 'F') : fasesNombre(f); };

  // El nombre del trabajo: el del cuaderno o, si es el genérico («Cuaderno 1»), el de su receta
  const nombreDelTrabajo = (ficha, receta) => (/^Cuaderno \d+$/.test(ficha.nombre || '') && receta && receta.id ? receta.nombre : ficha.nombre);

  // ── Piezas comunes del informe y del texto para una IA (versión 129). El usuario: «repetir qué pasos
  // has hecho en cada una, si es todo igual, no tiene sentido; con poner una basta; en lo que cambia,
  // sí apuntarlo para esa muestra». Cada apunte es de un solo grupo (el que lo tenía entonces): la
  // historia «propia» de un grupo es solo lo suyo, y lo de antes de separarse está en el grupo del que
  // salió. Así no se repite nada y no se pierde nada ──
  const fechaHoraNum = (ms) => `${fechaNum(ms)} ${horaDe(ms)}`;
  // La receta de un cuaderno (o una vacía, si no tiene)
  const recetaDeAmbito = (amb, ficha) => (amb.recetaId && recetaDe(amb.recetaId))
    || { id: null, nombre: ficha.nombre, pasos: [], datos: [], calculos: [], sinReceta: true };
  // Una parte del informe: un cuaderno, con su ficha y su receta
  const parteDe = (c, amb) => { const ficha = K.fichaCuaderno(c, amb); return { amb, ficha, receta: recetaDeAmbito(amb, ficha) }; };
  // Los cuadernos unidos a este por muestras que pasaron de uno a otro (en los dos sentidos y en cadena):
  // [{ parte, vienen, van }] (cuántos grupos vinieron de él o fueron a él)
  const cuadernosRelacionados = (c, amb) => {
    const clave = (a) => a.cuadernoId;
    const vistos = new Map([[clave(amb), null]]);
    const pendientes = [amb];
    const salida = [];
    while (pendientes.length) {
      const a = pendientes.shift();
      for (const g of K.gruposDe(c, a)) {
        const enlaces = [];
        const o = g.vieneDe && K.grupoDe(c, g.vieneDe);
        if (o) enlaces.push({ otro: ambitoDe(o), tipo: 'vienen' });
        for (const d of c.grupos.filter((x) => x.vieneDe === g.id)) enlaces.push({ otro: ambitoDe(d), tipo: 'van' });
        for (const { otro, tipo } of enlaces) {
          if (!vistos.has(clave(otro))) {
            const x = { parte: parteDe(c, otro), vienen: 0, van: 0 };
            vistos.set(clave(otro), x);
            salida.push(x);
            pendientes.push(otro);
          }
          const x = vistos.get(clave(otro));
          if (x && a === amb) x[tipo]++;
        }
      }
    }
    return salida;
  };
  // Cuántas muestras tenía un grupo al formarse
  const muestrasAlEmpezar = (c, g) => {
    if (g.padre) { const e = c.entradas.find((x) => x.tipo === 'separar' && x.nuevoId === g.id); if (e && e.cuantas != null) return e.cuantas; }
    if (g.vieneDe) { const e = c.entradas.find((x) => x.tipo === 'llegar' && x.grupoId === g.id); if (e && e.cuantas != null) return e.cuantas; }
    const e = c.entradas.filter((x) => x.grupoId === g.id && x.muestras != null).sort((a, b) => a.fecha - b.fecha)[0];
    return e ? e.muestras : g.muestras;
  };
  // Los grupos en el orden de su familia: cada uno seguido de los que salieron de él. [{ g, nivel }]
  const ordenFamilia = (grupos) => {
    const ids = new Set(grupos.map((g) => g.id));
    const hijos = new Map();
    const raices = [];
    for (const g of grupos) {
      if (g.padre && ids.has(g.padre)) { if (!hijos.has(g.padre)) hijos.set(g.padre, []); hijos.get(g.padre).push(g); } else raices.push(g);
    }
    const lista = [];
    const visita = (g, nivel) => { lista.push({ g, nivel }); for (const x of (hijos.get(g.id) || []).sort((a, b) => (a.desde || 0) - (b.desde || 0))) visita(x, nivel + 1); };
    for (const g of raices) visita(g, 0);
    return lista;
  };
  // Los apuntes de una lista, con las pasadas por una fase juntas: el «empezar» y el «terminar» (y sus
  // subfases) de una misma vez son una sola cosa. Lo demás, cada apunte tal cual. ultimas: la última
  // subfase de muestras de cada fase (terminarla es terminar la fase)
  const conPasadas = (entradas, ultimas = {}) => {
    const items = [];
    let p = null;
    for (const e of entradas) {
      if (e.tipo !== 'empezar' && e.tipo !== 'fase') { items.push({ tipo: e.tipo, fecha: e.fecha, e }); continue; }
      if (!p || p.fase !== e.fase || (e.tipo === 'empezar' && p.terminada)) {
        p = { tipo: 'pasada', fase: e.fase, fecha: e.fecha, desdeElPrincipio: e.tipo === 'empezar', fin: null, terminada: false, muestras: null, subfases: [], disoluciones: [], notas: [], distinto: [], fotos: [], entradas: [] };
        items.push(p);
      }
      p.entradas.push(e);
      if (p.muestras == null && e.muestras != null) p.muestras = e.muestras;
      if (e.tipo === 'fase') {
        p.fin = e.fecha;
        if (e.subfase) p.subfases.push({ nombre: e.subfase, fecha: e.fecha });
        if (!e.subfase || ultimas[e.fase] === undefined || ultimas[e.fase] === e.subfase) p.terminada = true;
      }
      for (const d of e.disoluciones || []) if (!p.disoluciones.some((x) => x.id === d.id)) p.disoluciones.push(d);
      if (e.nota) p.notas.push(e.nota);
      if (e.distinto) p.distinto.push(e.distinto);
      p.fotos.push(...(e.fotos || []));
    }
    return items;
  };
  const ultimasDe = (g) => { const r = recetaDe(g.recetaId); return r ? Q.ultimasDeMuestras(r) : {}; };
  // La historia propia de un grupo: [item] (pasadas con su «vez»: 2.ª vez si ya la había hecho, contando
  // lo heredado del grupo del que salió)
  const historiaPropia = (c, g) => {
    const ultimas = ultimasDe(g);
    const orden = (a, b) => a.fecha - b.fecha;
    const propias = c.entradas.filter((e) => e.grupoId === g.id).map((e) => conNombresDeAhora(c, e)).sort(orden);
    const todas = conPasadas(K.historiaDe(c, g.id).slice().sort(orden), ultimas).filter((x) => x.tipo === 'pasada');
    const items = conPasadas(propias, ultimas);
    const pasadas = items.filter((x) => x.tipo === 'pasada');
    for (const p of pasadas) {
      p.vez = todas.filter((x) => x.fase === p.fase && x.fecha <= p.fecha).length || 1;
    }
    // (sin terminar: «en curso» solo si el grupo sigue en ella; si se unió a otro o pasó a otro cuaderno, no)
    const est = estadoGrupo(c, g);
    const ultima = pasadas[pasadas.length - 1];
    if (ultima && !ultima.terminada) ultima.enCurso = est.estado === 'en' && est.fase === ultima.fase;
    return items;
  };
  // ── Los grupos finales y en qué se apartaron del procedimiento (versión 149; lo propuso el usuario: «¿no es un
  // poco lioso poner toda la historia de los grupos? ¿no sería mejor poner solo lo que cambió cada grupo respecto
  // de su receta original, y que sean solo los grupos finalistas?») ──
  // Un grupo final: el que llegó al final del trabajo (sigue con muestras, o pasó a otro cuaderno); no los que se
  // unieron a otro ni los que se repartieron entero en otros grupos
  const esGrupoFinal = (c, g) => {
    const est = estadoGrupo(c, g).estado;
    if (est === 'juntado') return false;
    return est === 'pasado' || (g.muestras || 0) > 0;
  };
  // Las muestras con las que acabó: las que le quedan o, si pasó a otro cuaderno, las que pasaron
  const muestrasFinales = (c, g) => {
    if (estadoGrupo(c, g).estado !== 'pasado') return g.muestras;
    const e = c.entradas.filter((x) => x.tipo === 'pasar' && x.grupoId === g.id).sort((a, b) => b.fecha - a.fecha)[0];
    return e && e.cuantas != null ? e.cuantas : g.muestras;
  };
  // (la nota que apunta «🧮 Corregir los números» es un registro de la corrección, no una observación; versión 150)
  const esNotaDeCorreccion = (n) => /^\s*🧮 Números corregidos/.test(n || '');
  // El pH que dice una disolución (en sus notas o en lo apuntado al prepararla): el último que se nombra
  const phDe = (c, d) => {
    const textos = [d.preparada, ...c.entradas.filter((e) => e.disolucionId === d.id && e.nota && !esNotaDeCorreccion(e.nota)).sort((a, b) => a.fecha - b.fecha).map((e) => e.nota)].filter(Boolean);
    // («pH 6.4» o «6.02 ph», en cada texto por separado —si no, «400» de lo apuntado y «Ph 6.4» de la nota daban
    // «pH 400»—, y solo de 0 a 14)
    const l = [];
    for (const t of textos) {
      const delante = [...t.matchAll(/\bp\s?h\s*[:=]?\s*(\d{1,2}(?:[.,]\d+)?)/gi)].map((m) => m[1]);
      const detras = delante.length ? [] : [...t.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s*p\s?h\b/gi)].map((m) => m[1]);
      l.push(...[...delante, ...detras].filter((v) => Number(v.replace(',', '.')) <= 14));
    }
    return l.length ? l[l.length - 1].replace('.', ',') : null;
  };
  // Lo observado de una disolución (lo apuntado al prepararla, si no es una cantidad, y sus notas)
  const observadoDe = (c, d) => [d.preparada && !/^\s*\d+([.,]\d+)?\s*$/.test(d.preparada) ? d.preparada : null,
    ...c.entradas.filter((e) => e.disolucionId === d.id && e.nota && !esNotaDeCorreccion(e.nota)).sort((a, b) => a.fecha - b.fecha).map((e) => e.nota)].filter(Boolean).map(sinEmoji);
  // Lo de su composición distinto de la receta (concentraciones, purezas, densidades, riquezas; no volúmenes ni
  // masas, que cambian con la cantidad que se prepara)
  const distintoDeLaReceta = (d, receta) => {
    if (!receta) return [];
    return (d.composicion || []).filter((x) => !x.intermedio && !/\s(?:[µm]?L|[µmk]?g)$|partes?$/.test(x.texto || '')).map((x) => {
      const dato = receta.datos.find((y) => (x.id && y.id === x.id) || y.nombre === x.nombre);
      if (!dato || dato.valor == null) return null;
      const ahora = Q.cantidad(dato.valor, dato.unidad);
      return ahora !== x.texto ? `${x.nombre.charAt(0).toLowerCase()}${x.nombre.slice(1)} ${x.texto} (receta: ${ahora})` : null;
    }).filter(Boolean);
  };
  // { recorrido: 'F0, F1, F2, F1, F2…', lista: [diferencia] }, contando lo heredado del grupo del que salió
  const variacionesDe = (c, g) => {
    const receta = recetaDe(g.recetaId);
    const fases = fasesDe(receta);
    const historia = K.historiaDe(c, g.id).slice().sort((a, b) => a.fecha - b.fecha).map((e) => conNombresDeAhora(c, e));
    const pasadas = conPasadas(historia, ultimasDe(g)).filter((x) => x.tipo === 'pasada');
    const lista = [];
    const medidas = [];
    const veces = new Map();
    for (const p of pasadas) veces.set(p.fase, (veces.get(p.fase) || 0) + 1);
    const repetidas = fases.filter((f) => (veces.get(f) || 0) > 1).map((f) => `${faseCorta(f)} (${veces.get(f)} veces)`);
    if (repetidas.length) lista.push(`Repitió ${repetidas.join(', ')}`);
    const sinHacer = fases.filter((f) => !veces.has(f)).map(faseCorta);
    if (sinHacer.length) lista.push(`No realizó ${sinHacer.join(', ')}`);
    const vistas = new Set();
    for (const p of pasadas) {
      for (const x of p.disoluciones) {
        if (vistas.has(x.id)) continue;
        vistas.add(x.id);
        const d = (c.disoluciones || []).find((y) => y.id === x.id);
        if (!d) continue;
        // (lo de su composición distinto de la receta es una diferencia; el pH, o lo observado si no dice pH, es una
        // medición: va en su columna —versión 150, lo dijo el usuario: «lo del pH debería ser una observación, o medición»)
        const cambios = distintoDeLaReceta(d, receta);
        if (cambios.length) lista.push(`${faseCorta(p.fase)} con ${sinEmoji(d.nombre)}: ${cambios.join('; ')}`);
        const ph = phDe(c, d);
        const obs = ph ? [`pH ${ph}`] : observadoDe(c, d);
        if (obs.length) medidas.push(`${faseCorta(p.fase)}, ${sinEmoji(d.nombre)}: ${obs.join('; ')}`);
      }
      for (const t of p.distinto) lista.push(`${faseCorta(p.fase)}: ${sinEmoji(t)}`);
    }
    for (const e of historia) {
      if (e.tipo !== 'empezar' && e.tipo !== 'fase' && e.distinto) lista.push(sinEmoji(e.distinto));
      if (e.tipo === 'recibir') lista.push(`${actividadFormal(e)}${e.nota ? `: ${sinEmoji(e.nota)}` : ''}`);
      // (las medidas apuntadas en el grupo —capacitancia, espesor…—, también en su columna)
      if (e.tipo === 'medida') for (const m of e.medidas || []) medidas.push(`${m.nombre} ${K.numTexto(m.valor)}${m.unidad ? ` ${m.unidad}` : ''}`);
    }
    return { recorrido: pasadas.map((p) => `${faseCorta(p.fase)}${p.terminada ? '' : ' (sin terminar)'}`).join(', '), lista, medidas };
  };
  // Un item, dicho como en un informe: { cuando, que, detalles: [texto] }. figuras: id de apunte → «Figuras 3–5»
  const textoItem = (c, it, { figuras } = {}) => {
    const notas = (l) => l.map((x) => sinEmoji(x)).filter(Boolean);
    if (it.tipo === 'pasada') {
      const cuando = it.fin == null ? `desde el ${fechaHoraNum(it.fecha)}`
        : !it.desdeElPrincipio ? `hasta el ${fechaHoraNum(it.fin)}`
          : it.fin - it.fecha < 60000 ? fechaHoraNum(it.fecha) : `${fechaHoraNum(it.fecha)} – ${fechaHoraNum(it.fin)}`;
      const que = `${fasesNombre(it.fase)}${it.vez > 1 ? ` (${it.vez}.ª vez)` : ''}${!it.desdeElPrincipio ? ' (iniciada antes, en el grupo de procedencia)' : ''}${!it.terminada ? (it.enCurso ? ' (en curso)' : ' (sin final registrado)') : ''}`;
      return { cuando, que, detalles: [
        it.muestras != null && muestrasTexto(it.muestras),
        it.disoluciones.length > 0 && `Disolución empleada: ${it.disoluciones.map((x) => x.nombre).join(', ')}`,
        it.subfases.length > 0 && `Etapas completadas: ${it.subfases.map((s) => `${sinEmoji(s.nombre)} (${fechaHoraNum(s.fecha)})`).join('; ')}`,
        ...it.distinto.map((x) => `Modificación respecto al procedimiento: ${sinEmoji(x)}`),
        ...notas(it.notas),
        it.fotos.length > 0 && `${it.fotos.length} ${it.fotos.length === 1 ? 'imagen' : 'imágenes'}`,
      ].filter(Boolean) };
    }
    const e = it.e;
    const otros = e.evento ? c.entradas.filter((x) => x.evento === e.evento && x.id !== e.id).map((x) => { const g = K.grupoDe(c, x.grupoId); return g ? g.nombre : x.grupo; }).filter(Boolean) : [];
    const f = figuras && figuras.get(e.id);
    const fig = f && (f.desde === f.hasta ? `⟦F:f${f.desde}⟧` : `⟦FS:f${f.desde}:f${f.hasta}⟧`);
    return { cuando: `${fechaHoraNum(e.fecha)}${e.aprox ? ' (fecha aproximada)' : ''}`, que: actividadFormal(e), detalles: [
      e.tipo === 'preparar' && e.preparada && `Cantidad preparada: ${e.preparada}`,
      (e.disoluciones || []).length > 0 && `Disolución empleada: ${e.disoluciones.map((x) => x.nombre).join(', ')}`,
      otros.length > 0 && `Simultáneo con: ${otros.join(', ')}`,
      e.tipo === 'comparar' && (e.de || []).length > 0 && `Imágenes de: ${e.de.join(', ')}`,
      e.distinto && `Modificación respecto al procedimiento: ${sinEmoji(e.distinto)}`,
      sinEmoji(e.nota),
      (e.fotos || []).length > 0 && `${e.fotos.length} ${e.fotos.length === 1 ? 'imagen' : 'imágenes'}${fig ? ` (${fig})` : ''}`,
    ].filter(Boolean) };
  };
  // Lo que pasó con una disolución (preparar, notas, cambios de estado): [item]
  const historiaDisolucionPropia = (c, d) => c.entradas.filter((e) => e.disolucionId === d.id).sort((a, b) => a.fecha - b.fecha).map((e) => ({ tipo: e.tipo, fecha: e.fecha, e }));
  // Quién la usó y en qué fase: «2c ph 8.4 (Fase 4, 06/10/2026)»
  const empleoDe = (c, d) => {
    const usos = c.entradas.filter((e) => e.grupoId && (e.disoluciones || []).some((x) => x.id === d.id)).sort((a, b) => a.fecha - b.fecha);
    const vistos = new Map();
    for (const e of usos) {
      const g = K.grupoDe(c, e.grupoId);
      const k = `${e.grupoId}|${e.fase}`;
      if (!vistos.has(k)) vistos.set(k, `${g ? g.nombre : e.grupo} (${faseCorta(e.fase)}, ${fechaNum(e.fecha)})`);
    }
    return [...vistos.values()];
  };
  // Las notas de una disolución, en una línea
  const notasDisolucion = (c, d) => c.entradas.filter((e) => e.disolucionId === d.id && e.nota && !esNotaDeCorreccion(e.nota))
    .sort((a, b) => a.fecha - b.fecha).map((e) => `${sinEmoji(e.nota)} (${fechaNum(e.fecha)})`);
  // De su composición, lo que se pesó o midió y el volumen preparado (sin las cuentas intermedias)
  const loEsencial = (comp) => { const l = (comp || []).filter((x) => (x.cantidad && !x.intermedio) || /\s[µm]?L$/.test(x.texto)); return l.length ? l : comp || []; };

  // op: { conReceta, conAnterior, conHistoria (los grupos), conHistoriaDis (las disoluciones), fotos: 'analisis' | 'todas' | 'album:<id>' | 'ninguna', quitadas: [id] }
  // partes: [{ amb, ficha, receta }]: el cuaderno del informe y, si se quiere, los relacionados con él
  const modeloInforme = (c, partes, op) => {
    const principal = partes[0];
    const ficha = principal.ficha;
    const inf = ficha.informe || {};
    const varios = partes.length > 1;
    const B = [];
    // Los números de secciones, tablas y figuras NO van aquí (versión 134): se ponen al dibujar (numerar),
    // porque en un informe guardado se pueden quitar o mover cosas. Cada tabla y figura lleva su id (t1,
    // f2…) y los textos que las citan, una marca «⟦T:t1⟧», «⟦F:f2⟧» o «⟦FS:f2:f8⟧» (Figuras 2 a 8)
    const n = { tabla: 0, fig: 0 };
    // (cada parte que se pone o se quita con «Qué incluir» lleva su zona: así, en un informe guardado, se
    // puede quitar o volver a poner solo esa parte sin tocar lo demás; versión 142)
    const enZona = (zona, fn) => { const a = B.length; fn(); for (let k = a; k < B.length; k++) B[k].zona = zona; };
    const sec = (texto) => B.push({ t: 'h1', texto, num: true });
    const sub = (texto) => B.push({ t: 'h2', texto, num: true });
    const sinNumero = (texto) => B.push({ t: 'h1', texto, sinNumero: true });
    const anexo = (texto) => B.push({ t: 'h1', texto, sinNumero: true, anexo: true });
    // editar (versión 133): de dónde sale cada cosa, para cambiarla tocándola en el modo de editar
    // (lo que viene de la bitácora se cambia en la bitácora; lo de la receta, en la receta)
    const parrafos = (texto, clase, editar) => { for (const p of String(texto || '').split(/\n\s*\n/)) if (p.trim()) B.push({ t: 'p', texto: p.trim(), clase, editar }); };
    const lineas = (texto) => String(texto || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const tabla = (titulo, cab, filas, numericas = [], editarFilas) => { if (!filas.length) return; n.tabla++; B.push({ t: 'tabla', id: `t${n.tabla}`, titulo, cab, filas, numericas, editarFilas }); };
    // Un texto propio del informe: su sección si está escrito; si no, en el modo de editar, un hueco para escribirlo ahí
    const HUECOS = { resumen: 'el resumen', introduccion: 'la introducción', objetivos: 'los objetivos', discusion: 'la discusión', conclusiones: 'las conclusiones', referencias: 'las referencias' };
    const escrito = (clave, titulo, numerada, lista, sinNum) => {
      const ed = { tipo: 'texto', clave };
      if (!inf[clave]) { if (op.editando) B.push({ t: 'hueco', texto: `＋ Escribir ${HUECOS[clave]}`, editar: ed }); return; }
      if (sinNum) sinNumero(titulo); else sec(titulo);
      if (lista) B.push({ t: 'lista', items: lineas(inf[clave]), numerada, editar: ed });
      else parrafos(inf[clave], clave === 'resumen' ? 'resumen' : undefined, ed);
    };
    const y = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}` : l[0] || '');
    const casaAlguna = (x) => partes.some((p) => K.casa(x, p.amb));
    const cuadernoDeGrupo = (g) => (partes.find((p) => K.casa(g, p.amb)) || principal).ficha.nombre;
    // (las recetas, sin repetir: dos cuadernos pueden ir con la misma)
    const recetas = [];
    if (op.conReceta) for (const p of partes) if (p.receta.id && !recetas.some((r) => r.id === p.receta.id)) { const r = recetaDe(p.receta.id); if (r) recetas.push(r); }
    const grupos = partes.flatMap((p) => ordenFamilia(K.gruposDe(c, p.amb)).map((x) => x.g));
    const entradas = c.entradas.filter(casaAlguna).map((e) => conNombresDeAhora(c, e)).sort((a, b) => a.fecha - b.fecha);
    const disoluciones = partes.flatMap((p) => K.disolucionesDe(c, p.amb)).sort((a, b) => a.fecha - b.fecha);
    const medidas = { grupos: [], filas: [] };
    for (const p of partes) {
      const m = K.medidasDe(c, p.amb);
      medidas.grupos.push(...m.grupos);
      for (const f of m.filas) { const x = medidas.filas.find((z) => z.nombre === f.nombre); if (x) Object.assign(x.celdas, f.celdas); else medidas.filas.push({ ...f, celdas: { ...f.celdas } }); }
    }
    const distintos = entradas.filter((e) => e.distinto);
    const sinFases = (g) => !fasesDe(recetaDe(g.recetaId)).length;

    // Portada
    const periodo = entradas.length ? `del ${fechaLargaDe(entradas[0].fecha)} al ${fechaLargaDe(entradas[entradas.length - 1].fecha)}` : '';
    B.push({ t: 'portada', titulo: inf.titulo || `Informe de laboratorio: ${nombreDelTrabajo(ficha, principal.receta)}`, autores: inf.autores || '', institucion: inf.institucion || '',
      fecha: fechaLargaDe(Date.now()),
      detalles: [`${varios ? 'Cuadernos' : 'Cuaderno'}: ${partes.map((p) => p.ficha.nombre).join('; ')}`,
        recetas.length > 0 && `${recetas.length > 1 ? 'Procedimientos' : 'Procedimiento'}: ${recetas.map((r) => r.nombre).join('; ')}`,
        periodo && `Periodo de trabajo: ${periodo}`].filter(Boolean) });
    escrito('resumen', 'Resumen', false, false, true);
    escrito('introduccion', 'Introducción');
    escrito('objetivos', 'Objetivos', false, true);

    // Materiales y métodos
    if (recetas.length || grupos.length || disoluciones.length) {
      sec('Materiales y métodos');
      const deCual = (r) => (recetas.length > 1 ? `: ${r.nombre}` : '');
      enZona('procedimiento', () => { for (const rec of recetas) {
        const res = Q.calcular(rec);
        const valor = (x) => (x.id in res.valores ? Q.cantidad(res.valores[x.id], x.unidad) : '—');
        sub(`Reactivos y cantidades${deCual(rec)}`);
        if (rec.resumen) parrafos(rec.resumen, undefined, { tipo: 'receta', recetaId: rec.id, campo: 'resumen' });
        const nDatos = `⟦T:t${n.tabla + 1}⟧`;
        tabla(`Parámetros de partida del procedimiento${recetas.length > 1 ? ` ${rec.nombre}` : ''}.`, ['Parámetro', 'Valor'], rec.datos.map((d) => [d.nombre, valor(d)]), [1],
          rec.datos.map((d) => ({ tipo: 'abrirReceta', recetaId: rec.id, marca: 'data-dato', valor: d.id })));
        tabla(`Cantidades de reactivo calculadas a partir de los parámetros de la ${nDatos}.`, ['Cantidad', 'Valor'], rec.calculos.map((x) => [x.nombre, valor(x)]), [1],
          rec.calculos.map((x) => ({ tipo: 'abrirReceta', recetaId: rec.id, marca: 'data-calculo', valor: x.id })));
        const notas = lineas(rec.notas);
        if (notas.length) { B.push({ t: 'p', texto: 'Observaciones sobre los reactivos y materiales:' }); B.push({ t: 'lista', items: notas.map(sinEmoji), editar: { tipo: 'receta', recetaId: rec.id, campo: 'notas' } }); }
      } });
      if (disoluciones.length) {
        sub('Disoluciones preparadas');
        // (con quién se usó y sus notas: ahí suele estar lo importante, como el pH que se midió)
        tabla('Disoluciones preparadas durante el trabajo: cantidades empleadas en el momento de la preparación, grupos de muestras que las emplearon y observaciones.',
          ['Disolución', 'Cantidades', 'Empleada en', 'Observaciones'],
          disoluciones.map((d) => [`${d.nombre} (${fechaNum(d.fecha)})${d.preparada ? `. ${/^\d+([.,]\d+)?$/.test(d.preparada.trim()) ? 'Cantidad preparada' : 'Anotación'}: ${d.preparada}` : ''}`,
            loEsencial(d.composicion).map((x) => `${x.nombre}: ${x.texto}`).join('; ') || '—',
            empleoDe(c, d).join('; ') || '—', notasDisolucion(c, d).join('; ') || '—']), [], disoluciones.map((d) => ({ tipo: 'disolucion', id: d.id })));
      }
      enZona('procedimiento', () => { for (const rec of recetas) {
        if (!rec.pasos.length) continue;
        sub(`Procedimiento${deCual(rec)}`);
        const res = Q.calcular(rec);
        B.push({ t: 'p', texto: 'El protocolo seguido se transcribe a continuación tal como figura en el cuaderno, con las cantidades correspondientes a los parámetros indicados en el apartado anterior.' });
        rec.pasos.forEach((p, i) => {
          const ed = { tipo: 'abrirReceta', recetaId: rec.id, marca: 'data-paso', valor: String(i) };
          if (p.titulo) B.push({ t: 'p', texto: sinEmoji(p.titulo), clase: 'fase', editar: ed });
          if (p.subfase) B.push({ t: 'p', texto: sinEmoji(p.subfase), clase: 'subfase', editar: ed });
          const txt = sinEmoji(Q.trozosPaso(p.texto, rec, res).map((x) => x.texto).join(''));
          // (el tiempo y los ciclos, solo si el paso no los dice ya: si no, salía «durante 3 h. (3 h)»)
          const extra = [p.minutos && !txt.includes(Q.duracion(p.minutos)) && Q.duracion(p.minutos), p.ciclos && !/ciclo/i.test(txt) && `${p.ciclos} ciclos`].filter(Boolean).join(', ');
          B.push({ t: 'paso', n: i + 1, texto: `${txt}${extra ? ` (${extra})` : ''}`, editar: ed });
        });
        if (rec.seguridad) B.push({ t: 'p', texto: `Precauciones: ${sinEmoji(rec.seguridad)}`, clase: 'nota', editar: { tipo: 'receta', recetaId: rec.id, campo: 'seguridad' } });
      } });
      if (grupos.length) {
        sub('Muestras');
        const origen = (g) => {
          if (g.padre) { const p = K.grupoDe(c, g.padre); return `Separado del grupo ${p ? p.nombre : 'de origen'} (${fechaNum(g.desde)})`; }
          if (g.vieneDe) {
            const o = K.grupoDe(c, g.vieneDe);
            return o && casaAlguna(o) ? `Continuación del grupo ${o.nombre}${varios ? ` (cuaderno ${cuadernoDeGrupo(o)})` : ''}, ${fechaNum(g.vieneDesde)}`
              : `Procedente del cuaderno ${g.vieneCuaderno || 'anterior'} (${fechaNum(g.vieneDesde)})`;
          }
          return 'Lote inicial';
        };
        // n: al formarse el grupo → al cierre (antes solo al cierre: «0» en los que ya habían pasado a otro sitio parecía que no tenían)
        const nTexto = (g) => { const a = muestrasAlEmpezar(c, g); const b = g.muestras; return a == null && b == null ? '—' : a == null || a === b ? String(b ?? a) : `${a} → ${b ?? '—'}`; };
        B.push({ t: 'p', texto: `Las muestras se organizaron en ${grupos.length} ${grupos.length === 1 ? 'grupo' : 'grupos'}; cada grupo reúne muestras que siguieron el mismo recorrido por el procedimiento. Un grupo nuevo se forma al separar parte de las muestras de otro.` });
        tabla('Grupos de muestras estudiados. n: número de muestras al formarse el grupo → al cierre del informe.', ['Grupo', ...(varios ? ['Cuaderno'] : []), 'n', 'Origen', 'Características'],
          grupos.map((g) => [g.nombre, ...(varios ? [cuadernoDeGrupo(g)] : []), nTexto(g), origen(g), sinEmoji(g.caracteristicas) || '—']), [varios ? 2 : 1],
          grupos.map((g) => ({ tipo: 'grupo', id: g.id })));
      }
    }

    // Resultados
    const quitadas = new Set(op.quitadas || []);
    const fotos = [];
    if (op.fotos && op.fotos !== 'ninguna') {
      if (op.fotos.startsWith('album:')) {
        const a = c.albumes.find((x) => x.id === op.fotos.slice(6));
        for (const id of (a ? a.fotos : [])) {
          const e = entradas.find((x) => (x.fotos || []).includes(id));
          if (e) fotos.push({ id, e, apartado: K.infoFoto(e, id).apartado || '' });
        }
      } else {
        for (const e of entradas) {
          if (!(e.fotos || []).length || (op.fotos === 'analisis' && K.tipoFoto(e) !== 'analisis')) continue;
          for (const a of K.apartadosDe(e)) for (const id of a.fotos) fotos.push({ id, e, apartado: a.titulo });
        }
      }
    }
    // Por fases (versión 131, lo pidió el usuario: «las figuras se deberían ordenar por fases, la fase 1, la
    // fase 2…»): primero el cuaderno, luego la fase en el orden de su receta (la de la foto: la que el grupo
    // estaba haciendo o acababa de terminar) y, dentro de cada fase, por fecha. Lo que no es de ninguna
    // fase, al final de su cuaderno
    const fotosVan = fotos.filter((f) => !quitadas.has(f.id)).map((f, i) => {
      const pi = Math.max(0, partes.findIndex((p) => K.casa(f.e, p.amb)));
      const fase = K.faseDeEntrada(c, f.e);
      const fi = fasesDe(recetaDe(f.e.recetaId)).indexOf(fase);
      return { ...f, i, pi, fase: fi < 0 ? '' : fase, fi: fi < 0 ? Infinity : fi };
    }).sort((a, b) => a.pi - b.pi || a.fi - b.fi || a.e.fecha - b.e.fecha || a.i - b.i);
    const arboles = partes.filter((p) => p.receta.id && K.gruposDe(c, p.amb).length).map((p) => ({ p, el: arbolDeMuestras(c, p.receta, () => {}, p.amb, 0, true) }));
    const figuras = new Map(); // id de apunte → «Figura 3» o «Figuras 3–5» (para el anexo)
    if (grupos.length || medidas.filas.length || fotosVan.length || distintos.length) {
      sec('Resultados');
      if (grupos.length) {
        sub('Seguimiento de las muestras');
        // Una fila por grupo con lo que hizo ÉL (desde que se formó): lo de antes está en la fila del grupo
        // del que salió (antes salían todas las fases desde el principio, iguales en casi todos)
        const resumen = (g) => {
          const items = historiaPropia(c, g);
          const fasesTxt = items.filter((x) => x.tipo === 'pasada').map((p) => `${faseCorta(p.fase)}${p.vez > 1 ? ` (${p.vez}.ª vez)` : ''}${p.terminada ? '' : p.enCurso ? ' (en curso)' : ' (sin terminar)'}`).join(', ');
          const tecnicas = new Map();
          for (const it of items.filter((x) => x.tipo === 'analisis')) { const t = sinEmoji(it.e.tecnica) || 'Otra'; tecnicas.set(t, (tecnicas.get(t) || 0) + 1); }
          const fechas = items.map((x) => x.fin || x.fecha).concat(items.map((x) => x.fecha));
          const inicio = g.desde || g.vieneDesde || (fechas.length ? Math.min(...fechas) : null);
          const periodoG = inicio != null && fechas.length ? `${fechaNum(inicio)} – ${fechaNum(Math.max(...fechas))}` : '—';
          return [g.nombre, ...(varios ? [cuadernoDeGrupo(g)] : []), fasesTxt || '—', [...tecnicas].map(([t, k]) => (k > 1 ? `${t} (${k})` : t)).join(', ') || '—', periodoG,
            sinFases(g) && !['juntado', 'pasado'].includes(estadoGrupo(c, g).estado) ? '—' : estadoFormal(estadoGrupo(c, g))];
        };
        const nArbol = arboles.length ? n.fig + 1 : null;
        const laTabla = `⟦T:t${n.tabla + 1}⟧`;
        B.push({ t: 'p', texto: `${nArbol ? `La ${arboles.length > 1 ? `⟦FS:f${nArbol}:f${nArbol + arboles.length - 1}⟧ muestran` : `⟦F:f${nArbol}⟧ muestra`} el recorrido de cada grupo por las fases del procedimiento, y la ${laTabla} lo resume` : `La ${laTabla} resume el recorrido de cada grupo`}. Para no repetir, de cada grupo se indica solo lo que hizo desde que se formó: lo anterior corresponde al grupo del que procede.` });
        for (const { p, el } of arboles) {
          n.fig++;
          const hay = (sel) => Boolean(el.querySelector(sel));
          const leyenda = [
            'Cada línea vertical representa un grupo de muestras y cada fila, una fase del procedimiento',
            'una rama indica que parte de las muestras pasó a formar un grupo nuevo',
            hay('.arbol-vuelta') && 'el trazo discontinuo curvo (↺), la repetición de fases anteriores',
            hay('.arbol-analisis') && 'los rombos (◆), las caracterizaciones',
            hay('.arbol-junta') && 'la línea de puntos, la unión de dos grupos',
            hay('.arbol-llegada') && 'el triángulo (▼), muestras procedentes de otro cuaderno',
            'el trazo horizontal final, un grupo detenido en esa fase, y el círculo, un grupo en curso',
            hay('.arbol-carpeta') && 'los grupos se reparten en las series indicadas en la parte superior',
          ].filter(Boolean);
          // (amb: para volver a dibujarlo en un informe guardado, que no guarda el dibujo)
          B.push({ t: 'arbol', id: `f${n.fig}`, amb: { recetaId: p.amb.recetaId, cuadernoId: p.amb.cuadernoId }, titulo: `Recorrido de los grupos de muestras por el procedimiento${varios ? ` (cuaderno ${p.ficha.nombre})` : ''}. ${leyenda.join('; ')}. n: número de muestras.`, el });
        }
        tabla('Resumen de lo realizado por cada grupo desde su formación. Fases: «2.ª vez», fase ya realizada antes por el grupo o por el grupo del que procede; Caracterización: técnica y número de sesiones.',
          ['Grupo', ...(varios ? ['Cuaderno'] : []), 'Fases', 'Caracterización', 'Periodo', 'Estado al cierre'], grupos.map(resumen), [], grupos.map((g) => ({ tipo: 'grupo', id: g.id })));
        // Los grupos que llegaron al final, con su recorrido entero y en qué se apartaron del procedimiento (versión 149)
        const finales = grupos.filter((g) => esGrupoFinal(c, g));
        if (op.conVariaciones && finales.length) enZona('variaciones', () => {
          sub('Diferencias de los grupos finales respecto al procedimiento');
          B.push({ t: 'p', texto: `La ⟦T:t${n.tabla + 1}⟧ recoge, para cada grupo que llegó al final del trabajo, su recorrido completo por las fases (incluido lo realizado antes de separarse del grupo del que procede) y en qué se apartó del procedimiento: fases repetidas o no realizadas, disoluciones con condiciones distintas de las indicadas, modificaciones anotadas y muestras incorporadas de otros grupos. Aparte se recogen las mediciones y observaciones de cada uno, como el pH de las disoluciones empleadas.` });
          tabla('Grupos finales: recorrido completo y diferencias respecto al procedimiento. n: número de muestras al final.',
            ['Grupo', ...(varios ? ['Cuaderno'] : []), 'n', 'Recorrido', 'Diferencias respecto al procedimiento', 'Mediciones y observaciones', 'Estado al cierre'],
            finales.map((g) => {
              const v = variacionesDe(c, g);
              const nf = muestrasFinales(c, g);
              return [g.nombre, ...(varios ? [cuadernoDeGrupo(g)] : []), nf == null ? '—' : String(nf), v.recorrido || '—', v.lista.length ? `${v.lista.join('. ')}.` : 'Ninguna',
                v.medidas.length ? `${v.medidas.join('. ')}.` : '—', sinFases(g) ? '—' : estadoFormal(estadoGrupo(c, g))];
            }), [varios ? 2 : 1], finales.map((g) => ({ tipo: 'grupo', id: g.id })));
        });
      }
      if (medidas.filas.length) {
        sub('Medidas');
        tabla('Última medida de cada magnitud en cada grupo (entre paréntesis, cuántas veces se midió).', ['Magnitud', ...medidas.grupos.map((g) => g.nombre)],
          medidas.filas.map((f) => [f.nombre, ...medidas.grupos.map((g) => { const x = f.celdas[g.id]; return x ? `${K.numTexto(x.valor)}${x.unidad ? ` ${x.unidad}` : ''}${x.n > 1 ? ` (${x.n})` : ''}` : '—'; })]),
          medidas.grupos.map((_, i) => i + 1));
      }
      if (fotosVan.length) enZona('fotos', () => {
        sub('Caracterización');
        // Una figura por sesión (un apunte) y apartado, con sus fotos como paneles (a), (b)… y un pie común
        // (antes, una figura por foto: 35 figuras casi iguales). Tocar un panel cambia su texto o lo quita;
        // tocar el pie, la descripción de la figura (inf.figuras[clave])
        const pies = inf.pies || {};
        const descripciones = inf.figuras || {};
        const conjuntos = [];
        for (const f of fotosVan) {
          const ult = conjuntos[conjuntos.length - 1];
          if (ult && ult.e === f.e && ult.apartado === f.apartado && ult.fotos.length < 6) ult.fotos.push(f.id);
          else conjuntos.push({ e: f.e, apartado: f.apartado, fotos: [f.id], sigue: Boolean(ult && ult.e === f.e && ult.apartado === f.apartado), fase: f.fase, pi: f.pi });
        }
        // (un título por fase encima de sus figuras, si hay más de una fase o más de un cuaderno)
        const deVarios = new Set(conjuntos.map((k) => k.pi)).size > 1;
        const rotulo = (k) => `${deVarios ? `${partes[k.pi].ficha.nombre}: ` : ''}${k.fase ? fasesNombre(k.fase) : 'Otras imágenes'}`;
        const conRotulos = new Set(conjuntos.map(rotulo)).size > 1;
        B.push({ t: 'p', texto: `Las imágenes obtenidas se ordenan por fase del procedimiento y, dentro de cada fase, por sesión de trabajo${conjuntos.length > 1 ? ` (⟦FS:f${n.fig + 1}:f${n.fig + conjuntos.length}⟧)` : ` (⟦F:f${n.fig + 1}⟧)`}. En cada pie se indican el grupo de muestras, la etapa del procedimiento en la que se encontraba y, cuando se registraron, el aumento y la zona observada.` });
        let rotuloAntes = null;
        for (const [ik, k] of conjuntos.entries()) {
          if (conRotulos && rotulo(k) !== rotuloAntes) { rotuloAntes = rotulo(k); B.push({ t: 'p', clase: 'fase', texto: rotuloAntes }); }
          n.fig++;
          const e = k.e;
          figuras.set(e.id, figuras.has(e.id) ? { ...figuras.get(e.id), hasta: n.fig } : { desde: n.fig, hasta: n.fig });
          const clave = `${e.id}|${k.apartado || ''}`;
          const momento = sinEmoji(K.momentoDe(c, e.grupoId, e.fecha)).replace(/ · /g, ', ');
          const que = e.tipo === 'analisis' ? `Imágenes de ${sinEmoji(e.tecnica) || 'caracterización'}` : e.tipo === 'preparar' ? `Imágenes de la disolución ${e.disolucion}` : 'Imágenes';
          const de = e.grupo ? ` del grupo ${(K.grupoDe(c, e.grupoId) || e).nombre || e.grupo}` : e.disolucion && e.tipo !== 'preparar' ? ` de la disolución ${e.disolucion}` : '';
          const cuando = momento && momento !== 'sin empezar' ? `, ${momento.replace(/^tras (fase)/i, 'tras la $1').replace(/^en (fase)/i, 'durante la $1').replace(/^en /, 'durante ')}` : '';
          const cabeza = `${que}${de}${cuando}${k.apartado ? ` (${sinEmoji(k.apartado)})` : ''}, ${fechaNum(e.fecha)}${k.sigue ? ' (continuación)' : ''}`;
          const desc = !k.sigue && descripciones[clave] ? `${sinEmoji(descripciones[clave])}${/[.!?]$/.test(descripciones[clave].trim()) ? '' : '.'}` : '';
          // (las letras (a), (b)… y el pie entero se ponen al dibujar: pieFotos, en numerar)
          const paneles = k.fotos.map((id) => {
            const info = K.infoFoto(e, id);
            const propio = pies[id] || c.titulos[id] || '';
            return { id, texto: [sinEmoji(propio), info.aumento, info.zona && `zona: ${info.zona}`].filter(Boolean).join(', ') };
          });
          // Lo que se escribió al hacer las fotos (la nota del apunte), debajo de las imágenes de esa sesión
          // (versión 132, lo pidió el usuario; antes solo salía en el anexo). Si la sesión ocupa varias
          // figuras, debajo de la última
          const ultimaDeLaSesion = !conjuntos[ik + 1] || conjuntos[ik + 1].e !== e;
          const observaciones = ultimaDeLaSesion ? sinEmojiLineas(e.nota) : '';
          B.push({ t: 'fotos', id: `f${n.fig}`, clave, entradaId: e.id, finSesion: ultimaDeLaSesion, paneles, observaciones, cabeza, desc });
        }
      });
      if (distintos.length) {
        sub('Desviaciones respecto al procedimiento');
        tabla('Modificaciones respecto al procedimiento escrito, registradas al finalizar cada fase.', ['Fecha', 'Grupo', 'Fase', 'Modificación'],
          distintos.map((e) => [fechaNum(e.fecha), e.grupo || e.disolucion || '—', e.fase ? fasesNombre(e.fase) : '—', sinEmoji(e.distinto)]), [], distintos.map((e) => ({ tipo: 'apuntes', ids: [e.id], campo: 'distinto' })));
      }
    }
    escrito('discusion', 'Discusión');
    escrito('conclusiones', 'Conclusiones', false, true);
    escrito('referencias', 'Referencias', true, true, true);

    // Anexos
    // La historia de cada grupo y de cada disolución, sin repetir (antes, todos los apuntes seguidos en una
    // tabla: lo de un grupo y lo de los que salieron de él se mezclaban)
    const linea = (it) => { const t = textoItem(c, it, { figuras }); return `${t.cuando.charAt(0).toUpperCase()}${t.cuando.slice(1)}: ${t.que}.${t.detalles.length ? ` ${t.detalles.map((x) => `${x}${/[.!?)]$/.test(x) ? '' : '.'}`).join(' ')}` : ''}`; };
    // (cada línea se cambia tocándola: la nota de sus apuntes)
    const deItem = (it) => ({ tipo: 'apuntes', ids: it.tipo === 'pasada' ? it.entradas.map((x) => x.id) : [it.e.id] });
    // (versión 147, lo pidió el usuario: la historia de los grupos y la de las disoluciones, en dos anexos que se
    // ponen o se quitan cada uno por su lado; antes, uno solo «Historia de cada grupo y disolución»)
    // (sin los cambios de estado —«queda poca», «desechada»—: sirven para organizarse, no para el informe; lo demás de
    // cada disolución ya está en su tabla; versión 148, lo dijo el usuario)
    const historiaDisInforme = (d) => historiaDisolucionPropia(c, d).filter((it) => it.tipo !== 'estado');
    const disConHistoria = disoluciones.filter((d) => historiaDisInforme(d).length);
    const sueltas = entradas.filter((e) => !e.grupoId && !e.disolucionId);
    if (op.conHistoria && (grupos.length || sueltas.length)) enZona('historia', () => {
      anexo('Historia de cada grupo');
      B.push({ t: 'p', texto: 'Transcripción de las anotaciones del cuaderno de laboratorio. De cada grupo se recoge solo lo realizado desde que se formó; lo anterior figura en el grupo del que procede. Cada fase realizada aparece una sola vez, con su inicio y su final.' });
      for (const g of grupos) {
        const items = historiaPropia(c, g);
        const p = g.padre && K.grupoDe(c, g.padre);
        const edG = { tipo: 'grupo', id: g.id };
        B.push({ t: 'p', clase: 'fase', editar: edG, texto: `Grupo ${g.nombre}${varios ? ` (cuaderno ${cuadernoDeGrupo(g)})` : ''}${p ? `, separado del grupo ${p.nombre}` : g.vieneDe ? ', procedente de otro cuaderno' : ', lote inicial'}` });
        // (una raya o espacios no son características: salía «Características: —»)
        if (/[\p{L}\p{N}]/u.test(g.caracteristicas || '')) B.push({ t: 'p', clase: 'nota', editar: edG, texto: `Características: ${sinEmoji(g.caracteristicas)}` });
        B.push({ t: 'lista', items: items.length ? items.map(linea) : ['Sin anotaciones propias.'], editarItems: items.map(deItem) });
      }
      if (sueltas.length) {
        B.push({ t: 'p', clase: 'fase', texto: 'Otras anotaciones' });
        B.push({ t: 'lista', items: sueltas.map((e) => linea({ tipo: e.tipo, fecha: e.fecha, e })), editarItems: sueltas.map((e) => ({ tipo: 'apuntes', ids: [e.id] })) });
      }
    });
    if (op.conHistoriaDis && disConHistoria.length) enZona('historiaDis', () => {
      anexo('Historia de cada disolución');
      B.push({ t: 'p', texto: 'Transcripción de las anotaciones del cuaderno sobre cada disolución: su preparación, las observaciones y los cambios de estado.' });
      for (const d of disConHistoria) {
        const items = historiaDisInforme(d);
        // (sin repetir «Disolución» si su nombre ya empieza así: salía «Disolución Disolución CuO nº 1»; versión 144)
        B.push({ t: 'p', clase: 'fase', texto: /^disoluci[oó]n\b/i.test(d.nombre) ? d.nombre : `Disolución ${d.nombre}`, editar: { tipo: 'disolucion', id: d.id } });
        B.push({ t: 'lista', items: items.map(linea), editarItems: items.map(deItem) });
      }
    });
    if (op.conAnterior) enZona('anterior', () => {
      // Lo que hicieron antes, en un cuaderno que no entra en el informe: una tabla por cuaderno de
      // procedencia, cada operación una sola vez
      const porCuaderno = new Map();
      for (const g of grupos.filter((x) => x.vieneDe)) {
        const o = K.grupoDe(c, g.vieneDe);
        if (o && casaAlguna(o)) continue;
        for (const tr of K.historiaAnterior(c, g.id)) {
          if (!porCuaderno.has(tr.cuaderno)) porCuaderno.set(tr.cuaderno, { grupos: [], entradas: new Map() });
          const pc = porCuaderno.get(tr.cuaderno);
          if (!pc.grupos.includes(g.nombre)) pc.grupos.push(g.nombre);
          for (const e of tr.entradas.filter((x) => x.tipo !== 'comparar')) pc.entradas.set(e.id, e);
        }
      }
      if (porCuaderno.size) {
        anexo('Historia anterior de las muestras');
        for (const [cuad, pc] of porCuaderno) {
          tabla(`Operaciones realizadas en el cuaderno ${cuad} sobre las muestras ${pc.grupos.length > 1 ? `de los grupos ${y(pc.grupos)}` : `del grupo ${pc.grupos[0]}`}, antes de su traslado a este cuaderno.`,
            ['Fecha', 'Grupo', 'Operación', 'Observaciones'],
            [...pc.entradas.values()].sort((a, b) => a.fecha - b.fecha).map((e) => { const x = conNombresDeAhora(c, e); return [fechaNum(e.fecha), x.grupo || '—', actividadFormal(x), [sinEmoji(e.distinto), sinEmoji(e.nota)].filter(Boolean).join('. ') || '—']; }));
        }
      }
    });
    for (const p of partes) {
      if (p.ficha.notas && String(p.ficha.notas).trim()) { anexo(varios ? `Notas del cuaderno ${p.ficha.nombre}` : 'Notas del cuaderno'); parrafos(p.ficha.notas, 'texto', { tipo: 'notasCuaderno', cuadernoId: p.ficha.id, recetaId: p.amb.recetaId || null, nombre: p.ficha.nombre }); }
    }
    if (B.length === 1) B.push({ t: 'p', texto: 'Aún no hay nada apuntado en este cuaderno.', clase: 'nota' });
    return B;
  };

  // ── Todos los datos en un texto, para pasárselo a una IA (versión 129; el usuario: «usar IAs en el
  // informe prefiero hacerlo luego por mi cuenta; para eso necesito todos los datos: que haya otro texto
  // para descargar y mandarle a una IA con todos los datos… que esté toda la información importante»).
  // Markdown (lo entienden bien), con TODO (no depende de «Qué incluir», salvo los cuadernos que entran)
  // y sin repetir: la historia de cada grupo es solo la suya. Las imágenes no van (son archivos): se dice
  // de cada una su nombre de archivo original, para adjuntarlas si se quiere ──
  const textoParaIA = async (c, partes) => {
    const principal = partes[0];
    const inf = principal.ficha.informe || {};
    const L = [];
    const md = (s) => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' / ').trim();
    const tablaMd = (cab, filas) => { if (!filas.length) return; L.push(`| ${cab.join(' | ')} |`, `|${cab.map(() => ' --- ').join('|')}|`, ...filas.map((f) => `| ${f.map((x) => md(x) || '—').join(' | ')} |`), ''); };
    const lineas = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const casaAlguna = (x) => partes.some((p) => K.casa(x, p.amb));
    const grupos = partes.flatMap((p) => ordenFamilia(K.gruposDe(c, p.amb)).map((x) => ({ ...x, p })));
    const entradas = c.entradas.filter(casaAlguna).map((e) => conNombresDeAhora(c, e)).sort((a, b) => a.fecha - b.fecha);
    const disoluciones = partes.flatMap((p) => K.disolucionesDe(c, p.amb)).sort((a, b) => a.fecha - b.fecha);
    const nombreGrupo = (id, porDefecto) => { const g = K.grupoDe(c, id); return g ? g.nombre : porDefecto; };

    L.push(`# Datos de laboratorio: ${inf.titulo || nombreDelTrabajo(principal.ficha, principal.receta)}`, '');
    L.push(`Datos exportados el ${fechaHoraNum(Date.now())} de «Química», un cuaderno de laboratorio digital. Contienen todo lo registrado: el procedimiento con sus cantidades, las disoluciones preparadas, los grupos de muestras con su historia, los análisis, las medidas, los datos de cada imagen y las notas.`, '');
    L.push('Cómo leerlo:', '- Las muestras se organizan en **grupos**: muestras que siguieron el mismo recorrido. Un grupo nuevo se forma al separar parte de las muestras de otro; cada grupo solo incluye lo que hizo él desde que se formó (lo anterior está en el grupo del que procede). Así no se repite nada.',
      '- Una **fase** realizada aparece una vez, con su inicio y su final. «2.ª vez» indica que el grupo (o el grupo del que procede) ya la había hecho antes.',
      '- Las cantidades del procedimiento son las de ahora. Las de cada disolución son las que se usaron al prepararla.',
      '- Las imágenes no van en este texto; de cada una se da su nombre de archivo original, para poder adjuntarla.',
      '- Fechas: día/mes/año y hora de 24 h.', '');

    // Lo que ya ha escrito el autor
    const escritos = TEXTOS_INFORME.filter(([k]) => inf[k]);
    if (escritos.length) {
      L.push('## Textos ya escritos por el autor', '');
      for (const [k, rotulo] of escritos) L.push(`### ${rotulo}`, String(inf[k]).trim(), '');
    }

    // Cuadernos
    L.push('## Cuadernos', '');
    for (const p of partes) {
      const suyas = entradas.filter((e) => K.casa(e, p.amb));
      L.push(`- **${p.ficha.nombre}**: ${p.receta.id ? `procedimiento «${p.receta.nombre}»` : 'sin procedimiento escrito'}; ${K.gruposDe(c, p.amb).length} grupos de muestras; ${suyas.length} anotaciones${suyas.length ? `, del ${fechaNum(suyas[0].fecha)} al ${fechaNum(suyas[suyas.length - 1].fecha)}` : ''}.${p.ficha.nota ? ` De qué va: ${md(p.ficha.nota)}` : ''}`);
    }
    L.push('');

    // Procedimientos
    const recetas = [];
    for (const p of partes) if (p.receta.id && !recetas.some((r) => r.id === p.receta.id)) { const r = recetaDe(p.receta.id); if (r) recetas.push(r); }
    for (const rec of recetas) {
      const res = Q.calcular(rec);
      const valor = (x) => (x.id in res.valores ? Q.cantidad(res.valores[x.id], x.unidad) : 'sin escribir');
      L.push(`## Procedimiento: ${rec.nombre}`, '');
      if (rec.resumen) L.push(sinEmoji(rec.resumen), '');
      L.push('### Parámetros de partida', '');
      tablaMd(['Parámetro', 'Valor', 'Fórmula química'], rec.datos.map((d) => [d.nombre, valor(d), d.formula || '']));
      L.push('### Cantidades calculadas', '');
      tablaMd(['Cantidad', 'Valor', 'Cómo se calcula', 'Con los números'], rec.calculos.map((x) => [x.nombre, valor(x), Q.leerFormula(x, rec) || x.expr || '', Q.formulaConNumeros(x, rec, res) || '']));
      L.push('### Pasos', '');
      rec.pasos.forEach((p, i) => {
        if (p.titulo) L.push('', `**${sinEmoji(p.titulo)}**`);
        if (p.subfase) L.push(`*${sinEmoji(p.subfase)}*${p.parte === 'disolucion' ? ' (se prepara una disolución)' : p.parte === 'muestras' ? ' (con las muestras)' : ''}`);
        const txt = sinEmoji(Q.trozosPaso(p.texto, rec, res).map((x) => x.texto).join(''));
        const extra = [p.minutos && `cronómetro: ${Q.duracion(p.minutos)}`, p.ciclos && `${p.ciclos} ciclos`].filter(Boolean).join('; ');
        L.push(`${i + 1}. ${txt}${extra ? ` (${extra})` : ''}`);
      });
      L.push('');
      if (rec.notas) L.push('### Notas sobre reactivos y materiales', ...lineas(rec.notas).map((x) => `- ${sinEmoji(x)}`), '');
      if (rec.seguridad) L.push('### Seguridad', sinEmoji(rec.seguridad), '');
    }

    // Disoluciones
    if (disoluciones.length) {
      L.push('## Disoluciones preparadas', '');
      for (const d of disoluciones) {
        L.push(`### ${d.nombre}`, `- Preparada el ${fechaHoraNum(d.fecha)}${d.fase ? `, en ${fasesNombre(d.fase)}` : ''}${d.subfase ? ` (${sinEmoji(d.subfase)})` : ''}.${d.preparada ? ` Cantidad o detalle apuntado: ${md(d.preparada)}.` : ''}`);
        if ((d.composicion || []).length) L.push(`- Composición al prepararla: ${d.composicion.map((x) => `${x.nombre}: ${x.texto}${x.intermedio ? ' (cálculo intermedio)' : ''}`).join('; ')}.`);
        const usos = empleoDe(c, d);
        L.push(`- Empleada en: ${usos.length ? usos.join('; ') : 'ningún grupo apuntado'}.`);
        L.push(`- Estado actual: ${sinEmoji(K.ESTADOS[d.estado || 'queda']).toLowerCase()}${d.queda ? ` (queda: ${md(d.queda)})` : ''}.`);
        for (const it of historiaDisolucionPropia(c, d)) {
          if (it.tipo === 'preparar' && !it.e.nota && !(it.e.fotos || []).length) continue;
          const t = textoItem(c, it);
          L.push(`- ${t.cuando}: ${t.que}.${t.detalles.length ? ` ${t.detalles.join('. ')}.` : ''}`);
        }
        L.push('');
      }
    }

    // Grupos
    if (grupos.length) {
      L.push('## Grupos de muestras', '', 'Familia de grupos (cada uno debajo del grupo del que salió):', '');
      for (const { g, nivel, p } of grupos) {
        const a = muestrasAlEmpezar(c, g);
        L.push(`${'  '.repeat(nivel)}- ${g.nombre}${partes.length > 1 ? ` [cuaderno ${p.ficha.nombre}]` : ''}: ${a != null ? `${a} → ${g.muestras ?? '—'} muestras` : ''}; ${!fasesDe(recetaDe(g.recetaId)).length && !['juntado', 'pasado'].includes(estadoGrupo(c, g).estado) ? 'en un cuaderno sin fases' : estadoFormal(estadoGrupo(c, g))}`);
      }
      L.push('');
      for (const { g, p } of grupos) {
        const padre = g.padre && K.grupoDe(c, g.padre);
        const o = g.vieneDe && K.grupoDe(c, g.vieneDe);
        const a = muestrasAlEmpezar(c, g);
        L.push(`### Grupo «${g.nombre}»${partes.length > 1 ? ` (cuaderno ${p.ficha.nombre})` : ''}`);
        L.push(`- Origen: ${padre ? `separado del grupo «${padre.nombre}» el ${fechaHoraNum(g.desde)}` : o ? `continuación del grupo «${o.nombre}» del cuaderno ${g.vieneCuaderno || 'anterior'} (${fechaHoraNum(g.vieneDesde)})` : 'lote inicial'}.`);
        L.push(`- Muestras: ${a ?? '—'} al formarse, ${g.muestras ?? '—'} al cierre.`);
        if (/[\p{L}\p{N}]/u.test(g.caracteristicas || '')) L.push(`- Características: ${md(g.caracteristicas)}`);
        const est = estadoGrupo(c, g);
        if (!fasesDe(recetaDe(g.recetaId)).length && !['juntado', 'pasado'].includes(est.estado)) L.push('- Su cuaderno no tiene procedimiento con fases.');
        else L.push(`- Estado actual: ${estadoFormal(est)}.`);
        const items = historiaPropia(c, g);
        L.push(items.length ? '- Lo que hizo:' : '- No tiene anotaciones propias.');
        for (const it of items) {
          const t = textoItem(c, it);
          L.push(`  - ${t.cuando}: ${t.que}.${t.detalles.length ? ` ${t.detalles.map(md).join('. ')}.` : ''}`);
        }
        const meds = items.filter((x) => x.tipo === 'medida');
        if (meds.length) L.push(`- Medidas: ${meds.map((x) => `${K.lineasDeMedidas(x.e.medidas)} (${fechaNum(x.fecha)})`).join('; ')}.`);
        L.push('');
      }
    }

    // Imágenes
    const conFotos = entradas.filter((e) => (e.fotos || []).length);
    if (conFotos.length) {
      L.push('## Imágenes', '', 'Una tabla por sesión (cada anotación con imágenes). «Archivo» es el nombre del archivo original.', '');
      let s = 0;
      for (const e of conFotos) {
        s++;
        const quien = e.grupoId ? `grupo «${nombreGrupo(e.grupoId, e.grupo)}»` : e.disolucion ? `disolución ${e.disolucion}` : 'sin grupo';
        const momento = e.grupoId ? sinEmoji(K.momentoDe(c, e.grupoId, e.fecha)).replace(/ · /g, ', ') : '';
        L.push(`### Sesión ${s} (${fechaHoraNum(e.fecha)}): ${actividadFormal(e)}, ${quien}${momento ? ` (${momento})` : ''}`);
        if (e.nota) L.push(`Nota: ${md(e.nota)}`);
        const filas = [];
        for (const [i, id] of e.fotos.entries()) {
          const f = await window.Fotos.leer(id).catch(() => null);
          const info = K.infoFoto(e, id);
          filas.push([String(i + 1), f ? f.nombre || '' : '(no está en este aparato)', f ? `${f.ancho} × ${f.alto}` : '', info.aumento || '', info.zona || '', info.apartado || '', c.titulos[id] || (inf.pies || {})[id] || '']);
        }
        L.push('');
        tablaMd(['Nº', 'Archivo', 'Píxeles', 'Aumento', 'Zona', 'Apartado', 'Título o descripción'], filas);
      }
    }

    // Medidas
    const medidas = { grupos: [], filas: [] };
    for (const p of partes) {
      const m = K.medidasDe(c, p.amb);
      medidas.grupos.push(...m.grupos);
      for (const f of m.filas) { const x = medidas.filas.find((z) => z.nombre === f.nombre); if (x) Object.assign(x.celdas, f.celdas); else medidas.filas.push({ ...f, celdas: { ...f.celdas } }); }
    }
    if (medidas.filas.length) {
      L.push('## Medidas (la última de cada grupo; entre paréntesis, cuántas veces se midió)', '');
      tablaMd(['Magnitud', ...medidas.grupos.map((g) => g.nombre)], medidas.filas.map((f) => [f.nombre, ...medidas.grupos.map((g) => { const x = f.celdas[g.id]; return x ? `${K.numTexto(x.valor)}${x.unidad ? ` ${x.unidad}` : ''}${x.n > 1 ? ` (${x.n})` : ''}` : ''; })]));
    }

    // Lo demás
    const sueltas = entradas.filter((e) => !e.grupoId && !e.disolucionId);
    if (sueltas.length) {
      L.push('## Otras anotaciones', '');
      for (const e of sueltas) { const t = textoItem(c, { tipo: e.tipo, fecha: e.fecha, e }); L.push(`- ${t.cuando}: ${t.que}.${t.detalles.length ? ` ${t.detalles.map(md).join('. ')}.` : ''}`); }
      L.push('');
    }
    for (const p of partes) if (p.ficha.notas && String(p.ficha.notas).trim()) L.push(`## Notas libres del cuaderno ${p.ficha.nombre}`, '', String(p.ficha.notas).trim(), '');
    return L.join('\n').replace(/\n{3,}/g, '\n\n');
  };

  // ── Los números, al dibujar (versión 134): secciones (1., 1.1.), anexos (A, B…), tablas y figuras en
  // el orden en que están ahora, y las citas «⟦T:t1⟧» de los textos con el número que les toca (si la
  // tabla o la figura se quitó del informe, «(quitada)»). También las letras (a), (b)… de las imágenes
  // y el pie de cada figura de fotos (pieFotos). Devuelve una copia de los bloques, en el mismo orden, y
  // en .citas la función que pone los números (la usa el editor para guardar sin perder las marcas).
  // Versión 137 (el editor «como en Word»): los títulos llevan aparte su número (prefijo) y su texto
  // (textoPropio), las tablas qué columnas se ven (columnas) y las fotos lo de sus paneles (detalle)
  const detalleFotos = (paneles) => paneles.filter((p) => p.texto).map((p) => (p.letra ? `${p.letra} ${p.texto}` : p.texto)).join('; ');
  const pieFotos = (b, paneles) => {
    if (b.pie) return b.pie;
    const det = detalleFotos(paneles);
    return `${b.cabeza}.${b.desc ? ` ${b.desc}` : ''}${det ? ` ${det.charAt(0).toUpperCase()}${det.slice(1)}.` : ''}`;
  };
  const numerar = (B) => {
    const num = new Map();
    let t = 0;
    let f = 0;
    let s = 0;
    let ss = 0;
    let a = 0;
    const salida = B.map((b) => {
      if (b.t === 'tabla') { t++; num.set(b.id, { tipo: 'Tabla', n: t }); return { ...b, n: `Tabla ${t}` }; }
      if (b.t === 'arbol' || b.t === 'fotos') { f++; num.set(b.id, { tipo: 'Figura', n: f }); return { ...b, n: `Figura ${f}` }; }
      let prefijo = '';
      if (b.t === 'h1' && b.num) { s++; ss = 0; prefijo = `${s}. `; }
      else if (b.t === 'h2' && b.num) { ss++; prefijo = `${s ? `${s}.` : ''}${ss}. `; }
      else if (b.t === 'h1' && b.anexo) prefijo = `Anexo ${String.fromCharCode(65 + a++)}. `;
      if (b.t === 'h1' || b.t === 'h2') return { ...b, prefijo, textoPropio: b.texto, texto: `${prefijo}${b.texto}` };
      return b;
    });
    const citas = (x) => (typeof x !== 'string' ? x : x.replace(/⟦(T|F|FS):([^⟧]*)⟧/g, (todo, tipo, ids) => {
      const [i1, i2] = ids.split(':');
      const n1 = num.get(i1);
      const n2 = i2 && num.get(i2);
      if (tipo === 'FS' && n1 && n2 && n1.n !== n2.n) return `Figuras ${n1.n} a ${n2.n}`;
      const uno = n1 || n2;
      return uno ? `${uno.tipo} ${uno.n}` : `${tipo === 'T' ? 'tabla' : 'figura'} (quitada)`;
    }));
    const resultado = salida.map((b) => {
      const x = { ...b };
      for (const k of ['texto', 'textoPropio', 'titulo', 'observaciones', 'desc', 'cabeza', 'pie']) if (typeof x[k] === 'string') x[k] = citas(x[k]);
      if (x.items) x.items = x.items.map(citas);
      if (x.t === 'tabla') {
        // (las columnas quitadas en un informe guardado no se ven)
        const ver = x.cab.map((_, i) => !(x.ocultas || []).includes(i));
        x.columnas = x.cab.map((_, i) => i).filter((i) => ver[i]);
        x.cab = x.cab.filter((_, i) => ver[i]);
        const nuevo = new Map();
        ver.forEach((v, i) => { if (v) nuevo.set(i, nuevo.size); });
        x.numericas = (b.numericas || []).filter((i) => nuevo.has(i)).map((i) => nuevo.get(i));
        x.filas = x.filas.map((fila) => fila.map(citas).filter((_, i) => ver[i]));
      }
      if (x.t === 'fotos') {
        x.paneles = x.paneles.map((p, i) => ({ ...p, letra: x.paneles.length > 1 ? `(${String.fromCharCode(97 + i)})` : '' }));
        x.detalle = detalleFotos(x.paneles);
        x.titulo = pieFotos(x, x.paneles);
      }
      return x;
    });
    resultado.citas = citas;
    return resultado;
  };
  // El dibujo del árbol de un bloque: el que trae (al hacer el informe) o uno nuevo (en un informe
  // guardado, que no guarda el dibujo: sale con los datos de ahora)
  // nombres (versión 145): los nombres de los grupos «para el informe» ({ nombre de verdad: el del informe })
  const arbolDeBloque = (b) => {
    if (b.el) return b.el;
    const r = b.amb && b.amb.recetaId && recetaDe(b.amb.recetaId);
    const el = r ? arbolDeMuestras(leerCuaderno(), r, () => {}, K.ambito(b.amb.recetaId, b.amb.cuadernoId), 0, true) : null;
    if (el && b.nombres) {
      const recorrido = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = recorrido.nextNode(); t; t = recorrido.nextNode()) {
        const v = t.nodeValue.trim();
        if (b.nombres[v]) t.nodeValue = t.nodeValue.replace(v, b.nombres[v]);
      }
    }
    return el;
  };

  // El informe en la pantalla (y para imprimir). Devuelve { el, listo } (listo: cuando ya están las fotos).
  // edicion (versión 137, el editor «como en Word»; antes, cada cosa se cambiaba en un cuadro aparte): en el
  // modo de editar de un informe guardado, cada texto se escribe ahí mismo. Lo pone el editor:
  //   texto(el, ref, valor, { linea, pista }) — un trozo que se escribe (ref: { i, campo, fila, col, item })
  //   bloque(el, i) — el bloque i (para elegirlo y que la barra de herramientas diga qué se puede hacer)
  //   hueco(el, i) — «＋ Escribir el resumen…»;  panel(el, i, pi) — una imagen;  reordenar(listas) — fotos arrastradas
  const informeHtml = (B0, { edicion: E } = {}) => {
    const B = numerar(B0);
    const esperas = [];
    const caja = h('article', { class: `informe formal${E ? ' editando' : ''}` });
    const tx = (etiqueta, props, ref, valor, op = {}) => {
      const el = h(etiqueta, props);
      if (E) return E.texto(el, ref, valor || '', op);
      el.textContent = valor || '';
      return el;
    };
    // (cada bloque lleva su número: así el índice salta a él y sabe por dónde se va, también sin editar)
    const bl = (el, i) => { el.dataset.i = String(i); return E ? E.bloque(el, i) : el; };
    const may = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
    B.forEach((b, i) => {
      if (b.t === 'portada') {
        const c = (campo) => ({ i, campo });
        caja.append(bl(h('header', { class: 'informe-portada' },
          tx('h1', {}, c('titulo'), b.titulo, { linea: true }),
          (b.autores || E) && tx('p', { class: 'informe-autores' }, c('autores'), b.autores, { linea: true, pista: 'Autor o autores' }),
          (b.institucion || E) && tx('p', { class: 'informe-institucion' }, c('institucion'), b.institucion, { linea: true, pista: 'Centro, departamento o grupo' }),
          tx('p', { class: 'informe-fecha' }, c('fecha'), b.fecha, { linea: true }),
          tx('p', { class: 'informe-detalles' }, c('detalles'), b.detalles.join(' · '))), i));
      } else if (b.t === 'h1' || b.t === 'h2') {
        caja.append(bl(h(b.t === 'h1' ? 'h2' : 'h3', { class: b.anexo ? 'anexo' : null },
          E && b.prefijo && h('span', { class: 'informe-prefijo', text: b.prefijo }),
          E ? tx('span', {}, { i, campo: 'texto' }, b.textoPropio, { linea: true, pista: 'Título' }) : b.texto), i));
      } else if (b.t === 'hueco') { if (E) caja.append(E.hueco(h('p', { class: 'informe-hueco', text: b.texto }), i)); }
      else if (b.t === 'salto') caja.append(bl(h('div', { class: 'informe-salto' }, E && h('span', { text: 'Salto de página' })), i));
      else if (b.t === 'p') caja.append(bl(tx('p', { class: b.clase ? `informe-${b.clase}` : null }, { i, campo: 'texto' }, b.texto, { pista: 'Escribe aquí…' }), i));
      else if (b.t === 'paso') caja.append(bl(h('p', { class: 'informe-paso' }, h('b', { text: `${b.n}. ` }), tx('span', {}, { i, campo: 'texto' }, b.texto)), i));
      else if (b.t === 'lista') {
        caja.append(bl(h(b.numerada ? 'ol' : 'ul', { class: 'informe-lista' }, b.items.map((t, k) => tx('li', {}, { i, campo: 'item', item: k }, t, { linea: true, pista: 'Escribe aquí…' }))), i));
      } else if (b.t === 'tabla') {
        // (una tabla larga se puede partir entre páginas; si no, deja media página en blanco)
        caja.append(bl(h('figure', { class: `informe-tabla-caja${b.filas.length > 6 || b.filas.flat().join('').length > 900 ? ' larga' : ''}` },
          h('figcaption', {}, h('b', { text: `${b.n}. ` }), tx('span', {}, { i, campo: 'titulo' }, b.titulo)),
          h('table', { class: 'informe-tabla' },
            h('thead', {}, h('tr', {}, b.cab.map((t, k) => tx('th', {}, { i, campo: 'cab', col: b.columnas[k] }, t, { linea: true })))),
            h('tbody', {}, b.filas.map((f, fi) => h('tr', {}, f.map((t, k) => tx('td', { class: b.numericas.includes(k) ? 'informe-numero' : b.cab[k] === 'Fecha' ? 'informe-fecha-celda' : null },
              { i, campo: 'celda', fila: fi, col: b.columnas[k] }, t))))))), i));
      } else if (b.t === 'arbol') {
        const el = arbolDeBloque(b);
        caja.append(bl(h('figure', { class: 'informe-figura informe-arbol' }, el ? el.querySelector('.arbol-caja') : h('p', { class: 'nota', text: '(el dibujo ya no se puede hacer: su receta no está)' }),
          h('figcaption', {}, h('b', { text: `${b.n}. ` }), tx('span', {}, { i, campo: 'titulo' }, b.titulo))), i));
      } else if (b.t === 'fotos') {
        // Una figura con sus paneles (a), (b)…: 1 foto a todo el ancho, 2 o 4 en dos columnas, 3, 5 o 6 en tres
        const k = b.paneles.length;
        const cols = b.cols ? Math.min(b.cols, Math.max(k, 1)) : k <= 1 ? 1 : k === 2 || k === 4 ? 2 : 3;
        // (el pie: entero a mano, o lo que pone el informe + «qué se ve» + lo de cada imagen)
        // (versión 145: también la parte que pone el informe —de qué son, grupo, fase, fecha— se escribe ahí mismo;
        // antes, para cambiarla había que pasar todo el pie a mano)
        const pie = !E ? b.titulo
          : b.pie ? tx('span', {}, { i, campo: 'pie' }, b.pie)
            : [tx('span', { class: 'informe-cabeza' }, { i, campo: 'cabeza' }, b.cabeza, { pista: 'De qué son estas imágenes' }), h('span', { text: '.' }), ' ',
              tx('span', { class: 'informe-desc' }, { i, campo: 'desc' }, b.desc, { pista: 'Qué se ve en esta figura' }), b.detalle && h('span', { text: ` ${may(b.detalle)}.` })];
        caja.append(bl(h('figure', { class: 'informe-figura informe-fotos-fig' },
          h('div', { class: 'informe-paneles', style: `grid-template-columns: repeat(${cols}, 1fr)`, 'data-lista': E ? String(i) : null }, b.paneles.map((p, pi) => {
            const img = h('img', { alt: p.texto || b.titulo, ondragstart: (e) => e.preventDefault() });
            // (en el papel, a unos 300 ppp: una hoja A4 son unos 2000 px de ancho, repartidos entre las columnas)
            esperas.push(urlDocumento(p.id, Math.round(2000 / cols)).then((u) => { if (u) { img.src = u; return img.decode().catch(() => {}); } img.alt = '(foto borrada)'; return null; }).catch(() => {}));
            const el = h('div', { class: 'informe-panel', 'data-foto': p.id, 'data-id': E ? p.id : null }, img, p.letra && h('span', { class: 'informe-letra', text: p.letra }),
              // (editando, lo de cada imagen se escribe debajo de ella —versión 145—; en el papel va en el pie)
              E && tx('span', { class: 'informe-panel-texto' }, { i, campo: 'panel', item: pi }, p.texto, { linea: true, pista: 'Qué se ve (aumento, zona…)' }));
            return E ? E.panel(el, i, pi) : el;
          })),
          h('figcaption', {}, h('b', { text: `${b.n}. ` }), pie),
          (b.observaciones || (E && b.finSesion)) && h('p', { class: 'informe-observaciones' }, h('b', { text: 'Observaciones: ' }),
            tx('span', {}, { i, campo: 'obs' }, b.observaciones, { pista: 'Lo que se observa en estas imágenes' }))), i));
      }
    });
    // Las imágenes, manteniendo pulsado y arrastrando (versión 135, lo pidió el usuario: «hay fotos que has
    // dividido en dos tandas y no puedo cambiarlas de lugar; que en vez de las flechas se pueda manteniendo
    // pulsado y arrastrando»): dentro de su figura o a otra
    if (E) mantenerYArrastrar(caja, (listas) => E.reordenar(listas), { rejilla: true });
    return { el: caja, listo: Promise.all(esperas) };
  };

  // Una librería de vendor/ (una sola vez)
  const vendorCargado = {};
  const cargarVendor = (src) => {
    if (!vendorCargado[src]) {
      vendorCargado[src] = new Promise((ok, mal) => {
        const s = h('script', { src });
        s.onload = ok;
        s.onerror = () => { delete vendorCargado[src]; mal(new Error(`No se ha podido cargar ${src}`)); };
        document.head.append(s);
      });
    }
    return vendorCargado[src];
  };
  // El dibujo del árbol (SVG) como PNG, para Word: se copian a cada elemento los estilos que le da la
  // hoja de estilos (si no, al sacarlo de la página perdería colores y letras)
  const svgAPng = async (svg) => {
    const marco = h('div', { class: 'informe-hoja', style: 'position: fixed; left: -100000px; top: 0;' }, h('article', { class: 'informe formal' }, svg));
    document.body.append(marco);
    try {
      const copia = svg.cloneNode(true);
      const de = [svg, ...svg.querySelectorAll('*')];
      const a = [copia, ...copia.querySelectorAll('*')];
      const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-opacity', 'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'paint-order', 'visibility', 'display'];
      de.forEach((x, i) => { const cs = getComputedStyle(x); a[i].setAttribute('style', PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';')); });
      const r = svg.getBoundingClientRect();
      const ancho = Math.ceil(Number(svg.getAttribute('width')) || r.width);
      const alto = Math.ceil(Number(svg.getAttribute('height')) || r.height);
      copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      copia.setAttribute('width', ancho);
      copia.setAttribute('height', alto);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copia))}`;
      await img.decode();
      const k = 2;
      const lienzo = h('canvas', { width: ancho * k, height: alto * k });
      const ctx = lienzo.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/png'));
      return { datos: new Uint8Array(await blob.arrayBuffer()), ancho, alto };
    } finally { marco.remove(); }
  };
  // El modelo, en Word (.docx). Devuelve un Blob
  const informeDocx = async (B0) => {
    const B = numerar(B0);
    await cargarVendor('vendor/docx.js');
    const D = window.docx;
    const hijos = [];
    const ANCHO_MAX = 600; // px (unos 16 cm: el ancho de la página menos los márgenes)
    const imagen = (datos, ancho, alto, maximo = ANCHO_MAX) => {
      const k = Math.min(1, maximo / ancho, 700 / alto);
      return new D.Paragraph({ alignment: D.AlignmentType.CENTER, keepNext: true, children: [new D.ImageRun({ data: datos, transformation: { width: Math.round(ancho * k), height: Math.round(alto * k) } })] });
    };
    const pie = (nn, texto) => new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, spacing: { after: 200 }, children: [new D.TextRun({ text: `${nn}. `, bold: true, size: 20 }), new D.TextRun({ text: texto, size: 20 })] });
    // (tablas de tres rayas, como en las revistas: arriba, bajo la cabecera y abajo)
    const NADA = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const RAYA = { style: D.BorderStyle.SINGLE, size: 8, color: '1B1C22' };
    const celda = (texto, { cabecera, numero } = {}) => new D.TableCell({
      borders: { top: NADA, left: NADA, right: NADA, bottom: cabecera ? RAYA : NADA },
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new D.Paragraph({ alignment: numero ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT, children: [new D.TextRun({ text: String(texto), bold: Boolean(cabecera), size: 18 })] })],
    });
    for (const b of B) {
      if (b.t === 'portada') {
        hijos.push(new D.Paragraph({ heading: D.HeadingLevel.TITLE, alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: b.titulo })] }));
        if (b.autores) hijos.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: b.autores, size: 24 })] }));
        if (b.institucion) hijos.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: b.institucion, italics: true })] }));
        hijos.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: b.fecha })] }));
        hijos.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 400 }, children: [new D.TextRun({ text: b.detalles.join(' · '), size: 18, color: '555555' })] }));
      } else if (b.t === 'h1') hijos.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: Boolean(b.anexo), children: [new D.TextRun({ text: b.texto })] }));
      else if (b.t === 'h2') hijos.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun({ text: b.texto })] }));
      else if (b.t === 'salto') hijos.push(new D.Paragraph({ children: [new D.PageBreak()] }));
      else if (b.t === 'p') {
        const rotulo = b.clase === 'fase' || b.clase === 'subfase';
        hijos.push(new D.Paragraph({ alignment: rotulo ? D.AlignmentType.LEFT : D.AlignmentType.JUSTIFIED, spacing: { before: b.clase === 'fase' ? 160 : 0, after: rotulo ? 60 : 120 }, keepNext: rotulo,
          children: [new D.TextRun({ text: b.texto, italics: b.clase === 'nota' || b.clase === 'resumen' || b.clase === 'subfase', bold: b.clase === 'fase', size: b.clase === 'nota' ? 20 : undefined })] }));
      } else if (b.t === 'paso') hijos.push(new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, indent: { left: 360, hanging: 360 }, children: [new D.TextRun({ text: `${b.n}. `, bold: true }), new D.TextRun({ text: b.texto })] }));
      else if (b.t === 'lista') {
        b.items.forEach((x, i) => hijos.push(new D.Paragraph({ indent: { left: 360, hanging: 360 }, children: [new D.TextRun({ text: `${b.numerada ? `[${i + 1}]` : '•'} ` }), new D.TextRun({ text: x })] })));
      } else if (b.t === 'tabla') {
        hijos.push(new D.Paragraph({ keepNext: true, spacing: { before: 160 }, children: [new D.TextRun({ text: `${b.n}. `, bold: true, size: 20 }), new D.TextRun({ text: b.titulo, size: 20 })] }));
        hijos.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE },
          borders: { top: { ...RAYA, size: 12 }, bottom: { ...RAYA, size: 12 }, left: NADA, right: NADA, insideHorizontal: NADA, insideVertical: NADA },
          rows: [new D.TableRow({ tableHeader: true, children: b.cab.map((x) => celda(x, { cabecera: true })) }),
            ...b.filas.map((f) => new D.TableRow({ children: f.map((x, i) => celda(x, { numero: b.numericas.includes(i) })) }))] }));
        hijos.push(new D.Paragraph({ children: [] }));
      } else if (b.t === 'arbol') {
        const dibujo = arbolDeBloque(b);
        const svg = dibujo && dibujo.querySelector('svg');
        if (svg) {
          try { const p = await svgAPng(svg); hijos.push(imagen(p.datos, p.ancho, p.alto)); } catch { /* sin dibujo: solo el pie */ }
        }
        hijos.push(pie(b.n, b.titulo));
      } else if (b.t === 'fotos') {
        // Los paneles, en una tabla sin bordes (como en la pantalla: 1, 2 o 3 por fila), con su letra debajo
        const k = b.paneles.length;
        const cols = b.cols ? Math.min(b.cols, Math.max(k, 1)) : k === 1 ? 1 : k === 2 || k === 4 ? 2 : 3;
        const anchoPanel = cols === 1 ? (b.cols ? ANCHO_MAX - 12 : 450) : Math.floor(ANCHO_MAX / cols) - 12;
        const celdas = [];
        for (const p of b.paneles) {
          const parrafos = [];
          // (la foto, con los píxeles que necesita a unos 300 ppp en el ancho que ocupa: no hace falta más;
          // los px de Word son de 96 ppp. Versión 141; antes iba la vista de 2000 px)
          const v = await window.Fotos.paraDocumento(p.id, Math.round(anchoPanel * 300 / 96)).catch(() => null);
          if (v) {
            try {
              const kk = Math.min(1, anchoPanel / v.ancho, (k === 1 ? 600 : 360) / v.alto);
              parrafos.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, keepNext: true, children: [new D.ImageRun({ data: new Uint8Array(await v.blob.arrayBuffer()), transformation: { width: Math.round(v.ancho * kk), height: Math.round(v.alto * kk) } })] }));
            } catch { /* sin foto: solo la letra */ }
          }
          if (p.letra) parrafos.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, keepNext: true, children: [new D.TextRun({ text: p.letra, size: 20 })] }));
          celdas.push(parrafos.length ? parrafos : [new D.Paragraph({ children: [] })]);
        }
        const SIN = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        const filas = [];
        for (let i = 0; i < celdas.length; i += cols) {
          const trozo = celdas.slice(i, i + cols);
          while (trozo.length < cols) trozo.push([new D.Paragraph({ children: [] })]);
          filas.push(new D.TableRow({ cantSplit: true, children: trozo.map((ps) => new D.TableCell({ children: ps, margins: { top: 40, bottom: 40, left: 60, right: 60 },
            borders: { top: SIN, bottom: SIN, left: SIN, right: SIN } })) }));
        }
        hijos.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, borders: { top: SIN, bottom: SIN, left: SIN, right: SIN, insideHorizontal: SIN, insideVertical: SIN }, rows: filas }));
        hijos.push(pie(b.n, b.titulo));
        // (la nota de la sesión, debajo; cada línea en la suya)
        if (b.observaciones) {
          hijos.push(new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, spacing: { after: 240 },
            children: [new D.TextRun({ text: 'Observaciones: ', bold: true, size: 20 }),
              ...b.observaciones.split('\n').map((l, i) => new D.TextRun({ text: l, size: 20, ...(i > 0 ? { break: 1 } : {}) }))] }));
        }
      }
    }
    const doc = new D.Document({
      creator: 'Química',
      title: (B[0] && B[0].titulo) || 'Informe',
      styles: { default: { document: { run: { font: 'Times New Roman', size: 22 } } } },
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        // (el número de página abajo: «Página 2 de 9»)
        footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER,
          children: [new D.TextRun({ children: ['Página ', D.PageNumber.CURRENT, ' de ', D.PageNumber.TOTAL_PAGES], size: 18, color: '555555' })] })] }) },
        children: hijos }],
    });
    return D.Packer.toBlob(doc);
  };
  // Guarda un archivo binario: en Android, en Descargas (plugin GuardarArchivo, por trozos en base64);
  // en el iPhone, la hoja de compartir; en el PC, una descarga
  const guardarBinario = async (blob, nombre, tipo) => {
    const plugin = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.GuardarArchivo;
    if (plugin) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const TROZO = 3 * 256 * 1024; // (múltiplo de 3: cada trozo en base64 sin relleno en medio)
      for (let i = 0, primera = true; i < bytes.length || primera; i += TROZO, primera = false) {
        let bin = '';
        const parte = bytes.subarray(i, i + TROZO);
        for (let j = 0; j < parte.length; j += 0x8000) bin += String.fromCharCode(...parte.subarray(j, j + 0x8000));
        await plugin.escribir({ nombre, texto: btoa(bin), base64: true, tipo, primera, ultima: i + TROZO >= bytes.length });
      }
      return 'la carpeta Descargas del móvil';
    }
    const archivo = new File([blob], nombre, { type: tipo });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], title: nombre }); return 'donde hayas elegido'; } catch (e) { if (e && e.name === 'AbortError') throw e; }
    }
    const enlace = h('a', { href: URL.createObjectURL(archivo), download: nombre });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    return 'tus descargas';
  };
  // Imprimir (o guardar como PDF) un informe: se copia a #impresion, lo único que se imprime
  // (@media print en estilos.css)
  const imprimirInforme = async (nodo, titulo) => {
    let zona = document.getElementById('impresion');
    if (!zona) { zona = h('div', { id: 'impresion' }); document.body.append(zona); }
    poner(zona, nodo.cloneNode(true));
    await Promise.all([...zona.querySelectorAll('img')].map((i) => (i.complete ? null : i.decode().catch(() => {}))));
    document.body.classList.add('imprimiendo');
    const plugin = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.Imprimir;
    if (plugin) {
      try { await plugin.imprimir({ titulo }); } catch { avisar('No se ha podido abrir la impresión'); }
      return;
    }
    // (en el navegador, el título de la página es el nombre del PDF)
    const antes = document.title;
    document.title = titulo;
    window.print();
    document.title = antes;
  };
  // Un nombre de archivo sin caracteres raros
  const nombreArchivo = (t) => String(t || 'Informe').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Informe';

  // ─── Los informes (versión 134) ───
  // El usuario: «que haya un informe estándar pero luego puedas editarlo como te plazca, y que se quede
  // guardado aparte para seguir editando; que aparezca hacer informe nuevo, seguir con el último y una
  // carpeta». Al tocar «Hacer el informe» (abrirInforme): «＋ Informe nuevo» hace el estándar con los datos
  // de ahora y lo guarda (c.informes: pasa al PC); «✏️ Seguir con…» abre el último; «📁 Carpeta», todos.
  // Cada informe guardado se edita a gusto (abrirInformeGuardado): cambiar textos, mover, quitar bloques,
  // filas, columnas e imágenes, añadir párrafos y títulos. Y su duda: «algo que quiero borrar en el
  // informe pero que se quede en notas; pero también el informe me parece una forma rápida de corregir
  // las notas»: quitar, mover o esconder solo cambia el informe; al cambiar una frase, si el trozo cambiado
  // es una nota de la bitácora (o el nombre de un grupo, el título de una foto, un texto de la receta…),
  // se ofrece corregirlo también allí (marcado de entrada), y entonces cambia en todo el informe.

  // Elegir una de varias cosas: opciones [{ texto, peligro?, … }] → la elegida o null
  const elegir = ({ texto, detalle, opciones }) => new Promise((resolver) => {
    let r = null;
    const fondo = h('div', { class: 'dialogo-fondo', onclick: (e) => { if (e.target === fondo) atras(); } },
      h('div', { class: 'dialogo' },
        h('p', { class: 'dialogo-texto', text: texto }),
        detalle && (typeof detalle === 'string' ? h('p', { class: 'dialogo-detalle', text: detalle }) : detalle),
        h('div', { class: 'menu-opciones' }, opciones.filter(Boolean).map((o) => h('button', { class: `boton ${o.peligro ? 'peligro' : 'secundario'}`, text: o.texto, onclick: () => { r = o; atras(); } }))),
        h('div', { class: 'dialogo-botones' }, h('button', { class: 'boton secundario', text: 'Cancelar', onclick: atras }))));
    document.body.append(fondo);
    abrirCapa(fondo, () => resolver(r));
  });
  // Lo que se guarda de un informe: sus bloques, sin el dibujo del árbol (se vuelve a hacer al verlo)
  const paraGuardar = (B) => B.map((b) => { const { el, ...x } = b; return JSON.parse(JSON.stringify(x)); });

  // ── Corregir en la bitácora lo corregido en un informe ──
  // El principio y el final iguales de dos textos: { p, s } (lo cambiado está entre p y largo − s)
  const comunes = (a, b) => {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    return { p, s };
  };
  // El texto de verdad (raw), cambiado como cambió el trozo que se veía de él (forma → nuevo); null si no se sabe
  const cambiarDentro = (raw, forma, nuevo) => {
    if (raw === forma) return nuevo;
    // (el texto de la bitácora con espacios de más —«lavado \nSe…», «.  Se»— y en el informe, limpio: es el
    // mismo texto; sin esto, reescribirlo entero no se reconocía como suyo; versión 144)
    const junto = (t) => t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
    if (junto(raw) === junto(forma)) return nuevo;
    const { p, s } = comunes(forma, nuevo);
    const viejoMedio = forma.slice(p, forma.length - s);
    const nuevoMedio = nuevo.slice(p, nuevo.length - s);
    if (viejoMedio && raw.split(viejoMedio).length === 2) return raw.replace(viejoMedio, () => nuevoMedio);
    const ancla = forma.slice(Math.max(0, p - 15), p);
    if (!viejoMedio && ancla && raw.split(ancla).length === 2) { const k = raw.indexOf(ancla) + ancla.length; return raw.slice(0, k) + nuevoMedio + raw.slice(k); }
    return null;
  };
  // Las formas en que se ve un texto de la bitácora en el informe (tal cual, sin emojis, en una línea)
  const formasDe = (v) => [...new Set([String(v), sinEmojiLineas(v), sinEmoji(v)])].filter(Boolean);
  // Si lo cambiado de un texto del informe (viejo → nuevo) cae dentro de un texto de la bitácora (fuentes),
  // cuál y cómo queda: [{ fuente, viejoTexto, nuevoTexto, nuevoRaw }] (el más pequeño que lo contiene)
  const detectarCambio = (viejo, nuevo, fuentes) => {
    if (viejo === nuevo) return [];
    const { p, s } = comunes(viejo, nuevo);
    const fin = viejo.length - s;
    const hallados = [];
    for (const f of fuentes) {
      for (const forma of formasDe(f.valor)) {
        let k = viejo.indexOf(forma);
        let hecho = false;
        while (k >= 0 && !hecho) {
          if (k <= p && fin <= k + forma.length) {
            const nuevoTexto = nuevo.slice(k, k + forma.length + (nuevo.length - viejo.length));
            const nuevoRaw = cambiarDentro(f.valor, forma, nuevoTexto);
            if (nuevoRaw !== null) { hallados.push({ fuente: f, viejoTexto: forma, nuevoTexto, nuevoRaw }); hecho = true; }
          }
          k = viejo.indexOf(forma, k + 1);
        }
        if (hecho) break;
      }
    }
    hallados.sort((a, b) => a.viejoTexto.length - b.viejoTexto.length);
    return hallados.slice(0, 1);
  };
  // Cambia un texto por otro en todos los textos de unos bloques (solo palabras enteras)
  const reemplazarEnBloques = (B, viejo, nuevo) => {
    if (!viejo || viejo === nuevo) return;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${viejo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
    const r = (s) => (typeof s === 'string' ? s.replace(re, () => nuevo) : s);
    for (const b of B) {
      for (const k of ['texto', 'titulo', 'observaciones', 'desc', 'cabeza', 'pie', 'autores', 'institucion']) if (typeof b[k] === 'string') b[k] = r(b[k]);
      if (b.items) b.items = b.items.map(r);
      if (b.filas) b.filas = b.filas.map((f) => f.map(r));
      if (b.detalles) b.detalles = b.detalles.map(r);
      for (const p of b.paneles || []) p.texto = r(p.texto);
    }
  };
  // Cambiar el nombre de un grupo (y donde se le nombra en la bitácora), o de una disolución
  const renombrarGrupo = (id, nombre) => cambiarCuaderno((d) => {
    const x = K.grupoDe(d, id);
    if (!x || !nombre.trim()) return;
    x.nombre = nombre.trim().slice(0, 60);
    for (const e of d.entradas) {
      if (e.grupoId === x.id) e.grupo = x.nombre;
      if (e.nuevoId === x.id) e.nuevo = x.nombre;
      if ((e.tipo === 'recibir' || e.tipo === 'llegar') && e.desdeId === x.id) e.desde = x.nombre;
    }
  });
  const renombrarDisolucion = (id, nombre) => cambiarCuaderno((d) => {
    const y = K.disolucionDe(d, id);
    if (!y || !nombre.trim()) return;
    y.nombre = nombre.trim().slice(0, 80);
    for (const e of d.entradas) {
      if (e.disolucionId === id) e.disolucion = y.nombre;
      for (const u of e.disoluciones || []) if (u.id === id) u.nombre = y.nombre;
    }
  });
  // Los textos de la bitácora (o de la receta, o de la ficha del cuaderno) de los que sale algo del
  // informe, con cómo se cambian: [{ etiqueta, valor, escribir(v) }]. o: el «editar» del bloque, de su
  // fila o de su línea. inf: { amb } del informe (para los textos de los informes nuevos)
  const fuentesDe = (c, o, x) => {
    const l = [];
    const add = (etiqueta, valor, escribir) => { if (valor != null && String(valor).trim()) l.push({ etiqueta, valor: String(valor), escribir }); };
    // (un texto de varias líneas o párrafos: también cada línea, que es como sale en las listas)
    const conLineas = (etiqueta, valor, escribir) => {
      add(etiqueta, valor, escribir);
      const v = String(valor || '');
      for (const sep of ['\n', /\n\s*\n/]) {
        const trozos = v.split(sep);
        if (trozos.length > 1) trozos.forEach((t, i) => add(etiqueta, t.trim(), (n) => { const copia = v.split(sep); copia[i] = n; escribir(copia.join(typeof sep === 'string' ? sep : '\n\n')); }));
      }
    };
    if (!o) return l;
    const enEntrada = (id, campo) => (v) => cambiarCuaderno((d) => { const e = d.entradas.find((y) => y.id === id); if (!e) return; if (v) e[campo] = v; else delete e[campo]; });
    if (o.tipo === 'apuntes') {
      for (const id of o.ids || []) {
        const e = c.entradas.find((y) => y.id === id);
        if (!e) continue;
        conLineas('en la bitácora (la nota del apunte)', e.nota, enEntrada(id, 'nota'));
        add('en la bitácora (lo distinto a la receta)', e.distinto, enEntrada(id, 'distinto'));
        add('en la bitácora (la técnica del análisis)', e.tecnica, enEntrada(id, 'tecnica'));
      }
    }
    if (o.tipo === 'grupo') {
      const g = K.grupoDe(c, o.id);
      if (g) {
        add('el nombre del grupo (en todo el cuaderno)', g.nombre, (v) => renombrarGrupo(o.id, v));
        add('las características del grupo', g.caracteristicas, (v) => cambiarCuaderno((d) => { const y = K.grupoDe(d, o.id); if (y) { if (v) y.caracteristicas = v; else delete y.caracteristicas; } }));
      }
    }
    if (o.tipo === 'disolucion') {
      const d = K.disolucionDe(c, o.id);
      if (d) {
        add('el nombre de la disolución (en todo el cuaderno)', d.nombre, (v) => renombrarDisolucion(o.id, v));
        add('cuánta se preparó', d.preparada, (v) => cambiarCuaderno((x2) => { const y = K.disolucionDe(x2, o.id); if (y) y.preparada = v; }));
        for (const e of c.entradas.filter((y) => y.disolucionId === o.id && y.nota)) conLineas('en la bitácora (una nota de la disolución)', e.nota, enEntrada(e.id, 'nota'));
      }
    }
    if (o.tipo === 'receta') {
      const r = recetaDe(o.recetaId);
      if (r) conLineas(`en la receta «${r.nombre}»`, r[o.campo], (v) => { const r2 = recetaDe(o.recetaId); if (r2) { r2[o.campo] = v; guardarRecetas(); } });
    }
    if (o.tipo === 'notasCuaderno') {
      const k = c.cuadernos.find((y) => y.id === o.cuadernoId);
      if (k) conLineas('en las notas del cuaderno', k.notas, (v) => cambiarCuaderno((d) => { const y = d.cuadernos.find((z) => z.id === o.cuadernoId); if (y) y.notas = v; }));
    }
    if (o.tipo === 'texto' && x) {
      const ficha = K.fichaCuaderno(c, x.amb);
      conLineas('en los textos para los informes nuevos', (ficha.informe || {})[o.clave], (v) => guardarTextoInforme(x.amb, ficha, o.clave, v));
    }
    if (o.tipo === 'fotosPie') {
      const e = c.entradas.find((y) => y.id === o.entradaId);
      if (e) {
        add('en la bitácora (la técnica del análisis)', e.tecnica, enEntrada(e.id, 'tecnica'));
        if (e.grupoId) l.push(...fuentesDe(c, { tipo: 'grupo', id: e.grupoId }).slice(0, 1));
        for (const id of o.fotos || []) {
          add('el título de la foto', c.titulos[id], (v) => cambiarCuaderno((d) => { if (v) d.titulos[id] = v.slice(0, 200); else delete d.titulos[id]; }));
          add('la zona de la foto', K.infoFoto(e, id).zona, (v) => cambiarCuaderno((d) => { const y = d.entradas.find((z) => z.id === e.id); if (y && y.fotosInfo && y.fotosInfo[id]) { if (v) y.fotosInfo[id].zona = v.slice(0, 40); else delete y.fotosInfo[id].zona; } }));
        }
      }
    }
    return l;
  };
  // Los textos del informe que se guardan con el cuaderno (para los informes nuevos)
  const guardarTextoInforme = (amb, ficha, clave, v) => cambiarCuaderno((d) => {
    let x = d.cuadernos.find((y) => y.id === ficha.id);
    if (!x) { x = { id: ficha.id, recetaId: amb.recetaId || null, nombre: ficha.nombre, fecha: 0 }; d.cuadernos.push(x); }
    const nuevo = { ...(x.informe || {}), [clave]: v };
    if (!v) delete nuevo[clave];
    x.informe = nuevo;
  });

  // ── Correcciones del informe para la bitácora (versión 143; lo pidió el usuario: «que en la bitácora luego me
  // salga una lista para aceptar cambios»). Lo corregido en un informe en un texto que viene de la bitácora, sin
  // marcar «Corregir también…», queda como propuesta en el informe (x.propuestas: { id, fecha, enlace, etiqueta,
  // viejo, nuevo, nota? }); en la bitácora del cuaderno sale la lista para aceptarlas o descartarlas ──
  const propuestasDe = (c, amb) => K.informesDe(c, amb).flatMap((x) => (x.propuestas || []).map((p) => ({ x, p })));
  const quitarPropuesta = (informeId, propId) => cambiarCuaderno((d) => {
    const y = (d.informes || []).find((z) => z.id === informeId);
    if (y && y.propuestas) { y.propuestas = y.propuestas.filter((q) => q.id !== propId); if (!y.propuestas.length) delete y.propuestas; y.mod = Date.now(); }
  });
  // Pasa una propuesta a la bitácora: 'ok', o 'cambiado' si allí ya no pone lo que ponía (no se pisa)
  const aceptarPropuesta = (x, p) => {
    const c = leerCuaderno();
    if (p.nota) {
      const e = c.entradas.find((y) => y.id === p.nota);
      if (!e || (e.nota && e.nota !== p.viejo)) return 'cambiado';
      cambiarCuaderno((d) => { const y = d.entradas.find((z) => z.id === p.nota); if (y) y.nota = p.nuevo; });
    } else {
      const f = fuentesDe(c, p.enlace, { amb: K.ambito(x.recetaId, x.cuadernoId) }).find((y) => y.etiqueta === p.etiqueta && y.valor === p.viejo);
      if (!f) return 'cambiado';
      f.escribir(p.nuevo);
    }
    quitarPropuesta(x.id, p.id);
    return 'ok';
  };
  // Lo cambiado, como en el control de cambios de Word: lo de antes tachado y lo nuevo subrayado, con un poco de contexto
  const diferenciaDe = (viejo, nuevo) => {
    let { p, s } = comunes(viejo, nuevo);
    // (al cambiar una cosa por otra, palabras enteras: una letra sola tachada apenas se ve)
    if (viejo.length - s > p && nuevo.length - s > p) {
      while (p > 0 && /\S/.test(viejo[p - 1])) p--;
      while (s > 0 && /\S/.test(viejo[viejo.length - s])) s--;
    }
    const ini = Math.max(0, p - 45);
    const fin = Math.min(viejo.length, viejo.length - s + 45);
    return h('p', { class: 'propuesta-cambio' },
      h('span', { text: `${ini > 0 ? '…' : ''}${viejo.slice(ini, p)}` }),
      viejo.length - s > p && h('del', { text: viejo.slice(p, viejo.length - s) }),
      nuevo.length - s > p && h('ins', { text: nuevo.slice(p, nuevo.length - s) }),
      h('span', { text: `${viejo.slice(viejo.length - s, fin)}${fin < viejo.length ? '…' : ''}` }));
  };
  // El recuadro de la bitácora (null si no hay ninguna)
  const listaPropuestas = (c, amb, alCambiar) => {
    const lista = propuestasDe(c, amb);
    if (!lista.length) return null;
    const deDonde = ({ p }) => {
      const e = p.enlace && p.enlace.tipo === 'apuntes' && c.entradas.find((y) => (p.enlace.ids || []).includes(y.id));
      // («en la bitácora (la nota del apunte)» → «la nota del apunte del 23/09/2026 · grupo»)
      const sitio = (/\(([^)]+)\)/.exec(p.etiqueta) || [])[1] || sinEmoji(p.etiqueta).replace(/^en /, '');
      return e ? `${sitio} del ${fechaNum(e.fecha)}${e.grupo ? ` · ${(K.grupoDe(c, e.grupoId) || e).nombre || e.grupo}` : ''}` : sitio;
    };
    const aceptar = (todas) => {
      let mal = 0;
      for (const it of todas) if (aceptarPropuesta(it.x, it.p) === 'cambiado') mal++;
      avisar(mal ? `⚠️ ${mal === 1 ? 'Una no se ha podido pasar' : `${mal} no se han podido pasar`}: en la bitácora ese texto ya ha cambiado. Descártala o corrígelo a mano.` : todas.length > 1 ? `✅ ${todas.length} correcciones pasadas a la bitácora` : '✅ Pasado a la bitácora');
      alCambiar();
    };
    return h('div', { class: 'propuestas' },
      h('div', { class: 'propuestas-cabeza' },
        h('b', { text: `✏️ Correcciones del informe (${lista.length})` }),
        lista.length > 1 && h('button', { class: 'chip', text: '✓ Aceptar todas', onclick: () => aceptar(lista) })),
      h('p', { class: 'nota', text: 'Lo corregiste en un informe y aún no está en la bitácora. Acéptalo para cambiarlo aquí también, o descártalo (en el informe se queda como lo dejaste).' }),
      lista.map((it) => h('div', { class: 'propuesta' },
        h('small', { class: 'nota', text: `«${it.x.nombre}» · ${deDonde(it)} · ${fechaHoraNum(it.p.fecha)}` }),
        diferenciaDe(it.p.viejo || '', it.p.nuevo || ''),
        h('div', { class: 'chips' },
          h('button', { class: 'chip', text: '✓ Aceptar', onclick: () => aceptar([it]) }),
          h('button', { class: 'chip', text: '✗ Descartar', onclick: () => { quitarPropuesta(it.x.id, it.p.id); avisar('Descartada: la bitácora se queda como estaba'); alCambiar(); } })))));
  };

  // ── «Hacer el informe»: nuevo, seguir con el último, carpeta; y cómo se hacen los nuevos ──
  const abrirInforme = (receta, amb, ficha, alVolver) => {
    const { cuerpo } = abrirPanel('📄 Informes', null, alVolver);
    const cid = ficha.id;
    const fichaDeAhora = () => {
      const c = leerCuaderno();
      return { ...ficha, ...(c.cuadernos.find((x) => x.id === cid) || {}) };
    };
    // Guarda en la ficha del cuaderno (la del Cuaderno 1 de una receta se crea la primera vez)
    const guardarInforme = (cambios) => {
      cambiarCuaderno((d) => {
        let x = d.cuadernos.find((y) => y.id === cid);
        if (!x) { x = { id: cid, recetaId: (receta && receta.id) || null, nombre: ficha.nombre, fecha: 0 }; d.cuadernos.push(x); }
        const nuevo = { ...(x.informe || {}), ...cambios };
        for (const k of Object.keys(nuevo)) if (nuevo[k] === '' || nuevo[k] == null) delete nuevo[k];
        x.informe = nuevo;
      });
    };
    const inf0 = fichaDeAhora().informe || {};
    const c0 = leerCuaderno();
    const hayReceta = Boolean(receta && receta.id && recetaDe(receta.id));
    const hayAnterior = K.gruposDe(c0, amb).some((g) => g.vieneDe);
    const albumes = K.albumesDe(c0, amb);
    const op = () => {
      const i = fichaDeAhora().informe || {};
      // (versión 149: las diferencias de los grupos finales, de entrada sí; la historia entera de cada grupo, solo si se pide)
      return { conReceta: i.sinReceta !== true, conAnterior: i.sinAnterior !== true, conHistoria: i.sinHistoria === false, conVariaciones: i.sinVariaciones !== true,
        // (las disoluciones, aparte desde la versión 147; desde la 148, solo si se pide: lo suyo ya está en su tabla)
        conHistoriaDis: i.sinHistoriaDis === false, fotos: i.fotos || 'analisis', quitadas: i.quitadas || [] };
    };
    // Los cuadernos unidos a este por muestras que pasaron de uno a otro (versión 129): entran también
    const relacionados = cuadernosRelacionados(c0, amb);
    const partes = () => {
      const c = leerCuaderno();
      const fuera = (fichaDeAhora().informe || {}).sinCuadernos || [];
      return [{ amb, ficha: fichaDeAhora(), receta }, ...cuadernosRelacionados(c, amb).filter((x) => !fuera.includes(x.parte.amb.cuadernoId)).map((x) => x.parte)];
    };
    // Lo que necesita un informe guardado para su «Qué incluir» (versión 142): sus cuadernos (los que tenía), y
    // las mismas opciones y fotos que los nuevos
    const contexto = {
      op, hayReceta, hayAnterior, albumes,
      partesDe: (ids) => {
        const c = leerCuaderno();
        const suyos = (ids || []).map((v) => v ?? null);
        return [{ amb, ficha: fichaDeAhora(), receta }, ...cuadernosRelacionados(c, amb).filter((x) => !ids || suyos.includes(x.parte.amb.cuadernoId ?? null)).map((x) => x.parte)];
      },
    };
    // Un informe nuevo: el estándar, con los datos de ahora, guardado (con los huecos para escribir lo que falta)
    const nuevo = () => {
      const c = leerCuaderno();
      const ps = partes();
      const hechos = K.informesDe(c, amb);
      const n = Math.max(0, ...hechos.map((x) => Number((/^Informe (\d+)$/.exec(x.nombre) || [])[1]) || 0)) + 1;
      const ahora = Date.now();
      const x = { id: idDe('i'), recetaId: (receta && receta.id) || null, ...K.marcaDe(amb), nombre: `Informe ${n}`, fecha: ahora, mod: ahora,
        cuadernos: ps.map((p) => p.amb.cuadernoId), incluir: { fotos: op().fotos }, bloques: paraGuardar(modeloInforme(c, ps, { ...op(), editando: true })) };
      cambiarCuaderno((d) => { d.informes = [...(d.informes || []), x]; });
      abrirInformeGuardado(x.id, pintar, contexto);
    };
    let relojTextos = null;
    const estado = h('small', { class: 'notas-estado' });
    const campos = TEXTOS_INFORME.map(([k, rotulo, pista, filas]) => {
      const campo = h(filas ? 'textarea' : 'input', { class: 'campo', rows: filas || null, autocapitalize: 'sentences', placeholder: pista, value: inf0[k] || '',
        oninput: () => {
          estado.textContent = 'Guardando…';
          clearTimeout(relojTextos);
          relojTextos = setTimeout(() => {
            guardarInforme(Object.fromEntries(campos.map((x) => [x.k, x.campo.value.trim()])));
            estado.textContent = '✓ Guardado (para los informes nuevos)';
          }, 700);
        } });
      return { k, campo, el: h('label', { class: 'etiqueta-campo' }, h('span', { text: rotulo }), campo) };
    });
    const casilla = (clave, texto) => h('label', { class: 'parte-opcion' },
      h('input', { type: 'checkbox', checked: inf0[clave] !== true, onchange: (e) => guardarInforme({ [clave]: e.target.checked ? null : true }) }), ` ${texto}`);
    const selFotos = h('select', { class: 'campo', onchange: (e) => guardarInforme({ fotos: e.target.value }) },
      [['analisis', 'Las de los análisis (microscopio, medidas…)'], ['todas', 'Todas las fotos'], ...albumes.map((a) => [`album:${a.id}`, `Las del álbum «${a.nombre}»`]), ['ninguna', 'Ninguna']]
        .map(([v, t]) => h('option', { value: v, text: t, selected: (inf0.fotos || 'analisis') === v })));
    const fueraDe0 = inf0.sinCuadernos || [];
    const relacionadosEl = relacionados.map((x) => h('label', { class: 'parte-opcion' },
      h('input', { type: 'checkbox', checked: !fueraDe0.includes(x.parte.amb.cuadernoId), onchange: (e) => {
        const l = new Set((fichaDeAhora().informe || {}).sinCuadernos || []);
        if (e.target.checked) l.delete(x.parte.amb.cuadernoId); else l.add(x.parte.amb.cuadernoId);
        guardarInforme({ sinCuadernos: l.size ? [...l] : null });
      } }),
      ` Incluir también «${x.parte.ficha.nombre}»${x.van ? ` (allí siguieron ${x.van} ${x.van === 1 ? 'grupo' : 'grupos'})` : x.vienen ? ` (de allí vienen ${x.vienen} ${x.vienen === 1 ? 'grupo' : 'grupos'})` : ''}`));
    // Todos los datos en un texto, para una IA (versión 129): se descarga o se copia
    const nombreIA = () => `${nombreArchivo(`Datos ${nombreDelTrabajo(fichaDeAhora(), receta)}`)}.txt`;
    const bIA = h('button', { class: 'boton secundario', text: '📝 Datos en texto', onclick: async () => {
      bIA.disabled = true;
      try {
        const texto = await textoParaIA(leerCuaderno(), partes());
        const donde = await guardarBinario(new Blob([texto], { type: 'text/plain;charset=utf-8' }), nombreIA(), 'text/plain');
        avisar(`✅ Guardado «${nombreIA()}» en ${donde} (${Math.round(texto.length / 1000)} mil letras)`);
      } catch (e) {
        if (!(e && e.name === 'AbortError')) avisar(`No se ha podido hacer el texto (${(e && e.message) || 'error'})`);
      }
      bIA.disabled = false;
    } });
    const bCopiarIA = h('button', { class: 'boton discreto', text: '📋 Copiar ese texto', onclick: async () => {
      try {
        const texto = await textoParaIA(leerCuaderno(), partes());
        await navigator.clipboard.writeText(texto);
        avisar(`📋 Copiado (${Math.round(texto.length / 1000)} mil letras): pégalo en la IA`);
      } catch { avisar('No se ha podido copiar: descárgalo con el botón de al lado'); }
    } });
    const ajustes = h('div', {},
      h('h3', { text: 'Para los informes nuevos' }),
      h('details', { class: 'informe-editor' }, h('summary', { text: '✏️ Textos (título, autores, resumen, introducción, discusión…)' }), campos.map((x) => x.el), estado),
      h('details', { class: 'informe-editor' }, h('summary', { text: '⚙️ Qué incluir' }),
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Fotos en «Caracterización»' }), selFotos),
        relacionados.length > 0 && h('p', { class: 'etiqueta-campo', text: 'Cuadernos unidos a este (las muestras pasaron de uno a otro):' }), relacionadosEl,
        hayReceta && casilla('sinReceta', 'El procedimiento (reactivos, cantidades y pasos)'),
        casilla('sinVariaciones', 'Las diferencias de los grupos finales respecto al procedimiento'),
        // (la historia entera de cada grupo, quitada de entrada desde la versión 149)
        h('label', { class: 'parte-opcion' }, h('input', { type: 'checkbox', checked: inf0.sinHistoria === false,
          onchange: (e) => guardarInforme({ sinHistoria: !e.target.checked }) }), ' Anexo: la historia completa de cada grupo'),
        // (las disoluciones, aparte desde la versión 147; desde la 148, quitada de entrada)
        h('label', { class: 'parte-opcion' }, h('input', { type: 'checkbox', checked: inf0.sinHistoriaDis === false,
          onchange: (e) => guardarInforme({ sinHistoriaDis: !e.target.checked }) }), ' Anexo: la historia de cada disolución'),
        hayAnterior && casilla('sinAnterior', 'Anexo: la historia de las muestras en otros cuadernos')),
      h('h3', { text: 'Todos los datos, para una IA' }),
      h('div', { class: 'informe-botones' }, bIA, bCopiarIA));
    const lista = h('div');
    const pintar = () => {
      const hechos = K.informesDe(leerCuaderno(), amb);
      const ultimo = hechos[0];
      poner(lista,
        h('button', { class: 'boton grande', text: '＋ Informe nuevo (con los datos de ahora)', onclick: nuevo }),
        ultimo && h('button', { class: 'boton secundario grande', onclick: () => abrirInformeGuardado(ultimo.id, pintar, contexto) },
          h('span', { text: `✏️ Seguir con «${ultimo.nombre}»` }), h('small', { class: 'nota', text: ` · cambiado el ${fechaHoraNum(ultimo.mod || ultimo.fecha)}` })),
        hechos.length > 0 && h('button', { class: 'boton secundario grande', text: `📁 Carpeta: ${hechos.length} ${hechos.length === 1 ? 'informe guardado' : 'informes guardados'}`, onclick: () => abrirCarpetaInformes(amb, pintar, contexto) }));
    };
    poner(cuerpo,
      h('p', { class: 'nota', text: 'El informe nuevo sale solo con los datos del cuaderno y se guarda aquí. Luego lo editas a tu gusto (mover, quitar, escribir): quitar algo del informe no lo quita de la bitácora; y si corriges una frase que viene de la bitácora, te ofrece corregirla también allí.' }),
      lista, ajustes);
    pintar();
  };

  // La carpeta: los informes guardados de un cuaderno, el último cambiado primero
  const abrirCarpetaInformes = (amb, alVolver, contexto) => {
    const { cuerpo } = abrirPanel('📁 Informes guardados', null, alVolver);
    const pintar = () => {
      const hechos = K.informesDe(leerCuaderno(), amb);
      poner(cuerpo, hechos.length ? hechos.map((x) => h('div', { class: 'tarjeta informe-guardado' },
        h('button', { class: 'informe-guardado-abrir', onclick: () => abrirInformeGuardado(x.id, pintar, contexto) },
          h('b', { text: `📄 ${x.nombre}` }), h('small', { class: 'nota', text: `Hecho el ${fechaHoraNum(x.fecha)} · cambiado el ${fechaHoraNum(x.mod || x.fecha)}` })),
        h('div', { class: 'chips' },
          h('button', { class: 'chip', text: '✏️ Nombre', onclick: async () => {
            const v = await preguntar({ texto: 'Nombre del informe', campo: { value: x.nombre, autocapitalize: 'sentences' }, si: 'Guardar', no: 'Cancelar' });
            if (v === null || !v.trim()) return;
            cambiarCuaderno((d) => { const y = (d.informes || []).find((z) => z.id === x.id); if (y) { y.nombre = v.trim().slice(0, 80); y.mod = Date.now(); } });
            pintar();
          } }),
          h('button', { class: 'chip', text: '📑 Duplicar', onclick: () => {
            cambiarCuaderno((d) => { const y = (d.informes || []).find((z) => z.id === x.id); if (y) d.informes.push({ ...JSON.parse(JSON.stringify(y)), id: idDe('i'), nombre: `${y.nombre} (copia)`, fecha: Date.now(), mod: Date.now() }); });
            pintar();
          } }),
          h('button', { class: 'chip', text: '🗑️ Borrar', onclick: async () => {
            if (!await preguntar({ texto: `¿Borrar «${x.nombre}»?`, detalle: 'Solo se borra este informe: la bitácora, las fotos y los demás informes se quedan.', si: 'Borrar', peligro: true })) return;
            cambiarCuaderno((d) => { d.informes = (d.informes || []).filter((z) => z.id !== x.id); });
            pintar();
          } }))))
        : h('p', { class: 'nota', text: 'Aún no hay informes guardados.' }));
    };
    pintar();
  };

  // ── Un informe guardado: verlo, sacarlo en PDF o Word y editarlo a gusto ──
  // Versión 137 (el usuario aprobó el plan: «dale»): se escribe directamente en la hoja, como en Word (antes,
  // cada cosa en un cuadro aparte); una barra de herramientas para lo elegido (arriba en el PC, abajo en el
  // móvil); la hoja limpia (solo se resalta lo que se toca); deshacer y rehacer (↶ ↷, Ctrl+Z / Ctrl+Y);
  // añadir párrafos, títulos, listas, saltos de página y figuras con fotos del cuaderno; en el PC, un
  // índice a la izquierda (para saltar y, editando, mover secciones enteras arrastrando); y la cabecera
  // compacta (tocar el nombre lo cambia). Lo de antes sigue: corregir también en la bitácora (ahora sale
  // un aviso con «Solo en el informe» para no hacerlo), quitar nunca toca la bitácora, arrastrar fotos
  // ctx (de abrirInforme): cómo se hacen sus partes con los datos de ahora, para «Qué incluir» (versión 142)
  const abrirInformeGuardado = (id, alVolver, ctx) => {
    const leerX = () => (leerCuaderno().informes || []).find((y) => y.id === id) || null;
    let x = leerX();
    if (!x) return;
    const amb = K.ambito(x.recetaId, x.cuadernoId);
    let editando = false;
    let actual = null;
    let sel = null; // lo elegido: { i, ref }
    // (al quitar o partir un bloque, el texto donde está el cursor cambia de número: ajuste lo corrige)
    let ajuste = null;
    const pilaAtras = [];
    const pilaAdelante = [];
    const sinFoco = (e) => e.preventDefault(); // (los botones no le quitan el cursor al texto que se escribe)
    const bDeshacer = h('button', { class: 'icono', type: 'button', 'aria-label': 'Deshacer', title: 'Deshacer (Ctrl+Z)', text: '↶', onmousedown: sinFoco, onclick: () => deshacer() });
    const bRehacer = h('button', { class: 'icono', type: 'button', 'aria-label': 'Rehacer', title: 'Rehacer (Ctrl+Y)', text: '↷', onmousedown: sinFoco, onclick: () => rehacer() });
    const bEditar = h('button', { class: 'boton-cabecera', type: 'button', onmousedown: sinFoco, onclick: () => { guardarLoEscrito(); editando = !editando; sel = null; pintar(); } });
    const bPdf = h('button', { class: 'boton-cabecera secundario solo-pc', type: 'button', text: '🖨️ PDF', onmousedown: sinFoco, onclick: () => pdf() });
    const bWord = h('button', { class: 'boton-cabecera secundario solo-pc', type: 'button', text: '📄 Word', onmousedown: sinFoco, onclick: () => word() });
    const bMas = h('button', { class: 'icono', type: 'button', 'aria-label': 'Más opciones del informe', title: 'Más', text: '⋯', onmousedown: sinFoco, onclick: () => mas() });
    // Ctrl+Z / Ctrl+Y (fuera de un texto: dentro, deshace lo escrito, como siempre)
    const teclas = (e) => {
      if (!editando || !capas.length || capas[capas.length - 1].el !== panel) return;
      // (Alt+↑ / Alt+↓: subir o bajar lo elegido, también mientras se escribe en ello)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel && x.bloques[sel.i] && x.bloques[sel.i].t !== 'portada') {
        e.preventDefault();
        guardarLoEscrito();
        soltarFoco();
        mover(sel.i, e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      // (Ctrl+H: buscar y reemplazar, también escribiendo)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); buscarYReemplazar(); return; }
      const a = document.activeElement;
      if (a && a.classList && a.classList.contains('escribible')) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); deshacer(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); rehacer(); }
    };
    document.addEventListener('keydown', teclas);
    // (lo que se está escribiendo se guarda también al salir de la app o del informe sin tocar fuera del texto)
    const alOcultar = () => { if (document.visibilityState === 'hidden') guardarLoEscrito(); };
    document.addEventListener('visibilitychange', alOcultar);
    const { cuerpo, titulo, panel, capa } = abrirPanel(`📄 ${x.nombre}`, [bDeshacer, bRehacer, bEditar, bPdf, bWord, bMas], () => {
      document.removeEventListener('keydown', teclas);
      document.removeEventListener('visibilitychange', alOcultar);
      cuerpo.removeEventListener('scroll', alDesplazar);
      const zona = document.getElementById('impresion');
      if (zona) zona.replaceChildren();
      document.body.classList.remove('imprimiendo');
      if (alVolver) alVolver();
    });
    capa.retener = () => { guardarLoEscrito(); return false; };
    panel.classList.add('panel-informe');
    titulo.classList.add('titulo-cambiable');
    titulo.title = 'Cambiar el nombre';
    titulo.addEventListener('click', () => renombrar());
    const hoja = h('div', { class: 'informe-hoja' });
    const indice = h('nav', { class: 'informe-indice', 'aria-label': 'Índice del informe' });
    const barra = h('div', { class: 'editor-barra', hidden: true });
    // Cambia el informe guardado (fn recibe sus bloques) y lo vuelve a dibujar donde se estaba; antes,
    // apunta cómo estaba para poder deshacerlo. fuera: lo que ese cambio corrigió también en la bitácora
    // ([{ escribir, viejo, nuevo }]): deshacer lo deja allí como estaba, y rehacer lo vuelve a corregir
    // (versión 139; antes, deshacer solo deshacía el informe)
    const cambiarX = (fn, { sinPila = false, fuera = [] } = {}) => {
      let paso = null;
      cambiarCuaderno((d) => {
        const y = (d.informes || []).find((z) => z.id === id);
        if (!y) return;
        // (con las correcciones propuestas a la bitácora: deshacer también las quita; versión 143)
        if (!sinPila) { paso = { bloques: JSON.stringify(y.bloques), propuestas: JSON.stringify(y.propuestas || []), fuera }; pilaAtras.push(paso); if (pilaAtras.length > 80) pilaAtras.shift(); pilaAdelante.length = 0; }
        fn(y.bloques, y);
        y.mod = Date.now();
      });
      apuntarGuardado();
      pintar();
      return paso;
    };
    const volverA = (desde, hacia, atrasDel) => {
      if (!desde.length) return;
      const paso = desde.pop();
      cambiarCuaderno((d) => { const y = (d.informes || []).find((z) => z.id === id); if (!y) return; hacia.push({ bloques: JSON.stringify(y.bloques), propuestas: JSON.stringify(y.propuestas || []), fuera: paso.fuera }); y.bloques = JSON.parse(paso.bloques); if (paso.propuestas) { const l = JSON.parse(paso.propuestas); if (l.length) y.propuestas = l; else delete y.propuestas; } y.mod = Date.now(); });
      for (const f of paso.fuera) f.escribir(atrasDel ? f.viejo : f.nuevo);
      if (paso.fuera.length) avisar(atrasDel ? '↶ Deshecho también en la bitácora' : '↷ Corregido otra vez también en la bitácora');
      sel = null;
      apuntarGuardado();
      pintar();
    };
    const deshacer = () => { guardarLoEscrito(); volverA(pilaAtras, pilaAdelante, true); };
    const rehacer = () => volverA(pilaAdelante, pilaAtras, false);
    // «✓ Guardado» en la barra (estaba en el plan de la versión 137 y faltaba): cada cambio se guarda solo
    const estadoGuardado = h('span', { class: 'barra-estado', 'aria-live': 'polite' });
    const apuntarGuardado = () => { estadoGuardado.textContent = `✓ Guardado ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`; };

    // ── Dónde está el cursor (para dejarlo en su sitio al volver a dibujar) ──
    const claveRef = (r) => [r.i, r.campo, r.fila ?? '', r.col ?? '', r.item ?? ''].join('|');
    const refDeClave = (k) => {
      const [i, campo, fila, col, item] = k.split('|');
      const n = (v) => (v === '' ? undefined : Number(v));
      return { i: Number(i), campo, fila: n(fila), col: n(col), item: n(item) };
    };
    const posCursor = (el) => {
      const s = window.getSelection();
      if (!s || !s.rangeCount) return null;
      const r = s.getRangeAt(0);
      if (!el.contains(r.endContainer)) return null;
      const antes = document.createRange();
      antes.selectNodeContents(el);
      antes.setEnd(r.endContainer, r.endOffset);
      return antes.toString().length;
    };
    const ponerCursor = (el, pos) => {
      const s = window.getSelection();
      const r = document.createRange();
      let quedan = pos == null ? Infinity : pos;
      const recorrido = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) {
        if (quedan <= nodo.length) { r.setStart(nodo, quedan); r.collapse(true); s.removeAllRanges(); s.addRange(r); return; }
        quedan -= nodo.length;
      }
      r.selectNodeContents(el);
      r.collapse(false);
      s.removeAllRanges();
      s.addRange(r);
    };
    const leerEl = (el) => el.innerText.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();

    const pintar = () => {
      x = leerX();
      if (!x) return;
      titulo.textContent = `📄 ${x.nombre}`;
      const a = document.activeElement;
      const foco = a && a.dataset && a.dataset.ref && hoja.contains(a) ? { ref: a.dataset.ref, pos: posCursor(a) } : null;
      if (foco && ajuste) {
        const r = refDeClave(foco.ref);
        if (ajuste.item !== undefined) { if (r.i === ajuste.desde && r.item > ajuste.item) r.item--; }
        else if (r.i > ajuste.desde) r.i += ajuste.n;
        foco.ref = claveRef(r);
        if (sel && ajuste.item === undefined && sel.i > ajuste.desde) sel = { ...sel, i: sel.i + ajuste.n };
      }
      ajuste = null;
      const arriba = cuerpo.scrollTop;
      actual = informeHtml(x.bloques, { edicion: editando ? edicion : null });
      // (los textos que se van a sustituir ya no se guardan al perder el cursor: si no, lo de uno se podía
      // guardar en el que ocupa ahora su sitio —al quitar una fila, en la de debajo—; versión 142)
      for (const el of hoja.querySelectorAll('.escribible')) el.dataset.hecho = '1';
      poner(hoja, actual.el);
      cuerpo.scrollTop = arriba;
      if (foco) {
        const el = hoja.querySelector(`[data-ref="${foco.ref}"]`);
        if (el) { el.focus({ preventScroll: true }); ponerCursor(el, foco.pos); }
      }
      marcarElegido();
      pintarBarra();
      pintarIndice();
      bEditar.textContent = editando ? '✓ Listo' : '✏️ Editar';
      bEditar.setAttribute('aria-label', editando ? 'Terminar de editar' : 'Editar este informe');
      bDeshacer.hidden = !editando;
      bRehacer.hidden = !editando;
      bDeshacer.disabled = !pilaAtras.length;
      bRehacer.disabled = !pilaAdelante.length;
      panel.classList.toggle('editando-informe', editando);
    };

    // ── Leer y escribir cada trozo de texto de un bloque (ref.campo) ──
    const leerCampo = (b, r) => {
      switch (r.campo) {
        case 'item': return b.items[r.item];
        case 'celda': return (b.filas[r.fila] || [])[r.col];
        case 'cab': return b.cab[r.col];
        case 'detalles': return b.detalles.join(' · ');
        case 'obs': return b.observaciones;
        case 'panel': return (b.paneles[r.item] || {}).texto;
        default: return b[r.campo];
      }
    };
    const escribirCampo = (z, r, v, B) => {
      const k = B.indexOf(z);
      switch (r.campo) {
        case 'texto':
          if (!v && ['p', 'h1', 'h2', 'paso'].includes(z.t)) { B.splice(k, 1); return; }
          // (un párrafo con saltos de línea son varios párrafos, como al pulsar Intro en Word)
          if (z.t === 'p' && v.includes('\n')) { const partes = v.split(/\n+/).map((s) => s.trim()).filter(Boolean); B.splice(k, 1, ...partes.map((t) => ({ ...z, texto: t }))); return; }
          z.texto = v;
          return;
        case 'item':
          if (!v) { z.items.splice(r.item, 1); if (z.editarItems) z.editarItems.splice(r.item, 1); if (!z.items.length) B.splice(k, 1); } else z.items[r.item] = v;
          return;
        case 'celda': z.filas[r.fila][r.col] = v; return;
        case 'cab': z.cab[r.col] = v; return;
        case 'detalles': z.detalles = v.split(' · ').map((s) => s.trim()).filter(Boolean); return;
        case 'desc': z.desc = v && !/[.!?]$/.test(v) ? `${v}.` : v; return;
        case 'pie': if (v) z.pie = v; else delete z.pie; return;
        case 'obs': z.observaciones = v; return;
        case 'panel': if (z.paneles[r.item]) z.paneles[r.item].texto = v; return;
        // (el punto lo pone el pie)
        case 'cabeza': z.cabeza = v.replace(/\.+$/, ''); return;
        default: z[r.campo] = v;
      }
    };
    // De dónde sale (en la bitácora, la receta…) lo escrito en un trozo: para corregirlo también allí
    const enlacesDe = (b, r) => {
      switch (r.campo) {
        case 'texto': return b.editar && b.editar.tipo !== 'abrirReceta' ? [b.editar] : [];
        case 'item': return [(b.editarItems && b.editarItems[r.item]) || b.editar].filter(Boolean);
        case 'celda': return [b.editarFilas && b.editarFilas[r.fila]].filter(Boolean);
        case 'obs': return b.entradaId ? [{ tipo: 'apuntes', ids: [b.entradaId] }] : [];
        case 'pie': return [{ tipo: 'fotosPie', entradaId: b.entradaId, fotos: b.paneles.map((p) => p.id) }];
        case 'titulo': case 'autores': case 'institucion': return b.t === 'portada' ? [{ tipo: 'texto', clave: r.campo }] : [];
        default: return [];
      }
    };
    // Las marcas de las citas («⟦T:t3⟧») se vuelven a poner donde sigue su texto («Tabla 3»)
    const devolverMarcas = (crudo, nuevo, citas) => {
      let r = nuevo;
      for (const m of crudo.match(/⟦[^⟧]*⟧/g) || []) {
        const visto = citas(m);
        const k = r.indexOf(visto);
        if (k >= 0) r = `${r.slice(0, k)}${m}${r.slice(k + visto.length)}`;
      }
      return r;
    };
    const cambiarEnBloques = (B, cambios) => {
      for (const ch of cambios) {
        const viejas = formasDe(ch.fuente.valor);
        const nuevas = formasDe(ch.nuevoRaw);
        viejas.forEach((v, k) => reemplazarEnBloques(B, v, nuevas[Math.min(k, nuevas.length - 1)] || ''));
      }
    };
    const conAjuste = (ref, fn) => (B, y) => {
      const n0 = B.length;
      const items0 = B[ref.i] && B[ref.i].items ? B[ref.i].items.length : 0;
      fn(B, y);
      if (B.length !== n0) ajuste = { desde: ref.i, n: B.length - n0 };
      else if (ref.campo === 'item' && B[ref.i] && B[ref.i].items.length < items0) ajuste = { desde: ref.i, item: ref.item };
    };
    // Guardar lo escrito en un trozo (al salir de él). Si lo cambiado es una frase de la bitácora, se corrige
    // también allí, con un aviso que deja no hacerlo («Solo en el informe»)
    // siFuera: la casilla «Corregir también en la bitácora» de la barra, tal como estaba al salir del texto
    const guardarTexto = (ref, nuevo, siFuera = false) => {
      x = leerX();
      if (!x) return;
      const b = x.bloques[ref.i];
      if (!b) return;
      const citas = numerar(x.bloques).citas;
      const crudo = leerCampo(b, ref) || '';
      const mostrado = citas(crudo);
      if (nuevo === mostrado) {
        // (un párrafo, un título o una línea nuevos que se dejan vacíos, fuera)
        if (!nuevo && (['p', 'h1', 'h2'].includes(b.t) && ref.campo === 'texto' || ref.campo === 'item')) cambiarX(conAjuste(ref, (B) => escribirCampo(B[ref.i], ref, '', B)), { sinPila: true });
        return;
      }
      const conMarcas = citasVivas(devolverMarcas(crudo, nuevo, citas), x.bloques);
      const c = leerCuaderno();
      // De dónde viene lo cambiado: un texto de la bitácora (fuente) o una corrección ya propuesta y aún sin
      // aceptar (si se vuelve a corregir, se corrige la propuesta)
      const fuentes = enlacesDe(b, ref).flatMap((o) => fuentesDe(c, o, { amb }).map((f) => ({ ...f, enlace: o })));
      const pendientes = (x.propuestas || []).map((p) => ({ etiqueta: p.etiqueta, valor: p.nuevo, propuesta: p }));
      const ch = detectarCambio(mostrado, nuevo, [...pendientes, ...fuentes])[0];
      const cambios = ch && siFuera && !ch.fuente.propuesta ? [ch] : [];
      // (observaciones donde no había: pasan a ser la nota de su apunte, si no tenía)
      const e = ref.campo === 'obs' && !mostrado && nuevo && b.entradaId && c.entradas.find((y) => y.id === b.entradaId);
      const notaNueva = e && !e.nota ? e.id : null;
      const fuera = cambios.map((ch) => ({ escribir: ch.fuente.escribir, viejo: ch.fuente.valor, nuevo: ch.nuevoRaw }));
      if (notaNueva && siFuera) fuera.push({ escribir: (v) => cambiarCuaderno((d) => { const y = d.entradas.find((z) => z.id === notaNueva); if (!y) return; if (v) y.nota = v; else delete y.nota; }), viejo: '', nuevo });
      for (const f of fuera) f.escribir(f.nuevo);
      // Sin la casilla: queda propuesto para aceptarlo luego en la bitácora (versión 143)
      // (los textos para los informes nuevos no son de la bitácora: esos no se proponen; y cambiar la redacción del
      // pie de una figura —«Microscopio electrónico» → «microscopía electrónica»— no es cambiar el nombre de la
      // técnica ni del grupo en la bitácora: se vio al rellenar un informe para entregar; versión 144)
      const deUnPie = ch && ch.fuente.enlace && ch.fuente.enlace.tipo === 'fotosPie' && /técnica|nombre del grupo/.test(ch.fuente.etiqueta);
      const propuesta = !siFuera && (ch && !ch.fuente.propuesta && ch.fuente.enlace.tipo !== 'texto' && !deUnPie ? { enlace: ch.fuente.enlace, etiqueta: ch.fuente.etiqueta, viejo: ch.fuente.valor, nuevo: ch.nuevoRaw }
        : notaNueva ? { nota: notaNueva, enlace: { tipo: 'apuntes', ids: [notaNueva] }, etiqueta: 'en la bitácora (como nota del apunte)', viejo: '', nuevo } : null);
      const corregida = ch && ch.fuente.propuesta ? { id: ch.fuente.propuesta.id, nuevo: ch.nuevoRaw } : null;
      const paso = cambiarX(conAjuste(ref, (B, y) => {
        const z = B[ref.i];
        cambiarEnBloques(B, cambios);
        escribirCampo(z, ref, conMarcas, B);
        if (propuesta) y.propuestas = [...(y.propuestas || []), { id: idDe('pr'), fecha: Date.now(), ...propuesta }];
        if (corregida) {
          // (vuelta a como estaba en la bitácora: ya no hay nada que proponer)
          y.propuestas = (y.propuestas || []).map((p) => (p.id === corregida.id ? { ...p, nuevo: corregida.nuevo, fecha: Date.now() } : p)).filter((p) => p.nuevo !== p.viejo);
          if (!y.propuestas.length) delete y.propuestas;
        }
      }), { fuera });
      if (corregida && siFuera) {
        const p = (leerX().propuestas || []).find((q) => q.id === corregida.id);
        if (p && aceptarPropuesta(leerX(), p) === 'ok') avisar(`✅ Corregido también ${p.etiqueta}`);
      }
      if (propuesta) {
        avisar('📝 Guardado en el informe. En la bitácora queda para que lo aceptes («Correcciones del informe»)', { texto: 'Aceptarlo ya', hacer: () => {
          const y = leerX();
          const p = y && (y.propuestas || [])[(y.propuestas || []).length - 1];
          avisar(p && aceptarPropuesta(y, p) === 'ok' ? `✅ Corregido también ${p.etiqueta}` : 'No se ha podido: en la bitácora ese texto ya ha cambiado');
        } });
      }
      if (fuera.length) {
        avisar(`✅ Corregido también ${cambios.length ? cambios[0].fuente.etiqueta : 'en la bitácora (la nota del apunte)'}`, { texto: 'Solo en el informe', hacer: () => {
          for (const f of fuera) f.escribir(f.viejo);
          // (y deshacer o rehacer ya no la tocan)
          if (paso) paso.fuera = [];
          avisar('Vale: en la bitácora se queda como estaba');
        } });
      }
    };
    // Las citas que se escriben a mano («como se ve en la Figura 3», «la Tabla 2», «Figuras 2 a 4») pasan a
    // ser citas vivas (⟦F:id⟧…): si luego se mueve o se quita una figura, el número se cambia solo
    // (versión 139). Solo con mayúscula y si existe esa tabla o figura
    const citasVivas = (texto, B) => {
      const N = numerar(B);
      const por = { Tabla: new Map(), Figura: new Map() };
      for (const b of N) if (b.id && (b.t === 'tabla' || b.t === 'arbol' || b.t === 'fotos')) { const [tipo, n] = b.n.split(' '); por[tipo].set(n, b.id); }
      return String(texto).split(/(⟦[^⟧]*⟧)/).map((trozo, k) => (k % 2 ? trozo : trozo
        .replace(/\bFiguras (\d+) a (\d+)\b/g, (todo, a, z) => (por.Figura.has(a) && por.Figura.has(z) ? `⟦FS:${por.Figura.get(a)}:${por.Figura.get(z)}⟧` : todo))
        .replace(/\b(Tabla|Figura) (\d+)\b/g, (todo, tipo, n) => (por[tipo].has(n) ? `⟦${tipo === 'Tabla' ? 'T' : 'F'}:${por[tipo].get(n)}⟧` : todo)))).join('');
    };
    // Lo que se está escribiendo, guardado ya (antes de una herramienta, de deshacer, de terminar…)
    const guardarLoEscrito = () => {
      const a = document.activeElement;
      if (a && a.classList && a.classList.contains('escribible') && hoja.contains(a)) guardarTexto(refDeClave(a.dataset.ref), leerEl(a), siFueraDe(a.dataset.ref));
    };
    // La casilla «☑ Corregir también en la bitácora» (versión 140; lo pidió el usuario: «que me salga una casilla
    // para marcar si se cambia o no»). Desde la versión 142, QUITADA de entrada (lo pidió: «mejor al revés, que
    // esté desactivado de normal y haya que activarlo»): una por texto, quitada cada vez que se entra
    let fueraSi = { clave: null, si: false };
    const siFueraDe = (clave) => (fueraSi.clave === clave ? fueraSi.si : false);
    // De dónde viene un texto del informe (para decirlo antes de escribir): la etiqueta de su sitio en la
    // bitácora, la receta, las notas… o null si solo está en el informe
    const deDondeViene = (ref) => {
      const b = x.bloques[ref.i];
      if (!b || !ref.campo) return null;
      const mostrado = numerar(x.bloques).citas(leerCampo(b, ref) || '');
      const c = leerCuaderno();
      const f = enlacesDe(b, ref).flatMap((o) => fuentesDe(c, o, { amb })).find((y) => formasDe(y.valor).some((v) => mostrado.includes(v)))
        // (o una corrección ya propuesta a la bitácora y aún sin aceptar)
        || (x.propuestas || []).find((p) => p.nuevo && formasDe(p.nuevo).some((v) => mostrado.includes(v)));
      if (f) return f.etiqueta;
      if (ref.campo === 'obs' && !mostrado && b.entradaId) {
        const e = c.entradas.find((y) => y.id === b.entradaId);
        if (e && !e.nota) return 'en la bitácora (como nota del apunte)';
      }
      return null;
    };
    const casillaFuera = (ref) => {
      const clave = claveRef(ref);
      const etiqueta = deDondeViene(ref);
      if (!etiqueta) return h('span', { class: 'barra-solo', text: 'Solo en este informe', title: 'Lo que escribas aquí no cambia la bitácora' });
      const b = h('button', { type: 'button', role: 'checkbox', class: 'herramienta casilla-fuera', title: 'Marcada: se corrige ya también allí. Sin marcar: queda en la bitácora, en «Correcciones del informe», para aceptarlo luego',
        onmousedown: sinFoco,
        onclick: () => { fueraSi = { clave, si: !siFueraDe(clave) }; pintarCasilla(); } });
      const pintarCasilla = () => {
        const si = siFueraDe(clave);
        b.setAttribute('aria-checked', String(si));
        b.textContent = `${si ? '☑' : '☐'} Corregir también ${etiqueta}`;
      };
      pintarCasilla();
      return b;
    };

    // ── Lo que pone el editor en la hoja (informeHtml) ──
    const edicion = {
      texto: (el, ref, valor, op) => {
        el.textContent = valor;
        el.classList.add('escribible');
        el.dataset.ref = claveRef(ref);
        if (op.pista) el.dataset.pista = op.pista;
        el.contentEditable = 'plaintext-only';
        if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
        el.spellcheck = true;
        el.addEventListener('focus', () => { if (fueraSi.clave !== el.dataset.ref) fueraSi = { clave: el.dataset.ref, si: false }; elegirBloque(ref.i, ref); });
        el.addEventListener('keydown', (e) => {
          // (Esc deja el texto como estaba; Intro, en una línea, termina)
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); el.textContent = valor; el.blur(); }
          // (en una lista, Intro hace otra línea debajo, como en Word; en una línea vacía, termina)
          else if (e.key === 'Enter' && ref.campo === 'item' && !e.ctrlKey && !e.metaKey && !e.shiftKey && leerEl(el)) { e.preventDefault(); otraLinea(el, ref); }
          else if (e.key === 'Enter' && (op.linea || e.ctrlKey || e.metaKey)) { e.preventDefault(); el.blur(); }
        });
        el.addEventListener('paste', (e) => {
          if (el.contentEditable !== 'true') return;
          e.preventDefault();
          document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
        });
        // (se guarda al salir: un momento después, para que el cursor ya esté donde se ha tocado)
        el.addEventListener('blur', () => {
          if (el.dataset.hecho) return;
          const v = leerEl(el);
          const si = siFueraDe(el.dataset.ref);
          if (fueraSi.clave === el.dataset.ref) fueraSi = { clave: null, si: false };
          setTimeout(() => guardarTexto(ref, v, si), 0);
        });
        return el;
      },
      bloque: (el, i) => {
        el.dataset.i = String(i);
        el.addEventListener('click', (e) => { if (!e.target.closest('.escribible, .informe-panel')) elegirBloque(i); });
        return el;
      },
      hueco: (el, i) => { el.dataset.i = String(i); el.addEventListener('click', () => { elegirBloque(i); escribirHueco(i); }); return el; },
      // (tocar la imagen: su cuadro; tocar el texto de debajo: escribir en él)
      panel: (el, i, pi) => { el.addEventListener('click', (e) => { if (e.target.closest('.escribible')) return; elegirBloque(i, { panel: pi }); editarPanel(i, pi); }); return el; },
      reordenar: (listas) => reordenarFotos(listas),
    };
    const otraLinea = (el, ref) => {
      el.dataset.hecho = '1';
      guardarTexto(ref, leerEl(el), siFueraDe(el.dataset.ref));
      cambiarX((B) => { const z = B[ref.i]; if (!z || !z.items) return; z.items.splice(ref.item + 1, 0, ''); if (z.editarItems) z.editarItems.splice(ref.item + 1, 0, null); });
      const n = hoja.querySelector(`[data-ref="${claveRef({ ...ref, item: ref.item + 1 })}"]`);
      if (n) n.focus();
    };
    const elegirBloque = (i, ref = null) => { sel = { i, ref }; marcarElegido(); pintarBarra(); };
    const marcarElegido = () => {
      for (const el of hoja.querySelectorAll('.seleccionado')) el.classList.remove('seleccionado');
      if (sel) { const el = hoja.querySelector(`[data-i="${sel.i}"]`); if (el) el.classList.add('seleccionado'); }
    };

    // ── La barra de herramientas: lo que se puede hacer con lo elegido ──
    const herr = (texto, hacer, op = {}) => h('button', { type: 'button', class: `herramienta${op.peligro ? ' peligro' : ''}`, text: texto, title: op.titulo || null, 'aria-label': op.titulo || null,
      // (op.descartar: lo que se quita —una fila, una línea, un bloque— no guarda antes lo que se escribía en ello)
      onmousedown: sinFoco, onclick: async () => { if (!op.descartar) guardarLoEscrito(); soltarFoco(); await hacer(); } });
    // Sale del texto en el que se escribe sin volver a guardarlo (ya se guardó): así lo que viene después
    // (quitar una fila, mover un bloque…) no se lleva el cursor a otro sitio ni guarda allí lo de este
    const soltarFoco = () => {
      const a = document.activeElement;
      if (a && a.classList && a.classList.contains('escribible') && hoja.contains(a)) { a.dataset.hecho = '1'; a.blur(); }
    };
    const nombreDe = (b, n) => ({ portada: 'Portada', h1: 'Título', h2: 'Subtítulo', p: 'Párrafo', paso: `Paso ${n.n}`, lista: 'Lista', tabla: n.n, arbol: n.n, fotos: n.n, salto: 'Salto de página', hueco: 'Por escribir' })[b.t] || 'Bloque';
    const pintarBarra = () => {
      barra.hidden = !editando;
      if (!editando) return;
      const b = sel && x.bloques[sel.i];
      if (!b) {
        poner(barra, h('div', { class: 'barra-fila' }, h('span', { class: 'barra-pista', text: 'Toca un texto para escribir en él · mantén pulsada una foto para moverla' }),
          herr('＋ Añadir al final', () => anadirMenu(x.bloques.length - 1)), herr('🔎 Buscar y reemplazar', buscarYReemplazar), herr('🏷️ Nombres de los grupos', nombresGrupos), ctx && herr('⚙️ Qué incluir', queIncluir), estadoGuardado));
        return;
      }
      const n = numerar(x.bloques)[sel.i];
      const r = sel.ref || {};
      // (la foto elegida: tocando la imagen o el texto de debajo)
      const pPanel = r.panel !== undefined ? r.panel : r.campo === 'panel' ? r.item : undefined;
      // (de dónde sale lo elegido: un apunte de la bitácora o algo de la receta)
      const enlace = (r.item !== undefined && ((b.editarItems && b.editarItems[r.item]) || b.editar))
        || (r.fila !== undefined && b.editarFilas && b.editarFilas[r.fila]) || (b.t === 'paso' && b.editar) || null;
      // (la casilla va aparte: en el móvil, en su propia línea encima de los botones; en el PC, en la misma fila)
      poner(barra, r.campo && casillaFuera(r), h('div', { class: 'barra-fila' },
        h('span', { class: 'barra-nombre', text: nombreDe(b, n) }),
        b.t !== 'portada' && herr('⬆️', () => mover(sel.i, -1), { titulo: 'Subir' }),
        b.t !== 'portada' && herr('⬇️', () => mover(sel.i, 1), { titulo: 'Bajar' }),
        herr('＋ Añadir', () => anadirMenu(sel.i), { titulo: 'Añadir debajo' }),
        b.t === 'tabla' && herr('🙈 Columnas', () => columnas(sel.i)),
        b.t === 'tabla' && herr('＋ Fila', () => filaNueva(sel.i, r.fila === undefined ? b.filas.length - 1 : r.fila), { titulo: 'Añadir una fila debajo' }),
        b.t === 'tabla' && r.fila !== undefined && herr('🗑️ Fila', () => { const i = sel.i; sel = { i, ref: null }; cambiarX((B) => { B[i].filas.splice(r.fila, 1); if (B[i].editarFilas) B[i].editarFilas.splice(r.fila, 1); }); }, { peligro: true, titulo: 'Quitar esta fila', descartar: true }),
        b.t === 'fotos' && b.paneles.length > 1 && herr(`▦ ${b.cols ? `${b.cols} por fila` : 'Por fila'}`, () => fotosPorFila(sel.i), { titulo: 'Cuántas fotos por fila' }),
        b.t === 'lista' && r.item !== undefined && herr('🗑️ Línea', () => { const i = sel.i; sel = { i, ref: null }; cambiarX((B) => escribirCampo(B[i], r, '', B)); }, { peligro: true, titulo: 'Quitar esta línea', descartar: true }),
        enlace && enlace.tipo === 'apuntes' && herr('📝 Su apunte', () => { const e = leerCuaderno().entradas.find((y) => y.id === enlace.ids[0]); if (e) editarApunte(e, pintar); }),
        b.t === 'fotos' && herr(b.pie ? '↩️ Pie automático' : '✍️ Pie a mano', () => cambiarX((B) => { const z = B[sel.i]; if (z.pie) delete z.pie; else z.pie = numerar(B)[sel.i].titulo; })),
        b.t === 'fotos' && (b.quitados || []).length > 0 && herr(`↩️ Fotos quitadas (${b.quitados.length})`, () => cambiarX((B) => { B[sel.i].paneles.push(...B[sel.i].quitados); delete B[sel.i].quitados; })),
        b.t === 'fotos' && pPanel !== undefined && pPanel > 0 && herr('✂️ Partir aquí', () => partirFigura(sel.i, pPanel), { titulo: 'Partir la figura: desde esta foto, en una figura nueva' }),
        b.t === 'fotos' && x.bloques[sel.i + 1] && x.bloques[sel.i + 1].t === 'fotos' && herr('⤵️ Juntar con la siguiente', () => juntarFigura(sel.i), { titulo: 'Juntar con la figura siguiente' }),
        b.t === 'fotos' && pPanel !== undefined && b.paneles[pPanel] && herr('🚫 Quitar esta foto', () => accionPanel(sel.i, pPanel, 'quitar'), { peligro: true }),
        (b.t === 'h1' || b.t === 'h2') && herr('🗑️ Quitar la sección entera', () => quitarSeccion(sel.i), { peligro: true, titulo: 'Quitar la sección entera (título y todo lo suyo)', descartar: true }),
        enlace && enlace.tipo === 'abrirReceta' && herr('📋 Cambiarlo en la receta', () => { const rr = recetaDe(enlace.recetaId); if (rr) abrirFormulario(rr, () => {}, { marca: enlace.marca, valor: enlace.valor, desfase: 80 }); }),
        b.t === 'hueco' && herr('✏️ Escribirlo', () => escribirHueco(sel.i)),
        b.t !== 'portada' && herr('🗑️ Quitar', () => quitarBloque(sel.i), { peligro: true, titulo: 'Quitar del informe (la bitácora no cambia)', descartar: true }),
        estadoGuardado));
    };
    // ✂️ Partir una figura desde una foto (versión 145): esa y las de detrás pasan a una figura nueva justo debajo,
    // con lo mismo arriba en su pie y «(continuación)»; las observaciones van con la última
    const partirFigura = (i, pi) => {
      cambiarX((B) => {
        const z = B[i];
        const usados = new Set(B.map((y) => y.id));
        let id = `${z.id}p`;
        for (let k = 2; usados.has(id); k++) id = `${z.id}p${k}`;
        const nueva = { ...JSON.parse(JSON.stringify(z)), id, paneles: z.paneles.slice(pi), desc: '', quitados: undefined,
          cabeza: /\(continuación\)$/.test(z.cabeza || '') ? z.cabeza : `${z.cabeza || 'Imágenes'} (continuación)` };
        delete nueva.pie;
        delete nueva.quitados;
        z.paneles = z.paneles.slice(0, pi);
        if (z.finSesion || z.observaciones) { z.observaciones = ''; z.finSesion = false; }
        B.splice(i + 1, 0, nueva);
      });
      sel = { i: i + 1, ref: null };
      marcarElegido();
      pintarBarra();
      avisar('✂️ Figura partida en dos (solo en el informe)', { texto: 'Deshacer', hacer: deshacer });
    };
    // ⤵️ Juntar una figura con la siguiente: sus fotos pasan a esta (y sus observaciones, si las tenía)
    const juntarFigura = (i) => {
      cambiarX((B) => {
        const z = B[i];
        const sig = B[i + 1];
        if (!sig || sig.t !== 'fotos') return;
        z.paneles = [...z.paneles, ...sig.paneles];
        if (sig.quitados) z.quitados = [...(z.quitados || []), ...sig.quitados];
        if (sig.observaciones) z.observaciones = [z.observaciones, sig.observaciones].filter(Boolean).join('\n');
        if (sig.finSesion) z.finSesion = true;
        B.splice(i + 1, 1);
      });
      sel = { i, ref: null };
      marcarElegido();
      pintarBarra();
    };
    // 🗑️ Quitar una sección entera: el título y todo lo que va debajo hasta el siguiente título de su nivel o mayor
    const quitarSeccion = (i) => {
      const B0 = x.bloques;
      const nivel = B0[i].t === 'h1' ? 1 : 2;
      let fin = i + 1;
      while (fin < B0.length && !(B0[fin].t === 'h1' || (nivel === 2 && B0[fin].t === 'h2'))) fin++;
      const n = fin - i;
      cambiarX((B) => { B.splice(i, n); });
      sel = null;
      pintarBarra();
      avisar(`Quitada la sección (${n} ${n === 1 ? 'bloque' : 'bloques'}; la bitácora no cambia)`, { texto: 'Deshacer', hacer: deshacer });
    };
    // Una fila nueva en una tabla, debajo de la elegida, y ya para escribir en su primera casilla
    const filaNueva = (i, fila) => {
      cambiarX((B) => { const z = B[i]; z.filas.splice(fila + 1, 0, z.cab.map(() => '')); if (z.editarFilas) z.editarFilas.splice(fila + 1, 0, null); });
      const col = (x.bloques[i].cab || []).findIndex((_, k) => !(x.bloques[i].ocultas || []).includes(k));
      const el = hoja.querySelector(`[data-ref="${claveRef({ i, campo: 'celda', fila: fila + 1, col })}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
    };
    // Cuántas fotos van en cada fila de una figura (en la pantalla, en el PDF y en Word)
    const fotosPorFila = async (i) => {
      const b = x.bloques[i];
      const o = await elegir({ texto: '▦ Fotos por fila', detalle: 'Más por fila, más pequeñas.', opciones: [
        { texto: `Automático${b.cols ? '' : ' ✓'}`, v: 0 },
        ...[1, 2, 3, 4].filter((n) => n <= b.paneles.length).map((n) => ({ texto: `${n} por fila${b.cols === n ? ' ✓' : ''}`, v: n }))] });
      if (o) cambiarX((B) => { if (o.v) B[i].cols = o.v; else delete B[i].cols; });
    };
    const mover = (i, d) => {
      if (i + d < 0 || i + d >= x.bloques.length) return;
      cambiarX((B) => { [B[i], B[i + d]] = [B[i + d], B[i]]; });
      sel = { i: i + d, ref: null };
      marcarElegido();
      pintarBarra();
      const el = hoja.querySelector(`[data-i="${i + d}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    };
    const quitarBloque = (i) => {
      cambiarX((B) => { B.splice(i, 1); });
      sel = null;
      pintarBarra();
      avisar('Quitado del informe (la bitácora no cambia)', { texto: 'Deshacer', hacer: deshacer });
    };
    // Añadir algo debajo de i, y ponerse ya a escribir en ello
    const insertar = (i, nuevo) => {
      cambiarX((B) => { B.splice(i + 1, 0, nuevo); });
      sel = { i: i + 1, ref: null };
      marcarElegido();
      pintarBarra();
      const el = hoja.querySelector(`[data-i="${i + 1}"]`);
      const escribir = el && (el.matches('.escribible') ? el : el.querySelector('.escribible'));
      if (el) el.scrollIntoView({ block: 'center' });
      if (escribir) { escribir.focus(); ponerCursor(escribir, null); }
    };
    const anadirMenu = async (i) => {
      const o = await elegir({ texto: '＋ Añadir debajo', opciones: [
        { texto: '¶ Un párrafo', hacer: () => insertar(i, { t: 'p', texto: '' }) },
        { texto: '🔠 Un título de sección', hacer: () => insertar(i, { t: 'h1', num: true, texto: '' }) },
        { texto: '🔡 Un subtítulo', hacer: () => insertar(i, { t: 'h2', num: true, texto: '' }) },
        { texto: '• Una lista', hacer: () => insertar(i, { t: 'lista', items: [''] }) },
        { texto: '🖼️ Una figura con fotos del cuaderno', hacer: () => figuraNueva(i) },
        { texto: '📄 Un salto de página', hacer: () => insertar(i, { t: 'salto' }) }] });
      if (o) await o.hacer();
    };
    // Una figura nueva con fotos del cuaderno (las que se toquen, en ese orden)
    const figuraNueva = async (i) => {
      const c = leerCuaderno();
      const todas = K.fotosDe(c, amb);
      if (!todas.length) { avisar('Este cuaderno no tiene fotos'); return; }
      const elegidas = new Set();
      const rejilla = h('div', { class: 'elegir-fotos' }, todas.map(({ id: fid, entrada }) => {
        const b = h('button', { type: 'button', class: 'elegir-foto', 'aria-pressed': 'false', title: sinEmoji(K.tituloFoto(c, fid, entrada)),
          onclick: () => { if (elegidas.has(fid)) elegidas.delete(fid); else elegidas.add(fid); b.setAttribute('aria-pressed', String(elegidas.has(fid))); } }, imagenFoto(fid));
        return b;
      }));
      const pie = h('textarea', { class: 'campo', rows: 2, autocapitalize: 'sentences', placeholder: 'Pie de la figura: qué se ve en estas imágenes' });
      const r = await preguntar({ texto: '🖼️ Figura nueva', detalle: [h('p', { class: 'dialogo-detalle', text: 'Toca las fotos que van en la figura (salen en el orden en que las toques).' }), rejilla, pie], si: 'Añadir', no: 'Cancelar' });
      if (!r || !elegidas.size) return;
      const textoDe = (fid) => {
        const e = c.entradas.find((y) => (y.fotos || []).includes(fid));
        const info = K.infoFoto(e, fid);
        return [c.titulos[fid], info.aumento, info.zona && `zona: ${info.zona}`].filter(Boolean).join(', ');
      };
      insertar(i, { t: 'fotos', id: `fn${Date.now().toString(36)}`, paneles: [...elegidas].map((fid) => ({ id: fid, texto: textoDe(fid) })), cabeza: 'Imágenes', desc: '',
        ...(pie.value.trim() ? { pie: pie.value.trim() } : {}), entradaId: null });
    };
    // Lo que falta por escribir (resumen, introducción…): en su sitio, con su título; y, si se quiere,
    // también para los informes nuevos
    const SECCIONES = { resumen: ['Resumen', 'sinNumero', 'p'], introduccion: ['Introducción', 'num', 'p'], objetivos: ['Objetivos', 'num', 'lista'],
      discusion: ['Discusión', 'num', 'p'], conclusiones: ['Conclusiones', 'num', 'lista'], referencias: ['Referencias', 'sinNumero', 'numerada'] };
    const escribirHueco = async (i) => {
      const b = x.bloques[i];
      const clave = b.editar && b.editar.clave;
      const def = TEXTOS_INFORME.find(([k]) => k === clave);
      const [tit, numero, forma] = SECCIONES[clave] || [];
      if (!def || !tit) return;
      const area = h('textarea', { class: 'campo', rows: Math.max(3, def[3] + 1), autocapitalize: 'sentences', placeholder: def[2] });
      // (quitada de entrada, como la de la bitácora: versión 144)
      const paraNuevos = h('input', { type: 'checkbox', checked: false });
      const r = await preguntar({ texto: `✏️ ${def[1]}`, detalle: [area, h('label', { class: 'parte-opcion' }, paraNuevos, ' Usarlo también en los informes nuevos')], si: 'Guardar', no: 'Cancelar' });
      if (!r || !area.value.trim()) return;
      const v = area.value.trim();
      const ed = { tipo: 'texto', clave };
      const lineas = v.split('\n').map((s) => s.trim()).filter(Boolean);
      // (con sus citas vivas: «la Figura 2» sigue a su figura si cambia de número; versión 144)
      const cuerpoNuevo = forma === 'p' ? v.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({ t: 'p', texto: citasVivas(p, x.bloques), clase: clave === 'resumen' ? 'resumen' : undefined, editar: ed }))
        : [{ t: 'lista', items: lineas.map((l) => citasVivas(l, x.bloques)), numerada: forma === 'numerada', editar: ed }];
      cambiarX((B) => { B.splice(i, 1, { t: 'h1', texto: tit, ...(numero === 'num' ? { num: true } : { sinNumero: true }) }, ...cuerpoNuevo); });
      if (paraNuevos.checked) guardarTextoInforme(amb, K.fichaCuaderno(leerCuaderno(), amb), clave, v);
    };
    // Una imagen: lo que se ve (su título), el aumento y la zona; también en la foto, si se quiere
    const editarPanel = async (i, pi) => {
      const b = x.bloques[i];
      const p = b.paneles[pi];
      const c = leerCuaderno();
      const e = c.entradas.find((y) => y.id === b.entradaId) || c.entradas.find((y) => (y.fotos || []).includes(p.id));
      const info = K.infoFoto(e, p.id);
      const titulo2 = h('textarea', { class: 'campo', rows: 2, autocapitalize: 'sentences', value: c.titulos[p.id] || '', placeholder: 'Por ejemplo: mapa EDX del cobre' });
      const aumento = h('input', { class: 'campo', autocomplete: 'off', value: info.aumento || '', placeholder: 'Por ejemplo: 1000 o ×1000' });
      const zona = h('input', { class: 'campo', autocomplete: 'off', value: info.zona || '', placeholder: 'Por ejemplo: borde de la fibra' });
      // (quitada de entrada, como las demás: versión 144)
      const enLaFoto = h('input', { type: 'checkbox', checked: false });
      const r = await preguntar({ texto: '🖼️ Esta imagen', detalle: [
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Qué se ve' }), titulo2),
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Aumento' }), aumento),
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Zona' }), zona),
        e && h('label', { class: 'parte-opcion' }, enLaFoto, ' Guardarlo también en la foto (bitácora y Fotos)')],
      si: 'Guardar', no: 'Cancelar', otro: '🚫 Quitarla de este informe' });
      if (!r) return;
      if (r === 'otro') { accionPanel(i, pi, 'quitar'); return; }
      const t = titulo2.value.trim();
      const a0 = aumento.value.trim();
      const a = a0 && /^[\d.,]+$/.test(a0) ? `×${a0}` : a0.slice(0, 20);
      const z = zona.value.trim().slice(0, 40);
      cambiarX((B) => { B[i].paneles[pi].texto = [t, a, z && `zona: ${z}`].filter(Boolean).join(', '); });
      if (e && enLaFoto.checked) {
        cambiarCuaderno((d) => {
          if (t) d.titulos[p.id] = t.slice(0, 200); else delete d.titulos[p.id];
          const y = d.entradas.find((q) => q.id === e.id);
          if (!y) return;
          const n = { ...((y.fotosInfo || {})[p.id] || {}) };
          if (a) n.aumento = a; else delete n.aumento;
          if (z) n.zona = z; else delete n.zona;
          y.fotosInfo = { ...(y.fotosInfo || {}) };
          if (Object.keys(n).length) y.fotosInfo[p.id] = n; else delete y.fotosInfo[p.id];
          if (!Object.keys(y.fotosInfo).length) delete y.fotosInfo;
        });
      }
    };
    // 🚫 una imagen (solo en este informe: se puede volver a poner)
    const accionPanel = (i, pi, accion) => cambiarX((B) => {
      const ps = B[i].paneles;
      if (accion !== 'quitar' || !ps[pi]) return;
      B[i].quitados = [...(B[i].quitados || []), ps[pi]];
      ps.splice(pi, 1);
      // (una figura sin imágenes, fuera)
      if (!ps.length) B.splice(i, 1);
    });
    // Fotos arrastradas: el orden nuevo de cada figura (una foto puede haber pasado a otra; la que se queda
    // sin fotos, fuera)
    const reordenarFotos = (listas) => cambiarX((B) => {
      const todas = new Map();
      for (const b of B) if (b.t === 'fotos') for (const p of b.paneles) todas.set(p.id, p);
      for (const { lista, ids } of listas) {
        const b = B[Number(lista)];
        if (b && b.t === 'fotos') b.paneles = ids.map((fid) => todas.get(fid)).filter(Boolean);
      }
      for (let k = B.length - 1; k >= 0; k--) if (B[k].t === 'fotos' && !B[k].paneles.length) B.splice(k, 1);
    });
    // Quitar o volver a poner columnas de una tabla
    const columnas = async (i) => {
      const b = x.bloques[i];
      const marcas = b.cab.map((t, k) => h('input', { type: 'checkbox', checked: !(b.ocultas || []).includes(k) }));
      const r = await preguntar({ texto: '🙈 Columnas que se ven', detalle: b.cab.map((t, k) => h('label', { class: 'parte-opcion' }, marcas[k], ` ${t}`)), si: 'Guardar', no: 'Cancelar' });
      if (!r) return;
      const ocultas = marcas.map((m, k) => (m.checked ? null : k)).filter((k) => k !== null);
      if (ocultas.length === b.cab.length) { avisar('Tiene que quedar al menos una columna'); return; }
      cambiarX((B) => { B[i].ocultas = ocultas; });
    };

    // ── El índice (en el PC, a la izquierda): saltar a una sección y, editando, moverlas arrastrando ──
    const reordenarSecciones = (orden) => cambiarX((B) => {
      const cortes = B.map((b, k) => (b.t === 'h1' ? k : -1)).filter((k) => k >= 0);
      if (!cortes.length) return;
      const trozo = new Map(cortes.map((k, j) => [k, B.slice(k, j + 1 < cortes.length ? cortes[j + 1] : B.length)]));
      const nuevo = [...B.slice(0, cortes[0]), ...orden.flatMap((k) => trozo.get(k) || [])];
      if (nuevo.length === B.length) B.splice(0, B.length, ...nuevo);
    });
    const pintarIndice = () => {
      const N = numerar(x.bloques);
      const secciones = [];
      N.forEach((b, k) => {
        if (b.t === 'h1') secciones.push({ k, b, dentro: [] });
        else if (secciones.length && (b.t === 'h2' || b.t === 'tabla' || b.t === 'arbol' || b.t === 'fotos')) secciones[secciones.length - 1].dentro.push({ k, b });
      });
      const ir = (k) => { const el = hoja.querySelector(`[data-i="${k}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      const texto = (b) => (b.t === 'h1' || b.t === 'h2' ? b.texto : `${b.n}. ${sinEmoji(b.t === 'fotos' ? b.pie || b.cabeza || b.titulo : b.titulo || '')}`);
      const lista = h('div', { class: 'indice-lista', 'data-lista': 'indice' }, secciones.map(({ k, b, dentro }) => h('div', { class: 'indice-seccion', 'data-id': String(k) },
        h('button', { type: 'button', class: 'indice-h1', 'data-k': String(k), text: texto(b), onclick: () => ir(k) }),
        dentro.map((d) => h('button', { type: 'button', class: d.b.t === 'h2' ? 'indice-h2' : 'indice-fig', 'data-k': String(d.k), text: texto(d.b), title: texto(d.b), onclick: () => ir(d.k) })))));
      const zona = h('div', {}, lista);
      poner(indice, h('p', { class: 'indice-titulo', text: 'Índice' }), secciones.length ? zona : h('p', { class: 'nota', text: 'Sin secciones' }),
        editando && secciones.length > 1 && h('p', { class: 'nota indice-pista', text: 'Mantén pulsada una sección para moverla entera' }));
      if (editando) mantenerYArrastrar(zona, (listas) => reordenarSecciones(listas[0].ids.map(Number)));
      marcarActual();
    };
    // En el índice, marcada la sección (o figura) por la que se va leyendo
    const marcarActual = () => {
      if (!indice.offsetParent) return;
      const tope = cuerpo.getBoundingClientRect().top + 140;
      let actualK = null;
      for (const bt of indice.querySelectorAll('[data-k]')) {
        const el = hoja.querySelector(`[data-i="${bt.dataset.k}"]`);
        if (el && el.getBoundingClientRect().top <= tope) actualK = bt.dataset.k;
      }
      for (const bt of indice.querySelectorAll('[data-k]')) bt.classList.toggle('actual', bt.dataset.k === actualK);
      const marcado = indice.querySelector('.actual');
      if (marcado && (marcado.offsetTop < indice.scrollTop || marcado.offsetTop > indice.scrollTop + indice.clientHeight - 30)) indice.scrollTop = marcado.offsetTop - indice.clientHeight / 2;
    };
    let pendienteMarcar = false;
    const alDesplazar = () => { if (pendienteMarcar) return; pendienteMarcar = true; requestAnimationFrame(() => { pendienteMarcar = false; marcarActual(); }); };
    cuerpo.addEventListener('scroll', alDesplazar, { passive: true });

    // ── «Qué incluir» también en el informe que se edita (versión 142; lo pidió el usuario: «que lo de qué
    // incluir también salga en el que estás editando»). Al cambiar algo se quita o se pone SOLO esa parte
    // (el procedimiento, las fotos de Caracterización, un anexo), hecha con los datos de ahora; lo demás que
    // se haya editado se queda. Se deshace con ↶ ──
    const OPCIONES = { procedimiento: 'conReceta', variaciones: 'conVariaciones', historia: 'conHistoria', historiaDis: 'conHistoriaDis', anterior: 'conAnterior' };
    // La zona de cada bloque: la suya (los hechos desde la versión 142) o, en los de antes, por su título
    const zonasDe = (B) => {
      let z = null;
      const zs = B.some((b) => b.zona) ? B.map((b) => b.zona || null) : B.map((b) => {
        if (b.t === 'h1') z = /^Historia de cada disoluci/.test(b.texto) ? 'historiaDis' : /^Historia de cada grupo/.test(b.texto) ? 'historia' : /^Historia anterior/.test(b.texto) ? 'anterior' : null;
        else if (b.t === 'h2') z = /^(Reactivos y cantidades|Procedimiento)/.test(b.texto) ? 'procedimiento' : /^Caracterización/.test(b.texto) ? 'fotos' : null;
        return z;
      });
      // (en los informes de antes de la versión 147, la historia de los grupos y la de las disoluciones iban en un
      // solo anexo: lo de las disoluciones, desde la primera de ellas, cuenta como su propia parte)
      let enDis = false;
      return zs.map((zona, k) => {
        if (zona !== 'historia') { enDis = false; return zona; }
        const b = B[k];
        if (b.t === 'h1') enDis = false;
        else if (b.t === 'p' && b.editar && b.editar.tipo === 'disolucion') enDis = true;
        return enDis ? 'historiaDis' : zona;
      });
    };
    const incluidoAhora = () => {
      const zs = new Set(zonasDe(x.bloques));
      const guardado = x.incluir || {};
      return { conReceta: zs.has('procedimiento'), conHistoria: zs.has('historia'), conHistoriaDis: zs.has('historiaDis'), conVariaciones: zs.has('variaciones'), conAnterior: zs.has('anterior'),
        fotos: zs.has('fotos') ? (guardado.fotos && guardado.fotos !== 'ninguna' ? guardado.fotos : ctx.op().fotos === 'ninguna' ? 'analisis' : ctx.op().fotos) : 'ninguna' };
    };
    // Cómo se reconoce un mismo bloque en dos informes (para no repetir números ni romper las citas)
    const marcasDe = (B) => {
      const veces = new Map();
      return B.map((b) => {
        let m = null;
        if (b.t === 'tabla') m = `T:${b.titulo}`;
        else if (b.t === 'arbol') m = `A:${JSON.stringify(b.amb || {})}`;
        else if (b.t === 'fotos' && b.clave) m = `F:${b.clave}`;
        else if (b.t === 'h1' || b.t === 'h2') m = `${b.t}:${b.texto}`;
        else if (b.t === 'portada') m = 'portada';
        else if (b.t === 'hueco' && b.editar) m = `hueco:${b.editar.clave}`;
        if (!m) return null;
        const k = (veces.get(m) || 0) + 1;
        veces.set(m, k);
        return `${m}#${k}`;
      });
    };
    const aplicarIncluir = (B, B2, quitar, poner) => {
      const m1 = marcasDe(B);
      const m2 = marcasDe(B2);
      const idPorMarca = new Map(B.map((b, k) => [m1[k], b.id]).filter(([m, i]) => m && i));
      const usados = new Set(B.map((b) => b.id).filter(Boolean));
      // (los números de B2 pasan a los de este informe: el mismo bloque, el suyo; uno nuevo, uno que no se repita)
      const mapa = {};
      let nuevos = 0;
      B2.forEach((b, k) => {
        if (!b.id) return;
        if (idPorMarca.has(m2[k])) { mapa[b.id] = idPorMarca.get(m2[k]); return; }
        let id = b.id;
        while (usados.has(id)) id = `${b.id}n${Date.now().toString(36)}${nuevos++}`;
        usados.add(id);
        mapa[b.id] = id;
      });
      const re = (s) => (typeof s !== 'string' ? s : s.replace(/⟦(T|F|FS):([^⟧]*)⟧/g, (todo, tipo, ids) => `⟦${tipo}:${ids.split(':').map((i) => mapa[i] || i).join(':')}⟧`));
      const copia = (b) => {
        const y = JSON.parse(JSON.stringify(b));
        if (y.id) y.id = mapa[y.id] || y.id;
        for (const k of ['texto', 'titulo', 'observaciones', 'desc', 'cabeza', 'pie']) if (typeof y[k] === 'string') y[k] = re(y[k]);
        if (y.items) y.items = y.items.map(re);
        if (y.filas) y.filas = y.filas.map((f) => f.map(re));
        // (con los nombres de los grupos de este informe, si se cambiaron; versión 145)
        if (x.nombres) {
          aplicarNombres([y], Object.fromEntries(Object.keys(x.nombres).map((k) => [k, k])), x.nombres);
          if (y.t === 'arbol') y.nombres = x.nombres;
        }
        return y;
      };
      // Quitar (y, lo que se rehace, apuntar dónde estaba)
      const z1 = zonasDe(B);
      const donde = {};
      for (let k = B.length - 1; k >= 0; k--) if (quitar.includes(z1[k])) { donde[z1[k]] = k; B.splice(k, 1); }
      // Poner: cada trozo seguido de esa zona, detrás del bloque que lo precede en el informe nuevo (o donde estaba)
      const z2 = zonasDe(B2);
      for (const zona of poner) {
        const trozos = [];
        z2.forEach((z, k) => { if (z !== zona) return; const u = trozos[trozos.length - 1]; if (u && u.fin === k) u.fin = k + 1; else trozos.push({ ini: k, fin: k + 1 }); });
        let primero = true;
        for (const t of trozos) {
          const mB = marcasDe(B);
          // Dónde: lo que se rehace, donde estaba; si no, delante de lo que lo sigue en el informe nuevo (si este
          // informe lo tiene) o, si no, detrás de lo que lo precede
          let en = primero && donde[zona] !== undefined ? donde[zona] : -1;
          // (el título de sección de ese trozo, si este informe no lo tiene —p. ej. «Materiales y métodos»—, va también)
          const titulos = [];
          for (let k = t.ini - 1; k >= 0; k--) if (B2[k].t === 'h1') { if (z2[k] !== zona && mB.indexOf(m2[k]) < 0) titulos.push(copia(B2[k])); break; }
          for (let k = t.fin; k < B2.length && en < 0; k++) { const j = m2[k] ? mB.indexOf(m2[k]) : -1; if (j >= 0) en = j; }
          if (en < 0 && (zona === 'historia' || zona === 'anterior')) {
            // (un anexo: delante del primer anexo que venga después en el informe nuevo, o al final)
            en = B.length;
          }
          if (en < 0) {
            let ancla = -1;
            for (let k = t.ini - 1; k >= 0 && ancla < 0; k--) {
              if (!m2[k]) continue;
              const j = mB.indexOf(m2[k]);
              if (j >= 0) ancla = j;
            }
            en = ancla + 1;
            // (detrás de todo lo de ese bloque: hasta el siguiente título)
            while (ancla >= 0 && en < B.length && B[en].t !== 'h1' && B[en].t !== 'h2') en++;
          }
          B.splice(en, 0, ...titulos, ...B2.slice(t.ini, t.fin).map(copia));
          primero = false;
        }
      }
      // (lo de las disoluciones de un anexo de antes, que iba junto con los grupos: si se quitan los grupos, sigue
      // con su propio título; si se quitan las disoluciones, el título dice solo «grupo»)
      const zf = zonasDe(B);
      // (las zonas, apuntadas solo si el informe ya las lleva: si no, se deducen por los títulos)
      const conZonas = B.some((b) => b.zona);
      if (conZonas) zf.forEach((z, k) => { if (z === 'historiaDis') B[k].zona = 'historiaDis'; });
      const iDis = zf.indexOf('historiaDis');
      if (iDis >= 0 && B[iDis].t !== 'h1') B.splice(iDis, 0, { t: 'h1', texto: 'Historia de cada disolución', sinNumero: true, anexo: true, ...(conZonas ? { zona: 'historiaDis' } : {}) });
      if (iDis < 0) for (const b of B) if (b.t === 'h1' && b.texto === 'Historia de cada grupo y disolución') b.texto = 'Historia de cada grupo';
    };
    const queIncluir = async () => {
      if (!ctx) return;
      const ahora = incluidoAhora();
      const selFotos = h('select', { class: 'campo', 'aria-label': 'Fotos en «Caracterización»' },
        [['analisis', 'Las de los análisis (microscopio, medidas…)'], ['todas', 'Todas las fotos'], ...ctx.albumes.map((a) => [`album:${a.id}`, `Las del álbum «${a.nombre}»`]), ['ninguna', 'Ninguna']]
          .map(([v, t]) => h('option', { value: v, text: t, selected: ahora.fotos === v })));
      const casillas = {};
      const casilla = (clave, texto) => { casillas[clave] = h('input', { type: 'checkbox', checked: ahora[clave] }); return h('label', { class: 'parte-opcion' }, casillas[clave], ` ${texto}`); };
      const r = await preguntar({ texto: '⚙️ Qué incluir en este informe', detalle: [
        h('p', { class: 'dialogo-detalle', text: 'Lo que pongas se hace con los datos de ahora; lo que quites sale del informe (no de la bitácora). Lo demás que hayas editado se queda. Si no te gusta, ↶ lo deshace.' }),
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Fotos en «Caracterización»' }), selFotos),
        ctx.hayReceta && casilla('conReceta', 'El procedimiento (reactivos, cantidades y pasos)'),
        casilla('conVariaciones', 'Las diferencias de los grupos finales respecto al procedimiento'),
        casilla('conHistoria', 'Anexo: la historia completa de cada grupo'),
        casilla('conHistoriaDis', 'Anexo: la historia de cada disolución'),
        ctx.hayAnterior && casilla('conAnterior', 'Anexo: la historia de las muestras en otros cuadernos'),
        ahora.fotos !== 'ninguna' && h('p', { class: 'nota', text: 'Ojo: si cambias las fotos, las figuras de «Caracterización» se vuelven a hacer (lo que hayas cambiado en ellas se pierde).' })],
      si: 'Aplicar', no: 'Cancelar' });
      if (!r) return;
      const quiero = { ...ahora, fotos: selFotos.value };
      for (const k of Object.keys(casillas)) quiero[k] = casillas[k].checked;
      const quitar = [];
      const poner = [];
      for (const [zona, clave] of Object.entries(OPCIONES)) {
        if (ahora[clave] && !quiero[clave]) quitar.push(zona);
        if (!ahora[clave] && quiero[clave]) poner.push(zona);
      }
      if (quiero.fotos !== ahora.fotos) { if (ahora.fotos !== 'ninguna') quitar.push('fotos'); if (quiero.fotos !== 'ninguna') poner.push('fotos'); }
      if (!quitar.length && !poner.length) return;
      guardarLoEscrito();
      const B2 = poner.length ? paraGuardar(modeloInforme(leerCuaderno(), ctx.partesDe(x.cuadernos), { ...ctx.op(), ...quiero, editando: true })) : [];
      if (poner.some((z) => !zonasDe(B2).includes(z))) avisar('Con los datos de ahora no hay nada que poner en alguna de esas partes');
      cambiarX((B, y) => { aplicarIncluir(B, B2, quitar, poner); y.incluir = { fotos: quiero.fotos }; });
      sel = null;
      pintarBarra();
      avisar('✅ Cambiado lo que incluye este informe', { texto: 'Deshacer', hacer: deshacer });
    };

    // ── 🔎 Buscar y reemplazar en todo el informe (versión 144; se vio al rellenar un informe para entregar: el
    // anexo copia las notas tal cual, con sus faltas y los nombres viejos de las fases, y corregirlas una a una
    // era muy pesado). Solo cambia el informe (no la bitácora) y se deshace con ↶ ──
    const patronDe = (q, enteras, mayus) => new RegExp(`${enteras ? '(?<![\\p{L}\\p{N}])' : ''}${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${enteras ? '(?![\\p{L}\\p{N}])' : ''}`, mayus ? 'gu' : 'giu');
    // Todos los textos de los bloques (fn recibe un texto y da el nuevo); las marcas de las citas no se tocan
    const porTextos = (B, fn) => {
      const r = (s) => (typeof s === 'string' ? s.split(/(⟦[^⟧]*⟧)/).map((t, k) => (k % 2 ? t : fn(t))).join('') : s);
      for (const b of B) {
        for (const k of ['texto', 'titulo', 'observaciones', 'desc', 'cabeza', 'pie', 'autores', 'institucion', 'fecha']) if (typeof b[k] === 'string') b[k] = r(b[k]);
        if (b.items) b.items = b.items.map(r);
        if (b.filas) b.filas = b.filas.map((f) => f.map(r));
        if (b.cab) b.cab = b.cab.map(r);
        if (b.detalles) b.detalles = b.detalles.map(r);
        for (const p of b.paneles || []) p.texto = r(p.texto);
      }
    };
    const buscarYReemplazar = async () => {
      guardarLoEscrito();
      soltarFoco();
      const buscar = h('input', { class: 'campo', autocomplete: 'off', 'aria-label': 'Buscar', placeholder: 'Buscar: labado' });
      const por = h('input', { class: 'campo', autocomplete: 'off', 'aria-label': 'Reemplazar por', placeholder: 'Reemplazar por: lavado' });
      const enteras = h('input', { type: 'checkbox', checked: true });
      const mayus = h('input', { type: 'checkbox', checked: false });
      const cuenta = h('p', { class: 'nota', 'aria-live': 'polite' });
      const contar = () => {
        const q = buscar.value;
        if (!q) { cuenta.textContent = 'Escribe lo que quieres buscar.'; return 0; }
        let n = 0;
        const re = patronDe(q, enteras.checked, mayus.checked);
        porTextos(JSON.parse(JSON.stringify(leerX().bloques)), (t) => { n += (t.match(re) || []).length; return t; });
        cuenta.textContent = n ? `Sale ${n} ${n === 1 ? 'vez' : 'veces'} en el informe.` : 'No sale en el informe.';
        return n;
      };
      for (const el of [buscar, enteras, mayus]) el.addEventListener('input', contar);
      contar();
      setTimeout(() => buscar.focus(), 50);
      const r = await preguntar({ texto: '🔎 Buscar y reemplazar en el informe', detalle: [
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Buscar' }), buscar),
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Reemplazar por' }), por),
        h('label', { class: 'parte-opcion' }, enteras, ' Solo palabras enteras'),
        h('label', { class: 'parte-opcion' }, mayus, ' Distinguir mayúsculas'),
        cuenta,
        h('p', { class: 'nota', text: 'Solo cambia este informe (la bitácora se queda como está). ↶ lo deshace.' })],
      si: 'Reemplazar todo', no: 'Cancelar' });
      if (!r || !buscar.value) return;
      const n = contar();
      if (!n) { avisar('No sale en el informe'); return; }
      const re = patronDe(buscar.value, enteras.checked, mayus.checked);
      cambiarX((B) => porTextos(B, (t) => t.replace(re, () => por.value)));
      avisar(`✅ Cambiado en ${n} ${n === 1 ? 'sitio' : 'sitios'} (solo en el informe)`, { texto: 'Deshacer', hacer: deshacer });
    };

    // ── 🏷️ Nombres de los grupos para el informe (versión 145; lo propuso Claude al rellenar un informe para
    // entregar: «2c ph 7?» o «2 ciclo ph 6» son nombres de laboratorio). Cambian en todo el informe —textos,
    // tablas, pies, el árbol— y se recuerdan (x.nombres) para lo que se añada luego con «Qué incluir». La bitácora
    // sigue con sus nombres ──
    const propuestaNombre = (n) => {
      const ciclos = /^(\d+)\s*c(?:iclos?)?\b/i.exec(n);
      const ph = /ph\s*([\d.,]+)(\?)?|([\d.,]+)(\?)?\s*ph/i.exec(n);
      if (!ciclos || !ph) return n;
      return `${ciclos[1]}C, pH ${(ph[1] || ph[3]).replace('.', ',')}${ph[2] || ph[4] ? ' (aprox.)' : ''}`;
    };
    const aplicarNombres = (B, de, a) => {
      // (en dos pasos, para que un nombre nuevo igual a otro viejo no se cambie dos veces; los más largos primero)
      const pares = Object.keys(de).filter((k) => de[k] !== a[k]).sort((p, q) => de[q].length - de[p].length);
      if (!pares.length) return;
      const marca = (k) => `\u0000${k}\u0000`;
      pares.forEach((k, j) => { const re = patronDe(de[k], true, true); porTextos(B, (t) => t.replace(re, () => marca(j))); });
      pares.forEach((k, j) => porTextos(B, (t) => t.split(marca(j)).join(a[k])));
    };
    const nombresGrupos = async () => {
      guardarLoEscrito();
      soltarFoco();
      const c = leerCuaderno();
      const partes = ctx ? ctx.partesDe(x.cuadernos) : [{ amb }];
      const grupos = [...new Set(partes.flatMap((p) => K.gruposDe(c, p.amb).map((g) => g.nombre)))];
      if (!grupos.length) { avisar('Este informe no tiene grupos de muestras'); return; }
      const ahora = x.nombres || {};
      const campos = grupos.map((g) => ({ g, el: h('input', { class: 'campo', autocomplete: 'off', value: ahora[g] || g, 'aria-label': `Nombre en el informe de «${g}»` }) }));
      const r = await preguntar({ texto: '🏷️ Nombres de los grupos en este informe', detalle: [
        h('p', { class: 'dialogo-detalle', text: 'Cómo se llama cada grupo en el informe (en textos, tablas, pies y en el árbol). En la bitácora siguen con su nombre.' }),
        h('button', { class: 'boton discreto', type: 'button', text: '✨ Proponer nombres («2c ph 8.4» → «2C, pH 8,4»)', onclick: () => { for (const f of campos) f.el.value = propuestaNombre(f.el.value); } }),
        campos.map((f) => h('label', { class: 'etiqueta-campo' }, h('span', { text: f.g }), f.el))],
      si: 'Cambiar en el informe', no: 'Cancelar' });
      if (!r) return;
      const de = Object.fromEntries(grupos.map((g) => [g, ahora[g] || g]));
      const a = Object.fromEntries(campos.map((f) => [f.g, f.el.value.trim() || f.g]));
      if (grupos.every((g) => de[g] === a[g])) return;
      const nuevos = Object.fromEntries(grupos.filter((g) => a[g] !== g).map((g) => [g, a[g]]));
      cambiarX((B, y) => {
        aplicarNombres(B, de, a);
        for (const b of B) if (b.t === 'arbol') { if (Object.keys(nuevos).length) b.nombres = nuevos; else delete b.nombres; }
        if (Object.keys(nuevos).length) y.nombres = nuevos; else delete y.nombres;
      });
      avisar('✅ Nombres cambiados en el informe (la bitácora sigue igual)', { texto: 'Deshacer', hacer: deshacer });
    };

    // ── PDF, Word y el nombre ──
    const pdf = async () => {
      guardarLoEscrito();
      // (sin las marcas ni los huecos del modo de editar)
      if (editando) { editando = false; sel = null; pintar(); }
      await actual.listo;
      imprimirInforme(actual.el, nombreArchivo(x.nombre));
    };
    const word = async () => {
      guardarLoEscrito();
      avisar('Preparando el documento de Word…');
      try {
        const blob = await informeDocx(leerX().bloques);
        const nombre = `${nombreArchivo(x.nombre)}.docx`;
        const donde = await guardarBinario(blob, nombre, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        avisar(`✅ Guardado «${nombre}» en ${donde}`);
      } catch (e) {
        if (!(e && e.name === 'AbortError')) avisar(`No se ha podido hacer el Word (${(e && e.message) || 'error'})`);
      }
    };
    const renombrar = async () => {
      const v = await preguntar({ texto: 'Nombre del informe', campo: { value: x.nombre, autocapitalize: 'sentences' }, si: 'Guardar', no: 'Cancelar' });
      if (v === null || !v.trim()) return;
      cambiarCuaderno((d) => { const y = (d.informes || []).find((z) => z.id === id); if (y) { y.nombre = v.trim().slice(0, 80); y.mod = Date.now(); } });
      pintar();
    };
    const mas = async () => {
      const o = await elegir({ texto: x.nombre, opciones: [
        { texto: '🖨️ PDF o imprimir', hacer: pdf },
        { texto: '📄 Word (.docx), para seguir editándolo', hacer: word },
        ctx && { texto: '⚙️ Qué incluir (procedimiento, fotos, anexos)', hacer: () => { if (!editando) { editando = true; pintar(); } return queIncluir(); } },
        { texto: '🔎 Buscar y reemplazar en el informe', hacer: () => { if (!editando) { editando = true; pintar(); } return buscarYReemplazar(); } },
        { texto: '🏷️ Nombres de los grupos en el informe', hacer: () => { if (!editando) { editando = true; pintar(); } return nombresGrupos(); } },
        { texto: '✏️ Cambiar el nombre', hacer: renombrar }] });
      if (o) await o.hacer();
    };
    poner(cuerpo, barra, h('div', { class: 'informe-con-indice' }, indice, hoja));
    pintar();
  };

  // Un cuaderno. Con receta: su árbol, sus grupos (al tocar uno, lo que se puede hacer con él), sus
  // disoluciones, sus fotos y su bitácora; sin receta: solo notas y fotos. A la derecha, la pestaña
  // de las notas libres (abrirNotas). alVolver: para repintar la lista de antes

  const abrirCuadernoDe = (cid, recetaIdInicial, alVolver, consultaInicial = '') => {
    // Cambiar el nombre del cuaderno, su receta o de qué va: con el ✏️ de su cajita de arriba (lo pone
    // pintar). Antes había otro ✏️ en la barra del título, repetido (versión 122, lo pidió el usuario)
    let editarEste = null;
    const { cuerpo, titulo, panel } = abrirPanel('📓', null, alVolver);
    // (la barra lateral del PC marca este cuaderno como abierto)
    panel.dataset.lateral = `c:${cid}`;
    let filtro = 'todos'; // 'todos', o el id de un grupo
    let busqueda = consultaInicial; // lo escrito en «Buscar en la bitácora» (o lo buscado en todos los cuadernos)
    let buscador = null;
    let receta = null;
    // La bitácora con lo buscado (versión 86, lo pidió el usuario). Al escribir solo se repinta la
    // lista, no el cuaderno entero (si no, se perdería el teclado)
    const bitacoraBuscada = (c, entradas, opciones, vacia) => {
      const caja = h('div');
      const pintarLista = () => {
        const q = busqueda.trim();
        const vistas = K.buscar(c, entradas, q);
        poner(caja,
          q && h('p', { class: 'nota resultado-busqueda', text: vistas.length ? `🔎 ${vistas.length} ${vistas.length === 1 ? 'apunte dice' : 'apuntes dicen'} «${q}»` : `🔎 Ningún apunte dice «${q}»` }),
          vistas.length ? bitacora(vistas, opciones) : !q && vacia);
      };
      buscador = entradas.length > 0 && h('input', { class: 'campo buscar-bitacora', type: 'search', value: busqueda, enterkeyhint: 'search',
        placeholder: '🔎 Buscar en la bitácora: SEM, poco denso…', 'aria-label': 'Buscar en la bitácora',
        oninput: (e) => { busqueda = e.target.value; pintarLista(); } });
      pintarLista();
      return [buscador, caja];
    };
    panel.append(h('button', { class: 'pestana-notas', 'aria-label': 'Notas del cuaderno', onclick: () => abrirNotas(cid, recetaIdInicial) }, h('span', { text: '📝 Notas' })));
    // ── Pestañas (versión 116): «📖 Bitácora» a la izquierda, «🧫 Muestras» (la principal, con las
    // disoluciones) en el medio y «🖼️ Fotos» a la derecha. Se cambia con ellas o deslizando el dedo; cada
    // una recuerda por dónde iba, y la elegida se recuerda por cuaderno (quimica.pagina-cuaderno)
    const PAGINAS = ['bitacora', 'muestras', 'fotos'];
    const recordadaC = leer('quimica.pagina-cuaderno', {})[cid];
    // (venido de «Buscar en todos los cuadernos»: a la bitácora, que es donde está lo buscado)
    let paginaCuaderno = consultaInicial ? 'bitacora' : PAGINAS.includes(recordadaC) ? recordadaC : 'muestras';
    const alturasC = { bitacora: 0, muestras: 0, fotos: 0 };
    let fotosCaja = null; // { clave, el, listo }: la pantalla de fotos de la pestaña
    let mostrarFotos = () => {};
    const irPaginaCuaderno = (nombre) => {
      if (nombre === paginaCuaderno || !PAGINAS.includes(nombre)) return;
      alturasC[paginaCuaderno] = cuerpo.scrollTop;
      const hacia = PAGINAS.indexOf(nombre) > PAGINAS.indexOf(paginaCuaderno) ? 'entra-der' : 'entra-izq';
      paginaCuaderno = nombre;
      guardar('quimica.pagina-cuaderno', { ...leer('quimica.pagina-cuaderno', {}), [cid]: nombre });
      if (nombre === 'fotos') mostrarFotos();
      for (const p of cuerpo.querySelectorAll('.pagina-cuaderno')) p.hidden = p.dataset.pagina !== nombre;
      for (const b of cuerpo.querySelectorAll('.pestana-cuaderno')) b.setAttribute('aria-pressed', String(b.dataset.pagina === nombre));
      cuerpo.scrollTop = alturasC[nombre] || 0;
      const nueva = cuerpo.querySelector(`.pagina-cuaderno[data-pagina="${nombre}"]`);
      if (nueva) { nueva.classList.remove('entra-izq', 'entra-der'); void nueva.offsetWidth; nueva.classList.add(hacia); }
    };
    // Deslizar: la pantalla sigue al dedo (versión 123; ver deslizarPantallas)
    deslizarPantallas(cuerpo, { hojas: '.pagina-cuaderno', orden: PAGINAS, actual: () => paginaCuaderno, ir: irPaginaCuaderno,
      activo: () => leer('quimica.receta-junta', false) !== true && Boolean(cuerpo.querySelector('.pestanas-cuaderno')) });
    const pintar = () => {
      const c = leerCuaderno();
      const ficha = K.fichaCuaderno(c, { cuadernoId: cid, recetaId: recetaIdInicial });
      // (el Cuaderno 1 de una receta va siempre con ella; uno creado, con la que tenga puesta)
      const rid = cid === K.principal(recetaIdInicial) ? recetaIdInicial : ficha.recetaId || null;
      const amb = K.ambito(rid, cid);
      // (sin receta todavía: una vacía, y el cuaderno es el mismo de siempre —árbol, grupos, carpetas, disoluciones,
      // medidas, fotos y bitácora—, solo sin fases hasta que se le ponga una; versión 118)
      receta = rid ? recetaDe(rid) || { id: rid, nombre: nombreDeReceta(c, rid), pasos: [] }
        : { id: null, nombre: ficha.nombre, pasos: [], datos: [], calculos: [], sinReceta: true };
      // Desde la receta, «Terminar fase» apunta en el último cuaderno suyo que se haya abierto
      if (rid) ponerCuadernoActual(rid, cid);
      titulo.textContent = `📓 ${ficha.nombre}`;
      // Arriba, el nombre del cuaderno (con ✏️ para cambiarlo), su receta y de qué va
      editarEste = async () => {
        const r = await editarFichaCuaderno({ ...ficha, recetaId: rid }, rid);
        if (r === 'quitado') atras(); else if (r) pintar();
      };
      const cabecera = h('div', { class: 'carpeta-cabecera cuaderno-este' },
        h('div', { class: 'carpeta-titulo' }, h('b', { text: `📓 ${ficha.nombre}` }),
          // La receta se abre desde aquí (atrás vuelve al cuaderno)
          rid && recetaDe(rid)
            ? h('button', { class: 'cuaderno-receta abrir-receta', onclick: () => abrirDetalle(rid) }, h('span', { text: `📋 ${receta.nombre}` }), h('span', { class: 'flecha', text: 'Abrir la receta ›' }))
            : rid
              ? h('span', { class: 'cuaderno-receta', text: `📋 ${receta.nombre} (borrada)` })
              // Sin receta todavía: el mismo sitio que «Abrir la receta ›», para ponérsela
              : h('button', { class: 'cuaderno-receta abrir-receta', type: 'button', onclick: editarEste },
                h('span', { text: '📋 Sin receta todavía' }), h('span', { class: 'flecha', text: 'Ponerle receta ›' })),
          ficha.nota && h('p', { class: 'carpeta-nota', text: ficha.nota })),
        h('button', { class: 'icono pequeno', 'aria-label': 'Cambiar el cuaderno', text: '✏️', onclick: editarEste }));
      const grupos = K.gruposDe(c, amb);
      if (filtro !== 'todos' && !grupos.some((g) => g.id === filtro)) filtro = 'todos';
      const nuevoGrupo = async () => {
        const cuantas = h('input', { class: 'campo', type: 'text', inputmode: 'numeric', placeholder: 'Nº de muestras (si quieres)', autocomplete: 'off' });
        const nombre = await preguntar({ texto: 'Nuevo grupo', detalle: [h('p', { class: 'dialogo-detalle', text: 'Unas muestras que van al mismo ritmo.' }), cuantas], campo: { placeholder: 'Nombre: Grupo A…', autocapitalize: 'sentences' }, si: 'Crear', no: 'Cancelar' });
        if (!nombre || !nombre.trim()) return;
        const n = Q.aNumero(cuantas.value);
        cambiarCuaderno((d) => { d.grupos.push({ id: idDe('g'), nombre: nombre.trim().slice(0, 60), recetaId: receta.id, ...K.marcaDe(amb), muestras: n > 0 ? Math.round(n) : null }); });
        pintar();
      };
      // Una carpeta para juntar grupos: su nombre y una nota de contexto (k null: una nueva)
      const editarCarpeta = async (k) => {
        const nombre = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', value: k ? k.nombre : '', placeholder: 'Por ejemplo: Ciclo normal' });
        const nota = h('textarea', { class: 'campo', rows: 3, autocapitalize: 'sentences', value: k ? k.nota || '' : '', placeholder: 'Nota de contexto (si quieres): por qué van juntos, qué se cambió…' });
        const r = await preguntar({ texto: k ? '📁 Cambiar la carpeta' : '📁 Nueva carpeta', detalle: [
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre' }), nombre),
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nota de contexto' }), nota),
          !k && h('p', { class: 'dialogo-detalle', text: 'Luego, mantén pulsado un grupo y arrástralo a la carpeta.' })],
        si: k ? 'Guardar' : 'Crear', no: 'Cancelar', otro: k ? '🗑️ Quitar la carpeta (sus grupos se quedan, sin carpeta)' : null });
        if (r === 'otro') {
          cambiarCuaderno((d) => { d.carpetas = d.carpetas.filter((x) => x.id !== k.id); for (const g of d.grupos) if (g.carpeta === k.id) delete g.carpeta; });
          pintar();
          return;
        }
        if (!r || !nombre.value.trim()) return;
        cambiarCuaderno((d) => {
          const x = k ? d.carpetas.find((y) => y.id === k.id) : { id: idDe('k'), recetaId: receta.id, ...K.marcaDe(amb), orden: K.carpetasDe(d, amb).length };
          if (!x) return;
          x.nombre = nombre.value.trim().slice(0, 60);
          x.nota = nota.value.trim();
          if (!k) d.carpetas.push(x);
        });
        pintar();
      };
      // Algo que se hizo con varios grupos a la vez (lo pidió el usuario: «fui al microscopio y miré
      // varias muestras»; y también empezar o terminar una fase): qué fue, cuándo y con qué grupos;
      // cada grupo, con su nota y sus fotos. Se apunta una entrada en cada grupo, todas con la misma
      // hora y el mismo «evento»
      const apuntarVarios = async () => {
        const posibles = K.gruposDe(c, amb).filter((g) => !g.juntadoEn && !g.pasadoA);
        if (!posibles.length) { avisar('Primero crea algún grupo de muestras'); return; }
        const ultima = [...c.entradas].reverse().find((e) => e.tipo === 'analisis' && e.tecnica);
        const tecnica = h('input', { class: 'campo', list: 'tecnicas', autocomplete: 'off', autocapitalize: 'sentences', value: ultima ? ultima.tecnica : 'Microscopio electrónico (SEM)' });
        const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        const cuando = h('input', { class: 'campo', type: 'datetime-local', value: local });
        let tipo = 'analisis';
        const radio = (nombre, valor, actual, alCambiar, texto, detalle) => h('label', { class: 'opcion-grupo' },
          h('input', { type: 'radio', name: nombre, checked: valor === actual, onchange: () => alCambiar(valor) }),
          h('span', {}, h('b', { text: texto }), detalle && h('small', { text: detalle })));
        const zonaAnalisis = h('div', {},
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Técnica' }), tecnica),
          h('datalist', { id: 'tecnicas' }, ['Microscopio óptico', 'Microscopio electrónico (SEM)', 'TEM', 'EDX', 'Raman', 'DRX', 'FTIR', 'UV-Vis'].map((t) => h('option', { value: t }))));
        // Empezar o terminar una fase: cuál y con qué disolución (lo mismo para todos los grupos)
        const fasesR = fasesDe(recetaDe(receta.id) || receta);
        const fase = elegirFase(fasesR, fasesR[0]);
        const selectFase = fase.el.querySelector('select');
        const cajaDis = h('div');
        let dis = null;
        const pintarDis = () => { dis = elegirDisoluciones(leerCuaderno(), recetaDe(receta.id) || receta, fase.fase(), null, amb); poner(cajaDis, dis.el); };
        selectFase.addEventListener('change', pintarDis);
        const distintoVarios = campoDistinto();
        const zonaFase = h('div', { hidden: true }, fase.el, cajaDis, distintoVarios.el);
        // Al elegir empezar o terminar, se propone la fase del primer grupo marcado (o del primero)
        const proponerFase = () => {
          const g = (filas.find((x) => x.x.checked) || filas[0]).g;
          const est = estadoGrupo(c, g);
          const f2 = tipo === 'empezar' ? K.faseParaEmpezar(est, fasesR) : K.faseParaTerminar(est, fasesR);
          const i = fasesR.indexOf(f2);
          if (i >= 0) selectFase.value = String(i);
          pintarDis();
        };
        const elegirTipo = (v) => {
          tipo = v;
          zonaAnalisis.hidden = v !== 'analisis';
          zonaFase.hidden = v !== 'empezar' && v !== 'fase';
          if (!zonaFase.hidden) proponerFase();
        };
        // Cada grupo: su casilla y, al marcarla, su nota y sus fotos
        const filas = posibles.map((g) => {
          const x = h('input', { type: 'checkbox' });
          const nota = h('textarea', { class: 'campo', rows: 2, autocapitalize: 'sentences', placeholder: `Nota de «${g.nombre}» (si quieres): qué has visto…` });
          const fotos = selectorFotos();
          const suyo = h('div', { class: 'varios-grupo', hidden: true }, nota, fotos.el);
          x.addEventListener('change', () => { suyo.hidden = !x.checked; });
          const el = h('div', { class: 'opcion-dis' },
            h('label', { class: 'opcion-grupo' }, x, h('span', {}, h('b', { text: g.nombre }), h('small', { text: [muestrasTexto(g.muestras), textoEstado(estadoGrupo(c, g))].filter(Boolean).join(' · ') }))),
            suyo);
          return { g, x, nota, fotos, el };
        });
        const comun = await preguntar({ texto: '👥 Algo de varios grupos a la vez', detalle: [
          radio('tipo-varios', 'analisis', tipo, elegirTipo, '🔬 Un análisis', 'Microscopio, Raman…'),
          radio('tipo-varios', 'empezar', tipo, elegirTipo, '▶ Empezar una fase', 'Varios grupos empiezan la misma fase'),
          radio('tipo-varios', 'fase', tipo, elegirTipo, '🏁 Terminar una fase', 'Varios grupos terminan la misma fase'),
          radio('tipo-varios', 'nota', tipo, elegirTipo, '✍️ Una nota', 'Algo que les pasó o que hiciste a varios grupos'),
          zonaAnalisis, zonaFase,
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Fecha y hora' }), cuando),
          h('div', { class: 'elegir-grupo' }, h('p', { class: 'dialogo-detalle', text: '¿Qué grupos? Cada uno con su nota y sus fotos' }), filas.map((f) => f.el))],
        campo: { filas: 2, placeholder: 'Nota para todos (si quieres)', autocapitalize: 'sentences' }, si: 'Guardar', no: 'Cancelar' });
        if (comun === null) return;
        const elegidos = filas.filter((f) => f.x.checked);
        if (!elegidos.length) { avisar('Marca algún grupo'); return; }
        const fecha = new Date(cuando.value).getTime();
        const evento = idDe('v');
        const conFase = tipo === 'empezar' || tipo === 'fase';
        const f2 = conFase ? fase.fase() : null;
        const usadas = conFase && dis ? dis.elegidas() : [];
        for (const f of elegidos) {
          const nota = [comun.trim(), f.nota.value.trim()].filter(Boolean).join('\n');
          const fotos = await f.fotos.guardar();
          const g = K.grupoDe(leerCuaderno(), f.g.id) || f.g;
          apuntar({ tipo, ...(tipo === 'analisis' ? { tecnica: tecnica.value.trim() || 'Análisis' } : {}),
            ...(conFase ? { fase: f2 } : {}),
            ...(tipo === 'empezar' ? { otraVez: K.yaHizo(leerCuaderno(), g.id, f2) || undefined, muestras: g.muestras == null ? undefined : g.muestras } : {}),
            ...(usadas.length ? { disoluciones: usadas } : {}),
            ...(tipo === 'fase' && distintoVarios.valor() ? { distinto: distintoVarios.valor() } : {}),
            grupoId: g.id, grupo: g.nombre, recetaId: receta.id, ...K.marcaDe(amb), receta: receta.nombre,
            nota, fotos, evento, ...(Number.isFinite(fecha) ? { fecha } : {}) });
        }
        // (el estado y lo que queda de las disoluciones marcadas)
        if (conFase && dis) dis.guardar();
        vibrar(30);
        avisar(`📓 Apuntado en ${elegidos.length} ${elegidos.length === 1 ? 'grupo' : 'grupos'}`);
        pintar();
      };
      const nuevaNota = async () => {
        const r = await pedirApunte({ texto: '✍️ Apuntar una nota (de toda la receta)' });
        if (!r || (!r.nota && !r.fotos.length)) return;
        apuntar({ tipo: 'nota', grupoId: null, grupo: null, recetaId: receta.id, ...K.marcaDe(amb), receta: receta.nombre, nota: r.nota, fotos: r.fotos });
        pintar();
      };
      // Con un grupo elegido, su historia entera (también lo heredado); si no, todo lo de la receta
      const entradas = filtro === 'todos' ? c.entradas.filter((e) => K.casa(e, amb)) : K.historiaDe(c, filtro);

      const arbol = arbolDeMuestras(c, receta, (gid) => abrirGrupo(receta, gid, pintar), amb);
      // El cuaderno en tres bloques (versión 116, lo pidió el usuario: «como las recetas: varias pestañas»):
      // muestras y disoluciones (la principal, en el medio), bitácora (a la izquierda) y fotos (a la derecha).
      // Con «Todo en una sola pantalla» (Ajustes), todo seguido y en el orden de siempre
      const bMuestras = [
        arbol && [h('h3', { text: '🌳 Cómo van las muestras' }), arbol],
        h('h3', { text: '🧫 Grupos de muestras' }),
        grupos.length
          ? (() => {
            // Los grupos, repartidos en sus carpetas (y los que no van en ninguna, al final). Se
            // cambian de sitio y de carpeta manteniendo pulsado y arrastrando
            const carpetas = K.carpetasDe(c, amb);
            // Cada grupo, con el color de su línea en el árbol
            const coloresGrupos = arbol ? arbol.colores : coloresSinArbol(c, amb);
            const colorDe = (g) => coloresGrupos.get(g.id);
            const tarjeta = (g) => h('button', { class: `tarjeta grupo${colorDe(g) ? ' con-color' : ''}`, 'data-id': g.id, style: colorDe(g) ? `--gc: ${colorDe(g)}` : null, onclick: () => abrirGrupo(receta, g.id, pintar) },
              h('h3', {}, g.nombre, g.muestras != null && h('small', { class: 'grupo-muestras', text: ` · ${muestrasTexto(g.muestras)}` })),
              h('p', { text: textoEstado(estadoGrupo(c, g)) }),
              // (de otro cuaderno: su historia anterior está allí; se ve entrando al grupo)
              g.vieneDe && h('small', { class: 'nota', text: `📥 Viene del cuaderno «${g.vieneCuaderno || 'otro'}»` }));
            const lista = (id) => h('div', { class: 'lista-grupos', 'data-lista': id || '' },
              K.gruposEnCarpeta(c, amb, id).map(tarjeta),
              h('p', { class: 'nota carpeta-vacia', text: id ? 'Vacía: mantén pulsado un grupo y arrástralo aquí.' : 'Suelta aquí un grupo para sacarlo de su carpeta.' }));
            const caja = h('div', { class: 'carpetas' },
              carpetas.map((k) => h('div', { class: 'carpeta', 'data-zona': k.id },
                h('div', { class: 'carpeta-cabecera' },
                  h('div', { class: 'carpeta-titulo' }, h('b', { text: `📁 ${k.nombre}` }), k.nota && h('p', { class: 'carpeta-nota', text: k.nota })),
                  h('button', { class: 'icono pequeno', 'aria-label': `Cambiar la carpeta ${k.nombre}`, text: '✏️', onclick: () => editarCarpeta(k) })),
                lista(k.id))),
              h('div', { class: `carpeta sin-carpeta${carpetas.length ? '' : ' sola'}`, 'data-zona': '' },
                carpetas.length > 0 && h('div', { class: 'carpeta-cabecera' }, h('b', { class: 'carpeta-titulo', text: 'Sin carpeta' })),
                lista(null)));
            mantenerYArrastrar(caja, (listas) => {
              cambiarCuaderno((d) => K.colocarGrupos(d, amb, listas.map((x) => ({ carpeta: x.lista || null, ids: x.ids }))));
              pintar();
            });
            return [caja, grupos.length > 1 && h('p', { class: 'nota', text: carpetas.length ? 'Para cambiar un grupo de sitio o de carpeta, mantenlo pulsado y arrástralo.' : 'Para cambiar el orden, mantén pulsado un grupo y arrástralo. Con «📁 Nueva carpeta» puedes juntarlos.' })];
          })()
          : h('p', { class: 'nota', text: 'Si llevas varias muestras a distinto ritmo, crea un grupo para cada tanda (también se puede crear al terminar una fase). Tocando un grupo puedes empezar o terminar una fase, separar muestras, apuntar un análisis…' }),
        h('div', { class: 'botones-fila' },
          h('button', { class: 'boton secundario', text: '＋ Nuevo grupo', onclick: nuevoGrupo }),
          grupos.length > 0 && h('button', { class: 'boton secundario', text: '📁 Nueva carpeta', onclick: () => editarCarpeta(null) })),
        h('h3', { text: '🧪 Disoluciones' }),
        (() => {
          const lista = K.disolucionesDe(c, amb);
          if (!lista.length) return h('p', { class: 'nota', text: 'Las que prepares salen aquí: al terminar una fase donde se prepara una disolución, elige «🧪 He preparado una disolución». Luego, al pasar las muestras por una fase, marcas con cuál.' });
          return lista.map((d) => {
            const usos = K.usadaPor(c, d.id).length;
            return h('button', { class: `tarjeta disolucion estado-${d.estado || 'queda'}`, onclick: () => abrirDisolucion(receta, d.id, pintar) },
              h('h3', { text: d.nombre }),
              h('p', { text: [K.ESTADOS[d.estado || 'queda'], d.queda && `quedan ${d.queda}`, `preparada el ${fechaCorta(d.fecha)}`, usos && `usada por ${usos} ${usos === 1 ? 'grupo' : 'grupos'}`].filter(Boolean).join(' · ') }));
          });
        })(),
        h('button', { class: 'boton secundario', text: '＋ Apuntar una disolución preparada', onclick: async () => {
          const fases = fasesDe(recetaDe(receta.id));
          const f = elegirFase(fases.length ? fases : [null], fases.find((x) => preparaEn(receta, x)) ?? fases[0]);
          const nombreDis = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', placeholder: 'Nombre (si no, el de la fase)' });
          const cuanta = h('input', { class: 'campo', autocomplete: 'off', placeholder: 'Por ejemplo: 800 mL (si quieres)' });
          const r = await pedirApunte({ texto: '🧪 Disolución preparada', antes: [
            f.el, h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre' }), nombreDis),
            h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Cuánta has preparado' }), cuanta)] });
          if (!r) return;
          const fase = f.fase();
          recordarPrepara(receta, fase, true);
          prepararDisolucion(recetaDe(receta.id) || receta, fase, { nombre: nombreDis.value.trim() || K.nombreDisolucion(leerCuaderno(), amb, fase), preparada: cuanta.value.trim(), nota: r.nota, fotos: r.fotos, amb });
          pintar();
        } })];
      const nFotos = K.fotosDe(c, amb).length;
      const bFotos = [h('h3', { text: '🖼️ Fotos' }),
        h('button', { class: 'boton secundario', text: nFotos ? `🖼️ Ver las ${nFotos === 1 ? 'fotos (1)' : `${nFotos} fotos`} y compararlas` : '🖼️ Fotos (aún no hay ninguna)', onclick: () => abrirFotos(receta, pintar, amb) })];
      // Lo medido (versión 114): se apunta desde cada grupo; aquí se comparan
      const bMedidas = (() => {
        const t = K.medidasDe(c, amb);
        return t.filas.length > 0 && [h('h3', { text: '📏 Medidas' }),
          h('button', { class: 'boton secundario', text: `📏 Comparar medidas: ${t.filas.length} ${t.filas.length === 1 ? 'medida' : 'medidas'} en ${t.grupos.length} ${t.grupos.length === 1 ? 'grupo' : 'grupos'}`, onclick: () => abrirMedidas(receta, pintar, amb) })];
      })();
      const bBitacora = [
        h('h3', { text: '📖 Bitácora' }),
        listaPropuestas(c, amb, pintar),
        grupos.length > 1 && h('div', { class: 'chips' },
          [{ id: 'todos', nombre: 'Todos' }, ...grupos].map((g) => h('button', { class: 'chip', 'aria-pressed': String(filtro === g.id), text: g.nombre, onclick: () => { filtro = g.id; pintar(); } }))),
        h('button', { class: 'boton secundario', text: '✍️ Apuntar una nota', onclick: nuevaNota }),
        grupos.length > 1 && h('button', { class: 'boton secundario', text: '👥 Apuntar algo de varios grupos a la vez (microscopio, fases…)', onclick: apuntarVarios }),
        bitacoraBuscada(c, entradas, { desde: filtro === 'todos' ? null : filtro, alCambiar: pintar },
          h('p', { class: 'nota', text: 'Aún no hay nada. Al final de cada fase de los pasos de la receta está el botón «🏁 Terminar fase»; y tocando un grupo, todo lo demás. Se apunta aquí con la fecha y la hora.' })),
        botonCopiar(`${receta.nombre} · ${ficha.nombre}`, entradas)];
      const bMas = [
        h('h3', { text: 'Más' }),
        h('button', { class: 'boton secundario', text: '📄 Hacer el informe (PDF o Word)', onclick: () => abrirInforme(receta, amb, ficha, pintar) }),
        rid && h('button', { class: 'boton secundario', text: '📓 Empezar otro cuaderno con esta receta (otro experimento)', onclick: async () => {
          const id = await editarFichaCuaderno(null, rid);
          if (!id || id === 'quitado') return;
          const k = K.fichaCuaderno(leerCuaderno(), { cuadernoId: id });
          cerrarCapas(1, () => abrirCuadernoDe(id, k.recetaId || null, alVolver));
        } })];
      if (leer('quimica.receta-junta', false) === true) {
        // Todo seguido, como antes
        poner(cuerpo, cabecera, avisosDeToca(c, amb, pintar), bMuestras, bFotos, bMedidas, bBitacora, bMas);
        return;
      }
      // Tres pestañas: bitácora | muestras y disoluciones | fotos (las fotos, la misma pantalla de siempre
      // dentro de la pestaña: se crea una vez por cuaderno y receta, para que no pierda sus filtros)
      const claveFotos = `${rid}|${cid}`;
      if (!fotosCaja || fotosCaja.clave !== claveFotos) fotosCaja = { clave: claveFotos, el: h('div', { class: 'fotos-embebidas' }), listo: false };
      if (paginaCuaderno === 'fotos' && !fotosCaja.listo) { fotosCaja.listo = true; abrirFotos(receta, pintar, amb, fotosCaja.el); }
      mostrarFotos = () => { if (!fotosCaja.listo) { fotosCaja.listo = true; abrirFotos(receta, pintar, amb, fotosCaja.el); } };
      const hoja = (nombre, ...bloques) => h('div', { class: 'pagina-receta pagina-cuaderno', 'data-pagina': nombre, hidden: paginaCuaderno !== nombre }, ...bloques);
      const pestana = (nombre, texto) => h('button', { class: 'pestana-receta pestana-cuaderno', type: 'button', 'data-pagina': nombre, 'aria-pressed': String(paginaCuaderno === nombre),
        text: texto, onclick: () => irPaginaCuaderno(nombre) });
      poner(cuerpo, cabecera, avisosDeToca(c, amb, pintar),
        h('div', { class: 'pestanas-receta pestanas-cuaderno' },
          pestana('bitacora', `📖 Bitácora${entradas.length ? ` (${entradas.length})` : ''}`),
          pestana('muestras', '🧫 Muestras'),
          pestana('fotos', `🖼️ Fotos${nFotos ? ` (${nFotos})` : ''}`)),
        hoja('bitacora', bBitacora),
        hoja('muestras', bMuestras, bMedidas, bMas),
        hoja('fotos', fotosCaja.el));
    };
    // (si llega algo del PC mientras se escribe en el buscador, no se repinta: se perdería el teclado)
    alLlegarCambios(cuerpo, () => { if (!buscador || document.activeElement !== buscador) pintar(); });
    pintar();
  };

  // Un grupo de muestras: por dónde va, lo que se puede hacer y su historia (también la heredada)
  const abrirGrupo = (receta, grupoId, alVolver) => {
    // ✏️ arriba, al lado del nombre: cambiar nombre, muestras o lo que le toca (lo pone pintar)
    let editarGrupo = null;
    const { cuerpo, titulo } = abrirPanel('🧫', [h('button', { class: 'icono', 'aria-label': 'Cambiar el nombre del grupo', text: '✏️', onclick: () => { if (editarGrupo) editarGrupo(); } })], alVolver);
    const fases = fasesDe(recetaDe(receta.id));
    const pintar = () => {
      const c = leerCuaderno();
      const g = K.grupoDe(c, grupoId);
      if (!g) { atras(); return; }
      titulo.textContent = `🧫 ${g.nombre}`;
      const est = estadoGrupo(c, g);
      const comun = () => {
        const x = K.grupoDe(leerCuaderno(), grupoId) || g;
        return { grupoId: x.id, grupo: x.nombre, recetaId: receta.id, ...K.marcaDe(ambitoDe(x)), receta: receta.nombre };
      };

      // Las disoluciones con las que pasa por la fase elegida (se proponen otras al cambiar de fase).
      // Al terminar una fase empezada, las que se marcaron al empezarla
      const conDisoluciones = (f, alTerminar) => {
        const zona = h('div');
        let actual = null;
        const pintarZona = () => {
          const fase = f.fase();
          const empezada = alTerminar && est.estado === 'en' && est.fase === fase
            && [...K.historiaDe(c, g.id)].reverse().find((e) => e.tipo === 'empezar' && e.fase === fase);
          actual = elegirDisoluciones(c, receta, fase, empezada && empezada.disoluciones ? empezada.disoluciones.map((x) => x.id) : null, ambitoDe(g));
          poner(zona, actual.el);
        };
        f.el.querySelector('select').addEventListener('change', pintarZona);
        pintarZona();
        return { el: zona, elegidas: () => { const l = actual.elegidas(); return l.length ? { disoluciones: l } : {}; }, guardar: () => actual.guardar() };
      };
      const empezar = async () => {
        const f = elegirFase(fases, K.faseParaEmpezar(est, fases));
        const dis = conDisoluciones(f, false);
        const r = await pedirApunte({ texto: `▶ Empezar una fase · ${g.nombre}`, antes: [f.el, dis.el,
          h('p', { class: 'dialogo-detalle', text: 'Si dura varios días, cuando acabe pulsa «🏁 Terminar fase». Para repetir una fase, elígela aquí.' })] });
        if (!r) return;
        const fase = f.fase();
        apuntar({ tipo: 'empezar', fase, otraVez: K.yaHizo(leerCuaderno(), g.id, fase) || undefined, muestras: g.muestras == null ? undefined : g.muestras, ...comun(), ...r, ...dis.elegidas() });
        dis.guardar();
        pintar();
      };
      const terminar = async () => {
        const f = elegirFase(fases, K.faseParaTerminar(est, fases));
        const dis = conDisoluciones(f, true);
        const distinto = campoDistinto();
        const r = await pedirApunte({ texto: `🏁 Terminar una fase · ${g.nombre}`, antes: [f.el, dis.el, distinto.el] });
        if (!r) return;
        apuntar({ tipo: 'fase', fase: f.fase(), ...comun(), ...r, ...(distinto.valor() ? { distinto: distinto.valor() } : {}), ...dis.elegidas() });
        dis.guardar();
        vibrar(30);
        pintar();
      };
      const analisis = async () => {
        // La técnica de la última vez, para no escribirla otra vez
        const ultima = [...c.entradas].reverse().find((e) => e.tipo === 'analisis' && e.tecnica);
        const tecnica = h('input', { class: 'campo', list: 'tecnicas', autocomplete: 'off', autocapitalize: 'sentences', value: ultima ? ultima.tecnica : 'Microscopio electrónico (SEM)' });
        // (sin «un trozo o una muestra entera»: lo quitó el usuario; si se gasta una muestra, cambia
        // el nº del grupo con ✏️)
        const r = await pedirApunte({ texto: `🔬 Muestra para analizar · ${g.nombre}`, antes: [
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Técnica' }), tecnica),
          h('datalist', { id: 'tecnicas' }, ['Microscopio óptico', 'Microscopio electrónico (SEM)', 'TEM', 'EDX', 'Raman', 'DRX', 'FTIR', 'UV-Vis'].map((t) => h('option', { value: t })))] });
        if (!r) return;
        apuntar({ tipo: 'analisis', tecnica: tecnica.value.trim() || 'Análisis', ...comun(), ...r });
        pintar();
      };
      // Juntar con otro grupo que vaya por la misma fase (y en la misma carpeta): sus muestras pasan
      // a ese, que sigue; este se queda cerrado
      const juntarCon = async () => {
        const r = recetaDe(g.recetaId);
        const fasesR = fasesDe(r);
        const ultimas = r ? Q.ultimasDeMuestras(r) : {};
        const posibles = K.gruposDe(c, ambitoDe(g)).filter((x) => K.mismoSitio(c, g, x, fasesR, ultimas));
        if (!posibles.length) {
          avisar(`No hay otro grupo ${g.carpeta ? 'de la misma carpeta ' : ''}que vaya por la misma fase que «${g.nombre}» (${textoEstado(est)})`);
          return;
        }
        let elegido = posibles[0];
        const opciones = h('div', { class: 'elegir-grupo' },
          h('p', { class: 'dialogo-detalle', text: `Las ${muestrasTexto(g.muestras) || 'muestras'} de «${g.nombre}» pasan a ese grupo, que sigue; «${g.nombre}» se queda cerrado (con su historia).` }),
          posibles.map((x) => h('label', { class: 'opcion-grupo' },
            h('input', { type: 'radio', name: 'juntar', checked: x === elegido, onchange: () => { elegido = x; } }),
            h('span', {}, h('b', { text: x.nombre }), h('small', { text: [muestrasTexto(x.muestras), textoEstado(estadoGrupo(c, x))].filter(Boolean).join(' · ') })))));
        const nota = await preguntar({ texto: `🔗 Juntar «${g.nombre}» con…`, detalle: opciones, campo: { placeholder: 'Nota (si quieres): por qué…', autocapitalize: 'sentences' }, si: 'Juntar', no: 'Cancelar' });
        if (nota === null) return;
        const destino = elegido.id;
        cambiarCuaderno((d) => {
          const { de } = K.juntar(d, g.id, destino, Date.now(), { de: idDe('e'), a: idDe('e') });
          const e = d.entradas.filter((x) => x.tipo === 'juntar' && x.grupoId === de.id).pop();
          if (e && nota.trim()) e.nota = nota.trim();
          for (const x of d.entradas) if ((x.tipo === 'juntar' || x.tipo === 'recibir') && !x.receta) x.receta = receta.nombre;
        });
        vibrar(30);
        avisar(`🔗 Juntado con «${elegido.nombre}»`);
        // Al grupo que sigue
        cerrarCapas(1, () => abrirGrupo(receta, destino, alVolver));
      };
      // Abre un grupo que está en otro cuaderno (de otra receta, quizá): su historial, o a dónde pasó
      const irAlGrupo = (id) => {
        const cc = leerCuaderno();
        const x = K.grupoDe(cc, id);
        if (!x) { avisar('Ese grupo ya no está'); return; }
        // (un grupo de un cuaderno sin receta todavía: la «receta» es solo un nombre para la pantalla)
        const r = recetaDe(x.recetaId) || { id: x.recetaId || null,
          nombre: x.recetaId ? nombreDeReceta(cc, x.recetaId) : K.fichaCuaderno(cc, K.ambito(null, K.cuadernoDe(x))).nombre, pasos: [] };
        abrirGrupo(r, id, pintar);
      };
      // Pasar muestras a otro cuaderno (versión 113, lo pidió el usuario): la historia se queda aquí, allí
      // nace un grupo limpio y cada uno lleva un botón para ir al otro
      const pasarACuaderno = async () => {
        const actual = ambitoDe(g);
        // (también los que aún no tienen receta: las muestras esperan allí y, al ponérsela, siguen sus fases)
        let destinos = K.todosLosCuadernos(c).filter((k) => !K.casa(g, k.ambito));
        let elegido = destinos[0] || null;
        const crear = !destinos.length;
        const cuantas = h('input', { class: 'campo', type: 'text', inputmode: 'numeric', autocomplete: 'off',
          value: g.muestras == null ? '' : String(g.muestras), placeholder: g.muestras == null ? 'Todas' : `Todas (${g.muestras})` });
        const lista = h('div', { class: 'elegir-grupo' },
          destinos.map((k) => h('label', { class: 'opcion-grupo' },
            h('input', { type: 'radio', name: 'cuaderno-destino', checked: k === elegido, onchange: () => { elegido = k; } }),
            h('span', {}, h('b', { text: `📓 ${k.ficha.nombre}` }), h('small', { text: k.ambito.recetaId ? `📋 ${nombreDeReceta(c, k.ambito.recetaId)}` : '📋 Sin receta todavía (las muestras esperan allí)' })))),
          h('label', { class: 'opcion-grupo' },
            h('input', { type: 'radio', name: 'cuaderno-destino', checked: crear, onchange: () => { elegido = 'nuevo'; } }),
            h('span', {}, h('b', { text: '＋ Un cuaderno nuevo…' }), h('small', { text: 'La receta se le puede poner ahora o después' }))));
        if (crear) elegido = 'nuevo';
        const nota = await preguntar({ texto: `📤 Pasar «${g.nombre}» a otro cuaderno`, detalle: [
          h('p', { class: 'dialogo-detalle', text: 'Las muestras siguen allí, en un grupo nuevo. Aquí se queda toda su historia, y cada grupo lleva un botón para ir al otro.' }),
          lista,
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Cuántas pasan' }), cuantas)],
        campo: { placeholder: 'Nota (si quieres): por qué…', autocapitalize: 'sentences' }, si: 'Pasar', no: 'Cancelar' });
        if (nota === null) return;
        let destino = elegido;
        if (destino === 'nuevo') {
          const id = await editarFichaCuaderno(null, null);
          if (!id || id === 'quitado') return;
          const ficha = K.fichaCuaderno(leerCuaderno(), { cuadernoId: id });
          destino = { ambito: K.ambito(ficha.recetaId || null, id), ficha };
        }
        if (!destino) { avisar('Elige un cuaderno'); return; }
        const cc = leerCuaderno();
        // (con la receta: «Cuaderno 1» lo tiene cada receta, y si no se confunden)
        const largo = (a, f) => { const rn = a.recetaId ? nombreDeReceta(cc, a.recetaId) : ''; return rn && rn !== f.nombre ? `${f.nombre} · ${rn}` : f.nombre; };
        const d = { recetaId: destino.ambito.recetaId, cuadernoId: destino.ambito.cuadernoId,
          nombre: largo(destino.ambito, destino.ficha), deNombre: largo(actual, K.fichaCuaderno(cc, actual)) };
        const n = String(cuantas.value).trim() === '' ? null : Q.aNumero(cuantas.value);
        let nuevoId = null;
        try {
          cambiarCuaderno((x) => {
            const r = K.pasar(x, g.id, d, n, Date.now(), { grupo: idDe('g'), de: idDe('e'), a: idDe('e') });
            nuevoId = r.nuevo.id;
            const e1 = x.entradas.find((y) => y.tipo === 'pasar' && y.nuevoId === r.nuevo.id);
            const e2 = x.entradas.find((y) => y.tipo === 'llegar' && y.grupoId === r.nuevo.id);
            if (e1) { e1.receta = receta.nombre; if (nota.trim()) e1.nota = nota.trim(); }
            if (e2) e2.receta = d.recetaId ? nombreDeReceta(x, d.recetaId) : null;
          });
        } catch (e) { avisar(e.message); return; }
        vibrar(30);
        avisar(`📤 «${g.nombre}» pasa al cuaderno «${d.nombre}»`);
        pintar();
      };
      // Deshacer un «pasar» sin querer (versión 114): se va el grupo nuevo y vuelven las muestras. Solo
      // mientras el nuevo no haya apuntado nada más (K.deshacerPasar). Se llama desde cualquiera de los dos
      const deshacerElPaso = async (nuevoId, haciaDonde) => {
        if (!await preguntar({ texto: '¿Deshacer el paso a otro cuaderno?', peligro: true, si: 'Deshacer', no: 'Cancelar',
          detalle: `El grupo nuevo desaparece${haciaDonde ? ` de «${haciaDonde}»` : ''} y las muestras vuelven a su grupo de origen, como estaban. Solo se puede mientras el nuevo no haya apuntado nada más.` })) return;
        try { cambiarCuaderno((d) => K.deshacerPasar(d, nuevoId)); } catch (e) { avisar(e.message); return; }
        vibrar(30);
        avisar('↩️ Deshecho: las muestras vuelven a su grupo');
        // (si estás en el grupo nuevo, ya no existe y pintar() cierra la hoja)
        pintar();
      };
      const separar = async () => {
        // El nombre que se propone: la primera letra que no tenga ya un grupo de esta receta
        const usados = new Set(K.gruposDe(c, ambitoDe(g)).map((x) => x.nombre));
        const letra = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `Grupo ${l}`).find((n) => !usados.has(n)) || '';
        const cuantas = h('input', { class: 'campo', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '¿Cuántas?' });
        const nombre = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', value: letra });
        const nota = await preguntar({ texto: `✂️ Separar muestras de «${g.nombre}»`, detalle: [
          h('p', { class: 'dialogo-detalle', text: `Unas muestras pasan a un grupo nuevo, que sigue a su ritmo y se lleva la historia de antes.${g.muestras != null ? ` Ahora hay ${muestrasTexto(g.muestras)}.` : ''}` }),
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Cuántas pasan' }), cuantas),
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Grupo nuevo' }), nombre)],
          campo: { placeholder: 'Nota (si quieres): por qué…', autocapitalize: 'sentences' }, si: 'Separar', no: 'Cancelar' });
        if (nota === null) return;
        try {
          cambiarCuaderno((d) => {
            const { entrada } = K.separar(d, grupoId, Q.aNumero(cuantas.value), nombre.value, Date.now(), { grupo: idDe('g'), entrada: idDe('e') });
            entrada.receta = receta.nombre;
            if (nota.trim()) entrada.nota = nota.trim();
          });
        } catch (e) { avisar(e.message); return; }
        pintar();
      };
      const nota = async () => {
        const r = await pedirApunte({ texto: `✍️ Nota · ${g.nombre}` });
        if (!r || (!r.nota && !r.fotos.length)) return;
        apuntar({ tipo: 'nota', ...comun(), ...r });
        pintar();
      };
      // Una medida (versión 114): capacitancia, espesor… con su valor y unidad; se compara entre grupos
      const medir = async () => {
        const ed = editorMedidas([{}], leerCuaderno());
        const r = await pedirApunte({ texto: `📏 Medida · ${g.nombre}`, antes: [ed.el], si: 'Apuntar' });
        if (!r) return;
        const medidas = ed.valores();
        if (!medidas.length) { avisar('Escribe qué mides y su valor'); return; }
        if (ed.incompletas()) avisar(`${ed.incompletas()} sin valor o sin nombre: no se ha apuntado`);
        apuntar({ tipo: 'medida', medidas, ...comun(), ...r });
        vibrar(30);
        pintar();
      };
      const editar = async () => {
        const cuantas = h('input', { class: 'campo', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: g.muestras == null ? '' : String(g.muestras), placeholder: 'Nº de muestras' });
        // Lo que le toca: lo normal (la fase siguiente) o una puesta a mano (para repetir una fase)
        const toca = h('select', { class: 'campo' },
          h('option', { value: '', text: 'Lo normal: la fase siguiente', selected: !('siguiente' in g) }),
          fases.map((f, i) => h('option', { value: String(i), text: K.nombreFase(f), selected: 'siguiente' in g && g.siguiente === f })));
        // El nombre, el primero y con su rótulo (antes iba abajo sin rótulo y no se veía que era el nombre)
        const campoNombre = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', value: g.nombre, placeholder: 'Nombre del grupo' });
        const si = await preguntar({ texto: '✏️ Cambiar el grupo', detalle: [
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre' }), campoNombre),
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Muestras' }), cuantas),
          fases.length > 0 && h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Le toca' }), toca)],
        si: 'Guardar', no: 'Cancelar' });
        if (!si) return;
        const nuevo = campoNombre.value;
        const n = Q.aNumero(cuantas.value);
        cambiarCuaderno((d) => {
          const x = K.grupoDe(d, grupoId);
          if (!x) return;
          if (nuevo.trim()) x.nombre = nuevo.trim().slice(0, 60);
          if (toca.value === '') delete x.siguiente; else x.siguiente = fases[Number(toca.value)];
          x.muestras = n >= 0 && n !== null ? Math.round(n) : null;
          // (también donde se le nombra: separar, juntar)
          for (const e of d.entradas) {
            if (e.grupoId === x.id) e.grupo = x.nombre;
            if (e.nuevoId === x.id) e.nuevo = x.nombre;
            if ((e.tipo === 'recibir' || e.tipo === 'llegar') && e.desdeId === x.id) e.desde = x.nombre;
          }
        });
        pintar();
      };
      editarGrupo = editar;
      // El día en que le toca lo siguiente (versión 86): sale un aviso en los cuadernos ese día (y el
      // de antes); se quita solo al empezar una fase
      const ponerFecha = async () => {
        const dia = h('input', { class: 'campo', type: 'date', value: g.toca || hoyISO(), 'aria-label': 'Día' });
        const r = await preguntar({ texto: `📅 ¿Cuándo le toca ${K.nombreFase(est.siguiente)}?`,
          detalle: [h('p', { class: 'dialogo-detalle', text: `Ese día (y el de antes) sale un aviso en los cuadernos: «${g.nombre} tiene que empezar ${K.nombreFase(est.siguiente)}». Se quita solo al empezarla.` }), dia],
          si: 'Guardar', no: 'Cancelar', otro: g.toca ? 'Quitar la fecha' : null });
        if (!r) return;
        cambiarCuaderno((d) => {
          const x = K.grupoDe(d, grupoId);
          if (!x) return;
          if (r === 'otro' || !dia.value) delete x.toca; else x.toca = dia.value;
        });
        pintar();
      };
      const puedeTocar = fases.length > 0 && !g.juntadoEn && !g.pasadoA && (est.estado === 'espera' || est.estado === 'nada') && est.siguiente !== undefined;
      const quitar = async () => {
        if (!await preguntar({ texto: `¿Quitar el grupo «${g.nombre}»?`, detalle: 'Lo apuntado en la bitácora se queda.', si: 'Quitar', peligro: true })) return;
        quitarGrupo(grupoId);
        atras();
      };

      const historia = K.historiaDe(c, g.id);
      const padre = g.padre && K.grupoDe(c, g.padre);
      const hayFases = fases.length > 0;
      // Las características de la muestra (versión 120, lo pidió el usuario): un texto del grupo que no
      // va en la bitácora sino en el informe. Se guarda solo
      const caract = h('textarea', { class: 'campo', rows: 3, autocapitalize: 'sentences', value: g.caracteristicas || '',
        placeholder: 'Por ejemplo: fibra de 4 cm, 2 capas de grafeno, pH 8,4, tintada 3 veces…' });
      const estadoCaract = h('small', { class: 'notas-estado', text: '' });
      let relojCaract = null;
      const guardarCaract = () => {
        clearTimeout(relojCaract);
        relojCaract = null;
        const texto = caract.value.trim();
        cambiarCuaderno((d) => {
          const x = K.grupoDe(d, grupoId);
          if (!x) return;
          if (texto) x.caracteristicas = texto; else delete x.caracteristicas;
        });
        estadoCaract.textContent = '✓ Guardado';
      };
      caract.addEventListener('input', () => { estadoCaract.textContent = 'Guardando…'; clearTimeout(relojCaract); relojCaract = setTimeout(guardarCaract, 700); });
      caract.addEventListener('blur', () => { if (relojCaract) guardarCaract(); });
      // (tres bloques: lo de arriba, su historia y «Más»; en el PC, la historia va a la derecha: versión 136)
      cuerpo.classList.add('cuerpo-grupo');
      poner(cuerpo, h('div', { class: 'grupo-bloque grupo-arriba' },
        h('div', { class: 'caja grupo-estado' },
          g.muestras != null && h('p', { class: 'grupo-cuantas', text: muestrasTexto(g.muestras) }),
          h('p', { text: textoEstado(est) }),
          g.padre && h('small', { class: 'nota', text: `Salió de «${padre ? padre.nombre : 'un grupo quitado'}» el ${fechaCorta(g.desde)}` }),
          // De otro cuaderno (pasar): su historia anterior no está aquí, está allí (botón)
          g.vieneDe && h('small', { class: 'nota', text: `📥 Llegó del cuaderno «${g.vieneCuaderno || 'otro'}» el ${fechaCorta(g.vieneDesde)}. Su historia anterior está allí.` }),
          g.vieneDe && h('button', { class: 'enlace', type: 'button', onclick: () => irAlGrupo(g.vieneDe),
            text: `📜 Ver su historial anterior${K.grupoDe(c, g.vieneDe) ? '' : ' (ya no está)'}` }),
          puedeTocar && h('button', { class: 'enlace', type: 'button', onclick: ponerFecha,
            text: g.toca ? `📅 Le toca ${cuandoToca(g.toca)}: cambiar` : '📅 ¿Cuándo le toca? (para que te avise)' })),
        h('label', { class: 'etiqueta-campo caracteristicas' }, h('span', { text: '📝 Características de esta muestra (solo salen en el informe, no en la bitácora)' }), caract, estadoCaract),
        // Juntado con otro o pasado a otro cuaderno: ya no sigue (solo notas); si no, todo lo que se puede hacer
        g.pasadoA
          ? h('div', { class: 'acciones-grupo' },
            h('button', { class: 'boton', text: `➡️ Seguir en «${est.cuaderno}»`, onclick: () => irAlGrupo(g.pasadoA) }),
            h('button', { class: 'boton secundario', text: '📷 Nota o fotos', onclick: nota }))
          : g.juntadoEn
          ? h('div', { class: 'acciones-grupo' },
            h('button', { class: 'boton secundario', text: `🔗 Ir a «${est.con}»`, onclick: () => cerrarCapas(1, () => abrirGrupo(receta, g.juntadoEn, alVolver)) }),
            h('button', { class: 'boton secundario', text: '📷 Nota o fotos', onclick: nota }))
          : h('div', { class: 'acciones-grupo' },
            hayFases && h('button', { class: 'boton', text: est.estado === 'en' ? '🏁 Terminar fase' : '▶ Empezar fase', onclick: est.estado === 'en' ? terminar : empezar }),
            hayFases && h('button', { class: 'boton secundario', text: est.estado === 'en' ? '▶ Empezar otra fase' : '🏁 Terminar fase', onclick: est.estado === 'en' ? empezar : terminar }),
            h('button', { class: 'boton secundario', text: '🔬 Muestra para analizar', onclick: analisis }),
            h('button', { class: 'boton secundario', text: '✂️ Separar muestras', onclick: separar }),
            h('button', { class: 'boton secundario', text: '🔗 Juntar con otro grupo', onclick: juntarCon }),
            h('button', { class: 'boton secundario', text: '📏 Apuntar una medida', onclick: medir }),
            h('button', { class: 'boton secundario', text: '📤 Pasar a otro cuaderno', onclick: pasarACuaderno }),
            h('button', { class: 'boton secundario', text: '📷 Nota o fotos', onclick: nota }))),
      h('div', { class: 'grupo-bloque grupo-historia' },
        h('h3', { text: '📖 Su historia' }),
        historia.length
          ? bitacora(historia, { desde: g.id, alCambiar: pintar })
          : h('p', { class: 'nota', text: 'Aún no hay nada apuntado de este grupo.' }),
        botonCopiar(`${receta.nombre} · ${g.nombre}`, historia)),
      h('div', { class: 'grupo-bloque grupo-mas' },
        h('h3', { text: 'Más' }),
        g.vieneDe && h('button', { class: 'boton secundario', text: '↩️ Deshacer: devolverlas a su grupo de origen', onclick: () => deshacerElPaso(g.id, g.vieneCuaderno) }),
        g.pasadoA && h('button', { class: 'boton secundario', text: `↩️ Deshacer el paso a «${est.cuaderno}»`, onclick: () => deshacerElPaso(g.pasadoA, est.cuaderno) }),
        h('button', { class: 'boton secundario', text: '✏️ Cambiar el nombre, las muestras o lo que le toca', onclick: editar }),
        h('button', { class: 'boton discreto', text: '🗑️ Quitar el grupo', onclick: quitar })));
    };
    alLlegarCambios(cuerpo, () => pintar());
    pintar();
  };

  // ─── Una disolución: si queda, cuánto, de qué está hecha, quién la usó, notas y fotos ───
  const abrirDisolucion = (receta, id, alVolver) => {
    let editarDis = null;
    const { cuerpo, titulo } = abrirPanel('🧪', [h('button', { class: 'icono', 'aria-label': 'Cambiar el nombre de la disolución', text: '✏️', onclick: () => { if (editarDis) editarDis(); } })], alVolver);
    const pintar = () => {
      const c = leerCuaderno();
      const d = K.disolucionDe(c, id);
      if (!d) { atras(); return; }
      titulo.textContent = `🧪 ${d.nombre}`;
      const cambiar = (fn) => cambiarCuaderno((x) => { const y = K.disolucionDe(x, id); if (y) fn(y); });
      const ponerEstado = (estado) => {
        if ((d.estado || 'queda') === estado) return;
        cambiar((y) => { y.estado = estado; });
        apuntar({ tipo: 'estado', disolucionId: id, disolucion: d.nombre, estado, recetaId: receta.id, ...K.marcaDe(ambitoDe(d)), receta: receta.nombre });
        pintar();
      };
      // Cuánto queda: se guarda al salir de la casilla (sin apuntarlo en la bitácora)
      const queda = h('input', { class: 'campo', autocomplete: 'off', placeholder: 'Por ejemplo: 300 mL', value: d.queda || '',
        onchange: (e) => { cambiar((y) => { y.queda = e.target.value.trim(); }); } });
      editarDis = async () => {
        const nombre = h('input', { class: 'campo', autocomplete: 'off', autocapitalize: 'sentences', value: d.nombre });
        const preparada = h('input', { class: 'campo', autocomplete: 'off', value: d.preparada || '', placeholder: 'Por ejemplo: 800 mL' });
        if (!await preguntar({ texto: '✏️ Cambiar la disolución', detalle: [
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre' }), nombre),
          h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Cuánta se preparó' }), preparada)], si: 'Guardar', no: 'Cancelar' })) return;
        cambiarCuaderno((x) => {
          const y = K.disolucionDe(x, id);
          if (!y) return;
          if (nombre.value.trim()) y.nombre = nombre.value.trim().slice(0, 80);
          y.preparada = preparada.value.trim();
          // El nombre nuevo también en lo apuntado
          for (const e of x.entradas) {
            if (e.disolucionId === id) e.disolucion = y.nombre;
            for (const u of e.disoluciones || []) if (u.id === id) u.nombre = y.nombre;
          }
        });
        pintar();
      };
      // Corregir los números con los que se preparó: se cambian los datos y las cantidades se vuelven
      // a calcular solas (con las cuentas que tenía la receta al prepararla, guardadas en d.hoja; las
      // de antes de guardarlas, con las de la receta de ahora). La receta no cambia
      const corregir = async () => {
        const deAhora = !d.hoja;
        const hoja = JSON.parse(JSON.stringify(d.hoja || Q.hojaDe(recetaDe(receta.id) || { datos: [], calculos: [], pasos: [] })));
        // Las de antes de guardar la hoja: su subfase (por el nombre) y sus números de entonces (los
        // de su tabla), no los de la receta de ahora
        const rango = d.rango || (d.subfase && ((Q.subfasesDe(hoja).find((t) => t.titulo === d.fase) || { subfases: [] }).subfases.find((s) => s.nombre === d.subfase))) || undefined;
        // (por el nombre; si se le cambió el nombre en la receta, uno que empiece igual que el otro:
        // «…acetato de cobre monohidratado» y «…acetato de cobre»)
        const sinEncontrar = [];
        if (deAhora) {
          const igual = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
          const empiezaIgual = (a, b) => { const x = a.trim().toLowerCase(); const y = b.trim().toLowerCase(); return x.startsWith(y) || y.startsWith(x); };
          for (const x of (d.composicion || []).filter((y) => !y.cantidad)) {
            const dato = hoja.datos.find((y) => igual(y.nombre, x.nombre)) || hoja.datos.find((y) => empiezaIgual(y.nombre, x.nombre));
            const v = dato ? Q.valorDeTexto(x.texto, dato.unidad, dato.valor) : null;
            if (v === null) { sinEncontrar.push(`${x.nombre} (${x.texto})`); continue; }
            if (v !== dato.valor) { dato.valor = v; if (Q.esPesoMolecular(dato)) dato.manual = true; }
          }
        }
        const lineas = Q.composicionDe(hoja, d.fase, rango);
        const datos = lineas.filter((x) => !x.cantidad).map((x) => hoja.datos.find((y) => y.id === x.id)).filter(Boolean);
        if (!datos.length) { avisar('Esta disolución no tiene números que corregir'); return; }
        const antes = new Map(datos.map((x) => [x.id, x.valor]));
        // (en una de antes de guardar sus cuentas, lo que su tabla no tenía —la riqueza o la densidad de un ácido,
        // que salen de la receta de ahora— cuenta como nuevo: si no, con esos números ya buenos no dejaba guardar;
        // versión 150, el HNO3 nº 1 del usuario)
        if (deAhora) for (const x of datos) if (!(d.composicion || []).some((y) => y.id === x.id || y.nombre.trim().toLowerCase() === x.nombre.trim().toLowerCase())) antes.set(x.id, null);
        const resultado = h('div', { class: 'caja composicion' });
        const pintarResultado = () => poner(resultado, Q.composicionDe(hoja, d.fase, rango).filter((x) => x.cantidad).map((x) => h('div', { class: 'dato calculo' },
          h('div', { class: 'dato-nombre', text: x.nombre }), h('span', { class: 'calculo-valor', text: x.texto }))));
        const filas = datos.map((x) => h('label', { class: 'etiqueta-campo' }, h('span', { text: `${x.nombre}${x.unidad ? ` (${x.unidad})` : ''}` }),
          h('input', { class: 'campo', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: x.valor == null ? '' : String(x.valor).replace('.', ','),
            oninput: (e) => {
              x.valor = Q.aNumero(e.target.value);
              if (Q.esPesoMolecular(x)) x.manual = true;
              pintarResultado();
            } })));
        pintarResultado();
        if (!await preguntar({ texto: `🧮 Corregir los números · ${d.nombre}`, detalle: [
          h('p', { class: 'dialogo-detalle', text: 'Cambia lo que no fue así (por ejemplo, el volumen) y las cantidades se calculan solas. La receta no cambia.' }),
          filas,
          h('p', { class: 'dialogo-detalle', text: 'Sale:' }), resultado,
          deAhora && h('p', { class: 'nota', text: 'Esta disolución es de antes de que se guardaran sus cuentas: se usan las fórmulas de la receta de ahora, con tus números de entonces.' }),
          sinEncontrar.length > 0 && h('p', { class: 'aviso-sentido', text: `⚠️ La receta ha cambiado desde que la preparaste y esto no está en la de ahora: ${sinEncontrar.join(', ')}. Revisa los números antes de guardar.` })],
        si: 'Guardar', no: 'Cancelar' })) return;
        const cambios = datos.filter((x) => x.valor !== antes.get(x.id));
        if (!cambios.length) return;
        cambiar((y) => { y.hoja = hoja; y.composicion = Q.composicionDe(hoja, d.fase, rango); if (rango) y.rango = { desde: rango.desde, hasta: rango.hasta }; });
        apuntar({ tipo: 'nota', disolucionId: id, disolucion: d.nombre, recetaId: receta.id, ...K.marcaDe(ambitoDe(d)), receta: receta.nombre,
          nota: `🧮 Números corregidos: ${cambios.map((x) => `${x.nombre} ${antes.get(x.id) == null ? '—' : Q.cantidad(antes.get(x.id), x.unidad)} → ${x.valor == null ? '—' : Q.cantidad(x.valor, x.unidad)}`).join('; ')}` });
        pintar();
      };
      const nota = async () => {
        const r = await pedirApunte({ texto: `✍️ Nota · ${d.nombre}` });
        if (!r || (!r.nota && !r.fotos.length)) return;
        apuntar({ tipo: 'nota', disolucionId: id, disolucion: d.nombre, recetaId: receta.id, ...K.marcaDe(ambitoDe(d)), receta: receta.nombre, ...r });
        pintar();
      };
      const quitar = async () => {
        if (!await preguntar({ texto: `¿Quitar «${d.nombre}»?`, detalle: 'Lo apuntado en la bitácora se queda.', si: 'Quitar', peligro: true })) return;
        cambiarCuaderno((x) => { x.disoluciones = x.disoluciones.filter((y) => y.id !== id); });
        atras();
      };
      const usos = K.usadaPor(c, id);
      const historia = K.historiaDisolucion(c, id);
      poner(cuerpo,
        h('div', { class: 'caja grupo-estado' },
          h('p', { class: 'grupo-cuantas', text: K.ESTADOS[d.estado || 'queda'] }),
          h('p', { text: [`Preparada el ${fechaCorta(d.fecha)} a las ${horaDe(d.fecha)}`, d.preparada].filter(Boolean).join(' · ') }),
          d.fase && h('small', { class: 'nota', text: K.nombreFase(d.fase) })),
        h('h3', { text: '¿Queda?' }),
        h('div', { class: 'chips' }, Object.entries(K.ESTADOS).map(([k, t]) => h('button', { class: 'chip', 'aria-pressed': String((d.estado || 'queda') === k), text: t, onclick: () => ponerEstado(k) }))),
        h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Cuánto queda (si quieres)' }), queda),
        h('h3', { text: '⚗️ De qué está hecha' }),
        d.composicion && d.composicion.length
          ? h('div', { class: 'caja composicion' }, d.composicion.map((x) => h('div', { class: `dato${x.cantidad ? ' calculo' : ''}` },
            h('div', { class: 'dato-nombre', text: x.nombre }), h('span', { class: 'calculo-valor', text: x.texto }))))
          : h('p', { class: 'nota', text: 'No hay datos de la receta para esta fase.' }),
        h('p', { class: 'nota', text: 'Tal como estaba la receta al prepararla: aunque cambies la receta, esto no cambia.' }),
        d.composicion && d.composicion.some((x) => !x.cantidad) && h('button', { class: 'boton secundario', text: '🧮 Corregir los números (el volumen, la concentración…)', onclick: corregir }),
        h('h3', { text: '🧫 Usada por' }),
        usos.length
          ? h('div', { class: 'caja' }, usos.map((u) => h('div', { class: 'entrada' },
            h('span', { class: 'entrada-hora', text: fechaCorta(u.fecha) }),
            h('div', { class: 'entrada-texto' }, h('b', { text: u.grupo || 'Sin grupo' }), h('small', { class: 'nota', text: K.nombreFase(u.fase) })))))
          : h('p', { class: 'nota', text: 'Ningún grupo todavía. Se marca al empezar o terminar una fase con unas muestras.' }),
        h('button', { class: 'boton secundario', text: '📷 Nota o fotos (sucia, color, precipitado…)', onclick: nota }),
        h('h3', { text: '📖 Su historia' }),
        historia.length ? bitacora(historia, { desde: null, alCambiar: pintar }) : h('p', { class: 'nota', text: 'Nada apuntado.' }),
        h('h3', { text: 'Más' }),
        h('button', { class: 'boton secundario', text: '✏️ Cambiar el nombre o cuánta se preparó', onclick: () => editarDis() }),
        h('button', { class: 'boton discreto', text: '🗑️ Quitar la disolución', onclick: quitar }));
    };
    alLlegarCambios(cuerpo, () => pintar());
    pintar();
  };

  // ─── Las fotos de una receta: el recopilatorio y la comparación ───
  // (mini: la miniatura, para la galería; sin ella, la foto entera, para comparar y ampliar)
  const fotoImg = (id, mini = false) => {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    (mini === 'vista' ? urlVista : mini ? urlMini : urlDe)(id).then((u) => { if (u) img.src = u; else img.alt = '(foto borrada)'; }).catch(() => {});
    return img;
  };
  // Lo que se hizo en un apunte, en corto (de una nota, su primera línea)
  const tituloApunte = (e) => (e.tipo === 'nota' && e.nota ? e.nota.split('\n')[0].slice(0, 60) : K.titularDe(e));
  // El pie de una foto. enSesion (dentro de su sesión, que ya dice qué fue y de quién): su título
  // puesto a mano o «Foto N», y su aumento y zona. Si no (al comparar): todo, con la fecha
  const pieFoto = (c, id, e, color, enSesion) => {
    const info = K.infoFoto(e, id);
    const deQuien = [e.grupo || (e.disolucion && `🧪 ${e.disolucion}`), K.momentoDe(c, e.grupoId, e.fecha)].filter(Boolean).join(' · ');
    const detalles = [info.aumento && `🔍 ${info.aumento}`, info.zona && `📍 ${info.zona}`, !enSesion && fechaCorta(e.fecha)].filter(Boolean).join(' · ');
    return h('div', { class: 'foto-pie' },
      h('b', { text: enSesion ? c.titulos[id] || `Foto ${e.fotos.indexOf(id) + 1}` : K.tituloFoto(c, id, e) }),
      !enSesion && deQuien && h('small', { class: 'foto-de' }, color && h('span', { class: 'punto-grupo', style: `background: ${color}` }), deQuien),
      (detalles || enSesion) && h('small', { text: detalles || 'Sin aumento' }));
  };
  // El color de cada grupo (el de su línea en el árbol): Map id → color (vacío sin árbol)
  const coloresDe = (c, receta, amb) => { const a = arbolDeMuestras(c, receta, () => {}, amb); return a ? a.colores : coloresSinArbol(c, amb); };
  // Los tipos de apunte con fotos, para filtrar (K.tipoFoto)
  const TIPOS_FOTO = [['analisis', '🔬 Análisis'], ['fases', '🧫 Fases'], ['disoluciones', '🧪 Disoluciones'], ['notas', '✍️ Notas']];

  // Las fotos en una tabla (versión 95, de las ideas pendientes de las fotos): los grupos en columnas y
  // los aumentos en filas, para ver de un vistazo cómo se ve cada grupo a cada aumento. Usa el mismo
  // filtro de tipo que Fotos (de entrada, solo los análisis); tocar una foto la abre en grande
  // Lo medido en el cuaderno, en una tabla (versión 114): una fila por lo que se mide y una columna por
  // grupo, con lo último medido; si se midió más veces, «×N» y al tocarlo salen todas
  const abrirMedidas = (receta, alVolver, amb = ambitoActual(receta)) => {
    const { cuerpo } = abrirPanel('📏 Medidas', null, alVolver);
    const pintar = () => {
      const c = leerCuaderno();
      const t = K.medidasDe(c, amb);
      if (!t.filas.length) {
        poner(cuerpo, h('p', { class: 'nota', text: 'Aún no hay medidas. Se apuntan desde cada grupo, con «📏 Apuntar una medida».' }));
        return;
      }
      const colores = coloresDe(c, receta, amb);
      const texto = (celda) => `${K.numTexto(celda.valor)}${celda.unidad ? ` ${celda.unidad}` : ''}`;
      const verTodas = (fila, grupo, celda) => preguntar({ texto: `📏 ${fila.nombre} · ${grupo.nombre}`, no: null, si: 'Cerrar',
        detalle: h('div', { class: 'medidas-historial' }, [...celda.todos].reverse().map((x) => h('p', {},
          h('b', { text: `${K.numTexto(x.valor)}${x.unidad ? ` ${x.unidad}` : ''}` }), ` · ${fechaCorta(x.fecha)} ${horaDe(x.fecha)}`))) });
      const textoPlano = () => [['', ...t.grupos.map((g) => g.nombre)].join('\t'),
        ...t.filas.map((f) => [f.nombre, ...t.grupos.map((g) => (f.celdas[g.id] ? texto(f.celdas[g.id]) : ''))].join('\t'))].join('\n');
      poner(cuerpo,
        h('div', { class: 'tabla-fotos tabla-medidas' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: '📏' }),
            t.grupos.map((g) => h('th', {}, colores.get(g.id) && h('span', { class: 'punto-grupo', style: `background: ${colores.get(g.id)}` }), g.nombre)))),
          h('tbody', {}, t.filas.map((f) => h('tr', {}, h('th', { text: f.nombre }),
            t.grupos.map((g) => {
              const celda = f.celdas[g.id];
              return h('td', { class: 'celda-medida' }, celda
                ? h('button', { class: 'medida-valor-celda', type: 'button', onclick: () => verTodas(f, g, celda) }, h('b', { text: texto(celda) }), celda.n > 1 && h('small', { text: ` ×${celda.n}` }))
                : h('span', { class: 'medida-vacia', text: '—' }));
            })))))),
        h('p', { class: 'nota', text: 'Cada columna es un grupo. Sale lo último medido; con «×2» se ha medido más veces: tócalo para verlas todas.' }),
        h('button', { class: 'boton secundario', type: 'button', text: '📋 Copiar la tabla (para pegarla en Excel)', onclick: async () => {
          try { await navigator.clipboard.writeText(textoPlano()); avisar('Copiada: pégala en Excel o en una hoja de cálculo'); } catch { avisar('No se ha podido copiar'); }
        } }));
    };
    alLlegarCambios(cuerpo, () => pintar());
    pintar();
  };
  const abrirTablaFotos = (receta, alVolver, amb = ambitoActual(receta)) => {
    const { cuerpo } = abrirPanel('▦ Fotos en tabla', null, alVolver);
    const numeroDe = (a) => { const n = Number(String(a).replace(/[^\d.,]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : Infinity; };
    const pintar = () => {
      const c = leerCuaderno();
      const colores = coloresDe(c, receta, amb);
      const tipos = new Set(leer('quimica.fotos-tipos', ['analisis']));
      const todas = K.fotosDe(c, amb);
      const fotos = todas.filter((f) => tipos.has(K.tipoFoto(f.entrada)));
      const claveG = (e) => e.grupoId || (e.disolucionId ? `d:${e.disolucionId}` : '');
      const nombreG = (e) => e.grupo || (e.disolucion && `🧪 ${e.disolucion}`) || 'Sin grupo';
      const columnas = [];
      for (const f of fotos) {
        const k = claveG(f.entrada);
        if (!columnas.some((x) => x.k === k)) columnas.push({ k, nombre: nombreG(f.entrada) });
      }
      // En el orden de los grupos del cuaderno (los demás, al final)
      const orden = K.gruposDe(c, amb).map((g) => g.id);
      const sitio = (k) => (orden.includes(k) ? orden.indexOf(k) : orden.length);
      columnas.sort((a, b) => sitio(a.k) - sitio(b.k));
      const filas = [...new Set(fotos.map((f) => K.infoFoto(f.entrada, f.id).aumento || ''))]
        .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : numeroDe(a) - numeroDe(b)));
      const celda = (aumento, k) => {
        const lista = fotos.filter((f) => (K.infoFoto(f.entrada, f.id).aumento || '') === aumento && claveG(f.entrada) === k);
        return h('td', { class: 'celda-foto' }, lista.map((f) => h('button', { class: 'foto-mini', 'aria-label': `Ver ${K.tituloFoto(c, f.id, f.entrada)} en grande`,
          title: `${fechaCorta(f.entrada.fecha)} · ${K.momentoDe(c, f.entrada.grupoId, f.entrada.fecha)}`, onclick: () => verFoto(f.id, pintar) }, fotoImg(f.id, true))));
      };
      poner(cuerpo,
        h('div', { class: 'chips' }, h('span', { class: 'chips-rotulo', text: 'Ver:' }),
          TIPOS_FOTO.map(([t, texto]) => {
            const n = todas.filter((f) => K.tipoFoto(f.entrada) === t).length;
            return n > 0 && h('button', { class: 'chip', 'aria-pressed': String(tipos.has(t)), text: `${texto} (${n})`,
              onclick: () => { if (tipos.has(t)) tipos.delete(t); else tipos.add(t); guardar('quimica.fotos-tipos', [...tipos]); pintar(); } });
          })),
        fotos.length
          ? h('div', { class: 'tabla-fotos' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: '🔍' }),
              columnas.map((col) => h('th', {}, colores.get(col.k) && h('span', { class: 'punto-grupo', style: `background: ${colores.get(col.k)}` }), col.nombre)))),
            h('tbody', {}, filas.map((a) => h('tr', {}, h('th', { text: a || 'Sin aumento' }), columnas.map((col) => celda(a, col.k)))))))
          : h('p', { class: 'nota', text: todas.length ? 'Ninguna foto de ese tipo: elige qué ver arriba.' : 'Aún no hay fotos.' }),
        h('p', { class: 'nota', text: 'Cada columna es un grupo y cada fila un aumento. Toca una foto para verla en grande. El aumento se pone en la foto en grande.' }));
    };
    alLlegarCambios(cuerpo, () => pintar());
    pintar();
  };

  // Todas las fotos de la receta, por sesiones (un bloque por apunte, con sus apartados). Lo pidió el
  // usuario: álbumes hechos a mano (grupos de fotos), varios grupos de muestras a la vez en el filtro,
  // y filtrar por tipo (de entrada solo los análisis: «yo solo quiero analizar muestras»). Las fotos
  // marcadas con el círculo se comparan o se añaden a un álbum
  // contenedor: si se da (la pestaña «Fotos» del cuaderno), las fotos van dentro de él y no en un panel
  const abrirFotos = (receta, alVolver, amb = ambitoActual(receta), contenedor = null) => {
    const cuerpo = contenedor || abrirPanel('🖼️ Fotos', null, alVolver).cuerpo;
    const filtro = { grupos: new Set(), apartado: '', aumento: '', tecnica: '', fase: '' }; // vacío = todos
    let album = ''; // el álbum que se está viendo ('' = todas las fotos)
    const plegadas = new Set(); // las sesiones plegadas (ids de sus apuntes)
    const pintar = () => {
      const c = leerCuaderno();
      const todas = K.fotosDe(c, amb);
      const albumes = K.albumesDe(c, amb);
      const elAlbum = albumes.find((a) => a.id === album) || null;
      if (!elAlbum) album = '';
      // Los tipos que se ven (se recuerdan en este aparato); dentro de un álbum, todas las suyas
      const tipos = new Set(leer('quimica.fotos-tipos', ['analisis']));
      const base = elAlbum ? todas.filter((f) => elAlbum.fotos.includes(f.id)) : todas.filter((f) => tipos.has(K.tipoFoto(f.entrada)));
      // Lo que hay para filtrar: grupos, apartados y aumentos de esas fotos
      const grupos = [...new Map(base.filter((f) => f.entrada.grupoId).map((f) => [f.entrada.grupoId, f.entrada.grupo])).entries()];
      const apartados = [...new Set(base.map((f) => K.infoFoto(f.entrada, f.id).apartado).filter(Boolean))];
      const aumentos = [...new Set(base.map((f) => K.infoFoto(f.entrada, f.id).aumento).filter(Boolean))];
      // La técnica (SEM, Raman…) y la fase en que estaba (versión 114: «filtrar por técnica y fase»)
      const tecnicas = [...new Set(base.map((f) => f.entrada.tecnica).filter(Boolean))];
      const fasesFoto = [...new Set(base.map((f) => K.faseDeEntrada(c, f.entrada)).filter(Boolean))].map((f) => K.nombreFase(f));
      for (const id of [...filtro.grupos]) if (!grupos.some(([g]) => g === id)) filtro.grupos.delete(id);
      if (!apartados.includes(filtro.apartado)) filtro.apartado = '';
      if (!aumentos.includes(filtro.aumento)) filtro.aumento = '';
      if (!tecnicas.includes(filtro.tecnica)) filtro.tecnica = '';
      if (!fasesFoto.includes(filtro.fase)) filtro.fase = '';
      const fotos = base.filter((f) => {
        const info = K.infoFoto(f.entrada, f.id);
        return (!filtro.grupos.size || filtro.grupos.has(f.entrada.grupoId)) && (!filtro.apartado || info.apartado === filtro.apartado) && (!filtro.aumento || info.aumento === filtro.aumento)
          && (!filtro.tecnica || f.entrada.tecnica === filtro.tecnica) && (!filtro.fase || K.nombreFase(K.faseDeEntrada(c, f.entrada)) === filtro.fase);
      });
      const elegidas = K.comparadas(c, amb);
      const ponerElegidas = (lista) => cambiarCuaderno((d) => { d.comparar[K.claveComparar(amb)] = lista; });
      const marcar = (id) => { ponerElegidas(elegidas.includes(id) ? elegidas.filter((x) => x !== id) : [...elegidas, id]); pintar(); };
      // Marcar de una vez todas las de una sesión, un apartado o todas las que se ven (lo pidió el
      // usuario: «seleccionar grupos enteros»); si ya estaban todas, se desmarcan
      const todasMarcadas = (ids) => ids.length > 0 && ids.every((id) => elegidas.includes(id));
      const marcarVarias = (ids) => {
        ponerElegidas(todasMarcadas(ids) ? elegidas.filter((x) => !ids.includes(x)) : [...elegidas, ...ids.filter((x) => !elegidas.includes(x))]);
        pintar();
      };
      const botonMarcar = (ids, que) => h('button', { class: 'marcar-varias', 'aria-pressed': String(todasMarcadas(ids)), onclick: () => marcarVarias(ids) },
        todasMarcadas(ids) ? `☑ Desmarcar ${que}` : `☐ Marcar ${que}`);
      const colores = coloresDe(c, receta, amb);
      const tarjeta = ({ id, entrada }) => {
        const n = elegidas.indexOf(id);
        const color = colores.get(entrada.grupoId);
        return h('div', { class: `foto-tarjeta${n >= 0 ? ' elegida' : ''}${color ? ' con-color' : ''}`, style: color ? `--gc: ${color}` : null },
          h('button', { class: 'foto-imagen', 'aria-label': 'Ver en grande', onclick: () => verFoto(id, pintar) }, fotoImg(id, true)),
          // El círculo: vacío, o el número con el que sale al comparar
          h('button', { class: 'foto-marca', 'aria-label': n >= 0 ? 'Desmarcar' : 'Marcar', 'aria-pressed': String(n >= 0), text: n >= 0 ? String(n + 1) : '', onclick: () => marcar(id) }),
          pieFoto(c, id, entrada, color, true));
      };
      // Por sesiones (lo pidió el usuario: mezcladas no se sabía qué era cada una): un bloque por
      // cada apunte con fotos, que dice qué fue, de quién, en qué punto estaba y cuándo, con su nota;
      // dentro, sus apartados con su título
      const sesiones = [];
      for (const f of fotos) {
        const s = sesiones[sesiones.length - 1];
        if (s && s.entrada.id === f.entrada.id) s.fotos.push(f); else sesiones.push({ entrada: f.entrada, fotos: [f] });
      }
      const sesion = ({ entrada: e, fotos: lista }) => {
        const color = colores.get(e.grupoId);
        const hay = new Set(lista.map((f) => f.id));
        const partes = K.apartadosDe(e).map((a) => ({ ...a, fotos: a.fotos.filter((id) => hay.has(id)) })).filter((a) => a.fotos.length);
        const conTitulos = partes.some((a) => a.titulo);
        // (de una nota, lo que sigue a su primera línea, que ya es el título)
        const nota = e.tipo === 'nota' ? (e.nota || '').split('\n').slice(1).join('\n').trim() : e.nota;
        const caja = h('details', { class: `foto-sesion${color ? ' con-color' : ''}`, style: color ? `--gc: ${color}` : null, open: !plegadas.has(e.id) },
          h('summary', {},
            h('b', { text: tituloApunte(e) }),
            h('small', { class: 'foto-de' }, color && h('span', { class: 'punto-grupo', style: `background: ${color}` }),
              [e.grupo || (e.disolucion && `🧪 ${e.disolucion}`), K.momentoDe(c, e.grupoId, e.fecha), fechaCorta(e.fecha), `${lista.length} ${lista.length === 1 ? 'foto' : 'fotos'}`].filter(Boolean).join(' · '))),
          nota && h('p', { class: 'foto-sesion-nota', text: nota }),
          // Lo mismo que tocar el apunte en la bitácora (lo pidió el usuario: editarlo desde aquí)
          h('div', { class: 'sesion-acciones' },
            h('button', { class: 'boton discreto editar-sesion', text: '✏️ Editar: nota, fotos, apartados…', onclick: () => editarApunte(e, pintar) }),
            lista.length > 1 && botonMarcar(lista.map((f) => f.id), `las ${lista.length}`)),
          partes.map((a) => [conTitulos && h('div', { class: 'foto-apartado' }, h('h4', { text: a.titulo ? `📂 ${a.titulo}` : 'Sin apartado' }),
            a.fotos.length > 1 && botonMarcar(a.fotos, `las ${a.fotos.length}`)),
          h('div', { class: 'galeria' }, a.fotos.map((id) => tarjeta({ id, entrada: e })))]));
        caja.addEventListener('toggle', () => { if (caja.open) plegadas.delete(e.id); else plegadas.add(e.id); });
        return caja;
      };
      // ─── Álbumes ───
      const nuevoAlbum = async (fotosIniciales) => {
        const nombre = await preguntar({ texto: '📁 Nuevo álbum', detalle: 'Un grupo de fotos tuyo: por ejemplo «SEM: 1 ciclo frente a 2 ciclos».', campo: { placeholder: 'Nombre del álbum', autocapitalize: 'sentences' }, si: 'Crear', no: 'Cancelar' });
        if (!nombre || !nombre.trim()) return null;
        const nuevo = { id: idDe('l'), recetaId: receta.id, ...K.marcaDe(amb), nombre: nombre.trim().slice(0, 60), fotos: fotosIniciales || [], fecha: Date.now() };
        cambiarCuaderno((d) => { d.albumes.push(nuevo); });
        return nuevo;
      };
      const cambiarAlbum = async () => {
        const r = await preguntar({ texto: '📁 Cambiar el álbum', campo: { value: elAlbum.nombre, placeholder: 'Nombre del álbum', autocapitalize: 'sentences' }, si: 'Guardar', no: 'Cancelar', otro: '🗑️ Quitar el álbum (las fotos se quedan)' });
        if (r === 'otro') {
          cambiarCuaderno((d) => { d.albumes = d.albumes.filter((a) => a.id !== elAlbum.id); });
          album = '';
        } else if (r && r.trim()) {
          cambiarCuaderno((d) => { const a = d.albumes.find((x) => x.id === elAlbum.id); if (a) a.nombre = r.trim().slice(0, 60); });
        }
        pintar();
      };
      // Las fotos marcadas, a un álbum (uno que ya hay, o uno nuevo)
      const aUnAlbum = async () => {
        let destino = albumes.length ? albumes[0].id : 'nuevo';
        const opcion = (valor, texto, detalle) => h('label', { class: 'opcion-grupo' },
          h('input', { type: 'radio', name: 'album', checked: valor === destino, onchange: () => { destino = valor; } }),
          h('span', {}, h('b', { text: texto }), detalle && h('small', { text: detalle })));
        if (albumes.length) {
          const ok = await preguntar({ texto: `📁 Añadir ${elegidas.length} ${elegidas.length === 1 ? 'foto' : 'fotos'} a…`, detalle: h('div', { class: 'elegir-grupo' },
            albumes.map((a) => opcion(a.id, a.nombre, `${a.fotos.length} ${a.fotos.length === 1 ? 'foto' : 'fotos'}`)), opcion('nuevo', '＋ Un álbum nuevo')), si: 'Añadir', no: 'Cancelar' });
          if (!ok) return;
        }
        if (destino === 'nuevo') {
          const nuevo = await nuevoAlbum([...elegidas]);
          if (!nuevo) return;
          destino = nuevo.id;
        } else {
          cambiarCuaderno((d) => { const a = d.albumes.find((x) => x.id === destino); if (a) a.fotos = [...new Set([...a.fotos, ...elegidas])]; });
        }
        const nombre = (K.albumesDe(leerCuaderno(), amb).find((a) => a.id === destino) || {}).nombre;
        ponerElegidas([]);
        avisar(`📁 Añadidas a «${nombre}»`);
        pintar();
      };
      const quitarDelAlbum = () => {
        cambiarCuaderno((d) => { const a = d.albumes.find((x) => x.id === elAlbum.id); if (a) a.fotos = a.fotos.filter((id) => !elegidas.includes(id)); });
        ponerElegidas([]);
        pintar();
      };
      const chip = (texto, pulsado, alPulsar, color) => h('button', { class: 'chip', 'aria-pressed': String(pulsado), onclick: alPulsar },
        color && h('span', { class: 'punto-grupo', style: `background: ${color}` }), texto);
      const elegir = (rotulo, clave, opciones) => opciones.length > 0 && h('label', { class: 'filtro-fotos' }, h('span', { text: rotulo }),
        h('select', { class: 'campo', onchange: (ev) => { filtro[clave] = ev.target.value; pintar(); } },
          h('option', { value: '', text: 'Todos', selected: !filtro[clave] }),
          opciones.map((v) => h('option', { value: v, text: v, selected: filtro[clave] === v }))));
      const enAlbum = elAlbum ? elegidas.filter((id) => elAlbum.fotos.includes(id)).length : 0;
      poner(cuerpo, todas.length
        ? [
          // Los álbumes
          h('div', { class: 'chips albumes' },
            chip('🖼️ Todas las fotos', !elAlbum, () => { album = ''; pintar(); }),
            albumes.map((a) => chip(`📁 ${a.nombre} (${a.fotos.length})`, a.id === album, () => { album = a.id; pintar(); })),
            chip('＋ Álbum', false, async () => { const n = await nuevoAlbum(elegidas.length ? [...elegidas] : []); if (n) { if (elegidas.length) ponerElegidas([]); album = n.id; } pintar(); })),
          elAlbum && h('div', { class: 'album-cabecera' }, h('b', { text: `📁 ${elAlbum.nombre}` }),
            h('button', { class: 'icono pequeno', 'aria-label': 'Cambiar el álbum', text: '✏️', onclick: cambiarAlbum })),
          // Sus notas (lo pidió el usuario): se guardan solas mientras se escribe
          elAlbum && (() => {
            let reloj = null;
            const guardarNota = (texto) => cambiarCuaderno((d) => { const a = d.albumes.find((x) => x.id === elAlbum.id); if (a) a.nota = texto; });
            return h('textarea', { class: 'campo album-nota', rows: 3, autocapitalize: 'sentences', value: elAlbum.nota || '', placeholder: 'Notas del álbum: qué comparas, qué ves, conclusiones…',
              oninput: (ev) => { clearTimeout(reloj); const t = ev.target.value; reloj = setTimeout(() => guardarNota(t), 600); },
              onchange: (ev) => { clearTimeout(reloj); guardarNota(ev.target.value); } });
          })(),
          elAlbum && !elAlbum.fotos.length && h('p', { class: 'nota', text: 'Vacío: en «🖼️ Todas las fotos», marca el círculo de las que quieras y pulsa «📁 Añadir a un álbum».' }),
          // Qué tipo de fotos (fuera de un álbum)
          !elAlbum && h('div', { class: 'chips' }, h('span', { class: 'chips-rotulo', text: 'Ver:' }),
            TIPOS_FOTO.map(([t, texto]) => {
              const n = todas.filter((f) => K.tipoFoto(f.entrada) === t).length;
              return n > 0 && chip(`${texto} (${n})`, tipos.has(t), () => { if (tipos.has(t)) tipos.delete(t); else tipos.add(t); guardar('quimica.fotos-tipos', [...tipos]); pintar(); });
            })),
          // De qué grupos (varios a la vez)
          grupos.length > 1 && h('div', { class: 'chips' }, h('span', { class: 'chips-rotulo', text: '🧫' }),
            chip('Todos', !filtro.grupos.size, () => { filtro.grupos.clear(); pintar(); }),
            grupos.map(([id, nombre]) => chip(nombre, filtro.grupos.has(id), () => { if (filtro.grupos.has(id)) filtro.grupos.delete(id); else filtro.grupos.add(id); pintar(); }, colores.get(id)))),
          h('div', { class: 'filtros-fotos' },
            elegir('📂 Apartado', 'apartado', apartados),
            elegir('🔍 Aumento', 'aumento', aumentos),
            elegir('🔬 Técnica', 'tecnica', tecnicas),
            elegir('🧪 Fase', 'fase', fasesFoto)),
          !elAlbum && todas.length > 0 && h('button', { class: 'boton secundario', text: '▦ Ver en tabla: grupos × aumentos', onclick: () => abrirTablaFotos(receta, pintar, amb) }),
          fotos.length > 1 && h('div', { class: 'sesion-acciones' }, botonMarcar(fotos.map((f) => f.id), `todas las que se ven (${fotos.length})`)),
          fotos.length
            ? sesiones.map(sesion)
            : !(elAlbum && !elAlbum.fotos.length) && h('p', { class: 'nota', text: base.length ? 'Ninguna foto con esos filtros.' : 'Ninguna foto de ese tipo: elige qué ver arriba.' }),
          h('p', { class: 'nota', text: 'Toca una foto para verla en grande y ponerle el aumento y la zona. Marca el círculo de las que quieras comparar o pasar a un álbum. Los apartados se hacen tocando el apunte en la bitácora.' }),
          h('div', { class: 'barra-comparar' },
            h('button', { class: 'boton', disabled: !elegidas.length, text: elegidas.length ? `⚖️ Comparar (${elegidas.length})` : '⚖️ Marca las fotos que quieras comparar', onclick: () => abrirComparar(receta, pintar, amb) }),
            elegidas.length > 0 && h('button', { class: 'boton secundario', text: `📁 Añadir a un álbum (${elegidas.length})`, onclick: aUnAlbum }),
            enAlbum > 0 && h('button', { class: 'boton secundario', text: `Quitar del álbum (${enAlbum})`, onclick: quitarDelAlbum }),
            elegidas.length > 0 && h('button', { class: 'boton discreto', text: 'Desmarcar todas', onclick: () => { ponerElegidas([]); pintar(); } }))]
        : h('p', { class: 'nota', text: 'Aún no hay fotos en esta receta. Se añaden tocando un grupo («📷 Nota o fotos», «🔬 Muestra para analizar»…) o al terminar una fase.' }));
    };
    // (si llega algo del PC mientras se escriben las notas del álbum, no se repinta: se perdería)
    alLlegarCambios(cuerpo, () => { if (!(cuerpo.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA')) pintar(); });
    pintar();
  };

  // Las fotos elegidas, una al lado de otra (1, 2 o 3 por fila). Se mueven arrastrando ✥ o con ◀ ▶
  const abrirComparar = (receta, alVolver, amb = ambitoActual(receta)) => {
    const { cuerpo, panel } = abrirPanel('⚖️ Comparar', null, alVolver);
    // La barra del título se va con la página al deslizar (lo pidió el usuario: con el móvil en
    // horizontal ocupaba mucho y no dejaba ver las fotos)
    panel.classList.add('desliza');
    const pintar = () => {
      const columnas = leer('quimica.columnas', 2);
      const c = leerCuaderno();
      const colores = coloresDe(c, receta, amb);
      const ids = K.comparadas(c, amb);
      const entradaDe = new Map(K.fotosDe(c, amb).map((f) => [f.id, f.entrada]));
      const guardarOrden = (lista) => cambiarCuaderno((d) => { d.comparar[K.claveComparar(amb)] = lista; });
      const mover = (i, d) => {
        const l = [...ids];
        [l[i], l[i + d]] = [l[i + d], l[i]];
        guardarOrden(l);
        pintar();
      };
      const rejilla = h('div', { class: 'comparar', style: `--columnas: ${columnas}` });
      // Arrastrar con el asa: la tarjeta se va poniendo donde está el dedo; al soltar se guarda el orden.
      // Se escucha en todo el documento: al mover la tarjeta de sitio, el asa perdería el dedo
      const arrastrable = (t, asa) => asa.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const dedo = ev.pointerId;
        t.classList.add('arrastrando');
        const alMover = (m) => {
          if (m.pointerId !== dedo) return;
          const bajo = document.elementFromPoint(m.clientX, m.clientY);
          const otra = bajo && bajo.closest('.comp-tarjeta');
          if (!otra || otra === t || otra.parentNode !== rejilla) return;
          const hijos = [...rejilla.children];
          rejilla.insertBefore(t, hijos.indexOf(otra) > hijos.indexOf(t) ? otra.nextSibling : otra);
        };
        let soltado = false;
        const soltar = (m) => {
          if (soltado || m.pointerId !== dedo) return;
          soltado = true;
          document.removeEventListener('pointermove', alMover);
          document.removeEventListener('pointerup', soltar);
          document.removeEventListener('pointercancel', soltar);
          const l = [...rejilla.children].map((x) => x.dataset.id);
          if (l.join() !== ids.join()) guardarOrden(l);
          pintar();
        };
        document.addEventListener('pointermove', alMover);
        document.addEventListener('pointerup', soltar);
        document.addEventListener('pointercancel', soltar);
      });
      const zooms = new Map(); // id → { fijar } de cada foto
      const juntas = () => leer('quimica.zoom-junto', true);
      const tarjeta = (id, i) => {
        const e = entradaDe.get(id);
        const asa = h('button', { class: 'asa', 'aria-label': 'Mover: arrastra', text: '✥' });
        // (la vista de 2000 px; al ampliar, la entera a toda su resolución: versión 126)
        const img = fotoImg(id, 'vista');
        const marco = h('div', { class: 'comp-marco' }, img);
        const op = { entera: () => urlDe(id) };
        window.Fotos.leer(id).then((f) => { if (f) { op.ancho = f.ancho; op.alto = f.alto; } }).catch(() => {});
        const color = colores.get(e.grupoId);
        const t = h('div', { class: `comp-tarjeta${color ? ' con-color' : ''}`, style: color ? `--gc: ${color}` : null, 'data-id': id },
          h('div', { class: 'comp-barra' }, asa,
            h('button', { 'aria-label': 'Mover antes', text: '◀', disabled: i === 0, onclick: () => mover(i, -1) }),
            h('button', { 'aria-label': 'Mover después', text: '▶', disabled: i === ids.length - 1, onclick: () => mover(i, 1) }),
            h('button', { 'aria-label': 'Ver en grande', text: '⤢', onclick: () => verFoto(id, pintar) }),
            h('button', { class: 'quitar', 'aria-label': 'Quitar de la comparación', text: '✕', onclick: () => { guardarOrden(ids.filter((x) => x !== id)); pintar(); } })),
          marco,
          pieFoto(c, id, e, color));
        // Se amplía ahí mismo con los dedos (lo pidió el usuario); con «🔗 Ampliar todas igual», las
        // demás hacen lo mismo (la misma zona en todas)
        const z = hacerZoom(marco, img, (estado) => { if (juntas()) for (const [otro, oz] of zooms) if (otro !== id) oz.fijar(estado); }, false, op);
        zooms.set(id, z);
        arrastrable(t, asa);
        return t;
      };
      poner(rejilla, ids.map(tarjeta));
      poner(cuerpo,
        h('div', { class: 'chips' }, h('span', { class: 'chips-rotulo', text: 'Por fila:' }),
          [1, 2, 3].map((n) => h('button', { class: 'chip', 'aria-pressed': String(columnas === n), text: String(n), onclick: () => { guardar('quimica.columnas', n); pintar(); } })),
          ids.length > 1 && h('button', { class: 'chip', 'aria-pressed': String(juntas()), text: '🔗 Ampliar todas igual', onclick: (ev) => { guardar('quimica.zoom-junto', !juntas()); ev.currentTarget.setAttribute('aria-pressed', String(juntas())); } })),
        ids.length
          ? [rejilla, h('p', { class: 'nota', text: 'Amplía con dos dedos (o tocando) y mueve con uno; con «🔗 Ampliar todas igual», todas a la vez. ⤢ la abre en grande. Arrastra ✥ (o usa ◀ ▶) para cambiarlas de sitio.' })]
          : h('p', { class: 'nota', text: 'No hay ninguna foto elegida. Vuelve atrás y marca las que quieras comparar.' }),
        ids.length > 0 && h('button', { class: 'boton', text: '📝 Apuntar en la bitácora lo que veo', onclick: () => apuntarComparacion(ids) }),
        h('button', { class: 'boton secundario', text: '＋ Elegir otras fotos', onclick: atras }));
    };
    // Lo que se ve al comparar, a la bitácora (lo pidió el usuario: «así guardo registro de lo que
    // veo cuando lo comparo»): una entrada «comparar» con la nota y las fotos comparadas, enlazadas
    // (comparadas: sus ids; no son suyas, así que al borrar la entrada no se borran), y de quién son
    const apuntarComparacion = async (ids) => {
      const entradaDe = new Map(K.fotosDe(leerCuaderno(), amb).map((f) => [f.id, f.entrada]));
      const de = [...new Set(ids.map((id) => entradaDe.get(id)).filter(Boolean).map((e) => e.grupo || e.disolucion).filter(Boolean))];
      const r = await pedirApunte({ texto: `⚖️ Lo que ves al comparar ${ids.length} ${ids.length === 1 ? 'foto' : 'fotos'}`,
        antes: [miniaturas(ids), de.length > 0 && h('p', { class: 'dialogo-detalle', text: `De: ${de.join(', ')}` })] });
      if (!r) return;
      if (!r.nota && !r.fotos.length) { avisar('Escribe lo que ves para apuntarlo'); return; }
      apuntar({ tipo: 'comparar', comparadas: [...ids], de, grupoId: null, grupo: null, recetaId: receta.id, ...K.marcaDe(amb), receta: receta.nombre, nota: r.nota, fotos: r.fotos });
      vibrar(30);
      avisar('📓 Apuntado en la bitácora');
    };
    alLlegarCambios(cuerpo, () => pintar());
    pintar();
  };

  // ─── Conexión con el PC (pc/servidor.js) ───
  // El PC guarda una copia de todo y hace de punto de encuentro: el móvil (por la wifi o por el
  // cable) y el navegador del PC se sincronizan con él. Se pasa: recetas, cuaderno y fotos. NO se
  // pasan la clave de Gemini, los pasos marcados, los ciclos, los cronómetros ni la calculadora.
  //   quimica.sincro  el sello: qué ha cambiado aquí y cuándo (Sincro.sellar, sincronizar.js)
  //   quimica.pc      en el móvil: { direccion: '192.168.1.35:8765' o 'localhost:8765', codigo }
  //   quimica.antes-de-sincronizar  cómo estaba todo antes de la última sincronización que trajo cambios
  const S = window.Sincro;
  // En el navegador del PC la app la sirve el propio programa: se habla con él sin código
  const enElPC = !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    && ['localhost', '127.0.0.1'].includes(location.hostname) && location.protocol === 'http:';
  // La app abierta desde la dirección del PC por la wifi (http://192.168.x.x:8765, la que sirve el
  // programa Química PC): lo que se escanea con el QR del PC. Aquí no hay bloqueo de «https → http», así
  // que el iPhone también se conecta (versión 97). Se conecta sola con el código que va en el enlace
  // (#c=123456); sin él, se pide en Ajustes con la dirección ya puesta
  const desdeElPC = !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    && location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname);
  if (desdeElPC) {
    const m = /[#&]c=(\d{6})(?:&|$)/.exec(location.hash);
    // (el enlace con el código se deja en la barra: si se añade a la pantalla de inicio, entra conectada)
    if (m) guardar('quimica.pc', { direccion: location.host, codigo: m[1] });
  }
  // La app abierta como página web en internet (GitHub Pages: el iPhone, o un Android sin la APK).
  // Ahí no se puede hablar con Química PC (el PC va por http y la página por https: Safari no deja)
  const enLaWeb = !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    && location.protocol === 'https:';
  let pcVisto = false; // en el navegador del PC: si de verdad es el programa (y no otra cosa en localhost)
  const conexion = () => {
    if (enElPC && pcVisto) return { base: '', codigo: '' };
    // (en la web no se puede pedir nada al PC directamente: va por la ventana puente, al tocar un botón)
    if (enLaWeb) return null;
    const c = leer('quimica.pc', null);
    return c && c.direccion ? { base: `http://${c.direccion}`, codigo: c.codigo || '' } : null;
  };
  const pedirPC = async (base, codigo, ruta, opciones = {}) => {
    const r = await fetch(`${base}${ruta}`, { ...opciones, headers: { 'x-codigo': codigo, ...(opciones.headers || {}) }, signal: AbortSignal.timeout(opciones.espera || 15000) });
    if (r.status === 403) throw new Error('El código no es el del PC. Si en el PC usas otro usuario, cambia al de este móvil (o vuelve a conectar con el QR del usuario que quieras)');
    // (el PC bloquea un rato tras 5 códigos equivocados seguidos: versión 96)
    if (r.status === 429) throw new Error(`Demasiados intentos con un código equivocado: el PC no contesta durante ${r.headers.get('Retry-After') || 60} s. Revisa el código`);
    if (!r.ok) throw new Error(`El PC ha contestado ${r.status}`);
    return r;
  };
  const datosLocales = () => {
    const c = leerCuaderno();
    const porId = (lista) => Object.fromEntries(lista.map((x) => [x.id, x]));
    return { recetas: porId(recetas), grupos: porId(c.grupos), entradas: porId(c.entradas), disoluciones: porId(c.disoluciones), carpetas: porId(c.carpetas), cuadernos: porId(c.cuadernos), albumes: porId(c.albumes), informes: porId(c.informes || []), titulos: { ...c.titulos }, comparar: { ...c.comparar } };
  };
  // Las fotos que usa algo: las de los apuntes y la de cada cuaderno. Las demás son de cosas que se
  // borraron (versión 124: no se pasan al PC ni se traen de él, y se pueden quitar en Ajustes)
  const fotosUsadas = (c = leerCuaderno()) => {
    const s = new Set();
    for (const e of c.entradas) for (const f of e.fotos || []) s.add(f);
    for (const k of c.cuadernos) if (k.foto) s.add(k.foto);
    // (y las de los informes guardados: aunque se borre su apunte, el informe las sigue enseñando)
    for (const x of c.informes || []) for (const b of x.bloques || []) for (const p of b.paneles || []) s.add(p.id);
    return s;
  };
  // La hora del PC (versión 126): al juntar, «gana lo más nuevo» de cada cosa, y eso se decide con la
  // hora de cada aparato. Si el móvil y el PC no tienen la misma hora, un cambio podía perderse. Ahora
  // los cambios se sellan con la hora del PC (quimica.pc-desfase: cuánto va el PC por delante, en ms;
  // se mide al hablar con él). Sin PC, la de aquí
  const ahoraPC = () => { const d = Number(leer('quimica.pc-desfase', 0)); return Date.now() + (isFinite(d) && Math.abs(d) < 365 * 864e5 ? d : 0); };
  const medirDesfase = (antes, despues, ahoraDelPC) => {
    if (typeof ahoraDelPC !== 'number' || despues - antes > 10000) return; // (si tardó mucho, no es fiable)
    guardar('quimica.pc-desfase', Math.round(ahoraDelPC - (antes + despues) / 2));
  };
  const sellar = () => {
    const meta = S.sellar(leer('quimica.sincro', null), datosLocales(), ahoraPC());
    guardar('quimica.sincro', meta);
    return meta;
  };
  // Las pantallas abiertas que quieren enterarse de lo que llega del PC: { el, fn(colecciones cambiadas) }
  let oyentes = [];
  const alLlegarCambios = (el, fn) => { oyentes.push({ el, fn }); };
  // Se queda con lo juntado. Las recetas se cambian "en su sitio" (el mismo objeto), para que una
  // pantalla que tenga una abierta siga apuntando a ella
  const quedarse = (estado) => {
    // (las huellas, ya: las recetas se cambian en su sitio, y si se guardaran los objetos, lo de
    // "antes" cambiaría también y no se vería ningún cambio; pasó: no se repintaba la receta abierta)
    const datosAntes = datosLocales();
    const antes = Object.fromEntries(Object.keys(datosAntes).map((c) => [c, S.huella(datosAntes[c])]));
    try { localStorage.setItem('quimica.antes-de-sincronizar', JSON.stringify({ fecha: Date.now(), recetas, cuaderno: leerCuaderno() })); } catch { /* sin sitio: se sigue */ }
    const { datos, meta } = S.aplicar(estado);
    const valida = (r) => r && r.id && Array.isArray(r.pasos) && Array.isArray(r.datos) && Array.isArray(r.calculos);
    const quedan = [];
    for (const r of recetas) {
      const nueva = datos.recetas[r.id];
      if (!valida(nueva)) continue;
      if (S.huella(nueva) !== S.huella(r)) { for (const k of Object.keys(r)) delete r[k]; Object.assign(r, nueva); }
      quedan.push(r);
    }
    const nuevas = Object.values(datos.recetas).filter((r) => valida(r) && !recetas.some((x) => x.id === r.id));
    recetas = [...nuevas, ...quedan];
    guardar('quimica.recetas', recetas);
    guardar('quimica.cuaderno', { grupos: Object.values(datos.grupos), entradas: Object.values(datos.entradas), disoluciones: Object.values(datos.disoluciones), carpetas: Object.values(datos.carpetas || {}), cuadernos: Object.values(datos.cuadernos || {}), albumes: Object.values(datos.albumes || {}), informes: Object.values(datos.informes || {}), titulos: datos.titulos, comparar: datos.comparar });
    guardar('quimica.sincro', meta);
    const despues = datosLocales();
    return S.COLECCIONES.filter((c) => antes[c] !== S.huella(despues[c]));
  };

  // El nombre del usuario del PC con el que está conectado este usuario del móvil (para enseñarlo en Ajustes)
  const guardarUsuarioDelPC = (nombre) => {
    const c = leer('quimica.pc', null);
    if (c && typeof nombre === 'string' && c.usuario !== nombre && !(enElPC && pcVisto)) guardar('quimica.pc', { ...c, usuario: nombre });
  };
  let sincronizando = false;
  let otraVez = false;
  let pcAlDia = null; // { base, fecha }: el programa del PC sabe guardar todas las colecciones de aquí
  let ultimaSincro = null; // { base, huella, version, arranque, fecha }: la última sincronización entera (versión 124)
  let avisadoViejo = false;
  let relojSincro = null;
  let estadoPC = null; // { ok, fecha, error?, cambios?, fotos? }: lo que enseña Ajustes
  let alCambiarEstadoPC = null;
  const sincronizar = async ({ avisarFallo = false } = {}) => {
    const pc = conexion();
    if (!pc) return;
    if (sincronizando) { otraVez = true; return; }
    sincronizando = true;
    try {
      // Que el programa del PC sepa guardar todo lo de aquí: uno abierto antes de una versión
      // nueva no conocería lo nuevo (pasó con las disoluciones). Si no, no se sincroniza
      if (!pcAlDia || pcAlDia.base !== pc.base || Date.now() - pcAlDia.fecha > 60000) {
        const antesHola = Date.now();
        const hola = await (await pedirPC(pc.base, pc.codigo, '/api/hola', { espera: 6000 })).json();
        medirDesfase(antesHola, Date.now(), hola.ahora);
        guardarUsuarioDelPC(hola.usuario);
        const sabe = Array.isArray(hola.colecciones) ? hola.colecciones : [];
        const falta = S.COLECCIONES.filter((c) => !sabe.includes(c));
        if (falta.length) throw new Error('Química PC está desactualizado: en el PC, cierra su ventana y vuelve a abrirlo (doble clic en «Quimica PC»). Hasta entonces no se sincroniza, para no perder nada');
        pcAlDia = { base: pc.base, fecha: Date.now() };
      }
      // (versión 124) Si aquí no ha cambiado nada desde la última vez y en el PC tampoco (su «versión»
      // es la misma), no se manda todo: antes iban y venían todos los datos cada 15 s. Cada 2 minutos,
      // o si se pide a mano, se hace entera igual. Un PC viejo (sin /api/version) sincroniza siempre
      const ult = ultimaSincro;
      if (!avisarFallo && ult && ult.base === pc.base && ult.version != null && Date.now() - ult.fecha < 120000
        && S.huella(datosLocales()) === ult.huella) {
        const antesV = Date.now();
        const v = await pedirPC(pc.base, pc.codigo, '/api/version', { espera: 6000 }).then((x) => x.json()).catch(() => null);
        if (v) medirDesfase(antesV, Date.now(), v.ahora);
        if (v && v.version === ult.version && v.arranque === ult.arranque) {
          estadoPC = { ok: true, fecha: Date.now(), cambios: 0, fotos: 0 };
          return;
        }
      }
      const meta = sellar();
      const datos = datosLocales();
      const huellaAntes = S.huella(datos);
      const fotosAqui = await window.Fotos.ids().catch(() => []);
      // (solo las fotos que usa algo: las de lo borrado no se mandan; versión 124)
      const usadasAqui = fotosUsadas();
      const r = await (await pedirPC(pc.base, pc.codigo, '/api/sincronizar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: S.estadoDe(meta, datos), fotos: fotosAqui.filter((id) => usadasAqui.has(id)) }),
      })).json();
      // Si mientras tanto se ha cambiado algo aquí, no se pisa: se vuelve a sincronizar enseguida
      if (S.huella(datosLocales()) !== huellaAntes) { otraVez = true; return; }
      const cambiadas = quedarse(r.estado);
      // (y de las que tiene el PC, solo las que usa algo de lo juntado: FALLO de antes, versión 124 —
      // una foto borrada aquí seguía en el PC y volvía en la siguiente sincronización, sin usarse;
      // en el móvil del usuario había 37 así, 9 MB)
      const usadasDespues = fotosUsadas();
      // Las fotos: las que el PC no tiene, se le mandan; las que tiene y aquí no, se traen
      let fotos = 0;
      for (const id of r.pedir || []) {
        const f = await window.Fotos.leer(id);
        if (!f) continue;
        const info = encodeURIComponent(JSON.stringify({ nombre: f.nombre, ancho: f.ancho, alto: f.alto, fecha: f.fecha }));
        await pedirPC(pc.base, pc.codigo, `/api/fotos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-foto': info }, body: f.blob, espera: 60000 });
        fotos++;
      }
      for (const id of (r.tiene || []).filter((x) => !fotosAqui.includes(x) && usadasDespues.has(x))) {
        const resp = await pedirPC(pc.base, pc.codigo, `/api/fotos/${id}`, { espera: 60000 });
        let info = {};
        try { info = JSON.parse(decodeURIComponent(resp.headers.get('x-foto') || '%7B%7D')); } catch { /* sin datos */ }
        await window.Fotos.guardar({ id, blob: await resp.blob(), nombre: info.nombre || 'foto', ancho: info.ancho, alto: info.alto, fecha: info.fecha || Date.now() });
        fotos++;
      }
      estadoPC = { ok: true, fecha: Date.now(), cambios: cambiadas.length, fotos };
      // (para la próxima: si nada cambia aquí ni allí, basta con preguntar la versión)
      // (si se mandaron fotos, la versión del PC ya habrá subido: la próxima vez se hace entera una vez más)
      ultimaSincro = r.version != null ? { base: pc.base, huella: S.huella(datosLocales()), version: r.version, arranque: r.arranque, fecha: Date.now() } : null;
      if (cambiadas.length) {
        pintarLista();
        oyentes = oyentes.filter((o) => o.el.isConnected);
        for (const o of oyentes) o.fn(cambiadas);
        avisar(`🔄 Han llegado cambios ${enElPC ? 'del móvil' : 'del PC'}`);
      }
    } catch (e) {
      estadoPC = { ok: false, fecha: Date.now(), error: e.name === 'TimeoutError' || e.name === 'TypeError' ? 'No se encuentra el PC (¿está abierto Química PC y en la misma wifi?)' : e.message };
      // Lo del programa desactualizado se avisa también sin pedirlo (una vez): si no, no se enteraría
      const viejo = /desactualizado/.test(estadoPC.error);
      if (avisarFallo || (viejo && !avisadoViejo)) avisar(`⚠️ ${estadoPC.error}`);
      if (viejo) avisadoViejo = true;
    } finally {
      sincronizando = false;
      if (alCambiarEstadoPC) alCambiarEstadoPC();
      if (otraVez) { otraVez = false; programarSincro(); }
    }
  };
  // Tras un cambio aquí, se sincroniza a los 2 s (si se sigue cambiando, se espera más)
  const programarSincro = () => {
    clearTimeout(relojSincro);
    if (conexion()) relojSincro = setTimeout(() => sincronizar(), 2000);
  };
  // ─── La app de internet (github.io) con Química PC: por una ventana puente (versión 106) ───
  // Lo pidió el usuario: «si fuera usuario de iPhone, quiero usar la app en el móvil y luego conectarme
  // al PC con todo sincronizado». Una página https no puede pedirle nada al PC (http): el navegador lo
  // bloquea. Pero sí puede ABRIR una ventana con una página del PC (www/puente.html, la sirve Química
  // PC) y pasarle mensajes: esa ventana habla con su PC y devuelve lo juntado. Los navegadores solo
  // dejan abrir ventanas al tocar algo, así que en la web se sincroniza A MANO (botón «Sincronizar»).
  //   quimica.pc-ultima     { fecha, huella }: la última vez que salió bien y cómo quedaron los datos
  //   quimica.pc-pendiente  desde cuándo hay cambios aquí sin pasar al PC
  let puenteAbierto = false;
  const pcWeb = () => { const c = enLaWeb ? leer('quimica.pc', null) : null; return c && c.direccion ? c : null; };
  const hayPendiente = () => {
    if (!pcWeb()) return false;
    const u = leer('quimica.pc-ultima', null);
    return !u || u.huella !== S.huella(datosLocales());
  };
  // Los indicadores de arriba (el de la pantalla principal y los de cada panel) y el aviso de los cuadernos
  const chipsWeb = new Set();
  let pendienteAntes = null;
  const pintarChipWeb = (chip) => {
    const pc = pcWeb();
    chip.hidden = !pc;
    const p = hayPendiente();
    chip.classList.toggle('con-movil', !p);
    chip.classList.toggle('sin-movil', p);
    chip.textContent = puenteAbierto ? '💻 sincronizando…' : p ? '💻 pasar al PC' : '💻 al día';
    chip.title = p ? 'Hay cambios sin pasar al PC: toca para sincronizar' : 'Todo está pasado al PC. Toca para sincronizar otra vez';
  };
  const refrescarPendiente = () => {
    for (const c of chipsWeb) { if (!c.isConnected && c.id !== 'b-pc') chipsWeb.delete(c); else pintarChipWeb(c); }
    const p = hayPendiente();
    if (p !== pendienteAntes) { pendienteAntes = p; if (!$('vista-cuadernos').hidden) pintarCuadernos(); }
  };
  const desdeCuando = (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? `desde las ${horaDe(ms)}` : `desde el ${fechaCorta(ms)}`);
  avisoPendientePC = () => {
    if (!hayPendiente()) return null;
    const u = leer('quimica.pc-ultima', null);
    const desde = leer('quimica.pc-pendiente', null);
    return h('button', { class: 'aviso-toca hoy aviso-pc', type: 'button', onclick: () => sincronizarPorPuente() },
      `💻 ${u ? `Tienes cambios sin pasar al PC${desde ? ` (${desdeCuando(desde)})` : ''}` : 'Aún no has pasado tus datos al PC'} · `, h('b', { text: 'Sincronizar' }));
  };
  // Abre la ventana puente y sincroniza. Hay que llamarla AL TOCAR algo (si no, el navegador bloquea la
  // ventana). Devuelve una promesa: true si salió bien
  const sincronizarPorPuente = () => {
    const pc = pcWeb();
    if (!pc) return Promise.resolve(false);
    if (puenteAbierto) { avisar('Ya se está sincronizando…'); return Promise.resolve(false); }
    const origen = `http://${pc.direccion}`;
    // (la ventana, lo primero: si se abre después de esperar a algo, el navegador la bloquea)
    const w = window.open(`${origen}/puente.html`, 'quimica-puente');
    const fallo = (error) => {
      estadoPC = { ok: false, fecha: Date.now(), error };
      avisar(`⚠️ ${error}`);
      return false;
    };
    if (!w) return Promise.resolve(fallo('El navegador no ha dejado abrir la ventana para hablar con el PC. Permite las ventanas emergentes para esta página y vuelve a tocar «Sincronizar».'));
    puenteAbierto = true;
    sincronizando = true;
    estadoPC = null;
    refrescarPendiente();
    if (alCambiarEstadoPC) alCambiarEstadoPC();
    return new Promise((acabar) => {
      let recibido = false; // la ventana ya tiene lo de aquí
      let resultado = false; // y ya ha contestado
      let mensaje = null;
      let huellaAntes = null;
      let reloj = null;
      const empezo = Date.now();
      const fin = (ok) => {
        clearInterval(reloj);
        removeEventListener('message', oir);
        puenteAbierto = false;
        sincronizando = false;
        try { if (!w.closed) w.close(); } catch { /* ya cerrada */ }
        refrescarPendiente();
        if (alCambiarEstadoPC) alCambiarEstadoPC();
        acabar(ok);
      };
      const oir = async (e) => {
        if (e.origin !== origen || !e.data) return;
        if (e.data.tipo === 'quimica-recibido') { recibido = true; return; }
        if (e.data.tipo !== 'quimica-resultado' || resultado) return;
        resultado = true;
        if (!e.data.ok) { fin(fallo(e.data.error || 'No se ha podido sincronizar')); return; }
        try {
          // Si mientras tanto se ha cambiado algo aquí, no se pisa
          if (S.huella(datosLocales()) !== huellaAntes) { fin(fallo('Has cambiado algo mientras se sincronizaba: vuelve a tocar «Sincronizar» para pasarlo también.')); return; }
          const cambiadas = quedarse(e.data.estado);
          let fotos = e.data.enviadas || 0;
          for (const f of e.data.fotos || []) {
            await window.Fotos.guardar({ id: f.id, blob: f.blob, nombre: f.nombre || 'foto', ancho: f.ancho, alto: f.alto, fecha: f.fecha || Date.now() });
            fotos++;
          }
          guardar('quimica.pc-ultima', { fecha: Date.now(), huella: S.huella(datosLocales()) });
          localStorage.removeItem('quimica.pc-pendiente');
          guardarUsuarioDelPC(e.data.usuario);
          if (typeof e.data.desfase === 'number' && isFinite(e.data.desfase)) guardar('quimica.pc-desfase', e.data.desfase);
          estadoPC = { ok: true, fecha: Date.now(), cambios: cambiadas.length, fotos };
          if (cambiadas.length) {
            pintarLista();
            oyentes = oyentes.filter((o) => o.el.isConnected);
            for (const o of oyentes) o.fn(cambiadas);
          }
          avisar(`✅ Sincronizado con el PC${cambiadas.length ? ': han llegado cambios' : ''}${fotos ? ` (${fotos} ${fotos === 1 ? 'foto pasada' : 'fotos pasadas'})` : ''}`);
          fin(true);
        } catch (err) { fin(fallo(`No se ha podido guardar lo que llegó del PC (${(err && err.message) || err})`)); }
      };
      addEventListener('message', oir);
      (async () => {
        try {
          const meta = sellar();
          const datos = datosLocales();
          huellaAntes = S.huella(datos);
          const ids = await window.Fotos.ids().catch(() => []);
          const usadas = fotosUsadas();
          const fotos = [];
          // (solo las que usa algo; tiene: todas las de aquí, para no traer otra vez lo que ya está)
          for (const id of ids.filter((x) => usadas.has(x))) {
            const f = await window.Fotos.leer(id).catch(() => null);
            if (f && f.blob) fotos.push({ id, blob: f.blob, nombre: f.nombre, ancho: f.ancho, alto: f.alto, fecha: f.fecha });
          }
          mensaje = { tipo: 'quimica-sincronizar', codigo: pc.codigo || '', estado: S.estadoDe(meta, datos), fotos, tiene: ids, colecciones: S.COLECCIONES };
        } catch (err) { fin(fallo(`No se han podido preparar los datos (${(err && err.message) || err})`)); }
      })();
      // Lo de aquí se le manda una y otra vez hasta que diga que lo tiene (mientras carga, se pierde)
      reloj = setInterval(() => {
        if (resultado) return;
        if (w.closed) { fin(fallo('Se ha cerrado la ventana antes de acabar. Vuelve a tocar «Sincronizar».')); return; }
        if (!recibido && mensaje) { try { w.postMessage(mensaje, origen); } catch { /* aún cargando */ } }
        if (!recibido && Date.now() - empezo > 20000) fin(fallo('No se encuentra el PC. Mira que Química PC esté abierto en el ordenador y que el móvil esté en la misma wifi.'));
      }, 300);
    });
  };

  alCambiarDatos = () => {
    sellar();
    programarSincro();
    if (pcWeb()) {
      if (!leer('quimica.pc-pendiente', null) && hayPendiente()) guardar('quimica.pc-pendiente', Date.now());
      refrescarPendiente();
    }
  };

  // Comprueba que en esa dirección está Química PC y que el código vale; si sí, la guarda
  const conectarPC = async (direccion, codigo) => {
    const d = direccion.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const conPuerto = /:\d+$/.test(d) ? d : `${d}:8765`;
    let usuarioPC = '';
    try {
      const r = await (await pedirPC(`http://${conPuerto}`, codigo.trim(), '/api/hola', { espera: 6000 })).json();
      if (r.app !== 'quimica-pc') throw new Error('Ahí no está Química PC');
      usuarioPC = typeof r.usuario === 'string' ? r.usuario : '';
    } catch (e) {
      avisar(e.name === 'TimeoutError' || e.name === 'TypeError'
        ? 'No se encuentra el PC. Mira que Química PC esté abierto, que los dos estéis en la misma wifi y la dirección.'
        : e.message);
      return false;
    }
    // Si este usuario ya tiene datos y es una conexión nueva, que sepa con qué usuario del PC se unen
    const ya = leer('quimica.pc', null);
    if (!(ya && ya.direccion === conPuerto) && !(enElPC && pcVisto) && !await confirmarUnion(usuarioPC)) return false;
    guardar('quimica.pc', { direccion: conPuerto, codigo: codigo.trim(), usuario: usuarioPC });
    await sincronizar({ avisarFallo: true });
    return true;
  };

  // ─── Usuarios del móvil (versión 112, el usuario: «que ambos tengan usuarios, tanto móvil como app») ───
  // Cada usuario tiene lo suyo: recetas, cuaderno, fotos, pasos marcados y su conexión con el PC. Lo que es
  // del aparato (la clave de Gemini, cómo se ve) lo comparten. Cómo: el usuario activo vive en las claves de
  // siempre (`quimica.recetas`…) y los demás, guardados en `quimica.u.<id>`; al cambiar se intercambian y se
  // recarga la página. Las fotos van en una base de IndexedDB por usuario (fotos.js). El registro:
  // `quimica.usuarios` = { activo, lista: [{ id, nombre }] }; el primero, `u1`, sigue con `quimica-fotos`.
  const DEL_USUARIO = ['quimica.recetas', 'quimica.cuaderno', 'quimica.sincro', 'quimica.hechos', 'quimica.ciclos', 'quimica.donde',
    'quimica.pagina-receta', 'quimica.cuaderno-actual', 'quimica.calculadora', 'quimica.preparan', 'quimica.cronometros',
    'quimica.pc', 'quimica.pc-ultima', 'quimica.pc-pendiente', 'quimica.pc-datos-id', 'quimica.pc-desfase', 'quimica.borrador-receta', 'quimica.borrador',
    'quimica.antes-de-sincronizar', 'quimica.antes-de-recuperar', 'quimica.antes-de-cambiar-de-usuario'];
  const leerUsuarios = () => {
    const r = leer('quimica.usuarios', null);
    const lista = r && Array.isArray(r.lista)
      ? r.lista.filter((u) => u && /^[a-z0-9]{2,20}$/i.test(u.id) && typeof u.nombre === 'string' && u.nombre.trim()).map((u) => ({ id: u.id, nombre: u.nombre.trim().slice(0, 40) }))
      : [];
    if (!lista.length) lista.push({ id: 'u1', nombre: 'Mi usuario' });
    return { activo: lista.some((u) => u.id === (r && r.activo)) ? r.activo : lista[0].id, lista };
  };
  const guardarUsuarios = (u) => guardar('quimica.usuarios', u);
  const usuarioDeAhora = () => { const u = leerUsuarios(); return u.lista.find((x) => x.id === u.activo); };
  const baseDeFotos = (id) => (id === 'u1' ? 'quimica-fotos' : `quimica-fotos-${id}`);
  // Lo de un usuario que no es el activo (para enseñar cuánto tiene)
  const resumenDe = (id) => {
    try {
      const b = JSON.parse(localStorage.getItem(`quimica.u.${id}`) || '{}');
      const rs = JSON.parse(b['quimica.recetas'] || '[]');
      const c = JSON.parse(b['quimica.cuaderno'] || '{}');
      const n = (Array.isArray(rs) ? rs.length : 0);
      const a = Array.isArray(c.entradas) ? c.entradas.length : 0;
      return n || a ? `${n} ${n === 1 ? 'receta' : 'recetas'} · ${a} ${a === 1 ? 'apunte' : 'apuntes'}` : 'vacío';
    } catch { return ''; }
  };
  // Cambia de usuario: guarda lo del de ahora en su cajón, saca lo del otro y recarga
  const pasarAUsuario = (id) => {
    const u = leerUsuarios();
    if (id === u.activo || !u.lista.some((x) => x.id === id)) return false;
    const dep = {};
    for (const k of DEL_USUARIO) { const v = localStorage.getItem(k); if (v !== null) dep[k] = v; }
    try { localStorage.setItem(`quimica.u.${u.activo}`, JSON.stringify(dep)); } catch { avisar('No hay sitio en el móvil para cambiar de usuario'); return false; }
    for (const k of DEL_USUARIO) localStorage.removeItem(k);
    let otro = {};
    try { otro = JSON.parse(localStorage.getItem(`quimica.u.${id}`) || '{}') || {}; } catch { otro = {}; }
    for (const [k, v] of Object.entries(otro)) if (DEL_USUARIO.includes(k) && typeof v === 'string') localStorage.setItem(k, v);
    localStorage.removeItem(`quimica.u.${id}`);
    guardarUsuarios({ activo: id, lista: u.lista });
    location.reload();
    return true;
  };
  // Si este usuario ya tiene datos y se va a conectar con un PC, que lo sepa: se unirán con los del usuario del PC
  const confirmarUnion = async (usuarioPC) => {
    const c = leerCuaderno();
    if (!recetas.length && !c.grupos.length && !c.entradas.length) return true;
    const yo = usuarioDeAhora().nombre;
    return preguntar({ texto: 'Este usuario ya tiene datos',
      detalle: `«${yo}» tiene ${recetas.length} ${recetas.length === 1 ? 'receta' : 'recetas'} y ${c.entradas.length} ${c.entradas.length === 1 ? 'apunte' : 'apuntes'} en este móvil. Al conectar se unirán con los ${usuarioPC ? `del usuario «${usuarioPC}» del PC` : 'del usuario que esté activo en el PC'}: cada lado recibe lo del otro. Si no es el que quieres, cambia de usuario antes (aquí o en el PC).`,
      si: 'Unir', no: 'Cancelar' });
  };
  const abrirUsuariosMovil = () => {
    const { cuerpo } = abrirPanel('👤 Usuarios de este móvil');
    const nombrar = async (texto, valor) => {
      const n = await preguntar({ texto, campo: { value: valor || '', placeholder: 'Nombre', 'aria-label': 'Nombre del usuario', maxlength: 40 }, si: 'Guardar', no: 'Cancelar' });
      return typeof n === 'string' && n.trim() ? n.trim().slice(0, 40) : null;
    };
    const pintar = () => {
      const u = leerUsuarios();
      poner(cuerpo,
        h('p', { class: 'nota', text: 'Cada usuario tiene sus recetas, su cuaderno, sus fotos y su conexión con el PC. La clave de Gemini es del móvil: la usan todos. Al cambiar, la app se recarga. Nada se borra.' }),
        u.lista.map((x) => h('div', { class: 'caja' },
          h('p', {}, h('b', { text: `${x.id === u.activo ? '✅ ' : ''}${x.nombre}` }), x.id === u.activo ? ' · el que usas' : ''),
          h('p', { class: 'nota', text: x.id === u.activo ? `${recetas.length} ${recetas.length === 1 ? 'receta' : 'recetas'} · ${leerCuaderno().entradas.length} apuntes` : resumenDe(x.id) }),
          x.id !== u.activo && h('button', { class: 'boton', type: 'button', text: 'Usar este usuario', onclick: async () => {
            const enMarcha = leer('quimica.cronometros', []);
            if (Array.isArray(enMarcha) && enMarcha.length && !await preguntar({ texto: 'Hay cronómetros en marcha', detalle: 'Seguirán sonando, pero no los verás hasta que vuelvas a este usuario.', si: 'Cambiar igualmente', no: 'Cancelar' })) return;
            await sincronizar(); // lo que falte, al PC, antes de irse (en la web solo se pasa a mano)
            pasarAUsuario(x.id);
          } }),
          h('button', { class: 'boton discreto', type: 'button', text: '✏️ Cambiar el nombre', onclick: async () => {
            const n = await nombrar('Nombre del usuario', x.nombre);
            if (!n) return;
            const v = leerUsuarios();
            if (v.lista.some((y) => y.id !== x.id && y.nombre.toLowerCase() === n.toLowerCase())) { avisar(`Ya hay un usuario que se llama «${n}»`); return; }
            guardarUsuarios({ activo: v.activo, lista: v.lista.map((y) => (y.id === x.id ? { ...y, nombre: n } : y)) });
            pintar();
          } }),
          x.id !== u.activo && h('button', { class: 'boton discreto', type: 'button', text: '🗑️ Quitar y borrar sus datos de este móvil', onclick: async () => {
            if (!await preguntar({ texto: `¿Quitar a «${x.nombre}»?`, detalle: `Se borran de ESTE móvil sus recetas, su cuaderno y sus fotos (${resumenDe(x.id)}). Si están en el PC, allí se quedan. Esto no se puede deshacer.`, si: 'Borrar', no: 'Cancelar', peligro: true })) return;
            localStorage.removeItem(`quimica.u.${x.id}`);
            try { indexedDB.deleteDatabase(baseDeFotos(x.id)); } catch { /* sin fotos */ }
            const v = leerUsuarios();
            guardarUsuarios({ activo: v.activo, lista: v.lista.filter((y) => y.id !== x.id) });
            pintar();
          } }))),
        h('button', { class: 'boton', type: 'button', text: '＋ Nuevo usuario', onclick: async () => {
          const n = await nombrar('Nombre del usuario nuevo', '');
          if (!n) return;
          const v = leerUsuarios();
          if (v.lista.some((y) => y.nombre.toLowerCase() === n.toLowerCase())) { avisar(`Ya hay un usuario que se llama «${n}»`); return; }
          let id;
          do { id = `u${Math.random().toString(36).slice(2, 7)}`; } while (v.lista.some((y) => y.id === id) || id === 'u1');
          guardarUsuarios({ activo: v.activo, lista: [...v.lista, { id, nombre: n }] });
          await sincronizar();
          pasarAUsuario(id);
        } }));
    };
    pintar();
  };

  // ─── Usuarios en la app del PC (versión 111) ───
  // La pantalla del PC guarda su propia copia de los datos (como un móvil). Si la carpeta del programa es
  // otra (cambió de usuario, o la vaciaron), esa copia NO se le puede pasar: era del usuario de antes.
  // `quimica.pc-datos-id` es el id de la carpeta con la que esta pantalla estaba sincronizada.
  // Se vacía sin pasar por alCambiarDatos (que apuntaría «borrados» y los mandaría al programa)
  const vaciarEstaPantalla = async () => {
    // Lo de ahora, por si acaso (sin fotos: no caben en localStorage)
    try { localStorage.setItem('quimica.antes-de-cambiar-de-usuario', JSON.stringify({ fecha: Date.now(), recetas, cuaderno: leerCuaderno() })); } catch { /* sin sitio */ }
    recetas = [];
    guardar('quimica.recetas', recetas);
    guardar('quimica.cuaderno', K.limpiar({}));
    localStorage.removeItem('quimica.sincro');
    for (const id of await window.Fotos.ids().catch(() => [])) await window.Fotos.borrar(id).catch(() => {});
    pcAlDia = null;
    pintarLista();
    pintarCuadernos();
  };
  let preguntandoCarpeta = false;
  let carpetaYaPreguntada = null;
  // hola: lo que dice /api/hola. Si es otra carpeta que la de esta pantalla, pregunta qué hacer
  const revisarCarpeta = async (hola) => {
    if (!enElPC || !pcVisto || !hola || !hola.id || preguntandoCarpeta || carpetaYaPreguntada === hola.id) return;
    const guardado = leer('quimica.pc-datos-id', null);
    if (!guardado) { guardar('quimica.pc-datos-id', hola.id); return; }
    if (guardado === hola.id) return;
    preguntandoCarpeta = true;
    try {
      const r = await preguntar({ texto: 'Esta carpeta de datos es otra',
        detalle: `Esta pantalla estaba con otros datos (${hola.usuario ? `ahora el usuario es «${hola.usuario}»` : 'la carpeta ha cambiado, o la han vaciado'}). ¿Qué hago con lo que tiene guardado?`,
        si: 'Usar solo lo de la carpeta', otro: 'Pasar lo de esta pantalla a la carpeta', no: 'Ahora no' });
      if (r === true) { await vaciarEstaPantalla(); guardar('quimica.pc-datos-id', hola.id); await sincronizar({ avisarFallo: true }); }
      else if (r === 'otro') { guardar('quimica.pc-datos-id', hola.id); await sincronizar({ avisarFallo: true }); }
      else carpetaYaPreguntada = hola.id; // «Ahora no»: no se vuelve a preguntar hasta que se abra de nuevo
    } finally { preguntandoCarpeta = false; }
  };
  // El panel de usuarios. alCambiar: para que Ajustes se repinte (código y QR nuevos)
  const abrirUsuarios = (alCambiar) => {
    const { cuerpo } = abrirPanel('👤 Usuarios');
    const pedir = async (datos) => {
      try {
        const resp = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
        const j = await resp.json();
        if (!resp.ok) { avisar(j.error || 'No se ha podido'); return null; }
        return j;
      } catch { avisar('No se encuentra el programa Química PC'); return null; }
    };
    // Después de pasar a otro usuario: esta pantalla suelta lo del anterior y trae lo de este
    const yaCambiado = async (j) => {
      await vaciarEstaPantalla();
      guardar('quimica.pc-datos-id', j.id);
      await sincronizar({ avisarFallo: true });
      avisar(`👤 Ahora usas «${j.usuario}». Los móviles tienen que conectarse con el código de este usuario.`);
      alCambiar();
      pintar();
    };
    const pintar = async () => {
      let hola;
      try { hola = await (await pedirPC('', '', '/api/hola')).json(); } catch { poner(cuerpo, h('p', { class: 'nota', text: 'No se encuentra el programa Química PC.' })); return; }
      const nombrar = async (texto, valor) => {
        const n = await preguntar({ texto, campo: { value: valor || '', placeholder: 'Nombre', 'aria-label': 'Nombre del usuario', maxlength: 40 }, si: 'Guardar', no: 'Cancelar' });
        return typeof n === 'string' && n.trim() ? n.trim() : null;
      };
      poner(cuerpo,
        h('p', { class: 'nota', text: 'Cada usuario tiene sus recetas, su cuaderno, sus fotos y su código. Solo uno a la vez. Al cambiar, esta pantalla pasa a mostrar los datos del otro y los móviles tienen que conectarse con su código. Nada se borra.' }),
        (hola.usuarios || []).map((u) => h('div', { class: 'caja' },
          h('p', {}, h('b', { text: `${u.activo ? '✅ ' : ''}${u.nombre}` }), u.activo ? ' · el que usas' : ''),
          h('p', { class: 'ruta-datos', text: u.carpeta }),
          !u.activo && h('button', { class: 'boton', type: 'button', text: 'Usar este usuario', onclick: async () => {
            if (!await preguntar({ texto: `¿Cambiar a «${u.nombre}»?`, detalle: 'Esta pantalla pasará a mostrar sus recetas, cuaderno y fotos. Lo del usuario de ahora no se borra, queda en su carpeta. Los móviles conectados con el código de ahora tendrán que conectarse con el de este usuario.', si: 'Cambiar', no: 'Cancelar' })) return;
            await sincronizar(); // lo que falte por pasar, a la carpeta de ahora
            const j = await pedir({ accion: 'cambiar', carpeta: u.carpeta });
            if (j) await yaCambiado(j);
          } }),
          h('button', { class: 'boton discreto', type: 'button', text: '✏️ Cambiar el nombre', onclick: async () => {
            const n = await nombrar('Nombre del usuario', u.nombre);
            if (n && await pedir({ accion: 'renombrar', carpeta: u.carpeta, nombre: n })) { alCambiar(); pintar(); }
          } }),
          !u.activo && h('button', { class: 'boton discreto', type: 'button', text: '🗑️ Quitar de la lista (no borra sus datos)', onclick: async () => {
            if (!await preguntar({ texto: `¿Quitar a «${u.nombre}» de la lista?`, detalle: `Sus datos NO se borran: se quedan en ${u.carpeta}. Se puede volver a añadir con «Añadir un usuario que ya tengo».`, si: 'Quitar', no: 'Cancelar' })) return;
            if (await pedir({ accion: 'quitar', carpeta: u.carpeta })) pintar();
          } }))),
        h('button', { class: 'boton', type: 'button', text: '＋ Nuevo usuario', onclick: async () => {
          const n = await nombrar('Nombre del usuario nuevo', '');
          if (!n) return;
          await sincronizar();
          const j = await pedir({ accion: 'nuevo', nombre: n });
          if (j) await yaCambiado(j);
        } }),
        h('button', { class: 'boton secundario', type: 'button', text: '📂 Añadir un usuario que ya tengo…', onclick: async () => {
          let datos = { accion: 'anadir', elegir: true };
          if (!hola.dialogoCarpeta) {
            const ruta = await preguntar({ texto: '📂 Carpeta con sus datos', detalle: 'Escribe la ruta completa de la carpeta que ya tiene los datos (la que tiene datos.json).',
              campo: { placeholder: '/ruta/completa/de/la/carpeta', 'aria-label': 'Carpeta con sus datos', autocapitalize: 'off' }, si: 'Añadir', no: 'Cancelar' });
            if (!ruta || !ruta.trim()) return;
            datos = { accion: 'anadir', carpeta: ruta.trim() };
          } else {
            avisar('Se ha abierto el cuadro de carpetas en este PC (si no lo ves, puede estar detrás del navegador)');
          }
          await sincronizar();
          const j = await pedir(datos);
          if (!j) return;
          if (j.cancelado) { avisar('No se ha cambiado nada'); return; }
          await yaCambiado(j);
        } }));
    };
    pintar();
  };

  // ─── Escanear el QR de Química PC con la cámara de la app (versión 98, lo pidió el usuario) ───
  // Pide la cámara (el permiso lo pide Capacitor la primera vez), lee cada fotograma con jsQR
  // (www/vendor/jsQR.js, se carga solo aquí) y, si el QR es el enlace de Química PC de la red de casa
  // (Sincro.enlaceDePC), se conecta. No se guarda ninguna imagen. alConectar: para repintar Ajustes
  const escanearQR = async (alConectar) => {
    const video = h('video', { class: 'escaner-video', playsinline: true, muted: true, autoplay: true });
    const estado = h('p', { class: 'escaner-estado', text: 'Apunta la cámara al código QR de la pantalla del PC' });
    const lienzo = document.createElement('canvas');
    let flujo = null;
    let vivo = true;
    const parar = () => { vivo = false; if (flujo) flujo.getTracks().forEach((t) => t.stop()); };
    const { cuerpo } = abrirPanel('📷 Escanear el QR', null, parar);
    poner(cuerpo, h('div', { class: 'escaner' }, video, estado),
      h('p', { class: 'nota', text: 'En el PC: Química PC abierto → en el navegador, ⚙️ Ajustes → sale el código QR. Los dos, en la misma wifi. La cámara solo se usa para leer el código: no se guarda nada.' }));
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('sin cámara');
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = flujo;
      await video.play().catch(() => {});
      if (!window.jsQR) {
        await new Promise((ok, mal) => { const s = h('script', { src: 'vendor/jsQR.js' }); s.onload = ok; s.onerror = mal; document.head.append(s); });
      }
    } catch (e) {
      parar();
      estado.textContent = e && /denied|NotAllowed|Permission/i.test(`${e.name} ${e.message}`)
        ? 'No hay permiso para usar la cámara. Actívalo en los ajustes del móvil (Apps → Química → Permisos) o escribe la dirección y el código a mano.'
        : 'No se puede usar la cámara en este móvil. Escribe la dirección y el código a mano.';
      return;
    }
    const mirar = async () => {
      if (!vivo || !cuerpo.isConnected) { parar(); return; }
      if (video.videoWidth) {
        // (a un tamaño razonable: más pequeño es más rápido y se lee igual)
        const k = Math.min(1, 640 / video.videoWidth);
        lienzo.width = Math.round(video.videoWidth * k);
        lienzo.height = Math.round(video.videoHeight * k);
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
        const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
        const q = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (q && q.data) {
          const enlace = S.enlaceDePC(q.data);
          if (enlace) {
            parar();
            vibrar(30);
            // En la app de internet: se guarda y se sincroniza al tocar (la ventana puente necesita un toque)
            if (enLaWeb) {
              if (!await confirmarUnion('')) { estado.textContent = 'No se ha conectado.'; return; }
              guardar('quimica.pc', { direccion: enlace.direccion, codigo: enlace.codigo });
              localStorage.removeItem('quimica.pc-ultima');
              estado.textContent = '✅ Código leído.';
              poner(cuerpo, h('div', { class: 'escaner' }, estado),
                h('button', { class: 'boton', type: 'button', text: '🔄 Sincronizar con el PC ahora', onclick: () => sincronizarPorPuente().then(() => { atras(); if (alConectar) alConectar(); }) }),
                h('p', { class: 'nota', text: 'Se abre una ventana un momento, pasa los datos en los dos sentidos y se cierra sola.' }));
              refrescarPendiente();
              return;
            }
            estado.textContent = 'Código leído. Conectando…';
            if (await conectarPC(enlace.direccion, enlace.codigo)) { atras(); if (alConectar) alConectar(); } else estado.textContent = 'Se leyó el código pero no se pudo conectar. Mira que Química PC esté abierto y la wifi.';
            return;
          }
          estado.textContent = 'Ese código QR no es el de Química PC. Apunta al que sale en la pantalla del PC (Ajustes).';
        }
      }
      setTimeout(mirar, 150);
    };
    mirar();
  };

  // "hace 2 min"
  const haceCuanto = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 60 ? 'ahora mismo' : s < 3600 ? `hace ${Math.round(s / 60)} min` : `el ${fechaCorta(ms)} a las ${horaDe(ms)}`;
  };
  // (en el navegador del PC, «sincronizado» solo quiere decir que esta pantalla está al día con el
  // programa Química PC, no que el móvil lo esté: el móvil se ve aparte, «📱» en Ajustes)
  const textoEstadoPC = () => (enLaWeb && !estadoPC ? (sincronizando ? '🔄 Sincronizando… (en la ventana que se ha abierto)'
    : leer('quimica.pc-ultima', null) ? `Última sincronización con el PC: ${haceCuanto(leer('quimica.pc-ultima', null).fecha)}` : 'Aún no has sincronizado con este PC')
    : !estadoPC ? (sincronizando ? '🔄 Sincronizando…' : 'Aún no se ha sincronizado desde que abriste la app')
    : estadoPC.ok ? (enElPC && pcVisto ? `✅ Esta pantalla está al día con Química PC (${haceCuanto(estadoPC.fecha)})`
      : `✅ Sincronizado ${haceCuanto(estadoPC.fecha)}${estadoPC.fotos ? ` (${estadoPC.fotos} ${estadoPC.fotos === 1 ? 'foto pasada' : 'fotos pasadas'})` : ''}`)
      : `⚠️ ${estadoPC.error} (${haceCuanto(estadoPC.fecha)})`);

  // La parte de Ajustes de la conexión con el PC. pintar: el de Ajustes, para volver a pintarlo
  const seccionPC = (pintar) => {
    const estado = h('p', { class: 'nota', text: textoEstadoPC() });
    alCambiarEstadoPC = () => { if (estado.isConnected) estado.textContent = textoEstadoPC(); };
    const ahora = h('button', { class: 'boton secundario', text: '🔄 Sincronizar ahora', onclick: async () => {
      ahora.disabled = true;
      estado.textContent = '🔄 Sincronizando…';
      await sincronizar({ avisarFallo: true });
      ahora.disabled = false;
    } });
    if (enElPC && pcVisto) {
      // En el navegador del PC: lo que hay que escribir en el móvil
      const info = h('div', { class: 'caja datos-pc' }, h('p', { class: 'nota', text: 'Buscando…' }));
      // Qué móviles han sincronizado y cuándo (se vuelve a mirar cada 10 s mientras está abierto)
      // Una sola respuesta, arriba y clara (versión 100, el usuario dijo que era confuso): o hay un
      // móvil sincronizando ahora (verde) o no (amarillo, y qué hacer)
      const moviles = h('div', { class: 'moviles-pc sin-moviles' });
      const verMoviles = (aparatos) => {
        const lista = aparatos || [];
        const hace = (a) => haceCuanto(Date.now() - a.hace);
        // (los de la página web sincronizan a mano, al tocar «Sincronizar»: no están «sin sincronizar»)
        const solos = lista.filter((a) => !a.manual);
        const manuales = lista.filter((a) => a.manual);
        const activos = solos.filter((a) => a.hace < 45 * 1000); // la app sincroniza cada 15 s (con la app a la vista)
        const atrasados = manuales.filter((a) => a.pendiente);
        const bien = !atrasados.length && (activos.length > 0 || manuales.length > 0);
        moviles.classList.toggle('sin-moviles', !bien);
        moviles.classList.toggle('con-moviles', bien);
        poner(moviles,
          h('b', { text: atrasados.length ? '📱 Faltan cambios por pasar al móvil'
            : activos.length ? `📱 ${activos.length === 1 ? 'Móvil conectado' : `${activos.length} móviles conectados`}`
              : manuales.length ? '📱 Móvil que sincroniza a mano' : solos.length ? '📱 Móvil sin sincronizar ahora' : '📱 Ningún móvil conectado' }),
          lista.map((a) => h('span', { class: 'movil-linea', text: `${[a.tipo, a.nombre].filter(Boolean).join(' ')} · ${a.manual ? 'desde la página web, a mano · ' : ''}última sincronización ${hace(a)}${a.pendiente ? ' · le faltan cambios de este PC' : ''}` })),
          atrasados.length > 0 && h('span', { class: 'movil-linea', text: 'Has cambiado algo en este PC que el móvil aún no tiene. En el móvil (misma wifi), toca «🔄 Sincronizar con el PC».' }),
          !activos.length && !atrasados.length && h('span', { class: 'movil-linea', text: manuales.length ? 'Desde la página web, los cambios se pasan cuando en el móvil se toca «🔄 Sincronizar con el PC» (con la misma wifi).'
            : solos.length ? 'Abre la app en el móvil (con la misma wifi) y se sincroniza sola.' : 'Escanea con el móvil el código QR de aquí abajo.' }));
      };
      const mirarMoviles = () => {
        if (!moviles.isConnected) return;
        pedirPC('', '', '/api/hola').then((r) => r.json()).then((r) => verMoviles(r.aparatos)).catch(() => {});
        setTimeout(mirarMoviles, 4000);
      };
      setTimeout(mirarMoviles, 4000);
      const cargarInfo = () => pedirPC('', '', '/api/hola').then((r) => r.json()).then((r) => { verMoviles(r.aparatos); return r; }).then((r) => poner(info,
        // El usuario de ahora (versión 111): cada uno con su carpeta de datos y su código
        h('p', {}, '👤 Usuario: ', h('b', { text: r.usuario || '' })),
        h('button', { class: 'boton secundario', type: 'button', text: '🔁 Cambiar de usuario…', onclick: () => abrirUsuarios(() => { cargarInfo(); dibujarQR(); }) }),
        h('p', { class: 'nota', text: 'A mano, sin QR (en el móvil: ⚙️ Ajustes → 💻 Conectar con el PC):' }),
        h('p', {}, 'Dirección: ', h('b', { text: (r.direcciones || []).join('  o  ') || '(este PC no está en ninguna red)' })),
        h('p', {}, 'Código: ', h('b', { class: 'codigo-pc', text: r.codigo })),
        // (lo del cable solo si este PC tiene las herramientas de Android; la carpeta es la de quien lo abre)
        h('p', { class: 'nota', text: `${r.cable ? 'O por cable USB (Android): conecta el cable y, en el móvil, «🔌 Por cable USB». ' : ''}Tus datos y fotos se guardan en la carpeta:` }),
        h('p', { class: 'ruta-datos', text: r.carpeta }),
        // Mover los datos de este usuario a otra carpeta (versión 103): se copia lo que haya y se sigue ahí
        h('button', { class: 'boton secundario', type: 'button', text: '📁 Mover los datos de este usuario a otra carpeta…', onclick: async () => {
          let cuerpo = { elegir: true };
          if (!r.dialogoCarpeta) {
            const ruta = await preguntar({ texto: '📁 Carpeta de datos', detalle: 'Escribe la ruta completa de una carpeta vacía. Se copia ahí todo lo que tienes y se sigue guardando allí; la de antes no se borra.',
              campo: { placeholder: '/ruta/completa/de/la/carpeta', 'aria-label': 'Carpeta de datos', autocapitalize: 'off' }, si: 'Cambiar', no: 'Cancelar' });
            if (!ruta || !ruta.trim()) return;
            cuerpo = { carpeta: ruta.trim() };
          } else {
            avisar('Se ha abierto el cuadro de carpetas en este PC (si no lo ves, puede estar detrás del navegador)');
          }
          try {
            const resp = await fetch('/api/carpeta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
            const j = await resp.json();
            if (!resp.ok) { avisar(j.error || 'No se ha podido cambiar la carpeta'); return; }
            if (j.cancelado) { avisar('No se ha cambiado nada'); return; }
            avisar(`Hecho: los datos se guardan ahora en ${j.carpeta}. La carpeta de antes no se ha borrado.`);
            cargarInfo();
          } catch { avisar('No se ha podido cambiar la carpeta'); }
        } }),
        h('p', { class: 'nota', text: '🔒 Por la wifi, conéctalo solo en una red de confianza (la de casa): lo que se pasa no va cifrado. En una wifi pública o de la universidad, mejor el cable.' }))).catch(() => poner(info, h('p', { class: 'nota', text: 'No se encuentra el programa Química PC.' })));
      cargarInfo();
      // El QR para el iPhone (y cualquier móvil): abre la app desde el PC y se conecta con el código.
      // Se dibuja en el momento (la librería se carga la primera vez); si no hay red, no sale
      const caja = h('div', { class: 'qr-pc' });
      const dibujarQR = () => pedirPC('', '', '/api/hola').then((r) => r.json()).then(async (r) => {
        const dir = (r.direcciones || [])[0];
        if (!dir || !r.codigo) return;
        const enlace = `http://${dir}/#c=${r.codigo}`;
        if (!window.qrcode) {
          await new Promise((ok, mal) => { const s = h('script', { src: 'vendor/qrcode.js' }); s.onload = ok; s.onerror = mal; document.head.append(s); });
        }
        const q = window.qrcode(0, 'M');
        q.addData(enlace);
        q.make();
        const svg = new DOMParser().parseFromString(q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }), 'image/svg+xml').documentElement;
        poner(caja,
          h('p', {}, h('b', { text: '📷 Conectar un móvil' })),
          h('ol', { class: 'pasos-qr' },
            h('li', { text: 'El móvil, en la misma wifi que este PC.' }),
            h('li', {}, h('b', { text: 'iPhone:' }), ' abre la cámara y apunta al código; toca el aviso que sale.'),
            h('li', {}, h('b', { text: 'App de Android, o la de internet (github.io):' }), ' Ajustes → Conectar con el PC → «📷 Escanear el QR del PC». En la de internet, después, «🔄 Sincronizar con el PC» cada vez que quieras pasar los datos.'),
            h('li', { text: 'Listo: arriba pasará a «Móvil conectado».' })),
          h('div', { class: 'qr-dibujo', role: 'img', 'aria-label': `Código QR con el enlace ${dir}` }, svg),
          h('p', { class: 'nota', text: 'En el iPhone, después: «Compartir → Añadir a pantalla de inicio» para tenerla como una app.' }));
      }).catch(() => {});
      dibujarQR();
      // Un código nuevo, por si alguien ha visto el de ahora (versión 96)
      const cambiarCodigo = h('button', { class: 'boton discreto', text: '🔑 Cambiar el código', onclick: async () => {
        if (!await preguntar({ texto: '¿Cambiar el código?', detalle: 'Hazlo si alguien ha visto el de ahora. Los móviles conectados por la wifi dejarán de sincronizar hasta que les pongas el nuevo (Desconectar del PC y volver a conectar).', si: 'Cambiar el código', no: 'Cancelar' })) return;
        try {
          const r = await (await pedirPC('', '', '/api/codigo-nuevo', { method: 'POST' })).json();
          const b = info.querySelector('.codigo-pc');
          if (b) b.textContent = r.codigo;
          avisar(`Código nuevo: ${r.codigo}`);
          dibujarQR();
        } catch { avisar('No se ha podido cambiar el código'); }
      } });
      // (aquí no van «Sincronizar ahora» ni «✅ al día»: esta pantalla habla con el programa del mismo
      // PC y eso siempre está al día; lo que importa es el móvil, arriba)
      return [moviles, caja, info, cambiarCodigo];
    }
    const pc = leer('quimica.pc', null);
    // La app de internet: a mano, por la ventana puente (versión 106)
    if (enLaWeb && pc && pc.direccion) {
      const pendiente = h('p', { class: 'nota aviso-texto' });
      const verPendiente = () => { pendiente.textContent = hayPendiente() ? '⚠️ Hay cambios aquí que aún no has pasado al PC.' : ''; pendiente.hidden = !hayPendiente(); };
      alCambiarEstadoPC = () => { if (estado.isConnected) { estado.textContent = textoEstadoPC(); verPendiente(); } };
      verPendiente();
      return [
        h('p', {}, '💻 Conectado con ', h('b', { text: pc.direccion })),
        pc.usuario && h('p', {}, '👤 Usuario del PC: ', h('b', { text: pc.usuario })),
        h('p', { class: 'nota', text: 'Desde esta página los datos se pasan cuando tocas «Sincronizar», con el móvil en la misma wifi que el PC y Química PC abierto: se abre una ventana un momento y se cierra sola. Mientras tanto, la app funciona igual sin el PC.' }),
        estado, pendiente,
        h('button', { class: 'boton', type: 'button', text: '🔄 Sincronizar con el PC', onclick: () => sincronizarPorPuente() }),
        h('button', { class: 'boton discreto', type: 'button', text: 'Desconectar del PC', onclick: async () => {
          if (!await preguntar({ texto: '¿Desconectar del PC?', detalle: 'Lo que hay aquí se queda. Dejará de pasarse al PC.', si: 'Desconectar' })) return;
          for (const k of ['quimica.pc', 'quimica.pc-ultima', 'quimica.pc-pendiente']) localStorage.removeItem(k);
          estadoPC = null;
          refrescarPendiente();
          pintar();
        } })];
    }
    if (pc && pc.direccion) {
      return [
        h('p', {}, '💻 Conectado con ', h('b', { text: pc.direccion === 'localhost:8765' ? 'el PC por cable USB' : pc.direccion })),
        pc.usuario && h('p', {}, '👤 Usuario del PC: ', h('b', { text: pc.usuario })),
        h('p', { class: 'nota', text: 'Las recetas, el cuaderno y las fotos se pasan solos al PC y del PC (con Química PC abierto). Si cambias lo mismo en los dos sitios, se queda el cambio más nuevo.' }),
        estado, ahora,
        h('button', { class: 'boton discreto', text: 'Desconectar del PC', onclick: async () => {
          if (!await preguntar({ texto: '¿Desconectar del PC?', detalle: 'Lo que hay en el móvil se queda. Dejará de pasarse al PC.', si: 'Desconectar' })) return;
          // Se avisa al PC para que deje de contarlo como conectado (si no se le encuentra, da igual)
          const c = conexion();
          if (c) { try { await pedirPC(c.base, c.codigo, '/api/desconectar', { method: 'POST', espera: 3000 }); } catch { /* sin PC a la vista */ } }
          localStorage.removeItem('quimica.pc');
          estadoPC = null;
          pintar();
        } })];
    }
    // (abierta desde la dirección del PC: la dirección ya es esta; solo falta el código)
    const direccion = h('input', { class: 'campo', autocomplete: 'off', inputmode: 'url', placeholder: 'Dirección: 192.168.1.35:8765', value: desdeElPC ? location.host : '' });
    const codigo = h('input', { class: 'campo', autocomplete: 'off', inputmode: 'numeric', placeholder: 'Código: 6 números' });
    const conectar = async (boton, d, c) => {
      boton.disabled = true;
      const texto = boton.textContent;
      boton.textContent = 'Conectando…';
      const ok = await conectarPC(d, c);
      if (!boton.isConnected) return;
      boton.disabled = false;
      boton.textContent = texto;
      if (ok) pintar();
    };
    const porWifi = h('button', { class: 'boton', text: '📶 Conectar por la wifi', onclick: () => {
      if (!direccion.value.trim() || !/^\d{6}$/.test(codigo.value.trim())) { avisar('Escribe la dirección y el código de 6 números que enseña Química PC'); return; }
      if (enLaWeb) {
        // (en la web, conectar ES sincronizar por la ventana puente, ya, con este toque; si no sale, no se guarda)
        // Ojo: la ventana tiene que abrirse en este toque; la pregunta de «ya tiene datos» la haría esperar
        // y el navegador la bloquearía. Por eso, en la web, esa pregunta va al escanear el QR (arriba) y aquí
        // se avisa en el texto de Ajustes
        const d = direccion.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        guardar('quimica.pc', { direccion: /:\d+$/.test(d) ? d : `${d}:8765`, codigo: codigo.value.trim() });
        localStorage.removeItem('quimica.pc-ultima');
        sincronizarPorPuente().then((ok) => { if (!ok) localStorage.removeItem('quimica.pc'); refrescarPendiente(); pintar(); });
        return;
      }
      conectar(porWifi, direccion.value, codigo.value);
    } });
    const porCable = h('button', { class: 'boton secundario', text: '🔌 Por cable USB', onclick: () => conectar(porCable, 'localhost:8765', '') });
    // En la app de Android y en la de internet: escanear el QR con la cámara
    const escanear = !desdeElPC && h('button', { class: 'boton', text: '📷 Escanear el QR del PC', onclick: () => escanearQR(() => pintar()) });
    return [
      escanear,
      enLaWeb
        ? [h('p', { class: 'nota', text: 'Con Química PC abierto en tu ordenador y este móvil en la misma wifi, puedes pasar tus recetas, el cuaderno y las fotos al PC (y traer lo del PC) cuando quieras, tocando «Sincronizar». Desde esta página no se pasan solos: la app te avisa cuando tengas cambios sin pasar.' }),
          /Android/i.test(navigator.userAgent) && h('p', { class: 'nota' }, 'En Android, la app instalada se sincroniza sola (y sus alarmas suenan con la app cerrada): ',
            h('a', { href: 'https://github.com/juma579/quimica/releases/latest', target: '_blank', rel: 'noopener', text: 'descargar la APK' }), '.')]
        : h('p', { class: 'nota', text: 'Con el programa Química PC abierto en tu ordenador, tendrás aquí y allí las mismas recetas, el cuaderno y las fotos, y podrás escribir en cualquiera de los dos. La dirección y el código salen en la ventana de Química PC.' }),
      desdeElPC && h('p', { class: 'nota', text: '📷 Más fácil: en la app del PC (Ajustes) hay un código QR. Escanéalo con la cámara de este móvil y se conecta solo. Si no, escribe el código que sale en el PC:' }),
      direccion, codigo, porWifi, !desdeElPC && porCable,
      h('p', { class: 'nota', text: 'Por la wifi: el móvil y el PC en la misma red (en algunas wifis de universidad no se ven entre sí; entonces, por cable). Por cable: con la depuración USB activada.' })];
  };

  // ─── Ajustes ───
  const abrirAjustes = () => {
    const { cuerpo, panel: panelAjustes } = abrirPanel('Ajustes');
    panelAjustes.dataset.lateral = 'ajustes';
    const pintar = () => {
      const campoClave = h('input', { class: 'campo', type: 'password', autocomplete: 'off', placeholder: 'Pega aquí la clave' });
      const copia = h('textarea', { class: 'campo', rows: 4, placeholder: 'Pega aquí una copia hecha con «Copiar todas las recetas»' });
      poner(cuerpo,
        // El usuario de este móvil (en la pantalla del PC los usuarios son los de Química PC, más abajo)
        !(enElPC && pcVisto) && [
          h('h3', { text: '👤 Usuario' }),
          h('p', {}, 'Usas: ', h('b', { text: usuarioDeAhora().nombre })),
          h('button', { class: 'boton secundario', type: 'button', text: '🔁 Cambiar de usuario…', onclick: abrirUsuariosMovil }),
        ],
        h('h3', { text: '✨ Gemini (la IA)' }),
        hayIA()
          ? [h('p', { class: 'nota', text: '✅ Hay una clave puesta. Solo está en este móvil y solo se usa para hablar con Gemini.' }),
            h('button', { class: 'boton secundario', text: 'Quitar la clave', onclick: async () => {
              if (!await preguntar({ texto: '¿Quitar la clave de Gemini?', detalle: 'Las recetas se quedan. Dejarán de salir los botones de la IA.', si: 'Quitar' })) return;
              localStorage.removeItem('quimica.clave');
              pintar();
            } })]
          : [h('p', { class: 'nota', text: 'Para convertir textos en recetas hace falta una clave de Gemini. Es gratis:' }),
            h('p', { class: 'nota', text: '1. En el navegador, entra en aistudio.google.com/apikey con tu cuenta de Google.\n2. Pulsa «Crear clave de API» y copia la clave.\n3. Pégala aquí. Se guarda solo en este móvil.', style: 'white-space: pre-line' }),
            campoClave,
            h('button', { class: 'boton', text: 'Guardar la clave', onclick: () => {
              const k = campoClave.value.trim();
              if (k.length < 20 || /\s/.test(k)) { avisar('Eso no parece una clave de Gemini'); return; }
              guardar('quimica.clave', k);
              pintar();
              avisar('Clave guardada');
            } })],
        h('h3', { text: '💻 Conectar con el PC' }),
        seccionPC(pintar),
        h('h3', { text: '📱 Pantalla de la receta' }),
        h('label', { class: 'parte-opcion' },
          h('input', { type: 'checkbox', checked: leer('quimica.receta-junta', false) === true, onchange: (e) => guardar('quimica.receta-junta', e.target.checked) }),
          ' Todo en una sola pantalla (sin pestañas: recetas y cuadernos)'),
        h('p', { class: 'nota', text: 'Por defecto, la receta tiene dos pantallas: «🧮 Datos» a la izquierda y «📋 Pasos» a la derecha. Se cambia con las pestañas de arriba o deslizando el dedo hacia un lado. Si lo prefieres, marca esto y vuelve todo seguido.' }),
        h('h3', { text: '💾 Copia de seguridad de todo' }),
        // (versión 124) En la página web abierta en el navegador (no añadida a la pantalla de inicio),
        // Safari del iPhone borra lo guardado por una web si pasan 7 días sin abrirla
        enLaWeb && !(window.matchMedia && matchMedia('(display-mode: standalone)').matches) && !navigator.standalone
          && h('p', { class: 'nota aviso-guardado', text: '⚠️ Estás usando la app en el navegador. En el iPhone, Safari puede borrar lo guardado si pasas 7 días sin abrir esta página. Para que no pase: añádela a la pantalla de inicio (Compartir → «Añadir a la pantalla de inicio») y haz copias de seguridad de vez en cuando.' }),
        h('p', { class: 'nota', text: 'Guarda en un archivo las recetas, el cuaderno entero (grupos, apuntes, disoluciones) y, si quieres, las fotos. Sirve para no perder nada si se borran los datos del navegador, se desinstala la app o cambias de móvil. No lleva la clave de Gemini.' }),
        (() => {
          const conFotos = h('input', { type: 'checkbox', checked: true });
          const estado = h('p', { class: 'nota' });
          const guardarBoton = h('button', { class: 'boton secundario', text: '💾 Guardar la copia en un archivo', onclick: async () => {
            guardarBoton.disabled = true;
            estado.textContent = 'Preparando la copia…';
            try {
              const r = await guardarCopiaCompleta(conFotos.checked, (n, total) => { estado.textContent = `Preparando la copia… foto ${n} de ${total}`; });
              estado.textContent = `✅ Guardada: «${r.nombre}» en ${r.donde}.`;
            } catch (e) {
              estado.textContent = e && e.name === 'AbortError' ? '' : `No se ha podido guardar la copia: ${e && e.message ? e.message : 'error'}`;
            }
            guardarBoton.disabled = false;
          } });
          const archivo = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
            const f = archivo.files && archivo.files[0];
            archivo.value = '';
            if (!f) return;
            if (!await preguntar({ texto: '¿Recuperar esta copia?', detalle: `«${f.name}» sustituirá las recetas y el cuaderno que hay ahora en este aparato (se guarda antes una copia de lo de ahora, sin fotos, por si acaso). Las fotos de la copia se añaden.`, si: 'Recuperar', no: 'Cancelar', peligro: true })) return;
            try {
              estado.textContent = 'Recuperando…';
              const r = await recuperarCopiaCompleta(f);
              pintarLista();
              pintarCuadernos();
              estado.textContent = `✅ Recuperadas ${r.recetas} recetas, ${r.apuntes} apuntes del cuaderno y ${r.fotos} fotos.`;
            } catch (e) {
              estado.textContent = `No se ha podido recuperar: ${e && e.message ? e.message : 'error'}`;
            }
          } });
          return [
            h('label', { class: 'parte-opcion' }, conFotos, ' Con las fotos (el archivo pesa más)'),
            guardarBoton,
            h('button', { class: 'boton secundario', text: '📥 Recuperar desde un archivo', onclick: () => archivo.click() }),
            archivo,
            estado];
        })(),
        // Las fotos guardadas que ya no usa nada (versión 124): son de apuntes borrados. Antes de la 124,
        // además, la sincronización con el PC las volvía a traer (en el móvil del usuario: 37, 9 MB)
        h('h3', { text: '🧹 Fotos que ya no se usan' }),
        (() => {
          const caja = h('div', {}, h('p', { class: 'nota', text: 'Mirando…' }));
          const mirar = async () => {
            const ids = await window.Fotos.ids().catch(() => []);
            const usadas = fotosUsadas();
            const sueltas = ids.filter((id) => !usadas.has(id));
            if (!sueltas.length) { poner(caja, h('p', { class: 'nota', text: 'Ninguna: todas las fotos guardadas en este aparato se usan.' })); return; }
            let bytes = 0;
            for (const id of sueltas) { const f = await window.Fotos.leer(id).catch(() => null); bytes += f && f.blob ? f.blob.size : 0; }
            const mb = (bytes / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 });
            const cuantas = `${sueltas.length} ${sueltas.length === 1 ? 'foto' : 'fotos'}`;
            poner(caja,
              h('p', { class: 'nota', text: `Hay ${cuantas} guardadas en este aparato que no usa ningún apunte ni ningún cuaderno (${mb} MB): son de cosas que se borraron.` }),
              h('button', { class: 'boton secundario', type: 'button', text: `🧹 Quitarlas (${mb} MB)`, onclick: async () => {
                if (!await preguntar({ texto: `¿Quitar ${cuantas} que no se usan?`, detalle: 'No las usa ningún apunte ni ningún cuaderno. Se quitan solo de este aparato (en Química PC, si lo usas, siguen en su carpeta). No se puede deshacer.', si: 'Quitar', peligro: true })) return;
                // (otra vez, justo antes: por si mientras tanto algo ha pasado a usarlas)
                const ahora = fotosUsadas();
                let n = 0;
                for (const id of sueltas.filter((x) => !ahora.has(x))) {
                  await window.Fotos.borrar(id).catch(() => {});
                  const u = urlsFotos.get(id);
                  if (u) { URL.revokeObjectURL(u); urlsFotos.delete(id); }
                  n++;
                }
                avisar(`🧹 Quitadas ${n} ${n === 1 ? 'foto' : 'fotos'} que no se usaban`);
                mirar();
              } }));
          };
          mirar();
          return caja;
        })(),
        h('h3', { text: 'Solo las recetas, como texto' }),
        h('p', { class: 'nota', text: `Las recetas (${recetas.length}) también se pueden copiar y pegar en un sitio seguro (un correo para ti, una nota…).` }),
        h('button', { class: 'boton secundario', text: '📋 Copiar todas las recetas', onclick: async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(recetas)); avisar('Copiadas: pégalas donde quieras guardarlas'); } catch { avisar('No se ha podido copiar'); }
        } }),
        copia,
        h('button', { class: 'boton secundario', text: '📥 Recuperar las recetas de esa copia', onclick: () => {
          let lista;
          try { lista = JSON.parse(copia.value); } catch { lista = null; }
          if (!Array.isArray(lista)) { avisar('Eso no es una copia de recetas'); return; }
          const buenas = lista.map((x) => Q.validar(x).receta).filter(Boolean);
          for (const b of buenas.reverse()) ponerReceta(b);
          avisar(`${buenas.length} ${buenas.length === 1 ? 'receta recuperada' : 'recetas recuperadas'}${buenas.length < lista.length ? ` (${lista.length - buenas.length} no valían)` : ''}`);
          pintar();
        } }),
        h('h3', { text: 'ℹ️ Sobre la app' }),
        h('p', { class: 'nota', text: `Versión de la app: ${typeof VERSION_WEB === 'string' ? VERSION_WEB : '?'}` }),
        h('p', { class: 'nota' }, '🔗 Descargas (Android y PC), instrucciones y novedades: ',
          h('a', { href: 'https://github.com/juma579/quimica', target: '_blank', rel: 'noopener', text: 'github.com/juma579/quimica' })));
    };
    pintar();
  };

  // ─── Copia de seguridad de todo (versión 95, lo pidió el usuario) ───
  // Un archivo con las recetas, el cuaderno entero (grupos, apuntes, disoluciones, carpetas…), los
  // pasos marcados, los ciclos y, si se quiere, las fotos (en base64). NO lleva la clave de Gemini ni
  // lo de la conexión con el PC. Recuperar SUSTITUYE lo que hay (con una copia de lo de antes en
  // localStorage «quimica.antes-de-recuperar»)
  const aBase64 = (blob) => new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1] || '');
    lector.onerror = () => mal(lector.error);
    lector.readAsDataURL(blob);
  });
  const deBase64 = (base64, tipo) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: tipo || 'image/jpeg' });
  };
  // Las partes del archivo, una a una (así no hay un texto de decenas de MB de golpe)
  // alParte: si se da, cada parte se le pasa según sale (y no se juntan todas en memoria: con cientos
  // de fotos, el texto entero podía pesar cientos de MB; versión 124)
  const partesDeLaCopia = async (conFotos, alAvanzar, alParte = null) => {
    const lista = [];
    const partes = { push: async (p) => { if (alParte) await alParte(p); else lista.push(p); } };
    const cabecera = JSON.stringify({ tipo: 'quimica-copia', version: typeof VERSION_WEB === 'string' ? VERSION_WEB : '?', fecha: Date.now(),
      recetas, cuaderno: leerCuaderno(), hechos: leer('quimica.hechos', {}), ciclos: leer('quimica.ciclos', {}) });
    await partes.push(`${cabecera.slice(0, -1)},"fotos":[`);
    if (conFotos) {
      // (las fotos guardadas en este aparato que usa algo: las de cosas borradas no; versión 124)
      const usadas = fotosUsadas();
      const ids = (await window.Fotos.ids()).filter((id) => usadas.has(id));
      let primera = true;
      let n = 0;
      for (const id of ids) {
        const f = await window.Fotos.leer(id);
        if (!f || !f.blob) continue;
        await partes.push(`${primera ? '' : ','}${JSON.stringify({ id: f.id, nombre: f.nombre, ancho: f.ancho, alto: f.alto, fecha: f.fecha, tipo: f.blob.type, datos: await aBase64(f.blob) })}`);
        primera = false;
        if (alAvanzar) alAvanzar(++n, ids.length);
      }
    }
    await partes.push(']}');
    return lista;
  };
  const guardarCopiaCompleta = async (conFotos, alAvanzar) => {
    const d = new Date();
    const nombre = `Quimica-copia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    const plugin = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.GuardarArchivo;
    if (plugin) {
      // En Android, a la carpeta Descargas, en trozos de 1 MB, según se va preparando
      let texto = '';
      let primera = true;
      const mandar = async (t, ultima) => { await plugin.escribir({ nombre, texto: t, primera, ultima }); primera = false; };
      await partesDeLaCopia(conFotos, alAvanzar, async (p) => {
        texto += p;
        while (texto.length > 1000000) { await mandar(texto.slice(0, 1000000), false); texto = texto.slice(1000000); }
      });
      await mandar(texto, true);
      return { nombre, donde: 'la carpeta Descargas del móvil' };
    }
    const partes = await partesDeLaCopia(conFotos, alAvanzar);
    const archivo = new File(partes, nombre, { type: 'application/json' });
    // En el iPhone (y donde se pueda), la hoja de compartir: «Guardar en Archivos»
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], title: nombre }); return { nombre, donde: 'donde hayas elegido' }; } catch (e) { if (e && e.name === 'AbortError') throw e; }
    }
    const enlace = h('a', { href: URL.createObjectURL(archivo), download: nombre });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    return { nombre, donde: 'tus descargas' };
  };
  // Lee un archivo de copia y lo deja en el aparato. Devuelve cuántas recetas, apuntes y fotos entraron
  const recuperarCopiaCompleta = async (archivo) => {
    let c;
    try { c = JSON.parse(await archivo.text()); } catch { c = null; }
    if (!c || c.tipo !== 'quimica-copia' || !Array.isArray(c.recetas)) throw new Error('Ese archivo no es una copia de Química');
    const buenas = c.recetas.map((x) => Q.validar(x).receta).filter(Boolean);
    const cuaderno = K.limpiar(c.cuaderno || {});
    // Lo de antes, por si acaso (sin fotos: no caben en localStorage)
    guardar('quimica.antes-de-recuperar', { fecha: Date.now(), recetas, cuaderno: leerCuaderno() });
    let fotos = 0;
    for (const f of Array.isArray(c.fotos) ? c.fotos : []) {
      if (!f || !f.id || !f.datos) continue;
      await window.Fotos.guardar({ id: f.id, blob: deBase64(f.datos, f.tipo), nombre: f.nombre || 'foto', ancho: f.ancho, alto: f.alto, fecha: f.fecha || Date.now() });
      fotos++;
    }
    recetas = buenas;
    guardarRecetas();
    guardarCuaderno(cuaderno);
    guardar('quimica.hechos', c.hechos && typeof c.hechos === 'object' ? c.hechos : {});
    guardar('quimica.ciclos', c.ciclos && typeof c.ciclos === 'object' ? c.ciclos : {});
    return { recetas: buenas.length, apuntes: cuaderno.entradas.length, fotos };
  };

  // ─── Arranque ───
  $('buscar').addEventListener('input', pintarLista);
  $('b-nueva').addEventListener('click', () => (vista === 'recetas' ? abrirNueva() : nuevoCuaderno()));
  $('b-recetas').addEventListener('click', verRecetas);
  $('b-ajustes').addEventListener('click', abrirAjustes);
  // (📓 solo se ve en las recetas: vuelve a los cuadernos)
  $('b-cuaderno').addEventListener('click', () => { if (vista === 'recetas') atras(); });
  // (con la flecha: si no, abrirCalculadora recibiría el evento del toque como si fueran números de una receta)
  $('b-calculadora').addEventListener('click', () => abrirCalculadora());

  // ─── En el PC: la barra lateral (versión 136; el usuario: «mejórame muchísimo la interfaz en el PC») ───
  // Siempre a la vista (en una pantalla de 1100 px o más; en el móvil no sale): ir a cuadernos, recetas,
  // calculadora o ajustes, crear, y la lista de cuadernos para saltar de uno a otro. Ir a algo cierra
  // antes lo que hubiera abierto (como darle a «atrás» hasta el principio); si un formulario tiene
  // cambios sin guardar, pregunta y no se va
  const cerrarTodoY = (luego) => { if (capas.length) cerrarCapas(capas.length, luego); else luego(); };
  const irDesdeLateral = (a) => cerrarTodoY(() => {
    if (a === 'recetas') verRecetas();
    else if (a === 'calculadora') abrirCalculadora();
    else if (a === 'ajustes') abrirAjustes();
  });
  for (const b of document.querySelectorAll('#lateral [data-ir]')) b.addEventListener('click', () => irDesdeLateral(b.dataset.ir));
  $('l-nuevo').addEventListener('click', () => { const enRecetas = vista === 'recetas'; cerrarTodoY(() => { if (enRecetas) { verRecetas(); abrirNueva(); } else nuevoCuaderno(); }); });
  pintarLateral = () => {
    const caja = $('lateral-cuadernos');
    if (!caja || getComputedStyle($('lateral')).display === 'none') return;
    const c = leerCuaderno();
    // Lo abierto: el panel de más abajo que lo dice (un cuaderno, la calculadora, los ajustes) o la vista
    const abajo = document.querySelector('.panel[data-lateral]');
    const activo = abajo ? abajo.dataset.lateral : vista;
    poner(caja, K.todosLosCuadernos(c).map((x) => h('button', { type: 'button', class: `lateral-cuaderno${activo === `c:${x.ambito.cuadernoId}` ? ' activo' : ''}`, title: x.ficha.nombre,
      onclick: () => cerrarTodoY(() => abrirCuadernoDe(x.ambito.cuadernoId, x.ambito.recetaId, pintarCuadernos)) },
    h('span', { class: 'lateral-cuaderno-nombre', text: x.ficha.nombre }),
    h('small', { text: x.ambito.recetaId ? nombreDeReceta(c, x.ambito.recetaId) : 'Sin receta' }))));
    for (const b of document.querySelectorAll('#lateral [data-ir]')) b.classList.toggle('activo', b.dataset.ir === activo);
    $('l-nuevo').textContent = vista === 'recetas' ? '＋ Nueva receta' : '＋ Nuevo cuaderno';
    $('lateral-pie').textContent = `Química · versión ${VERSION_WEB}`;
  };
  // (al cambiar el tamaño de la ventana puede aparecer)
  window.matchMedia('(min-width: 1100px)').addEventListener('change', () => pintarLateral());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { if (alSalirDeLaApp) alSalirDeLaApp(); return; }
    // Si se vuelve a la app con el formulario abierto, el borrador ya no hace falta
    if (alSalirDeLaApp) quitarBorrador();
    revisarCronometros();
    recogerCancelados();
    sincronizar();
  });
  // En la app del PC, siempre a la vista (versión 102, lo pidió el usuario: «debería salir un aviso en
  // el PC de que no estás conectado»): un indicador arriba, junto a Ajustes, con si hay un móvil
  // sincronizando (verde) o no (amarillo), y un aviso cuando uno se conecta o se desconecta.
  // Conectado = sincronizó hace menos de 45 s (el móvil sincroniza cada 15 s con la app a la vista)
  const vigilarMoviles = () => {
    const chips = new Set(); // el de arriba y los de dentro de cada pantalla abierta
    // (manual: el último que sincroniza desde la página web, a mano; no está «desconectado» por no sincronizar)
    let ultimo = { activos: 0, lista: 0, manual: null };
    const pintarUno = (chip) => {
      const { activos, lista, manual } = ultimo;
      const falta = Boolean(manual && manual.pendiente); // el móvil a mano se ha quedado atrás
      const bien = !falta && (activos > 0 || Boolean(manual));
      chip.classList.toggle('con-movil', bien);
      chip.classList.toggle('sin-movil', !bien);
      chip.textContent = falta ? '📱 falta pasar al móvil' : activos > 0 ? '📱 conectado' : manual ? `📱 a mano · ${haceCuanto(Date.now() - manual.hace)}` : lista > 0 ? '📱 sin sincronizar' : '📱 sin conectar';
      chip.title = falta ? 'Hay cambios en este PC que un móvil aún no tiene: en ese móvil, toca «Sincronizar con el PC»'
        : activos > 0 ? 'Hay un móvil sincronizando con este PC'
          : manual ? 'Un móvil con la app de internet sincroniza con este PC cuando lo pide (botón «Sincronizar» del móvil)'
            : 'Ningún móvil sincroniza ahora con este PC. Toca para ver cómo conectarlo.';
    };
    const nuevo = (id) => {
      const c = h('button', { ...(id ? { id } : {}), class: 'chip-movil sin-movil', type: 'button', 'aria-label': 'Estado del móvil: ver en Ajustes',
        onclick: () => $('b-ajustes').click() });
      chips.add(c);
      pintarUno(c);
      return c;
    };
    // (los de pantallas ya cerradas se van quitando)
    const pintarChip = (activos, lista, manual) => {
      ultimo = { activos, lista, manual };
      for (const c of chips) { if (!c.isConnected && c.id !== 'b-movil') chips.delete(c); else pintarUno(c); }
    };
    window.chipMovilNuevo = () => nuevo();
    $('b-ajustes').before(nuevo('b-movil'));
    const avisadas = new Map(); // los que sincronizan a mano: cuándo se avisó de su última vez
    let avisadoAtras = false; // ya se ha dicho que hay un móvil a mano sin los últimos cambios
    let habia = null; // si había un móvil conectado en la última mirada (null: aún no se ha mirado)
    const mirar = async () => {
      try {
        const r = await (await pedirPC('', '', '/api/hola', { espera: 4000 })).json();
        revisarCarpeta(r);
        const lista = r.aparatos || [];
        // (los que sincronizan a mano no cuentan para «conectado / ya no está conectado»)
        const activos = lista.filter((a) => !a.manual && a.hace < 45 * 1000).length;
        const manuales = lista.filter((a) => a.manual).sort((a, b) => a.hace - b.hace);
        // (el que se ha quedado atrás, si lo hay, va primero: es el que importa)
        const atras = manuales.find((a) => a.pendiente) || null;
        pintarChip(activos, lista.filter((a) => !a.manual).length, atras || manuales[0] || null);
        if (atras && !avisadoAtras) {
          avisadoAtras = true;
          avisar(`📱 Hay cambios en el PC que ${[atras.tipo, atras.nombre].filter(Boolean).join(' ')} aún no tiene: en el móvil, toca «🔄 Sincronizar con el PC»`);
        }
        if (!atras) avisadoAtras = false;
        // Cada vez que uno de esos sincroniza, se dice (una vez por sincronización)
        // (por el nº de veces que ha sincronizado, que da el programa: por la hora, dos seguidas se confundían)
        for (const a of manuales) {
          const antes = avisadas.get(a.nombre);
          if (antes !== undefined && a.veces > antes) avisar(`📱 ${[a.tipo, a.nombre].filter(Boolean).join(' ')} ha sincronizado con este PC (desde la página web)`);
          avisadas.set(a.nombre, a.veces);
        }
        if (habia !== null && habia !== activos > 0) {
          avisar(activos > 0 ? '📱 Móvil conectado: ya se sincroniza con este PC' : '📱 El móvil ya no está conectado: sus cambios no llegan a este PC hasta que vuelva a conectarse',
            activos > 0 ? null : { texto: 'Ver', hacer: () => $('b-ajustes').click() });
        }
        habia = activos > 0;
      } catch {
        // (el programa del PC no contesta: se deja el último estado)
      }
    };
    mirar();
    setInterval(() => { if (document.visibilityState === 'visible') mirar(); }, 5000);
  };
  // La conexión con el PC: al abrir, al volver a la app y cada 15 s (si hay PC)
  (async () => {
    if (enElPC) {
      let hola = null;
      try { hola = await (await pedirPC('', '', '/api/hola', { espera: 3000 })).json(); pcVisto = hola.app === 'quimica-pc'; } catch { pcVisto = false; }
      if (pcVisto) {
        document.title = 'Química (PC)'; document.body.classList.add('en-pc'); vigilarMoviles();
        // ¿es la misma carpeta con la que estaba esta pantalla? (antes de sincronizar, para no pasarle lo de otra)
        await revisarCarpeta(hola);
      }
    }
    // En la app de internet conectada al PC: «💻 al día» o «💻 pasar al PC», que al tocarlo sincroniza
    if (enLaWeb) {
      const nuevo = (id) => {
        const c = h('button', { ...(id ? { id } : {}), class: 'chip-movil', type: 'button', 'aria-label': 'Sincronizar con el PC', onclick: () => sincronizarPorPuente() });
        chipsWeb.add(c);
        pintarChipWeb(c);
        return c;
      };
      window.chipMovilNuevo = () => nuevo();
      $('b-ajustes').before(nuevo('b-pc'));
      refrescarPendiente();
    }
    sincronizar();
    setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 15000);
  })();
  // Si la página se recarga con paneles apuntados en el historial, se empieza limpio
  if (history.state && history.state.capa) history.replaceState(null, '');
  pintarLista();
  pintarCuadernos();
  // (lo que llega del PC también se ve en la lista de cuadernos)
  alLlegarCambios($('vista-cuadernos'), () => pintarCuadernos());
  pintarCronometros();
  revisarCronometros();
  recogerCancelados();
  // En la web (GitHub Pages: el iPhone, o un Android sin la APK): funciona sin internet (sw.js) y se
  // pide que el navegador no borre lo guardado aunque falte sitio
  if (enLaWeb && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    // Si ya había una versión y se ha guardado otra nueva, decirlo (si no, se seguiría viendo la de antes)
    const habia = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (habia) avisar('Hay una versión nueva de la app', { texto: 'Abrirla', hacer: () => location.reload() });
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  // Un borrador de una receta que se estaba editando cuando se cerró la app
  const borrador = leer('quimica.borrador-receta', null);
  if (borrador && borrador.receta && Array.isArray(borrador.receta.pasos)) {
    quitarBorrador();
    avisar(`✏️ Tenías cambios sin guardar en «${borrador.receta.nombre || 'una receta nueva'}»`,
      { texto: 'Recuperar', hacer: () => abrirFormulario(borrador.receta, (guardada) => abrirDetalle(guardada.id), null, true) });
  }
})();
