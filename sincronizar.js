// Juntar los datos del móvil y del PC (sin pantalla: vale también en Node, en pc/servidor.js y en
// pruebas/sincronizar.js). No se manda "lo que ha cambiado": cada lado manda todo lo suyo con la
// hora de cada cambio, y se queda con lo más nuevo de cada cosa.
//
// Las colecciones: recetas, grupos, entradas y disoluciones (del cuaderno), titulos (de las fotos) y comparar.
// Cada cosa se reconoce por su id. Un estado es:
//   { registros: { coleccion: { id: { v: el dato, mod: hora del último cambio } } },
//     borrados:  { coleccion: { id: hora a la que se borró } } }
// Si una cosa se cambia en los dos sitios, gana el cambio más nuevo (el otro se pierde).
// Si se borra en un sitio y se cambia en el otro después, vuelve (gana lo más nuevo).
//
// Para saber qué ha cambiado y cuándo, cada lado guarda un "sello" (meta):
//   { huellas: { coleccion: { id: huella } }, mods: { coleccion: { id: hora } }, borrados }
// sellar() compara los datos con las huellas de la última vez: lo distinto se sella con la hora de
// ahora y lo que ya no está pasa a borrados.
(function (raiz) {
  'use strict';
  const COLECCIONES = ['recetas', 'grupos', 'entradas', 'disoluciones', 'carpetas', 'cuadernos', 'albumes', 'titulos', 'comparar'];

  // Una huella corta del dato (FNV-1a de 32 bits del JSON): si cambia algo, cambia la huella
  const huella = (v) => {
    const s = JSON.stringify(v);
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return `${x.toString(36)}.${s.length.toString(36)}`;
  };
  const objeto = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  // Las colecciones de unos objetos: las conocidas y CUALQUIER OTRA que traigan. Así, un lado más
  // viejo (que no conoce una colección nueva) la guarda y la devuelve igual, en vez de perderla
  // (pasó el 03-10-2026: el programa del PC, abierto antes de las disoluciones, las tiraba)
  const coleccionesDe = (...objs) => {
    const s = new Set(COLECCIONES);
    for (const o of objs) for (const k of Object.keys(objeto(o))) if (/^[a-z][a-z0-9_]{0,30}$/i.test(k)) s.add(k);
    return [...s];
  };
  const porColeccion = (cols) => Object.fromEntries(cols.map((c) => [c, {}]));
  const limpiarMeta = (m) => {
    const cols = coleccionesDe(m && m.huellas, m && m.mods, m && m.borrados);
    const r = { huellas: porColeccion(cols), mods: porColeccion(cols), borrados: porColeccion(cols) };
    for (const k of ['huellas', 'mods', 'borrados']) for (const c of cols) r[k][c] = { ...objeto(objeto(m && m[k])[c]) };
    return r;
  };
  const limpiarEstado = (e) => {
    const cols = coleccionesDe(e && e.registros, e && e.borrados);
    const r = { registros: porColeccion(cols), borrados: porColeccion(cols) };
    for (const c of cols) {
      for (const [id, x] of Object.entries(objeto(objeto(e && e.registros)[c]))) {
        if (x && typeof x === 'object' && 'v' in x && x.v != null) r.registros[c][id] = { v: x.v, mod: Number(x.mod) || 0 };
      }
      for (const [id, t] of Object.entries(objeto(objeto(e && e.borrados)[c]))) r.borrados[c][id] = Number(t) || 0;
    }
    return r;
  };

  // datos: { coleccion: { id: dato } }. Devuelve un sello nuevo (no cambia el que se le pasa)
  // Solo se miran las colecciones que trae datos: las que este lado no conoce (le llegaron del otro)
  // no se tocan, y así no se dan por borradas
  const sellar = (meta, datos, ahora) => {
    const m = limpiarMeta(meta);
    for (const c of Object.keys(objeto(datos))) {
      for (const k of ['huellas', 'mods', 'borrados']) m[k][c] = m[k][c] || {};
      const suyos = objeto(datos[c]);
      for (const [id, v] of Object.entries(suyos)) {
        const hu = huella(v);
        if (m.huellas[c][id] !== hu) {
          m.huellas[c][id] = hu;
          m.mods[c][id] = ahora;
          delete m.borrados[c][id];
        }
      }
      for (const id of Object.keys(m.huellas[c])) {
        if (!(id in suyos)) {
          m.borrados[c][id] = ahora;
          delete m.huellas[c][id];
          delete m.mods[c][id];
        }
      }
    }
    return m;
  };

  // Lo que se manda al otro lado: los datos con la hora de cada uno, y lo borrado
  const estadoDe = (meta, datos) => {
    const m = limpiarMeta(meta);
    const e = { registros: porColeccion(Object.keys(objeto(datos))), borrados: m.borrados };
    for (const c of Object.keys(objeto(datos))) for (const [id, v] of Object.entries(objeto(datos[c]))) e.registros[c][id] = { v, mod: (m.mods[c] || {})[id] || 0 };
    return e;
  };

  // Lo más nuevo de cada cosa de los dos estados (de todas las colecciones que traiga cualquiera)
  const fusionar = (a, b) => {
    a = limpiarEstado(a);
    b = limpiarEstado(b);
    const cols = coleccionesDe(a.registros, b.registros, a.borrados, b.borrados);
    const r = { registros: porColeccion(cols), borrados: porColeccion(cols) };
    const de = (x, k, c) => x[k][c] || {};
    for (const c of cols) {
      const ids = new Set([...Object.keys(de(a, 'registros', c)), ...Object.keys(de(b, 'registros', c)), ...Object.keys(de(a, 'borrados', c)), ...Object.keys(de(b, 'borrados', c))]);
      for (const id of ids) {
        const ra = de(a, 'registros', c)[id];
        const rb = de(b, 'registros', c)[id];
        // El dato más nuevo (si empatan, el de huella mayor: así los dos lados eligen el mismo)
        let dato = ra || rb;
        if (ra && rb && (rb.mod > ra.mod || (rb.mod === ra.mod && huella(rb.v) > huella(ra.v)))) dato = rb;
        const hayBorrado = id in de(a, 'borrados', c) || id in de(b, 'borrados', c);
        const borrado = Math.max(de(a, 'borrados', c)[id] || 0, de(b, 'borrados', c)[id] || 0);
        if (dato && (!hayBorrado || dato.mod > borrado)) r.registros[c][id] = dato;
        else r.borrados[c][id] = borrado;
      }
    }
    return r;
  };

  // Para quedarse con un estado ya juntado: los datos ({ coleccion: { id: dato } }) y su sello
  // (con copias: lo que se queda un lado no comparte nada con el estado que se le pasa)
  const aplicar = (estado) => {
    const e = limpiarEstado(JSON.parse(JSON.stringify(estado || null)));
    const datos = {};
    const m = limpiarMeta({ borrados: e.borrados, huellas: e.registros });
    for (const c of Object.keys(e.registros)) {
      datos[c] = {};
      m.huellas[c] = {};
      m.mods[c] = m.mods[c] || {};
      for (const [id, x] of Object.entries(e.registros[c])) {
        datos[c][id] = x.v;
        m.huellas[c][id] = huella(x.v);
        m.mods[c][id] = x.mod;
      }
    }
    return { datos, meta: m };
  };

  // Cuántas cosas cambian al pasar de un estado a otro (para decir "3 cambios del PC")
  const diferencias = (antes, despues) => {
    const a = limpiarEstado(antes);
    const d = limpiarEstado(despues);
    let n = 0;
    for (const c of coleccionesDe(a.registros, d.registros)) {
      const ra = a.registros[c] || {};
      const rd = d.registros[c] || {};
      const ids = new Set([...Object.keys(ra), ...Object.keys(rd)]);
      for (const id of ids) {
        const x = ra[id];
        const y = rd[id];
        if (!x || !y || huella(x.v) !== huella(y.v)) n++;
      }
    }
    return n;
  };

  const Sincro = { COLECCIONES, huella, sellar, estadoDe, fusionar, aplicar, diferencias, limpiarEstado, limpiarMeta };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sincro;
  else raiz.Sincro = Sincro;
})(typeof window !== 'undefined' ? window : globalThis);
