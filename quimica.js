// La lógica de la app, sin pantalla: pesos moleculares, fórmulas de cálculo y recetas.
// Vale igual en el móvil (window.Quimica) y en Node (pruebas/quimica.js).
//
// Una receta:
//   { id, nombre, resumen, seguridad, textoOriginal, avisos: [texto],
//     datos:    [{ id, nombre, valor, unidad, formula?, manual?, inicial }]   lo que escribe el usuario
//     calculos: [{ id, nombre, expr, unidad, original? }]                     lo que calcula la app
//     pasos:    [{ texto, minutos?, titulo?, subfase?, parte?, ciclos? }] }  el texto lleva {id}
// - "titulo": aquí empieza una fase; "subfase" (+ "parte": 'disolucion' o 'muestras'): aquí empieza
//   una parte de la fase (preparar una disolución, o lo que se hace con las muestras).
// - "titulo" es el nombre de la fase que empieza en ese paso (sale como un rótulo encima).
// - "ciclos" va en el primer paso de un ciclo que se repite: cuántos son en total (sale un contador).
// - Un dato con "formula" (NaCl) es un peso molecular: la app lo calcula sola, salvo que el usuario
//   escriba otro valor (manual).
// - Un cálculo puede ser de tipo fijo ("tipo" y "args": la cuenta la monta la app; ver TIPOS) o
//   llevar una fórmula libre en "expr". En los fijos, "expr" también está, pero lo escribe la app.
// - "expr" es una cuenta con los id de los datos y de otros cálculos: c_nacl * v_final / 1000 * pm_nacl
// - "original" es la cantidad que decía el texto pegado: sirve para comprobar la fórmula de la IA.
(function (raiz) {
  'use strict';

  // ─── Pesos atómicos (IUPAC, abreviados) ───
  const MASAS = {
    H: 1.008, D: 2.014, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
    Ne: 20.180, Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.95,
    K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933,
    Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.630, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798,
    Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Tc: 97, Ru: 101.07, Rh: 102.91,
    Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.60, I: 126.90, Xe: 131.29,
    Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24, Pm: 145, Sm: 150.36, Eu: 151.96,
    Gd: 157.25, Tb: 158.93, Dy: 162.50, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05, Lu: 174.97, Hf: 178.49,
    Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59, Tl: 204.38,
    Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226, Ac: 227, Th: 232.04, Pa: 231.04,
    U: 238.03, Np: 237, Pu: 244, Am: 243,
  };

  const SUBINDICES = '₀₁₂₃₄₅₆₇₈₉';

  // Un trozo de fórmula sin hidratos: "Ca(OH)2", "(NH4)2SO4", "K4[Fe(CN)6]". null si no se entiende
  const masaGrupo = (s) => {
    let i = 0;
    const veces = () => {
      const m = /^\d+/.exec(s.slice(i));
      if (!m) return 1;
      i += m[0].length;
      return Number(m[0]);
    };
    const leer = (cierre) => {
      let suma = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === '(' || c === '[') {
          i++;
          const dentro = leer(c === '(' ? ')' : ']');
          if (dentro === null) return null;
          suma += dentro * veces();
        } else if (c === ')' || c === ']') {
          if (c !== cierre) return null;
          i++;
          return suma;
        } else {
          const dos = s.slice(i, i + 2);
          const simbolo = /^[A-Z][a-z]$/.test(dos) && dos in MASAS ? dos : c;
          if (!(simbolo in MASAS)) return null;
          i += simbolo.length;
          suma += MASAS[simbolo] * veces();
        }
      }
      return cierre ? null : suma;
    };
    const total = leer('');
    return total ? total : null;
  };

  // masaMolar('CuSO4·5H2O') → 249.68 (g/mol). Los hidratos, con "·", "." o "*". null si no se entiende
  const masaMolar = (formula) => {
    const texto = String(formula == null ? '' : formula).replace(/\s+/g, '')
      .replace(/[₀-₉]/g, (d) => SUBINDICES.indexOf(d));
    if (!texto) return null;
    let total = 0;
    for (const parte of texto.split(/[·.*•]/)) {
      const m = /^(\d+)(.+)$/.exec(parte);
      const masa = masaGrupo(m ? m[2] : parte);
      if (masa === null) return null;
      total += (m ? Number(m[1]) : 1) * masa;
    }
    return Math.round(total * 1000) / 1000;
  };

  // ─── Las cuentas ("expr") ───
  const FUNCIONES = {
    sqrt: Math.sqrt, raiz: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10,
    min: Math.min, max: Math.max, round: Math.round, redondear: Math.round, pow: Math.pow,
  };
  const ID = /^[A-Za-z_][A-Za-z0-9_]*/;

  // Trocea la cuenta: números (con punto), nombres, operadores y paréntesis
  const trocear = (expr) => {
    const s = String(expr == null ? '' : expr);
    const trozos = [];
    let i = 0;
    while (i < s.length) {
      const resto = s.slice(i);
      const espacio = /^\s+/.exec(resto);
      if (espacio) { i += espacio[0].length; continue; }
      const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(resto);
      if (num) { trozos.push({ tipo: 'num', valor: Number(num[0]) }); i += num[0].length; continue; }
      const id = ID.exec(resto);
      if (id) { trozos.push({ tipo: 'id', valor: id[0] }); i += id[0].length; continue; }
      const c = s[i];
      const op = { '×': '*', '·': '*', '÷': '/', '−': '-' }[c] || c;
      if ('+-*/^(),'.includes(op)) { trozos.push({ tipo: op }); i++; continue; }
      throw new Error(`No entiendo «${c}» en la fórmula`);
    }
    return trozos;
  };

  // Calcula una cuenta. valorDe(id) da el número de cada nombre (o lanza un error)
  const evaluar = (expr, valorDe) => {
    const t = trocear(expr);
    if (!t.length) throw new Error('La fórmula está vacía');
    let p = 0;
    const mira = (tipo) => p < t.length && t[p].tipo === tipo;
    const suma = () => {
      let v = producto();
      while (mira('+') || mira('-')) v = t[p++].tipo === '+' ? v + producto() : v - producto();
      return v;
    };
    const producto = () => {
      let v = signo();
      while (mira('*') || mira('/')) v = t[p++].tipo === '*' ? v * signo() : v / signo();
      return v;
    };
    const signo = () => {
      if (mira('-')) { p++; return -signo(); }
      if (mira('+')) { p++; return signo(); }
      return potencia();
    };
    const potencia = () => {
      const base = basico();
      if (mira('^')) { p++; return Math.pow(base, signo()); }
      return base;
    };
    const basico = () => {
      if (p >= t.length) throw new Error('La fórmula está sin acabar');
      const x = t[p++];
      if (x.tipo === 'num') return x.valor;
      if (x.tipo === '(') {
        const v = suma();
        if (!mira(')')) throw new Error('Falta cerrar un paréntesis');
        p++;
        return v;
      }
      if (x.tipo === 'id') {
        if (!mira('(')) return valorDe(x.valor);
        const f = FUNCIONES[x.valor.toLowerCase()];
        if (!f) throw new Error(`No conozco la función «${x.valor}»`);
        p++;
        const args = [];
        if (!mira(')')) {
          args.push(suma());
          while (mira(',')) { p++; args.push(suma()); }
        }
        if (!mira(')')) throw new Error('Falta cerrar un paréntesis');
        p++;
        return f(...args);
      }
      if (x.tipo === ',') throw new Error('Los decimales van con punto (0.5), no con coma');
      throw new Error(`Sobra «${x.tipo}» en la fórmula`);
    };
    const v = suma();
    if (p < t.length) {
      if (t[p].tipo === ',') throw new Error('Los decimales van con punto (0.5), no con coma');
      throw new Error('La fórmula está mal escrita');
    }
    return v;
  };

  // Los nombres (de datos o de otros cálculos) que usa una cuenta
  const nombresDe = (expr) => {
    const t = trocear(expr);
    return [...new Set(t.filter((x, i) => x.tipo === 'id' && !(t[i + 1] && t[i + 1].tipo === '(')).map((x) => x.valor))];
  };

  // Calcula toda la receta: { valores: { id: número }, errores: { id: 'por qué no sale' } }
  const calcular = (receta) => {
    const valores = {};
    const errores = {};
    const datos = new Map((receta.datos || []).map((d) => [d.id, d]));
    const calculos = new Map((receta.calculos || []).map((c) => [c.id, c]));
    const enCurso = new Set();
    const valorDe = (id) => {
      if (datos.has(id)) {
        const d = datos.get(id);
        if (typeof d.valor !== 'number' || !isFinite(d.valor)) throw new Error(`Falta el dato «${d.nombre}»`);
        return d.valor;
      }
      if (!calculos.has(id)) throw new Error(`No existe «${id}»`);
      if (id in valores) return valores[id];
      if (id in errores) throw new Error(errores[id]);
      if (enCurso.has(id)) throw new Error('La fórmula depende de sí misma');
      enCurso.add(id);
      try {
        const v = evaluar(calculos.get(id).expr, valorDe);
        if (typeof v !== 'number' || !isFinite(v)) throw new Error('No se puede calcular (¿una división entre 0?)');
        valores[id] = v;
        return v;
      } catch (e) {
        errores[id] = e.message;
        throw e;
      } finally {
        enCurso.delete(id);
      }
    };
    for (const d of datos.values()) if (typeof d.valor === 'number' && isFinite(d.valor)) valores[d.id] = d.valor;
    for (const id of calculos.keys()) { try { valorDe(id); } catch { /* queda en errores */ } }
    return { valores, errores };
  };

  // ─── Enseñar números ───
  // 4 cifras significativas y coma decimal: 58.44 → "58,44"; 0.000123456 → "0,0001235"
  const numero = (v) => {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    if (v === 0) return '0';
    const r = Number(v.toPrecision(4));
    const a = Math.abs(r);
    const s = a >= 1e9 || a < 1e-6 ? r.toExponential(3).replace('e', '·10^').replace('^+', '^') : String(r);
    return s.replace('.', ',');
  };

  // Unidades que se pueden cambiar de tamaño solas: 0,0585 g → 58,5 mg
  const FAMILIAS = [
    [['kg', 1e3], ['g', 1], ['mg', 1e-3], ['µg', 1e-6], ['ng', 1e-9]],
    [['L', 1], ['mL', 1e-3], ['µL', 1e-6]],
    [['mol', 1], ['mmol', 1e-3], ['µmol', 1e-6], ['nmol', 1e-9]],
    [['M', 1], ['mM', 1e-3], ['µM', 1e-6], ['nM', 1e-9]],
  ];
  const ALIAS = {
    l: 'L', ml: 'mL', ul: 'µL', 'μl': 'µL', 'µl': 'µL', ug: 'µg', 'μg': 'µg', umol: 'µmol', 'μmol': 'µmol', um: 'µM', 'μm': 'µM',
    'mol/l': 'M', 'mmol/l': 'mM', 'g/l': 'g/L', 'mg/ml': 'mg/mL', 'mg/l': 'mg/L', 'ug/ml': 'µg/mL', 'μg/ml': 'µg/mL', 'µg/ml': 'µg/mL',
    'g/ml': 'g/mL', 'kg/l': 'kg/L', 'g/cm³': 'g/cm3', 'g/cc': 'g/cm3',
  };
  const unidadLimpia = (u) => {
    const s = String(u == null ? '' : u).trim();
    return ALIAS[s.toLowerCase()] || s;
  };

  // { valor, unidad } con la unidad más cómoda de su familia (la primera en la que el número llega a 1)
  const ajustar = (valor, unidad) => {
    const u = unidadLimpia(unidad);
    const familia = FAMILIAS.find((f) => f.some(([n]) => n === u));
    if (!familia || typeof valor !== 'number' || !isFinite(valor) || valor === 0) return { valor, unidad: u };
    const base = valor * familia.find(([n]) => n === u)[1];
    const elegida = familia.find(([, k]) => Math.abs(base) / k >= 0.9995) || familia[familia.length - 1];
    return { valor: base / elegida[1], unidad: elegida[0] };
  };

  // "2,922 g"
  const cantidad = (valor, unidad) => {
    const a = ajustar(valor, unidad);
    // («1 parte», no «1 partes»)
    const u = a.unidad === 'partes' && a.valor === 1 ? 'parte' : a.unidad;
    return u ? `${numero(a.valor)} ${u}` : numero(a.valor);
  };
  // Al revés que cantidad: el valor en la unidad del dato de un texto como "800 mL" o "20 mM" (que
  // pudo salir con otra unidad de la familia). Si el valor de ahora ya da ese texto, se queda (con
  // todas sus cifras). null si no se entiende
  const valorDeTexto = (texto, unidad, actual) => {
    if (typeof actual === 'number' && cantidad(actual, unidad) === texto) return actual;
    const m = /^(-?\d+(?:,\d+)?)/.exec(String(texto).trim());
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    for (const f of [1, 1e-3, 1e3, 1e-6, 1e6, 1e-9, 1e9]) {
      const v = Number((n * f).toPrecision(12));
      if (cantidad(v, unidad) === texto) return v;
    }
    return null;
  };

  // ─── Las fórmulas fijas de la app ───
  // Las cuentas de siempre (pesar para una molaridad, diluir, repartir en proporción…) están aquí,
  // escritas una vez y probadas (pruebas/quimica.js). La IA no escribe la cuenta: solo dice qué
  // "tipo" es y qué dato va en cada hueco ("args": hueco → id de un dato o de otro cálculo).
  // La app pone también los cambios de unidades: cada hueco admite unas clases de unidad, y un
  // dato en una unidad que no pega (un volumen donde va una masa) no vale: así se pillan huecos
  // mal rellenados. Lo que no encaja en ningún tipo va con fórmula libre ("expr" a mano).

  // Clases de unidad, con lo que vale cada una en la unidad de la cuenta (mol/L, L, g, mol, g/L, g/mL)
  const CLASES = {
    molar: { nombre: 'una concentración molar (M, mM, µM)', u: { M: 1, mM: 1e-3, 'µM': 1e-6, nM: 1e-9 } },
    volumen: { nombre: 'un volumen (L, mL, µL)', u: { L: 1, mL: 1e-3, 'µL': 1e-6 } },
    masa: { nombre: 'una masa (kg, g, mg, µg)', u: { kg: 1e3, g: 1, mg: 1e-3, 'µg': 1e-6, ng: 1e-9 } },
    moles: { nombre: 'una cantidad en moles (mol, mmol, µmol)', u: { mol: 1, mmol: 1e-3, 'µmol': 1e-6, nmol: 1e-9 } },
    masica: { nombre: 'una concentración en masa (g/L, mg/mL, mg/L)', u: { 'g/L': 1, 'mg/mL': 1, 'mg/L': 1e-3, 'µg/mL': 1e-3, 'g/mL': 1e3 } },
    pv: { nombre: 'un porcentaje peso/volumen (%)', u: { '%': 10, '% p/v': 10 } },
    pm: { nombre: 'un peso molecular (g/mol)', u: { 'g/mol': 1, Da: 1, u: 1 } },
    densidad: { nombre: 'una densidad (g/mL)', u: { 'g/mL': 1, 'g/cm3': 1, 'kg/L': 1, 'g/L': 1e-3 } },
    porcentaje: { nombre: 'un porcentaje (%)', u: { '%': 0.01 } },
    numero: { nombre: 'un número', u: null }, // equivalentes, partes: vale cualquier unidad
  };

  // Cada tipo: los huecos (con sus clases; "?" = se puede dejar vacío; "lista" = varios), en qué sale
  // y la cuenta, que sirve para calcular (con los id) y para enseñarla (con los nombres)
  const op = (signo, x) => (x ? ` ${signo} ${x}` : '');
  const TIPOS = {
    masa_molar: { nombre: 'Disolución pesando un sólido', sale: ['masa'],
      huecos: { c: ['molar'], v: ['volumen'], pm: ['pm'], pureza: ['porcentaje', '?'] },
      cuenta: (a) => `${a.c} * ${a.v} * ${a.pm}${op('/', a.pureza)}` },
    masa_gl: { nombre: 'Disolución en g/L pesando un sólido', sale: ['masa'],
      huecos: { c: ['masica', 'pv'], v: ['volumen'], pureza: ['porcentaje', '?'] },
      cuenta: (a) => `${a.c} * ${a.v}${op('/', a.pureza)}` },
    dilucion: { nombre: 'Dilución desde una disolución más concentrada', sale: ['volumen'], mismaClase: ['c', 'c_stock'],
      huecos: { c: ['molar', 'masica', 'porcentaje'], v: ['volumen'], c_stock: ['molar', 'masica', 'porcentaje'] },
      cuenta: (a) => `${a.c} * ${a.v} / ${a.c_stock}` },
    parte: { nombre: 'Parte de una mezcla en proporción', sale: ['volumen', 'masa', 'moles'], saleComo: 'total',
      huecos: { total: ['volumen', 'masa', 'moles'], parte: ['numero'], partes: ['numero', 'lista'] },
      cuenta: (a) => `${a.total} * ${a.parte} / (${a.partes.join(' + ')})` },
    conc_comercial: { nombre: 'Molaridad de un ácido o base comercial', sale: ['molar'],
      huecos: { densidad: ['densidad'], riqueza: ['porcentaje'], pm: ['pm'] },
      cuenta: (a) => `${a.densidad} * 1000 * ${a.riqueza} / ${a.pm}` },
    moles_masa: { nombre: 'Moles que hay en una masa', sale: ['moles'],
      huecos: { masa: ['masa'], pm: ['pm'], pureza: ['porcentaje', '?'] },
      cuenta: (a) => `${a.masa}${op('*', a.pureza)} / ${a.pm}` },
    moles_disolucion: { nombre: 'Moles que hay en un volumen de disolución', sale: ['moles'],
      huecos: { c: ['molar'], v: ['volumen'] },
      cuenta: (a) => `${a.c} * ${a.v}` },
    masa_moles: { nombre: 'Masa a partir de los moles', sale: ['masa'],
      huecos: { moles: ['moles'], eq: ['numero', '?'], pm: ['pm'], pureza: ['porcentaje', '?'] },
      cuenta: (a) => `${a.moles}${op('*', a.eq)} * ${a.pm}${op('/', a.pureza)}` },
    volumen_masa: { nombre: 'Volumen de un líquido a partir de su masa', sale: ['volumen'],
      huecos: { masa: ['masa'], densidad: ['densidad'] },
      cuenta: (a) => `${a.masa} / ${a.densidad} / 1000` },
    volumen_moles: { nombre: 'Volumen de disolución que lleva unos moles', sale: ['volumen'],
      huecos: { moles: ['moles'], eq: ['numero', '?'], c: ['molar'] },
      cuenta: (a) => `${a.moles}${op('*', a.eq)} / ${a.c}` },
    // (versión 152, lo pidió el usuario con su silicona: «5 de catalizador por cada 100 de base») Solo
    // de la app (soloApp): no se le ofrecen a Gemini, para no cambiar lo que se le pide (ver www/ia.js)
    proporcion: { nombre: 'En proporción con otra cantidad', sale: ['masa', 'volumen', 'moles'], saleComo: 'ref', soloApp: true,
      huecos: { ref: ['masa', 'volumen', 'moles'], p_ref: ['numero'], p: ['numero'] },
      cuenta: (a) => `${a.ref} * ${a.p} / ${a.p_ref}` },
    porcentaje_de: { nombre: 'Un porcentaje de otra cantidad', sale: ['masa', 'volumen', 'moles'], saleComo: 'total', soloApp: true,
      huecos: { total: ['masa', 'volumen', 'moles'], w: ['porcentaje'] },
      cuenta: (a) => `${a.total} * ${a.w}` },
    suma: { nombre: 'Suma de cantidades', sale: ['masa', 'volumen', 'moles'], saleComo: 's1', soloApp: true,
      mismaClase: ['s1', 's2', 's3', 's4'], mismaClaseAviso: 'todas las cantidades que se suman tienen que ser del mismo tipo (todas masas, o todas volúmenes, o todas moles)',
      huecos: { s1: ['masa', 'volumen', 'moles'], s2: ['masa', 'volumen', 'moles'], s3: ['masa', 'volumen', 'moles', '?'], s4: ['masa', 'volumen', 'moles', '?'] },
      cuenta: (a) => `${a.s1} + ${a.s2}${op('+', a.s3)}${op('+', a.s4)}` },
  };

  const esFija = (c) => Boolean(c && c.tipo && Object.prototype.hasOwnProperty.call(TIPOS, c.tipo));

  // Monta la cuenta de un cálculo de tipo fijo. porId: Map id → dato o cálculo (para saber su unidad).
  // Devuelve { expr, args } (args limpios) o { error }
  const montar = (c, porId) => {
    const tipo = TIPOS[c.tipo];
    const dados = c.args && typeof c.args === 'object' ? c.args : {};
    const args = {};
    const trozos = {};
    const clases = {};
    const hueco = (rol, id, admitidas) => {
      const x = porId.get(id);
      if (!x) return { error: `«${c.nombre}» usa «${id}», que no existe` };
      for (const clase of admitidas) {
        const u = CLASES[clase].u;
        if (!u) return { trozo: id, clase };
        if (Object.prototype.hasOwnProperty.call(u, x.unidad)) return { trozo: u[x.unidad] === 1 ? id : `(${id} * ${u[x.unidad]})`, clase };
      }
      return { error: `«${c.nombre}»: «${x.nombre}» va en «${x.unidad || 'sin unidad'}» y ahí hace falta ${admitidas.map((k) => CLASES[k].nombre).join(' o ')}` };
    };
    for (const [rol, espec] of Object.entries(tipo.huecos)) {
      const admitidas = espec.filter((k) => k !== '?' && k !== 'lista');
      if (espec.includes('lista')) {
        const lista = (Array.isArray(dados[rol]) ? dados[rol] : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
        if (lista.length < 2) return { error: `«${c.nombre}»: faltan las partes de la proporción` };
        trozos[rol] = [];
        for (const id of lista) { const h = hueco(rol, id, admitidas); if (h.error) return h; trozos[rol].push(h.trozo); }
        args[rol] = lista;
        continue;
      }
      const id = String(dados[rol] == null ? '' : dados[rol]).trim();
      if (!id) {
        if (espec.includes('?')) continue;
        return { error: `«${c.nombre}» (${tipo.nombre.toLowerCase()}): falta decir qué dato es «${rol}»` };
      }
      const h = hueco(rol, id, admitidas);
      if (h.error) return h;
      trozos[rol] = h.trozo;
      clases[rol] = h.clase;
      args[rol] = id;
    }
    // (los huecos que se dejan vacíos, como el tercero de una suma, no cuentan)
    if (tipo.mismaClase && new Set(tipo.mismaClase.filter((rol) => rol in clases).map((rol) => clases[rol])).size > 1) {
      return { error: `«${c.nombre}»: ${tipo.mismaClaseAviso || 'las dos concentraciones tienen que ir en el mismo tipo de unidad (las dos en M, o las dos en g/L, o las dos en %)'}` };
    }
    if (c.tipo === 'parte' && !args.partes.includes(args.parte)) return { error: `«${c.nombre}»: su parte tiene que ser una de las partes de la proporción` };
    const sale = tipo.saleComo ? [clases[tipo.saleComo]] : tipo.sale;
    const factor = sale.map((k) => CLASES[k].u[c.unidad]).find((f) => f !== undefined);
    if (factor === undefined) return { error: `«${c.nombre}» (${tipo.nombre.toLowerCase()}) tiene que salir en ${sale.map((k) => CLASES[k].nombre).join(' o ')}, no en «${c.unidad || 'sin unidad'}»` };
    const cuenta = tipo.cuenta(trozos);
    return { expr: factor === 1 ? cuenta : `(${cuenta}) / ${factor}`, args };
  };

  // Lo que va en cada hueco de un cálculo de tipo fijo, con los nombres de los datos
  const textosNombres = (c, receta) => {
    const porId = new Map([...(receta.datos || []), ...(receta.calculos || [])].map((x) => [x.id, x.nombre]));
    const nombres = {};
    for (const [rol, v] of Object.entries(c.args || {})) nombres[rol] = Array.isArray(v) ? v.map((id) => porId.get(id) || id) : porId.get(v) || v;
    return nombres;
  };

  // La cuenta de un tipo en forma de fracción ("build-up"): { num: 'a × b × c', den: 'd' } (den: ''
  // si no se divide entre nada). textos: lo que se escribe en cada hueco (nombres o números).
  // Sale de la misma "cuenta" con la que se calcula, poniendo marcas en los huecos: así lo que se
  // ve no puede ser distinto de lo que se calcula. Sin los "× 1000" de pasar unidades
  const marcasDe = (textos) => {
    const marcas = {};
    for (const [rol, v] of Object.entries(textos)) marcas[rol] = Array.isArray(v) ? v.map((_, i) => `§${rol}:${i}§`) : `§${rol}§`;
    return marcas;
  };
  const conTextos = (s, textos) => s.replace(/§([a-z0-9_]+)(?::(\d+))?§/g, (todo, rol, i) => String(i === undefined ? textos[rol] : textos[rol][Number(i)]));
  const fraccionDe = (tipo, textos) => {
    const [arriba, ...abajo] = TIPOS[tipo].cuenta(marcasDe(textos)).replace(/ [*/] 1000/g, '').split(' / ');
    const escribir = (s) => conTextos(s.replace(/^\((.*)\)$/, '$1').replace(/ \* /g, ' × '), textos);
    return { num: escribir(arriba), den: abajo.map(escribir).join(' × ') };
  };
  // La cuenta en una línea: «a × b ÷ c». Los «× 1000» de pasar unidades se quitan ANTES de poner los
  // textos (versión 129: antes se quitaban después, y un dato que valía justo 1000 —«1000 mL»— desaparecía:
  // salía «0,5 g/L mL»)
  const enUnaLinea = (tipo, textos) => conTextos(TIPOS[tipo].cuenta(marcasDe(textos)).replace(/ [*/] 1000/g, '').replace(/ \* /g, ' × ').replace(/ \/ /g, ' ÷ '), textos);

  // La fracción de un cálculo de tipo fijo, con los nombres de los datos; null si es de fórmula libre
  const fraccionConNombres = (c, receta) => (esFija(c) ? fraccionDe(c.tipo, textosNombres(c, receta)) : null);

  // La cuenta de un cálculo de tipo fijo, para leerla: "Disolución pesando un sólido: Concentración × Volumen × …"
  const leerFormula = (c, receta) => {
    if (!esFija(c)) return null;
    // Sin los "× 1000" de pasar unidades: de las unidades se encarga la app
    return `${TIPOS[c.tipo].nombre}: ${enUnaLinea(c.tipo, textosNombres(c, receta))}`;
  };

  // Lo que va en cada hueco de un cálculo de tipo fijo, con sus números. Lo que falta por escribir
  // sale como "?". resultado: lo que da calcular(receta)
  const textosNumeros = (c, receta, resultado) => {
    const porId = new Map([...(receta.datos || []), ...(receta.calculos || [])].map((x) => [x.id, x]));
    const esDato = new Set((receta.datos || []).map((d) => d.id));
    const huecos = TIPOS[c.tipo].huecos;
    const numeroDe = (rol, id) => {
      const x = porId.get(id);
      if (!x || !(id in resultado.valores)) return '?';
      const v = resultado.valores[id];
      // Partes y equivalentes, sin unidad; un dato, como lo escribió el usuario; otro cálculo, como se ve en la receta
      if (huecos[rol].includes('numero')) return numero(v);
      return esDato.has(id) ? `${numero(v)}${x.unidad ? ` ${x.unidad}` : ''}` : cantidad(v, x.unidad);
    };
    const trozos = {};
    for (const [rol, v] of Object.entries(c.args || {})) trozos[rol] = Array.isArray(v) ? v.map((id) => numeroDe(rol, id)) : numeroDe(rol, v);
    return trozos;
  };

  // La cuenta de un cálculo de tipo fijo con sus números, en una línea:
  // "0,02 M × 400 mL × 199,6 g/mol ÷ 98 %"
  const formulaConNumeros = (c, receta, resultado) => {
    if (!esFija(c)) return null;
    return enUnaLinea(c.tipo, textosNumeros(c, receta, resultado));
  };

  // Lo mismo en forma de fracción, que es como se enseña en la receta: { num, den }
  const fraccionConNumeros = (c, receta, resultado) => (esFija(c) ? fraccionDe(c.tipo, textosNumeros(c, receta, resultado)) : null);

  // ─── La "cara" de cada fórmula fija ───
  // Lo mismo en la receta y en la calculadora: un icono, un nombre corto, una frase de qué hace,
  // un color y una letra para cada hueco, con la que se escribe la fórmula ("m = c × V × PM / pureza")
  const FICHAS = {
    masa_molar: { icono: '⚖️', corto: 'Pesar (molaridad)', color: 'pesar', sale: 'm',
      que: 'Cuánto sólido hay que pesar para preparar una disolución de concentración molar (M, mM).',
      simbolos: { c: 'c', v: 'V', pm: 'PM', pureza: 'pureza' } },
    masa_gl: { icono: '⚖️', corto: 'Pesar (g/L)', color: 'pesar', sale: 'm',
      que: 'Cuánto sólido hay que pesar para una concentración en masa (g/L, mg/mL o %).',
      simbolos: { c: 'c', v: 'V', pureza: 'pureza' } },
    dilucion: { icono: '💧', corto: 'Diluir', color: 'diluir', sale: 'V₁',
      que: 'Cuánto hay que medir de una disolución más concentrada para preparar otra más diluida.',
      simbolos: { c: 'c₂', v: 'V₂', c_stock: 'c₁' } },
    parte: { icono: '🔀', corto: 'Repartir mezcla', color: 'repartir', sale: 'Vᵢ',
      que: 'Cuánto le toca a una parte de una mezcla en proporción (por ejemplo 5 : 1 : 4).',
      simbolos: { total: 'V', parte: 'pᵢ', partes: 'Σp' } },
    conc_comercial: { icono: '🧴', corto: 'Ácido comercial', color: 'acido', sale: 'c',
      que: 'La molaridad de un ácido o una base tal como viene en el bote, con su densidad y su riqueza.',
      simbolos: { densidad: 'ρ', riqueza: 'w', pm: 'PM' } },
    moles_masa: { icono: '🔢', corto: 'Moles de una masa', color: 'moles', sale: 'n',
      que: 'Cuántos moles hay en una masa pesada.',
      simbolos: { masa: 'm', pm: 'PM', pureza: 'pureza' } },
    moles_disolucion: { icono: '🔢', corto: 'Moles en disolución', color: 'moles', sale: 'n',
      que: 'Cuántos moles hay en un volumen de disolución.',
      simbolos: { c: 'c', v: 'V' } },
    masa_moles: { icono: '⚗️', corto: 'Masa por equivalentes', color: 'reaccion', sale: 'm',
      que: 'Cuánto hay que pesar de un reactivo (o cuánto sale de producto) a partir de unos moles.',
      simbolos: { moles: 'n', eq: 'eq', pm: 'PM', pureza: 'pureza' } },
    volumen_masa: { icono: '🫗', corto: 'Volumen de un líquido', color: 'liquido', sale: 'V',
      que: 'Qué volumen de un líquido puro tiene esa masa, con su densidad.',
      simbolos: { masa: 'm', densidad: 'ρ' } },
    volumen_moles: { icono: '💧', corto: 'Volumen con unos moles', color: 'diluir', sale: 'V',
      que: 'Qué volumen de una disolución lleva esos moles.',
      simbolos: { moles: 'n', eq: 'eq', c: 'c' } },
    proporcion: { icono: '⚖️', corto: 'En proporción', color: 'repartir', sale: 'm₂',
      que: 'Cuánto va de un componente por cada tanto de otro (por ejemplo, 5 g de catalizador por cada 100 g de base).',
      simbolos: { ref: 'm₁', p_ref: 'p₁', p: 'p₂' } },
    porcentaje_de: { icono: '📊', corto: 'Porcentaje de', color: 'pesar', sale: 'mᵢ',
      que: 'Cuánto es un porcentaje de otra cantidad (por ejemplo, el 30 % en masa de una mezcla de 60 g).',
      simbolos: { total: 'm', w: 'w' } },
    suma: { icono: '➕', corto: 'Sumar', color: 'repartir', sale: 'Σ',
      que: 'La suma de dos a cuatro cantidades del mismo tipo (por ejemplo, la masa total de una mezcla).',
      simbolos: { s1: 'x₁', s2: 'x₂', s3: 'x₃', s4: 'x₄' } },
  };

  // ─── Para el editor de cantidades ───
  // Las unidades que admite un hueco (null: cualquiera, como las partes o los equivalentes)
  const unidadesHueco = (tipo, rol) => {
    const espec = ((TIPOS[tipo] || {}).huecos || {})[rol];
    if (!espec) return null;
    const clases = espec.filter((k) => k !== '?' && k !== 'lista');
    if (clases.some((k) => !CLASES[k].u)) return null;
    const lista = [];
    for (const k of clases) for (const u of [UNIDAD_HABITUAL[k], ...Object.keys(CLASES[k].u)]) if (u && !lista.includes(u) && !u.includes(' ')) lista.push(u);
    return lista;
  };
  // Qué hace falta en un hueco, dicho para personas: "una concentración molar (M, mM, µM)"
  const queHaceFalta = (tipo, rol) => TIPOS[tipo].huecos[rol].filter((k) => k !== '?' && k !== 'lista').map((k) => CLASES[k].nombre).join(' o ');
  const encajaEnHueco = (tipo, rol, unidad) => { const u = unidadesHueco(tipo, rol); return !u || u.includes(unidadLimpia(unidad)); };
  // En qué unidades puede salir un cálculo de ese tipo (en "parte", las de la clase del total)
  const unidadesResultado = (tipo, unidadTotal) => {
    const t = TIPOS[tipo];
    let clases = t.sale;
    if (t.saleComo) {
      const delTotal = t.huecos[t.saleComo].find((k) => CLASES[k].u && Object.prototype.hasOwnProperty.call(CLASES[k].u, unidadLimpia(unidadTotal)));
      clases = delTotal ? [delTotal] : ['volumen'];
    }
    return clases.flatMap((k) => [UNIDAD_SALIDA[k] || UNIDAD_HABITUAL[k], ...Object.keys(CLASES[k].u)]).filter((u, i, l) => u && l.indexOf(u) === i);
  };
  const rotuloHueco = (tipo, rol) => (rol === 'partes' ? 'Todas las partes' : (ROTULOS_TIPO[tipo] || {})[rol] || ROTULOS[rol] || rol);
  const huecoOpcional = (tipo, rol) => TIPOS[tipo].huecos[rol].includes('?');

  // La ficha de un tipo: { tipo, nombre, icono, corto, que, color, sale, simbolos, formula: { num, den } }
  // (formula, con las letras: "c × V × PM" sobre "pureza"). null si el tipo no existe
  const fichaFormula = (tipo) => {
    const f = FICHAS[tipo];
    if (!f || !TIPOS[tipo]) return null;
    const textos = {};
    for (const [rol, espec] of Object.entries(TIPOS[tipo].huecos)) textos[rol] = espec.includes('lista') ? [f.simbolos[rol]] : f.simbolos[rol];
    return { ...f, tipo, nombre: TIPOS[tipo].nombre, formula: fraccionDe(tipo, textos) };
  };

  // Qué es cada letra en un cálculo de la receta: [{ simbolo, nombre, valor }]
  // (valor como se ve: "800 mL", "?" si falta). En las partes de una mezcla, todas en una fila
  const leyendaFormula = (c, receta, resultado) => {
    if (!esFija(c)) return [];
    const f = FICHAS[c.tipo];
    const nombres = textosNombres(c, receta);
    const numeros = textosNumeros(c, receta, resultado);
    return Object.keys(c.args || {}).map((rol) => ({
      simbolo: f.simbolos[rol] || rol,
      nombre: Array.isArray(nombres[rol]) ? nombres[rol].join(' + ') : nombres[rol],
      valor: Array.isArray(numeros[rol]) ? numeros[rol].join(' + ') : numeros[rol],
    }));
  };

  // Para "Abrir en la calculadora": los números de un cálculo de la receta, como los pide la
  // calculadora. Pesar → { disolucion: { v, solutos: [ … ] } }; las demás → { tipo, entradas }.
  // Con todos los decimales (no los 4 que se enseñan). null si es de fórmula libre
  const paraCalculadora = (c, receta, resultado) => {
    if (!esFija(c)) return null;
    const porId = new Map([...(receta.datos || []), ...(receta.calculos || [])].map((x) => [x.id, x]));
    const num = (id) => (id in resultado.valores ? String(resultado.valores[id]).replace('.', ',') : '');
    const entrada = (id) => ({ valor: num(id), unidad: (porId.get(id) || {}).unidad || '' });
    const a = c.args;
    if (c.tipo === 'masa_molar' || c.tipo === 'masa_gl') {
      return { disolucion: { v: entrada(a.v), solutos: [{ nombre: c.nombre, c: entrada(a.c), pm: a.pm ? entrada(a.pm) : { valor: '' }, pureza: a.pureza ? entrada(a.pureza) : { valor: '' } }] } };
    }
    const entradas = {};
    for (const [rol, v] of Object.entries(a)) {
      if (rol === 'partes') {
        // La calculadora pide las partes de esta y la suma de las demás
        const otras = [...v];
        otras.splice(otras.indexOf(a.parte), 1);
        const suma = otras.reduce((s, id) => s + (resultado.valores[id] || 0), 0);
        entradas.otras = { valor: String(suma).replace('.', ','), unidad: '' };
      } else entradas[rol] = entrada(v);
    }
    return { tipo: c.tipo, entradas };
  };

  // ─── Comprobaciones de sentido común ───
  // Números que no cuadran aunque la cuenta salga: una pureza de más del 100 %, una densidad que no
  // pega con la riqueza del bote, una dilución imposible… (lo pidió el usuario tras ver su HNO3 de
  // 1,41 g/mL "del 98 %"). Son avisos, no errores: la receta se calcula igual.

  // Densidad (g/mL, a unos 20 °C) de las disoluciones comerciales más comunes según su riqueza (% en
  // peso), de las tablas de siempre. Sirve para ver si la densidad y la riqueza escritas cuadran
  const DENSIDADES = {
    HNO3: { nombre: 'ácido nítrico', tabla: [[0, 0.998], [10, 1.054], [20, 1.115], [30, 1.180], [40, 1.246], [50, 1.310], [60, 1.367], [65, 1.391], [70, 1.413], [80, 1.452], [90, 1.483], [98, 1.501], [100, 1.513]] },
    HCl: { nombre: 'ácido clorhídrico', tabla: [[0, 0.998], [10, 1.048], [20, 1.098], [30, 1.149], [36, 1.179], [38, 1.189]] },
    H2SO4: { nombre: 'ácido sulfúrico', tabla: [[0, 0.998], [10, 1.066], [20, 1.139], [30, 1.219], [40, 1.303], [50, 1.395], [60, 1.498], [70, 1.611], [80, 1.727], [90, 1.814], [96, 1.835], [98, 1.836]] },
    H3PO4: { nombre: 'ácido fosfórico', tabla: [[0, 0.998], [10, 1.053], [50, 1.335], [75, 1.579], [85, 1.685]] },
    NH3: { nombre: 'amoníaco', tabla: [[0, 0.998], [10, 0.958], [20, 0.923], [25, 0.907], [30, 0.892]] },
    H2O2: { nombre: 'agua oxigenada', tabla: [[0, 0.998], [30, 1.111], [35, 1.132], [50, 1.196]] },
  };
  const NOMBRES_ACIDOS = [[/n[ií]tric|HNO3/i, 'HNO3'], [/clorh[ií]dric|HCl/i, 'HCl'], [/sulf[uú]ric|H2SO4/i, 'H2SO4'], [/fosf[oó]ric|H3PO4/i, 'H3PO4'], [/amon[ií]ac|NH3/i, 'NH3'], [/per[oó]xid|oxigenada|H2O2/i, 'H2O2']];
  // Interpola en una tabla de pares [x, y]; null si se sale de ella. Con al revés, de y a x
  const interpolar = (tabla, x, alReves) => {
    const pares = alReves ? tabla.map(([a, b]) => [b, a]) : tabla;
    for (let i = 1; i < pares.length; i++) {
      const [x0, y0] = pares[i - 1];
      const [x1, y1] = pares[i];
      if ((x - x0) * (x - x1) <= 0 && x0 !== x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return null;
  };
  // Un valor en la unidad de la cuenta de su clase (mL → L, mM → M…); null si la unidad no se conoce
  const enBase = (valor, unidad) => {
    const u = unidadLimpia(unidad);
    for (const k of ['volumen', 'masa', 'molar', 'moles', 'densidad']) if (Object.prototype.hasOwnProperty.call(CLASES[k].u, u)) return valor * CLASES[k].u[u];
    return null;
  };

  // [{ id (del dato o de la cantidad donde se enseña), texto }]. resultado: lo que da calcular(receta)
  const comprobar = (receta, resultado) => {
    const avisos = [];
    const avisar = (id, texto) => { if (!avisos.some((a) => a.id === id && a.texto === texto)) avisos.push({ id, texto }); };
    const porId = new Map([...(receta.datos || []), ...(receta.calculos || [])].map((x) => [x.id, x]));
    const esDato = new Set((receta.datos || []).map((d) => d.id));
    const val = (id) => (id in resultado.valores ? resultado.valores[id] : null);
    const nombre = (id) => (porId.get(id) || {}).nombre || id;
    const cant = (id) => cantidad(val(id), (porId.get(id) || {}).unidad);

    // Un peso molecular escrito a mano que no es el de su fórmula
    for (const d of receta.datos || []) {
      if (!esPesoMolecular(d) || !d.manual || typeof d.valor !== 'number') continue;
      const pm = masaMolar(d.formula);
      if (pm && Math.abs(d.valor - pm) / pm > 0.01) {
        avisar(d.id, `Has escrito ${numero(d.valor)} g/mol, pero la fórmula ${d.formula} da ${numero(pm)} g/mol. ¿Es otro hidrato, u otra fórmula?`);
      }
    }

    for (const c of (receta.calculos || []).filter(esFija)) {
      const a = c.args || {};
      // Nada de lo que entra en una fórmula fija puede ser negativo
      for (const [rol, v] of Object.entries(a)) {
        for (const id of Array.isArray(v) ? v : [v]) {
          if (esDato.has(id) && val(id) !== null && val(id) < 0) avisar(id, `«${nombre(id)}» es negativo: no puede serlo.`);
        }
        if (rol === 'pureza' || rol === 'riqueza') {
          const p = val(v);
          if (p === null || !esDato.has(v)) continue;
          if (p > 100) avisar(v, `Una ${rol} no puede pasar del 100 %.`);
          else if (p === 0) avisar(v, `Una ${rol} del 0 % no tiene sentido (no habría nada del reactivo).`);
          else if (p > 0 && p < 50 && rol === 'pureza') avisar(v, `¿Seguro? Una pureza de menos del 50 % es muy rara en un reactivo.`);
        }
        if (rol === 'densidad' && esDato.has(v) && val(v) !== null) {
          const d = enBase(val(v), (porId.get(v) || {}).unidad);
          if (d !== null && d > 0 && (d < 0.6 || d > 2.5)) avisar(v, `Una densidad de ${numero(d)} g/mL es muy rara para un líquido (el agua es 1; el ácido sulfúrico, 1,84). Revisa el número y la unidad.`);
        }
        if (rol === 'c' && ['masa_molar', 'moles_disolucion', 'dilucion', 'volumen_moles'].includes(c.tipo) && val(v) !== null) {
          const m = enBase(val(v), (porId.get(v) || {}).unidad);
          if (m !== null && m > 20) avisar(v, `Más de 20 M es imposible para casi cualquier disolución. ¿Era mM?`);
        }
      }

      // Ácido o base comercial: ¿cuadran la densidad y la riqueza del bote?
      if (c.tipo === 'conc_comercial' && val(a.densidad) !== null && val(a.riqueza) !== null) {
        const pm = porId.get(a.pm) || {};
        const texto = `${pm.formula || ''} ${nombre(a.pm)} ${nombre(a.densidad)} ${nombre(a.riqueza)} ${c.nombre}`;
        // Por su fórmula química; si no tiene, por los nombres. Con una fórmula que no está en la
        // tabla (CH3COOH) no se adivina por los nombres: no se comprueba
        const formula = (pm.formula || '').replace(/\s+/g, '');
        const clave = formula ? (DENSIDADES[formula] ? formula : null) : (NOMBRES_ACIDOS.find(([re]) => re.test(texto)) || [])[1];
        const tabla = clave && DENSIDADES[clave];
        const rho = enBase(val(a.densidad), (porId.get(a.densidad) || {}).unidad);
        const w = val(a.riqueza);
        const esperada = tabla && rho !== null ? interpolar(tabla.tabla, w) : null;
        if (esperada !== null && Math.abs(rho - esperada) > 0.03) {
          const deVerdad = interpolar(tabla.tabla, rho, true);
          avisar(a.riqueza, `Un ${tabla.nombre} del ${numero(w)} % tiene una densidad de unos ${numero(Math.round(esperada * 100) / 100)} g/mL, y aquí pone ${numero(rho)} g/mL.${deVerdad !== null ? ` Con ${numero(rho)} g/mL sería de un ${Math.round(deVerdad)} %.` : ''} Mira la etiqueta del bote.`);
        }
      }

      // Dilución imposible: hay que medir más de lo que se quiere preparar
      if (c.tipo === 'dilucion' && val(c.id) !== null && val(a.v) !== null) {
        const medir = enBase(val(c.id), c.unidad);
        const total = enBase(val(a.v), (porId.get(a.v) || {}).unidad);
        if (medir !== null && total !== null && medir > total) {
          avisar(c.id, `Hay que medir ${cant(c.id)} para preparar ${cant(a.v)}: la concentración que quieres es mayor que la de partida, y eso no se puede hacer diluyendo.`);
        }
      }

      // Disolver demasiado: más de 1 g por cada mL
      if ((c.tipo === 'masa_molar' || c.tipo === 'masa_gl') && val(c.id) !== null && val(a.v) !== null) {
        const g = enBase(val(c.id), c.unidad);
        const litros = enBase(val(a.v), (porId.get(a.v) || {}).unidad);
        if (g !== null && litros && g / (litros * 1000) > 1) {
          avisar(c.id, `Hay que disolver ${cant(c.id)} en ${cant(a.v)}: más de 1 g por cada mL. Seguramente no se disuelva; revisa la concentración y sus unidades.`);
        }
      }
    }
    return avisos;
  };

  // ─── Las fases de los pasos, para el cuaderno ───
  // [{ titulo, desde, hasta }] (nº de paso desde 0): cada fase va de su rótulo (paso.titulo) hasta
  // el paso de antes del siguiente rótulo. Los pasos de antes del primer rótulo no son de ninguna.
  // Una receta sin rótulos es una sola fase, con titulo null (toda la receta)
  const tramosFases = (receta) => {
    const pasos = receta.pasos || [];
    if (!pasos.length) return [];
    const tramos = [];
    pasos.forEach((p, i) => {
      if (p.titulo) {
        if (tramos.length) tramos[tramos.length - 1].hasta = i - 1;
        tramos.push({ titulo: p.titulo, desde: i, hasta: pasos.length - 1 });
      }
    });
    return tramos.length ? tramos : [{ titulo: null, desde: 0, hasta: pasos.length - 1 }];
  };

  // Las subfases de cada fase: [{ titulo (de la fase), subfases: [{ nombre, parte, desde, hasta }] }],
  // en el orden de tramosFases. Una subfase va de su paso hasta el de antes de la siguiente subfase
  // o del final de su fase. Los pasos de una fase de antes de su primera subfase no son de ninguna.
  // Una fase sin subfases lleva la lista vacía (se termina entera, como siempre)
  const subfasesDe = (receta) => {
    const pasos = receta.pasos || [];
    return tramosFases(receta).map((t) => {
      const subfases = [];
      for (let i = t.desde; i <= t.hasta; i++) {
        const p = pasos[i];
        if (!p || !p.subfase) continue;
        if (subfases.length) subfases[subfases.length - 1].hasta = i - 1;
        subfases.push({ nombre: p.subfase, parte: p.parte === 'disolucion' ? 'disolucion' : 'muestras', desde: i, hasta: t.hasta });
      }
      return { titulo: t.titulo, subfases };
    });
  };
  // La última subfase de muestras de cada fase (al terminarla, las muestras han acabado esa fase).
  // { titulo de la fase: nombre }; las fases sin subfases de muestras no salen
  const ultimasDeMuestras = (receta) => {
    const r = {};
    for (const f of subfasesDe(receta)) {
      const m = f.subfases.filter((s) => s.parte === 'muestras');
      if (m.length) r[f.titulo] = m[m.length - 1].nombre;
    }
    return r;
  };

  // ─── Datos y cantidades, repartidos por las fases de los pasos ───
  // Las fases las marcan los pasos (paso.titulo). Cada cantidad es de la fase del primer paso que
  // la nombra ({id}) o, si no sale en ningún paso, de la primera cantidad que la usa. Cada dato,
  // igual: del primer paso o de la primera cantidad que lo usa. No hay que apuntar nada en la
  // receta: se deduce, así que vale para cualquiera (también las ya guardadas).
  // Devuelve { datos: [{ titulo, lista }], calculos: [{ titulo, lista }] }, en el orden de las fases.
  // Sin fases, un solo grupo con titulo null. Lo que no se usa en nada va a un grupo "Sin usar"
  const porFases = (receta) => {
    const datos = receta.datos || [];
    const calculos = receta.calculos || [];
    const pasos = receta.pasos || [];
    const titulos = [];
    const faseDe = {}; // id → nº de fase (-1: pasos de antes del primer título)
    let fase = -1;
    for (const p of pasos) {
      if (p.titulo) { titulos.push(p.titulo); fase = titulos.length - 1; }
      const patron = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
      let m;
      while ((m = patron.exec(p.texto))) if (!(m[1] in faseDe)) faseDe[m[1]] = fase;
    }
    if (!titulos.length) return { datos: [{ titulo: null, lista: datos }], calculos: [{ titulo: null, lista: calculos }] };
    // Lo que usa cada cantidad; la fase baja de la cantidad a lo que usa (si aún no tenía, o era posterior)
    const usa = new Map(calculos.map((c) => { try { return [c.id, nombresDe(c.expr)]; } catch { return [c.id, []]; } }));
    for (let vuelta = 0, cambia = true; cambia && vuelta <= calculos.length; vuelta++) {
      cambia = false;
      for (const c of calculos) {
        if (!(c.id in faseDe)) continue;
        for (const id of usa.get(c.id)) {
          if (!(id in faseDe) || faseDe[id] > faseDe[c.id]) { faseDe[id] = faseDe[c.id]; cambia = true; }
        }
      }
    }
    const repartir = (lista) => {
      const grupos = [];
      const de = (n) => lista.filter((x) => (x.id in faseDe ? faseDe[x.id] : null) === n);
      if (de(-1).length) grupos.push({ titulo: 'Antes de empezar', lista: de(-1) });
      titulos.forEach((titulo, n) => { if (de(n).length) grupos.push({ titulo, lista: de(n) }); });
      if (de(null).length) grupos.push({ titulo: 'Sin usar en los pasos', lista: de(null) });
      return grupos;
    };
    return { datos: repartir(datos), calculos: repartir(calculos) };
  };

  // Datos y cantidades JUNTOS, como una hoja que se lee de arriba abajo (lo pidió el usuario): en
  // cada fase, cada cantidad con los datos que usa justo encima. Un dato que usan varias cantidades
  // sale solo con la primera; en las demás va en "usa" (también lo que viene de otra cantidad).
  // Devuelve [{ titulo, bloques: [{ calculo, nuevos: [datos], usa: [datos o cantidades] }], sueltos: [datos] }]
  // (sueltos: los datos de esa fase que no usa ninguna cantidad: los que solo salen en los pasos)
  const bloquesPorFases = (receta) => {
    const fases = porFases(receta);
    const datos = new Map((receta.datos || []).map((d) => [d.id, d]));
    const calculos = new Map((receta.calculos || []).map((c) => [c.id, c]));
    const titulosPasos = (receta.pasos || []).filter((p) => p.titulo).map((p) => p.titulo);
    const orden = (t) => (t === 'Antes de empezar' ? -1 : t === 'Sin usar en los pasos' ? 1e9 : Math.max(0, titulosPasos.indexOf(t)));
    const titulos = [];
    for (const g of [...fases.calculos, ...fases.datos]) if (!titulos.includes(g.titulo)) titulos.push(g.titulo);
    titulos.sort((a, b) => orden(a) - orden(b));
    const usaDe = (c) => { try { return nombresDe(c.expr); } catch { return []; } };
    const vistos = new Set();
    return titulos.map((titulo) => {
      const deLaFase = (grupos) => (grupos.find((g) => g.titulo === titulo) || { lista: [] }).lista;
      const bloques = deLaFase(fases.calculos).map((c) => {
        const ids = usaDe(c);
        const nuevos = ids.filter((id) => datos.has(id) && !vistos.has(id)).map((id) => datos.get(id));
        const usa = ids.filter((id) => (datos.has(id) && vistos.has(id)) || calculos.has(id)).map((id) => datos.get(id) || calculos.get(id));
        for (const d of nuevos) vistos.add(d.id);
        vistos.add(c.id);
        return { calculo: c, nuevos, usa };
      });
      const sueltos = deLaFase(fases.datos).filter((d) => !vistos.has(d.id));
      for (const d of sueltos) vistos.add(d.id);
      return { titulo, bloques, sueltos };
    }).filter((f) => f.bloques.length || f.sueltos.length);
  };

  // De qué está hecha una disolución preparada en una fase: las cantidades de esa fase (lo que se
  // pesa o se mide) y los datos con los que se calculan, con sus valores de ahora. Para guardarlo
  // en el cuaderno tal como estaba al prepararla. [{ nombre, texto, cantidad: true|false }]
  // rango { desde, hasta } (nº de paso): solo lo que nombran esos pasos (una subfase) y lo que usa;
  // si no nombran nada, lo de toda la fase
  const composicionDe = (receta, fase, rango) => {
    const f = bloquesPorFases(receta).find((x) => x.titulo === fase);
    if (!f) return [];
    const res = calcular(receta);
    const lineas = [];
    const vistos = new Set();
    const dato = (d) => {
      if (vistos.has(d.id)) return;
      vistos.add(d.id);
      lineas.push({ id: d.id, nombre: d.nombre, texto: d.valor == null ? 'sin escribir' : cantidad(d.valor, d.unidad), cantidad: false });
    };
    let bloques = f.bloques;
    if (rango) {
      const nombrados = new Set();
      for (const p of (receta.pasos || []).slice(rango.desde, rango.hasta + 1)) for (const m of String(p.texto).matchAll(/\{\s*([A-Za-z_][\w]*)\s*\}/g)) nombrados.add(m[1]);
      const suyos = bloques.filter((b) => nombrados.has(b.calculo.id));
      if (suyos.length) bloques = suyos;
    }
    // Y las cuentas de las que dependen (versión 129: el usuario no podía corregir la riqueza ni la
    // densidad del ácido nítrico de su baño, porque entran por otra cuenta —la concentración del ácido
    // comercial— que no se nombra en los pasos; tampoco salían en «De qué está hecha»). Esas cuentas
    // salen como «intermedio» (no es lo que se pesa o se mide)
    const todos = bloquesPorFases(receta).flatMap((x) => x.bloques);
    const porId = new Map(todos.map((b) => [b.calculo.id, b]));
    const elegidos = new Set(bloques.map((b) => b.calculo.id));
    const pila = bloques.flatMap((b) => b.usa.map((u) => u.id));
    const intermedios = new Set();
    while (pila.length) {
      const id = pila.pop();
      if (!porId.has(id) || elegidos.has(id)) continue;
      elegidos.add(id);
      intermedios.add(id);
      for (const u of porId.get(id).usa) pila.push(u.id);
    }
    const base = bloques;
    bloques = [...bloques, ...todos.filter((b) => intermedios.has(b.calculo.id))];
    // (también es intermedia una de la fase que usa otra y que no sale en ningún paso)
    const enPasos = new Set();
    for (const p of receta.pasos || []) for (const m of String(p.texto).matchAll(/\{\s*([A-Za-z_][\w]*)\s*\}/g)) enPasos.add(m[1]);
    for (const b of bloques) for (const u of b.usa) if (porId.has(u.id) && !enPasos.has(u.id)) intermedios.add(u.id);
    for (const b of bloques) {
      const c = b.calculo;
      vistos.add(c.id);
      lineas.push({ id: c.id, nombre: c.nombre, texto: c.id in res.valores ? cantidad(res.valores[c.id], c.unidad) : 'no sale', cantidad: true, ...(intermedios.has(c.id) ? { intermedio: true } : {}) });
    }
    for (const b of bloques) for (const d of [...b.nuevos, ...b.usa]) if ((receta.datos || []).includes(d)) dato(d);
    if (base === f.bloques) for (const d of f.sueltos) dato(d);
    return lineas;
  };
  // Una copia de la receta con lo que hace falta para volver a sacar la composición de una disolución
  // (sus datos, sus cuentas y los pasos): se guarda en la disolución al prepararla, para corregir
  // sus números más tarde con las cuentas de entonces aunque la receta haya cambiado
  const hojaDe = (receta) => JSON.parse(JSON.stringify({
    datos: receta.datos || [], calculos: receta.calculos || [],
    pasos: (receta.pasos || []).map((p) => ({ texto: p.texto, titulo: p.titulo, subfase: p.subfase, parte: p.parte })),
  }));

  // La letra con la que va un dato en una cantidad de fórmula fija ("c", "V", "PM"…); null si no va
  const letraEn = (c, id) => {
    if (!esFija(c)) return null;
    const rol = Object.keys(c.args || {}).find((k) => (Array.isArray(c.args[k]) ? c.args[k].includes(id) : c.args[k] === id));
    return rol ? FICHAS[c.tipo].simbolos[rol] : null;
  };

  // ─── La calculadora (las mismas fórmulas fijas, fuera de las recetas) ───
  // Cómo se llama cada hueco en la calculadora (el de cada tipo, o el general)
  const ROTULOS = {
    c: 'Concentración', v: 'Volumen', pm: 'Peso molecular', pureza: 'Pureza', c_stock: 'Concentración de partida',
    total: 'Total de la mezcla', parte: 'Partes de esta', otras: 'Partes de las demás (sumadas)',
    densidad: 'Densidad', riqueza: 'Riqueza (% en peso)', masa: 'Masa', moles: 'Moles', eq: 'Equivalentes',
  };
  const ROTULOS_TIPO = {
    masa_molar: { v: 'Volumen de disolución' },
    masa_gl: { v: 'Volumen de disolución' },
    dilucion: { c: 'Concentración que quieres', v: 'Volumen que quieres' },
    moles_disolucion: { v: 'Volumen de disolución' },
    volumen_moles: { c: 'Concentración de la disolución' },
    proporcion: { ref: 'Cantidad de referencia', p_ref: 'Partes de la referencia', p: 'Partes de esta' },
    porcentaje_de: { total: 'Cantidad total', w: 'Porcentaje' },
    suma: { s1: 'Primera cantidad', s2: 'Segunda cantidad', s3: 'Tercera cantidad (si hay)', s4: 'Cuarta cantidad (si hay)' },
  };
  // En qué unidad se da el resultado (luego la app la adapta sola: 0,0585 g → 58,5 mg)
  const UNIDAD_SALIDA = { masa: 'g', volumen: 'mL', molar: 'M', moles: 'mol' };
  // La unidad que sale elegida en cada hueco
  const UNIDAD_HABITUAL = { molar: 'M', volumen: 'mL', masa: 'g', moles: 'mmol', masica: 'g/L', pv: '%', pm: 'g/mol', densidad: 'g/mL', porcentaje: '%' };

  // Los huecos de un tipo, para pintar la calculadora: [{ rol, rotulo, unidades, opcional }]
  // (en "parte", en vez de la lista de todas las partes se piden las de esta y la suma de las demás)
  const huecosCalculadora = (tipo) => {
    const t = TIPOS[tipo];
    if (!t) return [];
    const huecos = [];
    for (const [rol, espec] of Object.entries(t.huecos)) {
      const clases = espec.filter((k) => k !== '?' && k !== 'lista');
      const unidades = [];
      for (const k of clases) {
        if (!CLASES[k].u) continue;
        // Primero la habitual de la clase; sin las repetidas ("% p/v" es lo mismo que "%")
        for (const u of [UNIDAD_HABITUAL[k], ...Object.keys(CLASES[k].u)]) if (!unidades.includes(u) && !u.includes(' ')) unidades.push(u);
      }
      const nombreRol = espec.includes('lista') ? 'otras' : rol;
      huecos.push({ rol: nombreRol, rotulo: (ROTULOS_TIPO[tipo] || {})[nombreRol] || ROTULOS[nombreRol] || nombreRol, unidades, opcional: espec.includes('?'), esPM: clases.includes('pm') });
    }
    return huecos;
  };

  // Una cuenta suelta. entradas: { rol: { valor, unidad } } (valor como lo escribe el usuario: "0,1";
  // en el peso molecular vale también la fórmula química, "NaCl").
  // Devuelve { valor, unidad, texto: '2,922 g', formula: 'Disolución pesando un sólido: …', pm? }
  // o { falta: 'Volumen' } si falta un número, o { error }
  const calculoSuelto = (tipo, entradas) => {
    const t = TIPOS[tipo];
    if (!t) return { error: 'No conozco esa fórmula' };
    const datos = [];
    const args = {};
    const pms = {};
    for (const h of huecosCalculadora(tipo)) {
      const e = (entradas && entradas[h.rol]) || {};
      let valor = aNumero(typeof e.valor === 'number' ? e.valor : String(e.valor == null ? '' : e.valor));
      // En el peso molecular se puede escribir la fórmula química
      if (valor === null && h.esPM && String(e.valor == null ? '' : e.valor).trim()) {
        valor = masaMolar(e.valor);
        if (valor === null) return { error: `No entiendo «${String(e.valor).trim()}» como fórmula química (escríbela con sus mayúsculas: NaCl, CuSO4·5H2O)` };
        pms[h.rol] = valor;
      }
      if (valor === null) {
        if (h.opcional) continue;
        return { falta: h.rotulo };
      }
      const id = `x_${h.rol}`;
      const dato = { id, nombre: h.rotulo, valor, unidad: h.unidades.includes(e.unidad) ? e.unidad : h.unidades[0] || '' };
      // (con su fórmula, para que las comprobaciones sepan de qué ácido se trata)
      if (pms[h.rol]) dato.formula = String(e.valor).trim();
      datos.push(dato);
      if (h.rol === 'otras') args.partes = ['x_parte', id]; else args[h.rol] = id;
    }
    // El resultado sale en la unidad habitual de su clase (en "parte", en la del total)
    const unidad = t.saleComo ? datos.find((d) => d.id === `x_${t.saleComo}`).unidad : UNIDAD_SALIDA[t.sale[0]];
    const v = validar({ nombre: 'Calculadora', pasos: [{ texto: '{x_r}' }], datos, calculos: [{ id: 'x_r', nombre: 'Resultado', unidad, tipo, args }] });
    if (v.error) return { error: v.error.replace('«Resultado»: ', '').replace('«Resultado» ', '') };
    const res = calcular(v.receta);
    if (!('x_r' in res.valores)) return { error: res.errores.x_r || 'No se puede calcular' };
    const pm = Object.values(pms)[0];
    return { valor: res.valores.x_r, unidad, texto: cantidad(res.valores.x_r, unidad), formula: leerFormula(v.receta.calculos[0], v.receta), fraccion: fraccionConNombres(v.receta.calculos[0], v.receta),
      fraccionNumeros: fraccionConNumeros(v.receta.calculos[0], v.receta, res), ...(pm ? { pm } : {}),
      // Los números que no cuadran (comprobar), en texto
      avisos: comprobar(v.receta, res).map((a) => a.texto) };
  };

  // Una disolución con varios solutos (en la calculadora): todos comparten el volumen y cada uno
  // lleva su concentración, en la unidad que sea. Si va en molar (M, mM…) hace falta su peso
  // molecular (fórmula "masa_molar"); si va en masa (g/L, mg/mL, %), no ("masa_gl")
  const unidadesSoluto = () => [...new Set([...huecosCalculadora('masa_molar')[0].unidades, ...huecosCalculadora('masa_gl')[0].unidades])];
  const esMolar = (unidad) => Object.prototype.hasOwnProperty.call(CLASES.molar.u, unidad || 'M');
  // v: { valor, unidad } del volumen; soluto: { c: { valor, unidad }, pm: { valor }, pureza: { valor } }
  // Devuelve lo mismo que calculoSuelto
  const calculoSoluto = (v, soluto) => {
    const s = soluto || {};
    const c = { valor: (s.c || {}).valor, unidad: (s.c || {}).unidad || 'M' };
    return calculoSuelto(esMolar(c.unidad) ? 'masa_molar' : 'masa_gl', { c, v, pm: s.pm, pureza: s.pureza });
  };

  // ─── Atajos para escribir una receta a mano (versión 83, lo pidió el usuario) ───
  // Con lo que se escribe en un solo cuadro salen los datos, la cantidad y el paso, ya enlazados.
  // atajo(tipo, e, usados) → { datos, calculos, pasos } para añadir a la receta (o { error }).
  // usados: Set de los id que ya hay (se le añaden los nuevos). Los números, como texto o número.
  //   'solido':   { nombre, formula, c: { valor, unidad }, v: { valor, unidad }, vId?, pm?, pureza?, disolvente? }
  //   'dilucion': { nombre, de? (id de su concentración), cStock?: { valor, unidad }, c, v, disolvente? }
  //   'acido':    { formula, riqueza, densidad?, c, v }
  const idNuevo = (nombre, usados) => {
    let base = String(nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'x';
    if (!/^[a-z]/.test(base)) base = `x_${base}`;
    let id = base;
    for (let n = 2; usados.has(id) || id in FUNCIONES; n++) id = `${base}_${n}`;
    usados.add(id);
    return id;
  };
  // La densidad de un ácido o base comercial con esa riqueza (tabla DENSIDADES), o null
  const densidadComercial = (formula, riqueza) => {
    const t = DENSIDADES[String(formula || '').trim()];
    const w = aNumero(riqueza);
    if (!t || w === null) return null;
    const rho = interpolar(t.tabla, w);
    return rho === null ? null : Math.round(rho * 1000) / 1000;
  };
  const atajo = (tipo, e, usados) => {
    const s = e || {};
    const datos = [];
    const calculos = [];
    // (id: un nombre corto como los de Gemini, "c_cuso4_5h2o"; se ve en el texto de los pasos al editar)
    const dato = (id, nombre, valor, unidad, extra) => {
      const d = { id: idNuevo(id, usados), nombre, valor: aNumero(valor), unidad, ...extra };
      datos.push(d);
      return d.id;
    };
    // De un nombre largo, la primera palabra ("sulfato de cobre" → "sulfato"; una fórmula, entera)
    const corto = (t) => String(t).trim().split(/\s+/)[0].slice(0, 14);
    const valor = (x) => (x && typeof x === 'object' ? x.valor : x);
    const unidad = (x, defecto) => unidadLimpia((x && x.unidad) || defecto);
    const disolvente = String(s.disolvente || '').trim() || 'agua destilada';
    if (tipo === 'solido') {
      const formula = String(s.formula || '').trim().replace(/\s+/g, '');
      const nombre = String(s.nombre || '').trim() || formula;
      if (!nombre) return { error: 'Escribe qué reactivo es (su nombre o su fórmula)' };
      // Los nombres, con el nombre que se escribe (se lee mejor); los id, con la fórmula si la hay
      const que = nombre;
      const molar = esMolar(unidad(s.c, 'M'));
      if (molar && !formula && aNumero(s.pm) === null) return { error: 'Con una concentración molar hace falta la fórmula química (o el peso molecular)' };
      const k = corto(formula || nombre);
      const args = { c: dato(`c_${k}`, `Concentración de ${que}`, valor(s.c), unidad(s.c, 'M')) };
      args.v = s.vId || dato(`v_${k}`, `Volumen de disolución de ${que}`, valor(s.v), unidad(s.v, 'mL'));
      if (molar) args.pm = dato(`pm_${k}`, `Peso molecular de ${que}`, formula ? null : s.pm, 'g/mol', formula ? { formula } : {});
      if (aNumero(s.pureza) !== null) args.pureza = dato(`pureza_${k}`, `Pureza de ${que}`, s.pureza, '%');
      const m = idNuevo(`m_${k}`, usados);
      calculos.push({ id: m, nombre: `${que} a pesar`, unidad: 'g', tipo: molar ? 'masa_molar' : 'masa_gl', args });
      return { datos, calculos, pasos: [{ texto: `Disuelve {${m}} de ${nombre} en ${disolvente} hasta {${args.v}}.` }] };
    }
    if (tipo === 'dilucion') {
      const nombre = String(s.nombre || '').trim() || 'la disolución madre';
      const cStock = s.de || dato('c_partida', `Concentración de ${nombre}`, valor(s.cStock), unidad(s.cStock, 'M'));
      const c = dato('c_final', `Concentración final de ${nombre}`, valor(s.c), unidad(s.c, unidad(s.cStock, 'M')));
      const v = dato('v_final', `Volumen final de ${nombre}`, valor(s.v), unidad(s.v, 'mL'));
      const medir = idNuevo('v_medir', usados);
      calculos.push({ id: medir, nombre: `${nombre[0].toUpperCase()}${nombre.slice(1)} a medir`, unidad: 'mL', tipo: 'dilucion', args: { c, v, c_stock: cStock } });
      return { datos, calculos, pasos: [{ texto: `Mide {${medir}} de ${nombre} y enrasa con ${disolvente} hasta {${v}}.` }] };
    }
    if (tipo === 'acido') {
      const formula = String(s.formula || '').trim().replace(/\s+/g, '');
      if (!formula || masaMolar(formula) === null) return { error: 'Escribe la fórmula del ácido o la base (HNO3, HCl, H2SO4…)' };
      const riqueza = dato(`riqueza_${formula}`, `Riqueza del ${formula} comercial`, s.riqueza, '%');
      const rho = aNumero(s.densidad) !== null ? s.densidad : densidadComercial(formula, s.riqueza);
      const densidad = dato(`d_${formula}`, `Densidad del ${formula} comercial`, rho, 'g/mL');
      const pm = dato(`pm_${formula}`, `Peso molecular de ${formula}`, null, 'g/mol', { formula });
      const c = dato(`c_${formula}`, `Concentración de ${formula} que quieres`, valor(s.c), unidad(s.c, 'M'));
      const v = dato(`v_${formula}`, `Volumen de ${formula} diluido a preparar`, valor(s.v), unidad(s.v, 'mL'));
      const stock = idNuevo(`c_${formula}_comercial`, usados);
      const medir = idNuevo(`v_${formula}_comercial`, usados);
      calculos.push({ id: stock, nombre: `Molaridad del ${formula} comercial`, unidad: 'M', tipo: 'conc_comercial', args: { densidad, riqueza, pm } },
        { id: medir, nombre: `${formula} comercial a medir`, unidad: 'mL', tipo: 'dilucion', args: { c, v, c_stock: stock } });
      return { datos, calculos, pasos: [{ texto: `En vitrina, añade lentamente {${medir}} de ${formula} comercial sobre agua destilada (nunca al revés) y completa con agua destilada hasta {${v}}.` }] };
    }
    return { error: 'No conozco ese atajo' };
  };

  // Las cantidades con unidad escritas con su número en el texto de un paso ("5,84 g de NaCl"), para
  // proponer que pasen a ser un dato que cambia con la receta (versión 83). No mira lo que va entre
  // llaves ({m_nacl})
  // Solo lo que se mide (masas, volúmenes, moles): una concentración en el texto suele ser parte de
  // un nombre ("la disolución de CuSO4 0,1 M") y proponerla molestaba
  const UNIDADES_PASO = ['g/L', 'mg/mL', 'mg/L', 'g/mL', 'mmol', 'mol', 'µL', 'uL', 'mL', 'ml', 'L', 'kg', 'mg', 'µg', 'g'];
  const SE_MIDEN = new Set(['mmol', 'mol', 'µL', 'mL', 'L', 'kg', 'mg', 'µg', 'g']);
  const cantidadesDelPaso = (texto) => {
    const t = String(texto || '');
    const unidades = UNIDADES_PASO.join('|');
    const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${unidades})(?![\\p{L}\\d/])`, 'gu');
    const fuera = [];
    for (const m of t.matchAll(/\{[^}]*\}/g)) fuera.push([m.index, m.index + m[0].length]);
    const halladas = [];
    let m;
    while ((m = re.exec(t))) {
      if (fuera.some(([a, b]) => m.index >= a && m.index < b)) continue;
      // De qué es: lo que va detrás ("de NaCl", "de etanol absoluto"), o nada
      const detras = /^\s+de(?:l)?\s+([\p{L}\p{N}()·.]+(?:\s+(?!y\b|en\b|a\b|con\b|hasta\b)[\p{L}\p{N}()·]+)?)/u.exec(t.slice(m.index + m[0].length));
      const unidad = unidadLimpia(m[2] === 'uL' ? 'µL' : m[2] === 'ml' ? 'mL' : m[2]);
      // (g/L y compañía se reconocen para no tomar "2 g/L" por "2 g", pero no se proponen)
      if (!SE_MIDEN.has(unidad)) continue;
      halladas.push({ texto: m[0], inicio: m.index, fin: m.index + m[0].length, valor: aNumero(m[1]), unidad, de: detras ? detras[1].replace(/[.]$/, '') : '' });
    }
    return halladas;
  };
  // El nombre que se propone para un dato sacado del texto de un paso: "Masa de NaCl", "Volumen de etanol"…
  const nombreDeCantidad = (q) => {
    const clase = Object.keys(CLASES).find((k) => CLASES[k].u && Object.prototype.hasOwnProperty.call(CLASES[k].u, q.unidad));
    const que = { masa: 'Masa', volumen: 'Volumen', molar: 'Concentración', masica: 'Concentración', moles: 'Moles', porcentaje: 'Porcentaje' }[clase] || 'Cantidad';
    return q.de ? `${que} de ${q.de}` : que;
  };

  // "30 s", "5 min", "1 h 30 min"
  const duracion = (minutos) => {
    const s = Math.round(minutos * 60);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (s % 60 && s < 600) return `${Math.floor(s / 60)} min ${s % 60} s`;
    if (m < 60) return `${m} min`;
    return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  };

  // El texto de un paso, troceado: [{ texto }] y, por cada {id}, { id, texto: '2,922 g', error? }
  const trozosPaso = (texto, receta, resultado) => {
    const porId = new Map([...(receta.datos || []), ...(receta.calculos || [])].map((x) => [x.id, x]));
    const trozos = [];
    let ultimo = 0;
    const patron = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
    let m;
    while ((m = patron.exec(texto))) {
      if (m.index > ultimo) trozos.push({ texto: texto.slice(ultimo, m.index) });
      const x = porId.get(m[1]);
      if (!x) trozos.push({ id: m[1], texto: '¿?', error: `No existe «${m[1]}»` });
      else if (m[1] in resultado.valores) trozos.push({ id: m[1], nombre: x.nombre, texto: cantidad(resultado.valores[m[1]], x.unidad) });
      else trozos.push({ id: m[1], nombre: x.nombre, texto: '¿?', error: resultado.errores[m[1]] || `Falta el dato «${x.nombre}»` });
      ultimo = m.index + m[0].length;
    }
    if (ultimo < texto.length) trozos.push({ texto: texto.slice(ultimo) });
    return trozos;
  };

  // ─── Comprobar y dejar limpia una receta (la de la IA o la del formulario) ───
  const MAX_MINUTOS = 7 * 24 * 60;
  const texto = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const aNumero = (v) => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string' || !v.trim()) return null;
    const n = Number(v.trim().replace(',', '.'));
    return isFinite(n) ? n : null;
  };
  const esPesoMolecular = (d) => Boolean(d.formula) && /^(g\/mol|da|u)$/i.test(d.unidad);

  // Devuelve { receta } limpia o { error } con el motivo
  const validar = (r) => {
    if (!r || typeof r !== 'object') return { error: 'No es una receta' };
    const nombre = texto(r.nombre, 80);
    if (!nombre) return { error: 'Falta el nombre' };
    const usados = new Set();
    const idLimpio = (x, queEs) => {
      const id = String(x.id == null ? '' : x.id).trim();
      if (!ID.test(id) || ID.exec(id)[0] !== id) return { error: `${queEs} «${texto(x.nombre, 40) || id}»: su nombre corto solo puede llevar letras, números y _, y empezar por letra` };
      if (id.toLowerCase() in FUNCIONES) return { error: `«${id}» no vale como nombre corto: es el nombre de una función` };
      if (usados.has(id)) return { error: `El nombre corto «${id}» está repetido` };
      usados.add(id);
      return { id };
    };

    const datos = [];
    for (const d of Array.isArray(r.datos) ? r.datos : []) {
      const i = idLimpio(d, 'El dato');
      if (i.error) return i;
      const dato = { id: i.id, nombre: texto(d.nombre, 60) || i.id, valor: aNumero(d.valor), unidad: unidadLimpia(texto(d.unidad, 12)) };
      const formula = texto(d.formula, 40).replace(/\s+/g, '');
      if (formula) dato.formula = formula;
      // (versión 151) Un dato que se apunta al hacer la receta (lo que pesó la base…): en sus pasos sale
      // como una casilla para escribirlo
      if (d.enPaso) dato.enPaso = true;
      if (esPesoMolecular(dato)) {
        const pm = masaMolar(formula);
        if (d.manual && dato.valor !== null) dato.manual = true;
        else if (pm !== null) dato.valor = pm;
      }
      // El valor de partida. Una receta ya guardada trae el suyo, y se respeta aunque sea null (un
      // dato que empezó en blanco y el usuario ha rellenado: no hay valor "del principio" al que volver)
      dato.inicial = Object.prototype.hasOwnProperty.call(d, 'inicial') ? aNumero(d.inicial) : dato.valor;
      datos.push(dato);
    }

    const calculos = [];
    for (const c of Array.isArray(r.calculos) ? r.calculos : []) {
      const i = idLimpio(c, 'La cantidad');
      if (i.error) return i;
      const calculo = { id: i.id, nombre: texto(c.nombre, 60) || i.id, expr: texto(c.expr, 300), unidad: unidadLimpia(texto(c.unidad, 12)) };
      // De tipo fijo (la cuenta la monta la app, más abajo) o con fórmula libre (expr tal cual)
      if (esFija(c)) { calculo.tipo = c.tipo; calculo.args = c.args; }
      const original = aNumero(c.original);
      if (original !== null) calculo.original = original;
      calculos.push(calculo);
    }
    const porId = new Map([...datos, ...calculos].map((x) => [x.id, x]));
    for (const c of calculos) {
      if (!esFija(c)) continue;
      const m = montar(c, porId);
      if (m.error) return m;
      c.expr = m.expr;
      c.args = m.args;
    }
    for (const c of calculos) {
      let nombres;
      try { nombres = nombresDe(c.expr); evaluar(c.expr, () => 1); } catch (e) { return { error: `La fórmula de «${c.nombre}» no vale: ${e.message}` }; }
      const falta = nombres.find((n) => !usados.has(n));
      if (falta) return { error: `La fórmula de «${c.nombre}» usa «${falta}», que no existe` };
    }

    // La app ya escribe la unidad de cada {id}: si el paso la repite detrás ("{c_hno3} M" daría
    // "6 M M"; lo hizo Gemini de verdad), se quita la repetida
    const unidadDe = new Map([...datos, ...calculos].map((x) => [x.id, x.unidad]));
    const sinUnidadRepetida = (t) => t.replace(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}(\s+)(\S+)/g, (todo, id, espacio, palabra) => {
      const unidad = unidadDe.get(id);
      const fin = /[.,;:)]+$/.exec(palabra);
      const limpia = fin ? palabra.slice(0, -fin[0].length) : palabra;
      return unidad && limpia === unidad ? `{${id}}${fin ? fin[0] : ''}` : todo;
    });

    const pasos = [];
    for (const p of Array.isArray(r.pasos) ? r.pasos : []) {
      const t = sinUnidadRepetida(texto(p && p.texto, 1000));
      if (!t) continue;
      const min = aNumero(p.minutos);
      const paso = { texto: t };
      if (min !== null && min > 0) paso.minutos = Math.min(min, MAX_MINUTOS);
      // El título de la fase que empieza en este paso ("Fase 1: Tinta de grafeno")
      const titulo = texto(p.titulo, 120);
      if (titulo) paso.titulo = titulo;
      // La subfase que empieza en este paso, dentro de su fase, y si es de preparar una disolución o
      // de las muestras ("parte": 'disolucion' | 'muestras')
      const subfase = texto(p.subfase, 120);
      if (subfase) {
        paso.subfase = subfase;
        paso.parte = p.parte === 'disolucion' ? 'disolucion' : 'muestras';
      }
      // Si en este paso empieza un ciclo que se repite, cuántos ciclos son en total (la app pone un contador)
      const ciclos = aNumero(p.ciclos);
      if (ciclos !== null && ciclos >= 2) paso.ciclos = Math.min(Math.round(ciclos), 999);
      pasos.push(paso);
    }
    if (!pasos.length) return { error: 'La receta no tiene ningún paso' };

    const receta = { id: texto(r.id, 40) || null, nombre, resumen: texto(r.resumen, 300), seguridad: texto(r.seguridad, 600), datos, calculos, pasos };
    // Notas (versión 94): lo del texto que no es un paso pero puede importar (purezas, grados, marcas).
    // Conservan sus saltos de línea (una nota por línea)
    const notas = String(r.notas == null ? '' : r.notas).replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 1500);
    if (notas) receta.notas = notas;
    if (typeof r.textoOriginal === 'string' && r.textoOriginal.trim()) receta.textoOriginal = r.textoOriginal.slice(0, 20000);
    if (Array.isArray(r.avisos)) receta.avisos = r.avisos.map((a) => texto(a, 300)).filter(Boolean).slice(0, 20);
    // Con qué modelo de la IA se hizo (se ve al final de la receta)
    if (texto(r.modelo, 60)) receta.modelo = texto(r.modelo, 60);
    return { receta };
  };

  // Lo que hay que revisar de una receta recién hecha por la IA: fórmulas que no dan lo que decía
  // el texto, cantidades que no salen y pasos que nombran algo que no existe
  const revisar = (receta) => {
    const avisos = [];
    const res = calcular(receta);
    // Los datos sin valor no son un aviso: es lo normal cuando el texto no da un número (el volumen
    // que se quiere preparar): salen en amarillo en Datos hasta que el usuario los escribe
    for (const c of receta.calculos) {
      if (!(c.id in res.valores)) continue;
      if (typeof c.original !== 'number' || c.original === 0) continue;
      const v = res.valores[c.id];
      if (Math.abs(v - c.original) / Math.abs(c.original) > 0.03) {
        avisos.push(`«${c.nombre}»: la fórmula da ${cantidad(v, c.unidad)}, pero el texto decía ${cantidad(c.original, c.unidad)}. Revisa la fórmula y los datos.`);
      }
    }
    const vistos = new Set();
    const usados = new Set();
    for (const p of receta.pasos) {
      for (const t of trozosPaso(p.texto, receta, res)) {
        if (t.id) usados.add(t.id);
        if (t.error && t.error.startsWith('No existe') && !vistos.has(t.id)) { vistos.add(t.id); avisos.push(`Un paso nombra «${t.id}», que no existe.`); }
      }
    }
    // Un dato que no sale en ningún paso ni en ninguna cuenta: seguramente falta en algún sitio
    for (const c of receta.calculos) { try { for (const n of nombresDe(c.expr)) usados.add(n); } catch { /* fórmula mal escrita */ } }
    for (const d of receta.datos) if (!usados.has(d.id)) avisos.push(`El dato «${d.nombre}» no se usa en ningún paso ni en ninguna cuenta.`);
    return avisos;
  };

  const minutosTotales = (receta) => receta.pasos.reduce((s, p) => s + (p.minutos || 0), 0);

  // Una receta de ejemplo, para ver cómo va la app sin la IA
  const EJEMPLO = {
    nombre: 'Disolución de NaCl 0,1 M',
    resumen: 'Preparar una disolución de cloruro de sodio pesando el sólido y enrasando en matraz aforado.',
    seguridad: 'Bata y gafas. El cloruro de sodio no es peligroso.',
    datos: [
      { id: 'v_final', nombre: 'Volumen final', valor: 500, unidad: 'mL' },
      { id: 'c_nacl', nombre: 'Concentración de NaCl', valor: 0.1, unidad: 'M' },
      { id: 'pm_nacl', nombre: 'Peso molecular del NaCl', valor: null, unidad: 'g/mol', formula: 'NaCl' },
      { id: 'pureza', nombre: 'Pureza del NaCl', valor: 99.5, unidad: '%' },
    ],
    calculos: [
      { id: 'm_nacl', nombre: 'NaCl a pesar', unidad: 'g', tipo: 'masa_molar', args: { c: 'c_nacl', v: 'v_final', pm: 'pm_nacl', pureza: 'pureza' } },
      { id: 'v_agua', nombre: 'Agua para disolver', expr: 'v_final * 0.6', unidad: 'mL' },
    ],
    pasos: [
      { texto: 'Pesa {m_nacl} de NaCl en un vaso de precipitados.' },
      { texto: 'Añade unos {v_agua} de agua destilada y agita hasta que se disuelva del todo.', minutos: 3 },
      { texto: 'Pásalo a un matraz aforado de {v_final}, lavando el vaso con un poco de agua.' },
      { texto: 'Enrasa con agua destilada hasta la marca, tapa y voltea varias veces para mezclar.' },
    ],
  };

  const Quimica = {
    MASAS, masaMolar, evaluar, nombresDe, calcular, numero, ajustar, cantidad, duracion, trozosPaso,
    validar, revisar, aNumero, esPesoMolecular, minutosTotales, EJEMPLO, TIPOS, esFija, leerFormula, formulaConNumeros, porFases, bloquesPorFases, letraEn, tramosFases, subfasesDe, ultimasDeMuestras, composicionDe, hojaDe, valorDeTexto,
    fraccionConNumeros, fraccionConNombres, FICHAS, fichaFormula, leyendaFormula, paraCalculadora,
    unidadesHueco, queHaceFalta, encajaEnHueco, unidadesResultado, rotuloHueco, huecoOpcional, unidadLimpia,
    comprobar, DENSIDADES,
    huecosCalculadora, calculoSuelto, unidadesSoluto, esMolar, calculoSoluto,
    atajo, densidadComercial, cantidadesDelPaso, nombreDeCantidad, idNuevo,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Quimica;
  else raiz.Quimica = Quimica;
})(typeof window !== 'undefined' ? window : globalThis);
