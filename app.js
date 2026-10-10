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
  const abrirCapa = (el, alCerrar) => {
    const capa = { el, alCerrar, retener: null };
    capas.push(capa);
    history.pushState({ capa: capas.length }, '');
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
  });
  const atras = () => history.back();
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
    for (const f of (e && e.fotos) || []) window.Fotos.borrar(f).catch(() => {});
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
  // Ampliar una imagen dentro de su marco (lo pidió el usuario: «hacer zoom ampliando con los dedos»):
  // con dos dedos se amplía alrededor de donde están; con uno se mueve (si está ampliada); un toque
  // la amplía ×2,5 donde se toca, u otra vez a su tamaño; en el PC, la rueda del ratón. La imagen se
  // mueve con transform: un punto p de la imagen sale en t + s·p (s: aumento, t: desplazamiento)
  // alCambiar({ s, fx, fy }): avisa de cada cambio hecho aquí (fx, fy: el desplazamiento en partes
  // del marco), para ampliar igual otras fotos (al comparar). soloRueda: la rueda del ratón amplía
  // sin Ctrl (en la foto en grande sí; al comparar, no). Devuelve { fijar(estado) }, que pone un
  // estado sin avisar
  const hacerZoom = (marco, img, alCambiar, soloRueda = true) => {
    let s = 1;
    let t = { x: 0, y: 0 };
    const dedos = new Map(); // pointerId → { x, y } (dentro del marco)
    let gesto = null; // cómo estaba al empezar a mover o a pellizcar
    const MAX = 10;
    const enMarco = (ev) => { const r = marco.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    // Que la imagen no se salga: con s ≥ 1, t entre (tamaño − s·tamaño) y 0
    const ajustar = (avisar = true) => {
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
    const url = await urlDe(id).catch(() => null);
    if (!url) { avisar('Esa foto ya no está'); return; }
    const f = await window.Fotos.leer(id);
    const c = leerCuaderno();
    const entrada = c.entradas.find((e) => (e.fotos || []).includes(id));
    const titulo = h('b', { text: entrada ? K.tituloFoto(c, id, entrada) : f.nombre });
    const img = h('img', { src: url, alt: titulo.textContent });
    const marco = h('div', { class: 'visor-marco' }, img);
    hacerZoom(marco, img);
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
          entrada && h('small', { text: [entrada.grupo, K.momentoDe(c, entrada.grupoId, entrada.fecha), `${fechaCorta(entrada.fecha)} ${horaDe(entrada.fecha)}`, f.nombre].filter(Boolean).join(' · ') })),
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
      h('p', { class: 'visor-ayuda', text: 'Amplía con dos dedos (o tocándola) y muévela con uno' }));
    document.body.append(fondo);
    abrirCapa(fondo);
  };
  const miniaturas = (ids) => (ids && ids.length ? h('div', { class: 'miniaturas' }, ids.map((id) => {
    const img = h('img', { alt: 'Foto' });
    urlDe(id).then((u) => { if (u) img.src = u; else img.alt = '(foto borrada)'; }).catch(() => {});
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
    const grupos = K.gruposDe(cuaderno, recetaId).filter((g) => !g.juntadoEn);
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
  const prepararDisolucion = (receta, fase, { nombre, preparada, nota, fotos, sub, amb = ambitoActual(receta) }) => {
    // (con una copia de las cuentas de la receta, para poder corregir sus números después)
    const d = { id: idDe('d'), recetaId: receta.id, ...K.marcaDe(amb), nombre: nombre.slice(0, 80), fase, ...(sub ? { subfase: sub.nombre, rango: { desde: sub.desde, hasta: sub.hasta } } : {}), fecha: Date.now(), preparada: preparada || '', composicion: Q.composicionDe(receta, fase, sub), hoja: Q.hojaDe(receta), estado: 'queda', queda: '' };
    cambiarCuaderno((c) => { c.disoluciones.push(d); });
    const entrada = apuntar({ tipo: 'preparar', disolucionId: d.id, disolucion: d.nombre, fase, recetaId: receta.id, ...K.marcaDe(amb), receta: receta.nombre, nota, fotos });
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
      const { disolucion, entrada } = prepararDisolucion(receta, tramo.titulo, { nombre: nombreDis.value.trim() || K.nombreDisolucion(leerCuaderno(), amb, tramo.titulo, sub && sub.nombre), preparada: cuanta.value.trim(), nota: r.nota, fotos: r.fotos, sub, amb });
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
    const e = apuntar({ tipo: 'fase', fase: tramo.titulo, ...(sub ? { subfase: sub.nombre } : {}), grupoId: g ? g.id : null, grupo: g ? g.nombre : null, recetaId: receta.id, ...K.marcaDe(amb), receta: receta.nombre, nota: r.nota, fotos: r.fotos, ...(usadas.length ? { disoluciones: usadas } : {}) });
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
    // Deslizar: un gesto sobre todo horizontal y de más de 70 px (no en una casilla ni en algo que se
    // desplaza de lado)
    let dedo0 = null;
    cuerpo.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      dedo0 = e.touches.length === 1 && !e.target.closest('input, textarea, select, .arbol-caja, .miniaturas') ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    cuerpo.addEventListener('touchend', (e) => {
      if (!dedo0 || leer('quimica.receta-junta', false) === true) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - dedo0.x;
      const dy = t.clientY - dedo0.y;
      dedo0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 1.6 * Math.abs(dy)) irPagina(dx < 0 ? 'pasos' : 'datos');
    }, { passive: true });

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
      }
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
    const { cuerpo } = abrirPanel('Calculadora');
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
  const mantenerYArrastrar = (caja, alSoltar) => {
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
        otra.parentNode.insertBefore(tarjeta, e.clientY > r.top + r.height / 2 ? otra.nextSibling : otra);
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
    const r = await preguntar({ texto: k ? '📓 Cambiar el cuaderno' : '📓 Nuevo cuaderno', detalle: [
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Nombre' }), nombre),
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'Va con la receta' }), receta),
      esPrincipal && h('p', { class: 'dialogo-detalle', text: 'Es el cuaderno de siempre de esta receta: su receta no se cambia.' }),
      h('label', { class: 'etiqueta-campo' }, h('span', { text: 'De qué va' }), nota),
      !k && h('p', { class: 'dialogo-detalle', text: 'Empieza vacío. La receta se le puede poner o cambiar después con ✏️.' })],
    si: k ? 'Guardar' : 'Crear', no: 'Cancelar', otro: k && !esPrincipal && !tieneAlgo ? '🗑️ Quitar este cuaderno (está vacío)' : null });
    if (r === 'otro') {
      cambiarCuaderno((d) => { d.cuadernos = d.cuadernos.filter((x) => x.id !== k.id); });
      return 'quitado';
    }
    if (!r || !nombre.value.trim()) return null;
    const nuevaReceta = esPrincipal ? k.recetaId : receta.value || null;
    const cambiaReceta = k && !esPrincipal && (k.recetaId || null) !== nuevaReceta;
    if (cambiaReceta && c.grupos.some((g) => K.casa(g, amb))
      && !await preguntar({ texto: '¿Cambiar la receta del cuaderno?', detalle: 'Sus grupos de muestras siguen las fases de la receta: con otra, sus fases pueden no cuadrar.', si: 'Cambiar', no: 'Cancelar' })) return null;
    const id = k ? k.id : idDe('n');
    cambiarCuaderno((d) => {
      let x = d.cuadernos.find((y) => y.id === id);
      // (el Cuaderno 1 de una receta no tiene ficha hasta que se le cambia algo)
      if (!x) { x = { id, recetaId: k ? k.recetaId : nuevaReceta, fecha: k ? 0 : Date.now() }; d.cuadernos.push(x); }
      x.nombre = nombre.value.trim().slice(0, 60);
      x.nota = nota.value.trim();
      if (cambiaReceta) {
        // Lo suyo pasa a ser de esa receta
        x.recetaId = nuevaReceta;
        for (const y of [...d.grupos, ...d.entradas, ...d.disoluciones, ...d.carpetas, ...d.albumes]) {
          if (y.cuadernoId !== id) continue;
          y.recetaId = nuevaReceta;
          if ('receta' in y) y.receta = nuevaReceta ? nombreDeReceta(d, nuevaReceta) : null;
        }
      }
    });
    return id;
  };

  // ─── La pantalla principal: los cuadernos ───
  // Todos: los creados (con o sin receta) y el de cada receta que tenga algo, lo último usado arriba
  // (en la app de internet conectada al PC: «💻 Tienes cambios sin pasar al PC»; se pone más abajo)
  let avisoPendientePC = () => null;
  const pintarCuadernos = () => {
    const caja = $('vista-cuadernos');
    const c = leerCuaderno();
    const lista = K.todosLosCuadernos(c);
    // Arriba, lo que les toca hoy o mañana a los grupos (o ya se pasó)
    poner(caja, avisoPendientePC(), avisosDeToca(c, null, pintarCuadernos), lista.length
      ? lista.map((x) => h('button', { class: 'tarjeta cuaderno-tarjeta', onclick: () => abrirCuadernoDe(x.ambito.cuadernoId, x.ambito.recetaId, pintarCuadernos) },
        h('h3', { text: `📓 ${x.ficha.nombre}` }),
        h('p', { text: x.ambito.recetaId ? `📋 ${nombreDeReceta(c, x.ambito.recetaId)}` : 'Sin receta (solo notas)' }),
        h('p', { class: 'meta', text: [x.grupos && `🧫 ${x.grupos} ${x.grupos === 1 ? 'grupo' : 'grupos'}`, x.entradas && `📖 ${x.entradas} ${x.entradas === 1 ? 'apunte' : 'apuntes'}`, x.ultima && `último: ${fechaCorta(x.ultima)}`].filter(Boolean).join(' · ') || 'Nada apuntado todavía' })))
      : h('div', { id: 'vacio-cuadernos' },
        h('p', { class: 'vacio-dibujo', text: '📓' }),
        h('p', { text: 'Aún no hay ningún cuaderno.' }),
        h('p', { class: 'nota', text: 'Cada cuaderno es un experimento: sus grupos de muestras, sus disoluciones, sus fotos y lo que vas apuntando. Crea uno con «＋ Nuevo cuaderno», o abre una receta (📋, arriba) y pulsa «🏁 Terminar fase»: se apunta en su cuaderno.' })));
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
    // Sus fotos: se quitan con ✕ y se añaden otras, y se reparten en apartados con título (lo pidió
    // el usuario: «ordenar las fotos en grupos y ponerles título», que luego se ve en Fotos). Todo se
    // guarda al dar a Guardar. Cada apartado lleva una clave suya (k) para poder cambiarle el título
    let quedan = [...(e.fotos || [])];
    let aparts = K.apartadosDe(e, true).filter((a) => a.titulo).map((a) => ({ k: idDe('a'), titulo: a.titulo }));
    const enAp = new Map(quedan.map((id) => { const a = aparts.find((x) => x.titulo === K.infoFoto(e, id).apartado); return [id, a ? a.k : '']; }));
    const cajaFotos = h('div', { class: 'apartados-editor' });
    const miniatura = (id) => {
      const img = h('img', { alt: 'Foto' });
      urlDe(id).then((u) => { if (u) img.src = u; else img.alt = '(foto borrada)'; }).catch(() => {});
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
      }
    });
    if (dis) dis.guardar();
    for (const id of quitadas) window.Fotos.borrar(id).catch(() => {});
    alCambiar();
  };
  // Un apunte con los grupos que nombra (separar, juntar) con su nombre de ahora, por si se les cambió
  const conNombresDeAhora = (c, e) => {
    const n = e.nuevoId && K.grupoDe(c, e.nuevoId);
    const d = e.tipo === 'recibir' && e.desdeId && K.grupoDe(c, e.desdeId);
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
  const arbolDeMuestras = (c, receta, abrir, amb = ambitoActual(receta)) => {
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
      ? [...carpetas.map((k) => ({ nombre: `📁 ${k.nombre}`, grupos: K.gruposEnCarpeta(c, amb, k.id) })),
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
    const ANCHO = Math.max(62, Math.min(92, Math.floor((Math.min(window.innerWidth, 860) - 34 - IZQ - 30) / columnas.length)));
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
    const colores = new Map(porFecha.map((g) => [g.id, COLORES_GRUPO[n++ % COLORES_GRUPO.length]]));
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
      const nombreX = repitiendo ? xi - 10 : aLaDerecha ? xFin + 9 : xFin - 10;
      const nombreY = repitiendo ? y(abajoDel) + 17 : y(fin) + (aLaDerecha ? -6 : 17);
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
            s('text', { x: fuera - 13, y: (arriba + abajo) / 2 + 4, class: 'arbol-vuelta-icono' }, '🔁'));
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
            return s('text', { x: cx + 6 + 13 * n2, y: cy - 3, class: 'arbol-analisis', ...deQuien(g.id, e.fecha) }, s('title', {}, `${K.titularDe(e)} · ${fechaCorta(e.fecha)}`), '🔬');
          });
        })(),
        // El final: una raya (o ● si está en una fase) y el nombre
        est.estado === 'en'
          ? s('circle', { cx: xFin, cy: y(fin), r: 6, fill: color, ...deQuien(g.id, Infinity) })
          : s('line', { x1: xFin - 10, y1: y(fin), x2: xFin + 10, y2: y(fin), stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round', ...deQuien(g.id, Infinity) }),
        void etiquetas.push(s('g', { class: 'arbol-etiqueta', 'data-grupo': g.id, 'data-dueno': g.id, 'data-nombre': '1' }, s('text', { x: nombreX, y: nombreY, class: 'arbol-nombre', fill: color }, `${est.estado === 'terminado' ? '✅ ' : est.estado === 'juntado' ? '🔗 ' : ''}${corto(g.nombre, est.estado === 'terminado' || est.estado === 'juntado' ? LETRAS - 2 : LETRAS)}`),
        // (en corto, para que no se monte con el de al lado; un grupo juntado ya no tiene)
        g.muestras != null && est.estado !== 'juntado' && s('text', { x: nombreX, y: nombreY + 14, class: 'arbol-muestras' }, `🧫 ${g.muestras}`))),
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
      h('p', { class: 'arbol-leyenda', text: '● va por aquí · ━ terminó ahí · 🔁 repitió fases · 🔬 análisis · ┅ se juntó con otro · un hueco en una línea: la otra pasa por encima sin tocarla · en gris: lo que hizo en otra carpeta' }));
    // (el color de cada grupo, para que sus tarjetas lleven el mismo)
    zona.colores = colores;
    return zona;
  };

  // Un cuaderno. Con receta: su árbol, sus grupos (al tocar uno, lo que se puede hacer con él), sus
  // disoluciones, sus fotos y su bitácora; sin receta: solo notas y fotos. A la derecha, la pestaña
  // de las notas libres (abrirNotas). alVolver: para repintar la lista de antes
  // ─── El informe de un cuaderno (versión 86, lo pidió el usuario: «toda la historia de un cuaderno
  // en un documento ordenado», para la memoria o para el tutor) ───
  // Se ve en la app y se guarda como PDF con «🖨️» (en Android, con el plugin Imprimir; en el PC y en
  // el iPhone, con la impresión del navegador). Devuelve { el, listo } (listo: cuando ya están las fotos)
  const informeDe = (c, receta, amb, ficha, { conFotos }) => {
    const esperas = [];
    const grupos = receta ? K.gruposDe(c, amb) : [];
    const entradas = c.entradas.filter((e) => K.casa(e, amb)).map((e) => conNombresDeAhora(c, e)).sort((a, b) => a.fecha - b.fecha);
    const disoluciones = receta ? [...K.disolucionesDe(c, amb)].sort((a, b) => a.fecha - b.fecha) : [];
    const arbol = receta && grupos.length ? arbolDeMuestras(c, receta, () => {}, amb) : null;
    const colorDe = (id) => (arbol && arbol.colores.get(id)) || null;
    const fechaLarga = (ms) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    let nFoto = 0;
    const foto = (e, id) => {
      const img = h('img', { alt: '' });
      esperas.push(urlDe(id).then((u) => { if (u) { img.src = u; return img.decode().catch(() => {}); } img.alt = '(foto borrada)'; return null; }).catch(() => {}));
      const info = K.infoFoto(e, id);
      return h('figure', { class: 'informe-foto' }, img,
        h('figcaption', { text: [`Foto ${++nFoto}`, c.titulos[id], info.aumento, info.zona].filter(Boolean).join(' · ') }));
    };
    const fotosDeEntrada = (e) => {
      if (!conFotos || !(e.fotos || []).length) return null;
      return K.apartadosDe(e).map((a) => [a.titulo && h('p', { class: 'informe-apartado', text: `📂 ${a.titulo}` }),
        h('div', { class: 'informe-fotos' }, a.fotos.map((id) => foto(e, id)))]);
    };
    // Lo que ha ido haciendo cada grupo, en una línea por cosa (lo suyo, sin lo heredado)
    const hitos = (g) => entradas.filter((e) => e.grupoId === g.id && ['empezar', 'fase', 'analisis', 'separar', 'juntar', 'recibir'].includes(e.tipo))
      .map((e) => `${fechaCorta(e.fecha)}: ${K.titularDe(e)}`);
    const dias = [];
    for (const e of entradas) {
      const d = diaDe(e.fecha);
      if (!dias.length || dias[dias.length - 1].dia !== d) dias.push({ dia: d, lista: [] });
      dias[dias.length - 1].lista.push(e);
    }
    const otrosDelEvento = (e) => entradas.filter((x) => x.evento && x.evento === e.evento && x.id !== e.id).map((x) => x.grupo).filter(Boolean);
    const el = h('article', { class: 'informe' },
      h('header', { class: 'informe-cabecera' },
        h('h1', { text: `📓 ${ficha.nombre}` }),
        h('p', { text: receta ? `Receta: ${receta.nombre}` : 'Sin receta (solo notas)' }),
        ficha.nota && h('p', { class: 'informe-nota', text: ficha.nota }),
        h('p', { class: 'informe-meta', text: [`Informe del ${fechaLarga(Date.now())}`, entradas.length && `${entradas.length} apuntes, del ${fechaLarga(entradas[0].fecha)} al ${fechaLarga(entradas[entradas.length - 1].fecha)}`].filter(Boolean).join(' · ') })),
      arbol && [h('h2', { text: '🌳 Cómo van las muestras' }), (() => {
        const caja = arbol.querySelector('.arbol-caja');
        const leyenda = arbol.querySelector('.arbol-leyenda');
        return h('div', { class: 'informe-arbol' }, caja, leyenda);
      })()],
      grupos.length > 0 && [h('h2', { text: '🧫 Grupos de muestras' }),
        h('table', { class: 'informe-tabla' },
          h('thead', {}, h('tr', {}, ['Grupo', 'Muestras', 'Cómo va', 'De dónde salió'].map((t) => h('th', { text: t })))),
          h('tbody', {}, grupos.map((g) => {
            const padre = g.padre && K.grupoDe(c, g.padre);
            return h('tr', {},
              h('td', {}, h('span', { class: 'informe-color', style: colorDe(g.id) ? `background: ${colorDe(g.id)}` : null }), g.nombre),
              h('td', { text: g.muestras == null ? '—' : String(g.muestras) }),
              h('td', { text: textoEstado(estadoGrupo(c, g)) }),
              h('td', { text: g.padre ? `De «${padre ? padre.nombre : 'un grupo quitado'}», el ${fechaCorta(g.desde)}` : '—' }));
          }))),
        grupos.map((g) => {
          const lista = hitos(g);
          return lista.length > 0 && h('div', { class: 'informe-hitos' }, h('b', { text: g.nombre }), h('ul', {}, lista.map((t) => h('li', { text: t }))));
        })],
      disoluciones.length > 0 && [h('h2', { text: '🧪 Disoluciones' }), disoluciones.map((d) => {
        const usos = K.usadaPor(c, d.id);
        return h('section', { class: 'informe-disolucion' },
          h('h3', { text: d.nombre }),
          h('p', { class: 'informe-meta', text: [d.fase && K.nombreFase(d.fase), `preparada el ${fechaLarga(d.fecha)}`, d.preparada && `(${d.preparada})`, K.ESTADOS[d.estado || 'queda'], d.queda && `quedan ${d.queda}`].filter(Boolean).join(' · ') }),
          (d.composicion || []).length > 0 && h('table', { class: 'informe-tabla' }, h('tbody', {}, d.composicion.map((x) => h('tr', {}, h('td', { text: x.nombre }), h('td', { class: 'informe-numero', text: x.texto }))))),
          usos.length > 0 && h('p', { text: `Usada por: ${usos.map((u) => u.grupo).join(', ')}` }));
      })],
      entradas.length > 0 && [h('h2', { text: '📖 Historia' }), dias.map((d) => h('section', { class: 'informe-dia' },
        h('h3', { text: d.dia }),
        d.lista.map((e) => h('div', { class: 'informe-entrada', style: colorDe(e.grupoId) ? `--gc: ${colorDe(e.grupoId)}` : null },
          h('p', { class: 'informe-titular' }, h('span', { class: 'informe-hora', text: horaDe(e.fecha) }), ' ',
            e.grupo && h('b', { text: `${e.grupo} · ` }), K.titularDe(e)),
          e.aprox && h('p', { class: 'informe-meta', text: '📅 Fecha por confirmar' }),
          e.disoluciones && e.disoluciones.length > 0 && h('p', { class: 'informe-meta', text: `🧪 Con ${e.disoluciones.map((x) => x.nombre).join(', ')}` }),
          e.evento && otrosDelEvento(e).length > 0 && h('p', { class: 'informe-meta', text: `👥 A la vez que ${otrosDelEvento(e).join(', ')}` }),
          e.tipo === 'comparar' && (e.de || []).length > 0 && h('p', { class: 'informe-meta', text: `De: ${e.de.join(', ')}` }),
          e.nota && h('p', { class: 'informe-texto', text: e.nota }),
          fotosDeEntrada(e))))) ],
      ficha.notas && String(ficha.notas).trim() && [h('h2', { text: '📝 Notas del cuaderno' }), h('p', { class: 'informe-texto', text: ficha.notas })],
      !entradas.length && !grupos.length && h('p', { text: 'Aún no hay nada apuntado en este cuaderno.' }));
    return { el, listo: Promise.all(esperas) };
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
  const abrirInforme = (receta, amb, ficha) => {
    const { cuerpo } = abrirPanel('📄 Informe', null, () => {
      const zona = document.getElementById('impresion');
      if (zona) zona.replaceChildren();
      document.body.classList.remove('imprimiendo');
    });
    let conFotos = true;
    let actual = null;
    const hoja = h('div', { class: 'informe-hoja' });
    const boton = h('button', { class: 'boton', text: '🖨️ Guardar como PDF o imprimir', onclick: async () => {
      if (!actual) return;
      boton.disabled = true;
      await actual.listo;
      boton.disabled = false;
      imprimirInforme(actual.el, `Informe ${ficha.nombre}`);
    } });
    const pintar = () => {
      actual = informeDe(leerCuaderno(), receta, amb, ficha, { conFotos });
      poner(hoja, actual.el);
    };
    poner(cuerpo,
      h('p', { class: 'nota', text: 'Toda la historia del cuaderno, ordenada. Con «Guardar como PDF» eliges «Guardar como PDF» (o una impresora) en el cuadro que sale.' }),
      h('label', { class: 'parte-opcion' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { conFotos = e.target.checked; pintar(); } }), ' Con las fotos'),
      boton,
      hoja);
    pintar();
  };

  const abrirCuadernoDe = (cid, recetaIdInicial, alVolver) => {
    // ✏️ arriba: cambiar el nombre del cuaderno, su receta o de qué va (lo pone pintar)
    let editarEste = null;
    const { cuerpo, titulo, panel } = abrirPanel('📓', [h('button', { class: 'icono', 'aria-label': 'Cambiar el nombre del cuaderno', text: '✏️', onclick: () => { if (editarEste) editarEste(); } })], alVolver);
    let filtro = 'todos'; // 'todos', o el id de un grupo
    let busqueda = ''; // lo escrito en «Buscar en la bitácora»
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
    const pintar = () => {
      const c = leerCuaderno();
      const ficha = K.fichaCuaderno(c, { cuadernoId: cid, recetaId: recetaIdInicial });
      // (el Cuaderno 1 de una receta va siempre con ella; uno creado, con la que tenga puesta)
      const rid = cid === K.principal(recetaIdInicial) ? recetaIdInicial : ficha.recetaId || null;
      const amb = K.ambito(rid, cid);
      receta = rid ? recetaDe(rid) || { id: rid, nombre: nombreDeReceta(c, rid), pasos: [] } : null;
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
            : h('span', { class: 'cuaderno-receta', text: rid ? `📋 ${receta.nombre} (borrada)` : 'Sin receta (solo notas)' }),
          ficha.nota && h('p', { class: 'carpeta-nota', text: ficha.nota })),
        h('button', { class: 'icono pequeno', 'aria-label': 'Cambiar el cuaderno', text: '✏️', onclick: editarEste }));
      // Sin receta: notas (con fotos) y la bitácora
      if (!receta) {
        const notas = c.entradas.filter((e) => K.casa(e, amb));
        poner(cuerpo, cabecera,
          h('p', { class: 'nota', text: 'Ponle una receta con ✏️ para tener grupos de muestras, fases, disoluciones y el árbol. Mientras, puedes apuntar notas y fotos, y escribir en «📝 Notas» (a la derecha).' }),
          h('h3', { text: '📖 Bitácora' }),
          h('button', { class: 'boton secundario', text: '✍️ Apuntar una nota', onclick: async () => {
            const r = await pedirApunte({ texto: `✍️ Nota · ${ficha.nombre}` });
            if (!r || (!r.nota && !r.fotos.length)) return;
            apuntar({ tipo: 'nota', grupoId: null, grupo: null, recetaId: null, ...K.marcaDe(amb), receta: null, nota: r.nota, fotos: r.fotos });
            pintar();
          } }),
          bitacoraBuscada(c, notas, { desde: null, alCambiar: pintar }, h('p', { class: 'nota', text: 'Aún no hay nada apuntado.' })),
          botonCopiar(ficha.nombre, notas),
          notas.length > 0 && h('button', { class: 'boton secundario', text: '📄 Hacer un informe con toda la historia (PDF)', onclick: () => abrirInforme(null, amb, ficha) }));
        return;
      }
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
        const posibles = K.gruposDe(c, amb).filter((g) => !g.juntadoEn);
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
        const zonaFase = h('div', { hidden: true }, fase.el, cajaDis);
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
      poner(cuerpo,
        cabecera,
        avisosDeToca(c, amb, pintar),
        arbol && [h('h3', { text: '🌳 Cómo van las muestras' }), arbol],
        h('h3', { text: '🧫 Grupos de muestras' }),
        grupos.length
          ? (() => {
            // Los grupos, repartidos en sus carpetas (y los que no van en ninguna, al final). Se
            // cambian de sitio y de carpeta manteniendo pulsado y arrastrando
            const carpetas = K.carpetasDe(c, amb);
            // Cada grupo, con el color de su línea en el árbol
            const colorDe = (g) => arbol && arbol.colores.get(g.id);
            const tarjeta = (g) => h('button', { class: `tarjeta grupo${colorDe(g) ? ' con-color' : ''}`, 'data-id': g.id, style: colorDe(g) ? `--gc: ${colorDe(g)}` : null, onclick: () => abrirGrupo(receta, g.id, pintar) },
              h('h3', {}, g.nombre, g.muestras != null && h('small', { class: 'grupo-muestras', text: ` · ${muestrasTexto(g.muestras)}` })),
              h('p', { text: textoEstado(estadoGrupo(c, g)) }));
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
        } }),
        h('h3', { text: '🖼️ Fotos' }),
        (() => {
          const n = K.fotosDe(c, amb).length;
          return h('button', { class: 'boton secundario', text: n ? `🖼️ Ver las ${n === 1 ? 'fotos (1)' : `${n} fotos`} y compararlas` : '🖼️ Fotos (aún no hay ninguna)', onclick: () => abrirFotos(receta, pintar, amb) });
        })(),
        h('h3', { text: '📖 Bitácora' }),
        grupos.length > 1 && h('div', { class: 'chips' },
          [{ id: 'todos', nombre: 'Todos' }, ...grupos].map((g) => h('button', { class: 'chip', 'aria-pressed': String(filtro === g.id), text: g.nombre, onclick: () => { filtro = g.id; pintar(); } }))),
        h('button', { class: 'boton secundario', text: '✍️ Apuntar una nota', onclick: nuevaNota }),
        grupos.length > 1 && h('button', { class: 'boton secundario', text: '👥 Apuntar algo de varios grupos a la vez (microscopio, fases…)', onclick: apuntarVarios }),
        bitacoraBuscada(c, entradas, { desde: filtro === 'todos' ? null : filtro, alCambiar: pintar },
          h('p', { class: 'nota', text: 'Aún no hay nada. Al final de cada fase de los pasos de la receta está el botón «🏁 Terminar fase»; y tocando un grupo, todo lo demás. Se apunta aquí con la fecha y la hora.' })),
        botonCopiar(`${receta.nombre} · ${ficha.nombre}`, entradas),
        h('h3', { text: 'Más' }),
        h('button', { class: 'boton secundario', text: '📄 Hacer un informe con toda la historia (PDF)', onclick: () => abrirInforme(receta, amb, ficha) }),
        h('button', { class: 'boton secundario', text: '📓 Empezar otro cuaderno con esta receta (otro experimento)', onclick: async () => {
          const id = await editarFichaCuaderno(null, rid);
          if (!id || id === 'quitado') return;
          const k = K.fichaCuaderno(leerCuaderno(), { cuadernoId: id });
          cerrarCapas(1, () => abrirCuadernoDe(id, k.recetaId || null, alVolver));
        } }));
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
        const r = await pedirApunte({ texto: `🏁 Terminar una fase · ${g.nombre}`, antes: [f.el, dis.el] });
        if (!r) return;
        apuntar({ tipo: 'fase', fase: f.fase(), ...comun(), ...r, ...dis.elegidas() });
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
            if (e.tipo === 'recibir' && e.desdeId === x.id) e.desde = x.nombre;
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
      const puedeTocar = fases.length > 0 && !g.juntadoEn && (est.estado === 'espera' || est.estado === 'nada') && est.siguiente !== undefined;
      const quitar = async () => {
        if (!await preguntar({ texto: `¿Quitar el grupo «${g.nombre}»?`, detalle: 'Lo apuntado en la bitácora se queda.', si: 'Quitar', peligro: true })) return;
        quitarGrupo(grupoId);
        atras();
      };

      const historia = K.historiaDe(c, g.id);
      const padre = g.padre && K.grupoDe(c, g.padre);
      const hayFases = fases.length > 0;
      poner(cuerpo,
        h('div', { class: 'caja grupo-estado' },
          g.muestras != null && h('p', { class: 'grupo-cuantas', text: muestrasTexto(g.muestras) }),
          h('p', { text: textoEstado(est) }),
          g.padre && h('small', { class: 'nota', text: `Salió de «${padre ? padre.nombre : 'un grupo quitado'}» el ${fechaCorta(g.desde)}` }),
          puedeTocar && h('button', { class: 'enlace', type: 'button', onclick: ponerFecha,
            text: g.toca ? `📅 Le toca ${cuandoToca(g.toca)}: cambiar` : '📅 ¿Cuándo le toca? (para que te avise)' })),
        // Juntado con otro: ya no sigue (solo notas); si no, todo lo que se puede hacer
        g.juntadoEn
          ? h('div', { class: 'acciones-grupo' },
            h('button', { class: 'boton secundario', text: `🔗 Ir a «${est.con}»`, onclick: () => cerrarCapas(1, () => abrirGrupo(receta, g.juntadoEn, alVolver)) }),
            h('button', { class: 'boton secundario', text: '📷 Nota o fotos', onclick: nota }))
          : h('div', { class: 'acciones-grupo' },
            hayFases && h('button', { class: 'boton', text: est.estado === 'en' ? '🏁 Terminar fase' : '▶ Empezar fase', onclick: est.estado === 'en' ? terminar : empezar }),
            hayFases && h('button', { class: 'boton secundario', text: est.estado === 'en' ? '▶ Empezar otra fase' : '🏁 Terminar fase', onclick: est.estado === 'en' ? empezar : terminar }),
            h('button', { class: 'boton secundario', text: '🔬 Muestra para analizar', onclick: analisis }),
            h('button', { class: 'boton secundario', text: '✂️ Separar muestras', onclick: separar }),
            h('button', { class: 'boton secundario', text: '🔗 Juntar con otro grupo', onclick: juntarCon }),
            h('button', { class: 'boton secundario', text: '📷 Nota o fotos', onclick: nota })),
        h('h3', { text: '📖 Su historia' }),
        historia.length
          ? bitacora(historia, { desde: g.id, alCambiar: pintar })
          : h('p', { class: 'nota', text: 'Aún no hay nada apuntado de este grupo.' }),
        botonCopiar(`${receta.nombre} · ${g.nombre}`, historia),
        h('h3', { text: 'Más' }),
        h('button', { class: 'boton secundario', text: '✏️ Cambiar el nombre, las muestras o lo que le toca', onclick: editar }),
        h('button', { class: 'boton discreto', text: '🗑️ Quitar el grupo', onclick: quitar }));
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
  const fotoImg = (id) => {
    const img = h('img', { alt: '' });
    urlDe(id).then((u) => { if (u) img.src = u; else img.alt = '(foto borrada)'; }).catch(() => {});
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
  const coloresDe = (c, receta, amb) => { const a = arbolDeMuestras(c, receta, () => {}, amb); return a ? a.colores : new Map(); };
  // Los tipos de apunte con fotos, para filtrar (K.tipoFoto)
  const TIPOS_FOTO = [['analisis', '🔬 Análisis'], ['fases', '🧫 Fases'], ['disoluciones', '🧪 Disoluciones'], ['notas', '✍️ Notas']];

  // Las fotos en una tabla (versión 95, de las ideas pendientes de las fotos): los grupos en columnas y
  // los aumentos en filas, para ver de un vistazo cómo se ve cada grupo a cada aumento. Usa el mismo
  // filtro de tipo que Fotos (de entrada, solo los análisis); tocar una foto la abre en grande
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
          title: `${fechaCorta(f.entrada.fecha)} · ${K.momentoDe(c, f.entrada.grupoId, f.entrada.fecha)}`, onclick: () => verFoto(f.id, pintar) }, fotoImg(f.id))));
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
  const abrirFotos = (receta, alVolver, amb = ambitoActual(receta)) => {
    const { cuerpo } = abrirPanel('🖼️ Fotos', null, alVolver);
    const filtro = { grupos: new Set(), apartado: '', aumento: '' }; // vacío = todos
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
      for (const id of [...filtro.grupos]) if (!grupos.some(([g]) => g === id)) filtro.grupos.delete(id);
      if (!apartados.includes(filtro.apartado)) filtro.apartado = '';
      if (!aumentos.includes(filtro.aumento)) filtro.aumento = '';
      const fotos = base.filter((f) => {
        const info = K.infoFoto(f.entrada, f.id);
        return (!filtro.grupos.size || filtro.grupos.has(f.entrada.grupoId)) && (!filtro.apartado || info.apartado === filtro.apartado) && (!filtro.aumento || info.aumento === filtro.aumento);
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
          h('button', { class: 'foto-imagen', 'aria-label': 'Ver en grande', onclick: () => verFoto(id, pintar) }, fotoImg(id)),
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
            elegir('🔍 Aumento', 'aumento', aumentos)),
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
        const img = fotoImg(id);
        const marco = h('div', { class: 'comp-marco' }, img);
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
        const z = hacerZoom(marco, img, (estado) => { if (juntas()) for (const [otro, oz] of zooms) if (otro !== id) oz.fijar(estado); }, false);
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
    if (r.status === 403) throw new Error('El código no es el del PC');
    // (el PC bloquea un rato tras 5 códigos equivocados seguidos: versión 96)
    if (r.status === 429) throw new Error(`Demasiados intentos con un código equivocado: el PC no contesta durante ${r.headers.get('Retry-After') || 60} s. Revisa el código`);
    if (!r.ok) throw new Error(`El PC ha contestado ${r.status}`);
    return r;
  };
  const datosLocales = () => {
    const c = leerCuaderno();
    const porId = (lista) => Object.fromEntries(lista.map((x) => [x.id, x]));
    return { recetas: porId(recetas), grupos: porId(c.grupos), entradas: porId(c.entradas), disoluciones: porId(c.disoluciones), carpetas: porId(c.carpetas), cuadernos: porId(c.cuadernos), albumes: porId(c.albumes), titulos: { ...c.titulos }, comparar: { ...c.comparar } };
  };
  const sellar = () => {
    const meta = S.sellar(leer('quimica.sincro', null), datosLocales(), Date.now());
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
    guardar('quimica.cuaderno', { grupos: Object.values(datos.grupos), entradas: Object.values(datos.entradas), disoluciones: Object.values(datos.disoluciones), carpetas: Object.values(datos.carpetas || {}), cuadernos: Object.values(datos.cuadernos || {}), albumes: Object.values(datos.albumes || {}), titulos: datos.titulos, comparar: datos.comparar });
    guardar('quimica.sincro', meta);
    const despues = datosLocales();
    return S.COLECCIONES.filter((c) => antes[c] !== S.huella(despues[c]));
  };

  let sincronizando = false;
  let otraVez = false;
  let pcAlDia = null; // { base, fecha }: el programa del PC sabe guardar todas las colecciones de aquí
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
        const hola = await (await pedirPC(pc.base, pc.codigo, '/api/hola', { espera: 6000 })).json();
        const sabe = Array.isArray(hola.colecciones) ? hola.colecciones : [];
        const falta = S.COLECCIONES.filter((c) => !sabe.includes(c));
        if (falta.length) throw new Error('Química PC está desactualizado: en el PC, cierra su ventana y vuelve a abrirlo (doble clic en «Quimica PC»). Hasta entonces no se sincroniza, para no perder nada');
        pcAlDia = { base: pc.base, fecha: Date.now() };
      }
      const meta = sellar();
      const datos = datosLocales();
      const huellaAntes = S.huella(datos);
      const fotosAqui = await window.Fotos.ids().catch(() => []);
      const r = await (await pedirPC(pc.base, pc.codigo, '/api/sincronizar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: S.estadoDe(meta, datos), fotos: fotosAqui }),
      })).json();
      // Si mientras tanto se ha cambiado algo aquí, no se pisa: se vuelve a sincronizar enseguida
      if (S.huella(datosLocales()) !== huellaAntes) { otraVez = true; return; }
      const cambiadas = quedarse(r.estado);
      // Las fotos: las que el PC no tiene, se le mandan; las que tiene y aquí no, se traen
      let fotos = 0;
      for (const id of r.pedir || []) {
        const f = await window.Fotos.leer(id);
        if (!f) continue;
        const info = encodeURIComponent(JSON.stringify({ nombre: f.nombre, ancho: f.ancho, alto: f.alto, fecha: f.fecha }));
        await pedirPC(pc.base, pc.codigo, `/api/fotos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-foto': info }, body: f.blob, espera: 60000 });
        fotos++;
      }
      for (const id of (r.tiene || []).filter((x) => !fotosAqui.includes(x))) {
        const resp = await pedirPC(pc.base, pc.codigo, `/api/fotos/${id}`, { espera: 60000 });
        let info = {};
        try { info = JSON.parse(decodeURIComponent(resp.headers.get('x-foto') || '%7B%7D')); } catch { /* sin datos */ }
        await window.Fotos.guardar({ id, blob: await resp.blob(), nombre: info.nombre || 'foto', ancho: info.ancho, alto: info.alto, fecha: info.fecha || Date.now() });
        fotos++;
      }
      estadoPC = { ok: true, fecha: Date.now(), cambios: cambiadas.length, fotos };
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
          const fotos = [];
          for (const id of ids) {
            const f = await window.Fotos.leer(id).catch(() => null);
            if (f && f.blob) fotos.push({ id, blob: f.blob, nombre: f.nombre, ancho: f.ancho, alto: f.alto, fecha: f.fecha });
          }
          mensaje = { tipo: 'quimica-sincronizar', codigo: pc.codigo || '', estado: S.estadoDe(meta, datos), fotos, colecciones: S.COLECCIONES };
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
    try {
      const r = await (await pedirPC(`http://${conPuerto}`, codigo.trim(), '/api/hola', { espera: 6000 })).json();
      if (r.app !== 'quimica-pc') throw new Error('Ahí no está Química PC');
    } catch (e) {
      avisar(e.name === 'TimeoutError' || e.name === 'TypeError'
        ? 'No se encuentra el PC. Mira que Química PC esté abierto, que los dos estéis en la misma wifi y la dirección.'
        : e.message);
      return false;
    }
    guardar('quimica.pc', { direccion: conPuerto, codigo: codigo.trim() });
    await sincronizar({ avisarFallo: true });
    return true;
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
        h('p', { class: 'nota', text: 'A mano, sin QR (en el móvil: ⚙️ Ajustes → 💻 Conectar con el PC):' }),
        h('p', {}, 'Dirección: ', h('b', { text: (r.direcciones || []).join('  o  ') || '(este PC no está en ninguna red)' })),
        h('p', {}, 'Código: ', h('b', { class: 'codigo-pc', text: r.codigo })),
        // (lo del cable solo si este PC tiene las herramientas de Android; la carpeta es la de quien lo abre)
        h('p', { class: 'nota', text: `${r.cable ? 'O por cable USB (Android): conecta el cable y, en el móvil, «🔌 Por cable USB». ' : ''}Tus datos y fotos se guardan en la carpeta:` }),
        h('p', { class: 'ruta-datos', text: r.carpeta }),
        // Cambiar la carpeta de datos (versión 103): se copia lo que haya y se sigue ahí
        h('button', { class: 'boton secundario', type: 'button', text: '📁 Cambiar la carpeta de datos…', onclick: async () => {
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
        // Usar una carpeta que YA tiene datos (versión 110): por ejemplo, tras descargar el programa en otro sitio
        h('button', { class: 'boton secundario', type: 'button', text: '📂 Usar una carpeta que ya tiene mis datos…', onclick: async () => {
          let cuerpo = { usar: true, elegir: true };
          if (!await preguntar({ texto: '¿Usar otra carpeta de datos?', detalle: 'Se dejará de usar la carpeta de ahora y se usará la que elijas, con sus recetas, cuaderno y fotos tal cual (no se copia nada). La de ahora no se borra. Los móviles conectados tendrán que poner el código de esa carpeta.', si: 'Elegir la carpeta', no: 'Cancelar' })) return;
          if (!r.dialogoCarpeta) {
            const ruta = await preguntar({ texto: '📂 Carpeta con tus datos', detalle: 'Escribe la ruta completa de la carpeta que ya tiene tus datos (la que tiene datos.json).',
              campo: { placeholder: '/ruta/completa/de/la/carpeta', 'aria-label': 'Carpeta con tus datos', autocapitalize: 'off' }, si: 'Usar', no: 'Cancelar' });
            if (!ruta || !ruta.trim()) return;
            cuerpo = { usar: true, carpeta: ruta.trim() };
          } else {
            avisar('Se ha abierto el cuadro de carpetas en este PC (si no lo ves, puede estar detrás del navegador)');
          }
          try {
            const resp = await fetch('/api/carpeta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
            const j = await resp.json();
            if (!resp.ok) { avisar(j.error || 'No se ha podido usar esa carpeta'); return; }
            if (j.cancelado) { avisar('No se ha cambiado nada'); return; }
            avisar(`Hecho: se usa la carpeta ${j.carpeta}. Los móviles tendrán que conectarse con el código de esta carpeta.`);
            cargarInfo();
            sincronizar();
          } catch { avisar('No se ha podido usar esa carpeta'); }
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
    const { cuerpo } = abrirPanel('Ajustes');
    const pintar = () => {
      const campoClave = h('input', { class: 'campo', type: 'password', autocomplete: 'off', placeholder: 'Pega aquí la clave' });
      const copia = h('textarea', { class: 'campo', rows: 4, placeholder: 'Pega aquí una copia hecha con «Copiar todas las recetas»' });
      poner(cuerpo,
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
          ' Todo en una sola pantalla (sin pestañas)'),
        h('p', { class: 'nota', text: 'Por defecto, la receta tiene dos pantallas: «🧮 Datos» a la izquierda y «📋 Pasos» a la derecha. Se cambia con las pestañas de arriba o deslizando el dedo hacia un lado. Si lo prefieres, marca esto y vuelve todo seguido.' }),
        h('h3', { text: '💾 Copia de seguridad de todo' }),
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
  const partesDeLaCopia = async (conFotos, alAvanzar) => {
    const partes = [];
    const cabecera = JSON.stringify({ tipo: 'quimica-copia', version: typeof VERSION_WEB === 'string' ? VERSION_WEB : '?', fecha: Date.now(),
      recetas, cuaderno: leerCuaderno(), hechos: leer('quimica.hechos', {}), ciclos: leer('quimica.ciclos', {}) });
    partes.push(`${cabecera.slice(0, -1)},"fotos":[`);
    if (conFotos) {
      // (todas las fotos guardadas en este aparato)
      const ids = await window.Fotos.ids();
      let primera = true;
      let n = 0;
      for (const id of ids) {
        const f = await window.Fotos.leer(id);
        if (!f || !f.blob) continue;
        partes.push(`${primera ? '' : ','}${JSON.stringify({ id: f.id, nombre: f.nombre, ancho: f.ancho, alto: f.alto, fecha: f.fecha, tipo: f.blob.type, datos: await aBase64(f.blob) })}`);
        primera = false;
        if (alAvanzar) alAvanzar(++n, ids.length);
      }
    }
    partes.push(']}');
    return partes;
  };
  const guardarCopiaCompleta = async (conFotos, alAvanzar) => {
    const partes = await partesDeLaCopia(conFotos, alAvanzar);
    const d = new Date();
    const nombre = `Quimica-copia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    const plugin = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.GuardarArchivo;
    if (plugin) {
      // En Android, a la carpeta Descargas, en trozos de 1 MB
      let texto = '';
      let primera = true;
      const mandar = async (t, ultima) => { await plugin.escribir({ nombre, texto: t, primera, ultima }); primera = false; };
      for (const p of partes) {
        texto += p;
        while (texto.length > 1000000) { await mandar(texto.slice(0, 1000000), false); texto = texto.slice(1000000); }
      }
      await mandar(texto, true);
      return { nombre, donde: 'la carpeta Descargas del móvil' };
    }
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { if (alSalirDeLaApp) alSalirDeLaApp(); return; }
    // Si se vuelve a la app con el formulario abierto, el borrador ya no hace falta
    if (alSalirDeLaApp) quitarBorrador();
    revisarCronometros();
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
      try { pcVisto = (await (await pedirPC('', '', '/api/hola', { espera: 3000 })).json()).app === 'quimica-pc'; } catch { pcVisto = false; }
      if (pcVisto) { document.title = 'Química (PC)'; document.body.classList.add('en-pc'); vigilarMoviles(); }
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
