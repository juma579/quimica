// Gemini (Google AI Studio): convierte el texto pegado de un procedimiento en una receta de la app
// (Gemini.convertir) y cambia una receta que ya existe según lo que se le pida (Gemini.cambiar).
// - No hay servidor: el móvil habla directamente con Gemini, con la clave que el usuario pone en
//   Ajustes. La clave solo está en el móvil; nunca en el código ni en git.
// - La IA ordena el texto y dice qué fórmula de la app toca en cada cantidad y qué dato va en cada
//   hueco. Las fórmulas (Quimica.TIPOS), las unidades y las cuentas son de la app (www/quimica.js),
//   que además comprueba que el resultado es la cantidad que decía el texto ("original").
//   Solo si ninguna fórmula fija sirve escribe la IA la cuenta (tipo "libre"), y se avisa.
// Vale en el móvil (window.Gemini) y en Node (pruebas/ia.js, con un fetch de mentira).
(function (raiz) {
  'use strict';
  const Quimica = typeof module !== 'undefined' && module.exports ? require('./quimica.js') : raiz.Quimica;

  const API = 'https://generativelanguage.googleapis.com/v1beta/models';
  // El primero es el que recomienda Google; si está saturado, sin cuota o da algo que no vale, el otro.
  // SIN los modelos "lite": cuando los buenos estaban saturados contestaba gemini-flash-lite-latest
  // y daba recetas malas (sin pesos moleculares, con números metidos a mano en las fórmulas, sin
  // temperaturas). En química es mejor decir "prueba en unos minutos" que dar una receta floja
  // OJO (03-10-2026): "gemini-flash-latest" resultó ser el MISMO modelo que gemini-3.8-flash, con
  // el mismo cupo (el error 429 de uno nombra al otro). Por eso el segundo intento es el mismo
  // modelo otra vez: sirve cuando la receta sale mal (Gemini no contesta igual dos veces). Si está
  // saturado (5xx) no se prueba el segundo en esa vuelta: se espera y se da otra vuelta
  const MODELOS = ['gemini-3.8-flash', 'gemini-3.8-flash'];
  const VUELTAS = 3;
  const ESPERA_SATURADO_MS = 6000;
  // (la receta larga del usuario tardó 88 s con Gemini cargado: con 90 s por poco no llega)
  const TIEMPO_MAXIMO = 150 * 1000;
  const MAX_TEXTO = 12000;

  // Los nombres de todos los huecos de las fórmulas fijas (c, v, pm, pureza, partes…).
  // A Gemini se le piden como una LISTA de parejas { hueco, dato }. Antes era una ficha con una
  // casilla por hueco (16 casillas), y Gemini de verdad solo rellenaba las dos primeras, dejaba
  // las demás vacías y metía varios id juntos en una ("v_tinta Sakamoto pureza_naddbs")
  // (versión 152) Las fórmulas «solo de la app» (soloApp: proporción, porcentaje, suma) no se le
  // ofrecen: así el esquema y las instrucciones que recibe Gemini son los mismos de antes (un cambio
  // en lo que se le pide ha hecho que se bloquee otras veces)
  const TIPOS_IA = Object.keys(Quimica.TIPOS).filter((t) => !Quimica.TIPOS[t].soloApp);
  const paraIA = (c) => Quimica.esFija(c) && TIPOS_IA.includes(c.tipo);
  const HUECOS = [];
  for (const tipo of TIPOS_IA.map((t) => Quimica.TIPOS[t])) {
    for (const rol of Object.keys(tipo.huecos)) if (!HUECOS.includes(rol)) HUECOS.push(rol);
  }

  const ESQUEMA = {
    type: 'OBJECT',
    properties: {
      nombre: { type: 'STRING' },
      resumen: { type: 'STRING' },
      seguridad: { type: 'STRING', nullable: true },
      // Lo que dice el texto y no es un paso ni una cantidad, pero puede importar (versión 94)
      notas: { type: 'STRING', nullable: true },
      datos: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' }, nombre: { type: 'STRING' }, valor: { type: 'NUMBER', nullable: true },
            unidad: { type: 'STRING' }, formula: { type: 'STRING', nullable: true },
            // De dónde sale el valor. Con 'falta', la app deja el dato en blanco diga lo que diga "valor"
            origen: { type: 'STRING', enum: ['texto', 'deducido', 'formula', 'falta'] },
          },
          required: ['id', 'nombre', 'unidad', 'origen'],
        },
      },
      calculos: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' }, nombre: { type: 'STRING' }, unidad: { type: 'STRING' },
            // La cuenta no la escribe la IA: dice de qué tipo es (los de Quimica.TIPOS) y qué dato va
            // en cada hueco. Solo con "libre" escribe la cuenta, en expr
            tipo: { type: 'STRING', enum: [...TIPOS_IA, 'libre'] },
            huecos: {
              type: 'ARRAY', nullable: true,
              items: { type: 'OBJECT', properties: { hueco: { type: 'STRING', enum: HUECOS }, dato: { type: 'STRING' } }, required: ['hueco', 'dato'] },
            },
            expr: { type: 'STRING', nullable: true },
            original: { type: 'NUMBER', nullable: true },
          },
          required: ['id', 'nombre', 'unidad', 'tipo'],
        },
      },
      pasos: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            titulo: { type: 'STRING', nullable: true }, texto: { type: 'STRING' }, minutos: { type: 'NUMBER', nullable: true },
            ciclos: { type: 'INTEGER', nullable: true },
            // Dónde empieza una subfase dentro de la fase y de qué es: preparar una disolución o
            // unas muestras que pasan por algo (versión 89)
            subfase: { type: 'STRING', nullable: true }, parte: { type: 'STRING', enum: ['disolucion', 'muestras'], nullable: true },
          },
          required: ['texto'],
        },
      },
    },
    required: ['nombre', 'resumen', 'datos', 'calculos', 'pasos'],
  };

  const SISTEMA = 'Eres el ayudante de un químico en su laboratorio. Ordenas procedimientos escritos de cualquier manera '
    + 'y los dejas como una receta clara, paso a paso, para una app de móvil. Eres riguroso con las unidades y las cuentas, '
    + 'y nunca inventas cantidades ni cambias el procedimiento.';

  // Versión corta de las instrucciones (versión 88): la mitad de largas que las de antes, con lo mismo
  // (una petición más ligera falla menos cuando Gemini está saturado)
  const REGLAS = `
La app tiene DATOS (números que el usuario cambia), CANTIDADES (las calcula la app con sus fórmulas a partir de los datos) y PASOS (cada cantidad sale calculada dentro del texto). Tú eliges la fórmula de cada cantidad y qué dato va en cada hueco; las cuentas y los cambios de unidades los hace la app.

- nombre corto; resumen: una frase de qué se prepara o qué se hace.
- seguridad: pocas frases (lo del texto y lo evidente: guantes, gafas, vitrina, "el ácido sobre el agua"); null si no hace falta. Si se calienta un disolvente inflamable o va al horno algo empapado en él: placa sin llama, ventilación, por debajo de su ebullición, y evaporarlo en vitrina antes del horno.
- notas: lo que dice el texto y no es un paso ni una cantidad, pero que alguien que repita la receta querría saber: pureza o grado de un reactivo ("PVA 99+ % hidrolizado", "ácido fosfórico ≥85 %"), marca o referencia de un material o equipo ("fibra HexForce AGP193-P de Hexcel"), tipo o tamaño de muestra. Frases cortas, separadas por saltos de línea, sin repetir lo que ya está en los pasos ni en los datos; null si no hay nada.
- datos: lo que un químico querría cambiar: volumen a preparar, concentraciones, masa de partida, equivalentes, pureza, densidad y pesos moleculares.
  - id: minúsculas sin tilde, números y "_", empezando por letra ("v_final", "c_nacl", "pm_nacl"). nombre: legible ("Concentración de NaCl").
  - origen y valor: "texto" (el número está en el texto) o "deducido" (sale de números del texto), con su valor; "formula" (peso molecular: pon formula, la química bien escrita, "CuSO4·5H2O", con el hidrato exacto que diga el texto; si el texto NO dice hidrato, la sal sin agua, "Cu(NO3)2": nunca te inventes uno) o "falta" (el texto no lo da: casi siempre el volumen a preparar), con valor null. NUNCA inventes un valor (ni 100 mL ni 1 L).
  - formula: solo en los pesos moleculares (unidad "g/mol"); en los demás, null.
  - Pureza: cada sólido que se pesa lleva su dato de pureza en % (100 y "deducido" si el texto no la da) en el hueco pureza.
- calculos: cada cantidad que hay que medir. unidad del resultado: g, mL, M, mol o mmol (la app ya pasa a mg o µL).
  - tipo y huecos: lista de parejas {"hueco","dato"}, con UN id de un dato o de otro cálculo por pareja, nunca números (si hace falta un número, créalo como dato). Pon todos los huecos obligatorios y los opcionales (?) si existe ese dato. Tipos:
    - masa_molar: masa de sólido para una molaridad. c, v, pm, pureza?
    - masa_gl: masa de sólido para g/L, mg/mL o % p/v. c, v, pureza?
    - dilucion: volumen a medir de una disolución más concentrada. c, v, c_stock (un dato o un cálculo conc_comercial).
    - parte: lo de una parte de una mezcla en proporción. total, parte (sus partes) y una pareja "partes" por CADA parte, incluida esta: [{"hueco":"total","dato":"v_mezcla"},{"hueco":"parte","dato":"partes_a"},{"hueco":"partes","dato":"partes_a"},{"hueco":"partes","dato":"partes_b"}].
    - conc_comercial: molaridad de un ácido o base comercial. densidad, riqueza, pm.
    - moles_masa: moles en una masa. masa, pm, pureza?
    - moles_disolucion: moles en un volumen de disolución. c, v.
    - masa_moles: masa a partir de unos moles. moles, eq?, pm, pureza?
    - volumen_masa: volumen de un líquido puro. masa, densidad.
    - volumen_moles: volumen de disolución con unos moles. moles, eq?, c.
    - libre: solo si nada encaja. huecos null y escribe la cuenta en expr (ids, números con punto, + - * / ^ y paréntesis, con los cambios de unidades).
  - expr: null salvo en libre. original: solo si el texto dice literalmente esa cantidad ("se pesan 5,84 g"), en esa unidad; si no, null.
- pasos: imperativo de tú ("Pesa", "Añade"; nunca "Pesar" ni "Se pesa"), una acción por paso, en orden, sin saltarte nada (temperaturas, orden de adición, material, lo que hay que observar, "solo para las muestras X").
  - Las cantidades, con su id entre llaves y SIN unidad detrás: "Pesa {m_nacl} de NaCl y disuélvelo hasta {v_final}". Cada id entre llaves tiene que existir.
  - Lo que no cambia con la escala (temperaturas, tiempos, rpm, pH) va escrito en el paso: cada paso se entiende solo.
  - titulo: en el primer paso de cada fase o apartado del texto, su nombre tal cual ("Lavado ácido (solo muestras GNP)"); si no, null.
  - subfase y parte: cada fase se divide en partes de dos tipos. En el PRIMER paso de cada parte, subfase = su nombre corto ("Preparar la tinta", "Lavado de la fibra") y parte = "disolucion" si en esos pasos se prepara una disolución (pesar, disolver, mezclar, enrasar, sonicar, ajustar el pH, enfriarla) o "muestras" si las muestras pasan por algo (lavar, sumergir, secar, calentar, meter al horno o al reactor). Una fase tiene una o varias partes; si solo hay muestras, una sola. En los demás pasos, null en los dos.
  - minutos: solo si el texto da una espera concreta (3 h = 180; un intervalo, el más bajo); también escrita en el texto. "Toda la noche" o "hasta que se disuelva": null.
  - ciclos: en CADA paso con tiempo (minutos) de unos pasos que se repiten, cuántas veces en total ("repetir 5 veces" = 5). Así la inmersión y el secado de un ciclo llevan los dos ciclos 5: el usuario trabaja con varias muestras a la vez, unas en cada paso, y cada paso lleva su propia cuenta. Dilo en el texto del primer paso ("…: 5 ciclos en total") y deja al final el de repetir ("Repite… 4 veces más: 5 ciclos en total"), sin ciclos ni minutos.

Cómo montarlo:
- Saca datos con sentido químico aunque el texto dé cantidades fijas ("5,84 g de NaCl en 1 L" → 0.1 M, 1000 mL y su peso molecular).
- Cada disolución tiene su dato de volumen a preparar, y su paso dice cuánto se prepara. Ningún dato puede quedar sin usar.
- Ácido o base comercial diluido ("HNO3 6 M"): datos de concentración, volumen, densidad y riqueza del comercial ("falta" si no los da) y pm; un cálculo conc_comercial, otro dilucion con él como c_stock, y un paso: "En vitrina, añade lentamente {v_acido} de HNO3 comercial sobre agua destilada (nunca al revés) y completa hasta {v_bano}".
- Mezcla en proporción (5 : 1 : 4): UN dato con el volumen total y un dato por parte (unidad "partes"); el volumen de cada parte, con parte; lo que se disuelve en una parte, con ese volumen en el hueco v.
- Síntesis: un reactivo de referencia (su masa es un dato), sus moles con moles_masa y los demás por equivalentes con masa_moles (un líquido, después volumen_masa).
- No inventes cantidades, reactivos ni pasos (salvo el de preparar el ácido diluido). Todo en español correcto, con tildes.`;

  // De las parejas que da Gemini ([{ hueco, dato }]) a los args de la receta ({ c: 'c_nacl', partes: [...] }), y al revés.
  // Si Gemini manda también (o solo) el formato viejo, args, se respeta
  const LISTAS = new Set(Object.values(Quimica.TIPOS).flatMap((t) => Object.entries(t.huecos).filter(([, e]) => e.includes('lista')).map(([rol]) => rol)));
  const deParejas = (calculo) => {
    if (!calculo || !Array.isArray(calculo.huecos)) return calculo;
    const args = { ...(calculo.args && typeof calculo.args === 'object' ? calculo.args : {}) };
    for (const p of calculo.huecos) {
      if (!p || typeof p.hueco !== 'string' || p.dato == null) continue;
      const dato = String(p.dato).trim();
      if (LISTAS.has(p.hueco)) args[p.hueco] = [...(Array.isArray(args[p.hueco]) ? args[p.hueco] : []), dato];
      else args[p.hueco] = dato;
    }
    const { huecos, ...resto } = calculo;
    return { ...resto, args };
  };
  const aParejas = (args) => Object.entries(args || {}).flatMap(([hueco, v]) => (Array.isArray(v) ? v : [v]).map((dato) => ({ hueco, dato })));

  // El texto, sin lo que sobra para la IA (versión 88): espacios y saltos de línea repetidos, y los
  // números de las citas ([12], "ref. 3"). Lo que se guarda como «texto original» es lo que escribió
  // el usuario, tal cual; esto solo es lo que se manda (menos peso = menos fallos por saturación)
  const limpiarTexto = (t) => String(t || '')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*\[\d+(?:[-–,]\d+)*\]/g, '')
    .trim();

  // ─── Las marcas que puede poner el usuario al escribir (versión 90) ───
  // «# Título» (o «Fase: Título») empieza una fase; «🧪 Nombre» (o «Disolución: Nombre»), una parte en
  // la que se prepara una disolución; «🧫 Nombre» (o «Muestras: Nombre»), una parte en la que las
  // muestras pasan por algo. Lo que sigue a una marca son los pasos de ese bloque. Con ellas, la IA
  // ya no tiene que adivinar la estructura (la persona la sabe), y es lo que respeta
  // Una marca puede ir sola («🧪» y debajo los pasos): sin nombre, la IA le pone uno corto. Y si
  // detrás de la marca va una frase larga y no un nombre (pasó: «🧫 The reactor was placed in an oven
  // at 100ºC…»), esa frase es un paso: la marca queda sin nombre y la línea se manda tal cual
  // (el usuario probó así de verdad y salían nombres de 100 letras cortados)
  const MARCAS = [
    [/^(?:#+|fase\s*:)\s*(.*)$/i, 'fase'],
    [/^(?:🧪|disoluci[oó]n\s*:)\s*(.*)$/i, 'disolucion'],
    [/^(?:🧫|muestras\s*:)\s*(.*)$/i, 'muestras'],
  ];
  const esNombre = (t) => t.length <= 50 && !/[.;]\s/.test(t) && !/[.;]$/.test(t) && t.split(/\s+/).length <= 8;
  const marcasDe = (texto) => {
    const marcas = [];
    for (const linea of String(texto || '').split('\n')) {
      const t = linea.trim();
      for (const [re, tipo] of MARCAS) {
        const m = re.exec(t);
        if (m) {
          const resto = m[1].trim();
          marcas.push({ tipo, nombre: esNombre(resto) ? resto : '' });
          break;
        }
      }
    }
    return marcas;
  };
  const sinTildes = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  // Lo que la IA tenía que haber puesto y no está en la receta (para avisar; no se arregla solo)
  const marcasSinCumplir = (receta, marcas) => {
    const fases = new Set(receta.pasos.map((p) => p.titulo).filter(Boolean).map(sinTildes));
    const subs = new Map(receta.pasos.filter((p) => p.subfase).map((p) => [sinTildes(p.subfase), p.parte]));
    // (las marcas sin nombre no se pueden comprobar por el nombre)
    return marcas.filter((m) => m.nombre && (m.tipo === 'fase' ? !fases.has(sinTildes(m.nombre)) : subs.get(sinTildes(m.nombre)) !== m.tipo));
  };
  const avisoDeMarcas = (marcas) => {
    if (!marcas.length) return '';
    const nombre = { fase: 'una fase', disolucion: 'una parte de disolución (🧪)', muestras: 'una parte de muestras (🧫)' };
    return `\n\nEl usuario ya ha marcado la estructura. RESPÉTALA exactamente: no cambies sus nombres, su orden ni su tipo, y no añadas otras fases ni partes. Las marcas, en orden:\n${
      marcas.map((m) => `- ${nombre[m.tipo]}: ${m.nombre ? `«${m.nombre}»` : '(sin nombre: ponle tú uno corto, de 2 a 5 palabras)'}`).join('\n')}\n`
      + 'Una marca de fase pone ese nombre en titulo del primer paso de la fase; una de disolución o de muestras, ese nombre en subfase y su tipo en parte, en el primer paso de ese bloque. '
      + 'Si en la línea de una marca hay una frase larga en vez de un nombre, esa frase es un paso de ese bloque. '
      + 'Las líneas que van detrás de una marca son los pasos de ese bloque. Una fase sin marcas 🧪 o 🧫 debajo no lleva subfases. Quita las marcas del texto de los pasos.';
  };

  const pedirConvertir = (texto) => `Convierte este procedimiento de laboratorio en una receta para la app.\n${REGLAS}${avisoDeMarcas(marcasDe(texto))}\n\nEl procedimiento, tal como lo ha escrito el usuario:\n"""\n${limpiarTexto(texto)}\n"""`;

  const pedirCambio = (receta, peticion) => {
    const actual = {
      nombre: receta.nombre, resumen: receta.resumen, seguridad: receta.seguridad || null, notas: receta.notas || null,
      // Un peso molecular escrito a mano va sin fórmula, para que la app no lo vuelva a calcular
      // (origen "texto" en los que tienen valor, para que la IA los devuelva tal cual)
      datos: receta.datos.map((d) => {
        const esPM = Quimica.esPesoMolecular(d) && !d.manual;
        return { id: d.id, nombre: d.nombre, valor: esPM ? null : d.valor, unidad: d.unidad, formula: d.manual ? null : d.formula || null,
          origen: esPM ? 'formula' : d.valor == null ? 'falta' : 'texto' };
      }),
      // (las «solo de la app», como su cuenta escrita: Gemini no las conoce; ver devolverFijas)
      calculos: receta.calculos.map((c) => (paraIA(c)
        ? { id: c.id, nombre: c.nombre, unidad: c.unidad, tipo: c.tipo, huecos: aParejas(c.args), expr: null, original: null }
        : { id: c.id, nombre: c.nombre, unidad: c.unidad, tipo: 'libre', huecos: null, expr: c.expr, original: null })),
      pasos: receta.pasos.map((p) => ({ titulo: p.titulo || null, texto: p.texto, minutos: p.minutos || null, ciclos: p.ciclos || null,
        subfase: p.subfase || null, parte: p.subfase ? p.parte || 'muestras' : null })),
    };
    return `Esta es una receta de la app, en JSON:\n${JSON.stringify(actual)}\n\nEl usuario pide este cambio:\n"""\n${peticion}\n"""\n\n`
      + 'Devuelve la receta entera con ese cambio hecho. Conserva tal cual todo lo que el cambio no toque (los id, los valores de los datos, los pasos). '
      + 'Si pide calcular algo nuevo, añade los datos y los cálculos que hagan falta y enséñalo en el paso que corresponda. '
      + 'Si algún cálculo es de tipo "libre" y encaja en uno de los tipos fijos, pásalo a ese tipo. '
      + 'En todos los cálculos pon original null.\n'
      + `${REGLAS}`;
  };

  class ErrorIA extends Error {
    constructor(mensaje, estado) { super(mensaje); this.estado = estado; }
  }

  // Cuando Gemini se niega por seguridad (estado propio, no es de HTTP)
  const SEGURIDAD = 'seguridad';
  // Cuando no contesta a tiempo (versión 125): no se vuelve a pedir (antes se pedía otra vez al mismo
  // modelo: 5 minutos de espera y 2 peticiones del cupo, y la segunda tampoco contestaba)
  const TIEMPO = 'tiempo';
  const FINES_DE_SEGURIDAD = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'];

  // OJO: NO limitar el «pensar» (thinkingConfig / thinkingBudget). Se probó en la versión 88 y con el
  // texto de la receta del usuario Gemini se BLOQUEABA (promptFeedback.blockReason «OTHER», tras
  // 60-90 s y sin escribir nada); sin el límite, el mismo texto se convierte bien. Con el texto de
  // un artículo el límite no daba problema: depende del texto, y no se puede fiar

  const llamar = async (modelo, texto, clave, pedir) => {
    const cuerpo = {
      systemInstruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: 'user', parts: [{ text: texto }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: ESQUEMA },
    };
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO);
    try {
      const r = await pedir(`${API}/${modelo}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': clave, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const mensaje = String((j.error && j.error.message) || `HTTP ${r.status}`);
        // Gemini contesta 400 tanto si la clave no vale como si la petición está mal: se distinguen por el texto
        const estado = r.status === 400 && /api.?key/i.test(mensaje) ? 401 : r.status;
        throw new ErrorIA(mensaje.split(clave).join('[clave]').slice(0, 200), estado);
      }
      // Gemini se niega por sus normas de seguridad: lo dice en promptFeedback.blockReason (el texto
      // pedido) o en finishReason (la respuesta), y no manda receta. No sirve volver a pedirlo
      const bloqueo = (j.promptFeedback && j.promptFeedback.blockReason) || '';
      const c = j.candidates && j.candidates[0];
      const fin = (c && c.finishReason) || '';
      const salida = c && c.content && (c.content.parts || []).map((p) => p.text || '').join('');
      if (bloqueo || (!salida && FINES_DE_SEGURIDAD.includes(fin))) throw new ErrorIA(`Bloqueado por seguridad (${bloqueo || fin})`, SEGURIDAD);
      if (!salida) throw new ErrorIA('La IA no ha devuelto nada', 0);
      return salida;
    } catch (err) {
      if (err.name === 'AbortError') throw new ErrorIA('La IA ha tardado demasiado', TIEMPO);
      if (err instanceof ErrorIA) throw err;
      throw new ErrorIA('Sin conexión', -1);
    } finally {
      clearTimeout(temporizador);
    }
  };

  const leerJson = (texto) => {
    try { return JSON.parse(texto); } catch { /* puede venir con texto alrededor */ }
    const m = /\{[\s\S]*\}/.exec(texto);
    if (m) { try { return JSON.parse(m[0]); } catch { /* no es JSON */ } }
    return null;
  };

  // Lo que se le dice al usuario cuando falla
  const mensajeDe = (err) => {
    if (err.estado === -1) return 'No hay conexión a internet: la IA la necesita';
    // (el motivo «OTHER» no es de seguridad: Gemini bloquea sin decir por qué; no sirve repetirlo)
    if (err.estado === SEGURIDAD && /\(OTHER\)/.test(err.message)) return 'Gemini ha rechazado este texto sin decir por qué. Prueba a acortarlo un poco, o escribe la receta a mano con ✍️ (las cuentas las hace la app igual).';
    if (err.estado === TIEMPO) return 'Gemini no ha contestado en 2 minutos y medio: suele pasar cuando está muy cargado. Prueba otra vez en un rato (o escribe la receta a mano con ✍️)';
    if (err.estado === SEGURIDAD) return 'Gemini no ha querido convertir este texto por sus normas de seguridad. Puedes escribir la receta a mano con ✍️ (las cuentas las hace la app igual).';
    if (err.estado === 429) return 'Gemini ha llegado a su límite gratuito de hoy (20 peticiones al día, y los intentos con Gemini saturado también cuentan). Se renueva de madrugada';
    if (err.estado === 401 || err.estado === 403) return 'Gemini no acepta la clave: revísala en ⚙️ Ajustes';
    if (err.estado >= 500) return 'Gemini está saturado ahora mismo; prueba otra vez en unos minutos';
    if (err.estado === 0 && err.message.startsWith('Receta')) return `La IA ha dado una receta que no vale (${err.message.slice(18)}). Prueba otra vez`;
    return 'La IA no ha podido ahora; prueba otra vez en un rato';
  };

  // Pide con el modelo principal y, si falla, con el de reserva. Devuelve { receta, modelo } o { error }
  const generar = async (texto, clave, opciones, extra, sinOriginales, marcas = []) => {
    const pedir = (opciones && opciones.fetch) || ((...a) => fetch(...a));
    const pausa = (opciones && opciones.pausa) || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let ultimo = null;
    // Una receta que vale pero con algún paso que nombra una cantidad que no existe (pasó con
    // Gemini de verdad: "{v_v_etanol_extra}") o con un dato que no se usa en nada (también pasó:
    // un volumen suelto): se prueba con el siguiente modelo y, si ninguno da una limpia, se
    // entrega la primera con sus avisos
    let conFallos = null;
    let rechazo = null;
    // Si Gemini está saturado (5xx, pasa a menudo), se espera un poco y se da otra vuelta
    // Un modelo que ya ha dicho que se acabó el cupo gratuito (429) no se vuelve a probar: la capa
    // gratuita da unas 20 peticiones al día por modelo, y cada intento gasta
    const sinCupo = new Set();
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      let saturado = false;
      for (const modelo of MODELOS) {
        if (sinCupo.has(modelo)) continue;
        try {
          const datos = leerJson(await llamar(modelo, texto, clave, pedir));
          // Lo que la IA dice que el texto no da se queda en blanco, aunque le haya puesto un número
          if (datos && Array.isArray(datos.datos)) for (const d of datos.datos) if (d && d.origen === 'falta') d.valor = null;
          if (datos && Array.isArray(datos.calculos)) datos.calculos = datos.calculos.map(deParejas);
          const v = datos ? Quimica.validar({ ...datos, ...extra }) : { error: 'no es JSON' };
          if (v.error) throw new ErrorIA(`Receta no válida: ${v.error}`, 0);
          // Al cambiar una receta, lo que decía el texto ya no sirve para comprobar (los datos pueden ser otros)
          if (sinOriginales) for (const c of v.receta.calculos) delete c.original;
          v.receta.avisos = Quimica.revisar(v.receta);
          // Lo que el usuario marcó y la IA no ha respetado, para que lo arregle en el formulario
          for (const m of marcasSinCumplir(v.receta, marcas)) {
            v.receta.avisos.push(`Marcaste ${m.tipo === 'fase' ? 'la fase' : m.tipo === 'disolucion' ? 'la disolución 🧪' : 'las muestras 🧫'} «${m.nombre}» y la IA no la ha puesto: añádela en el formulario (✏️).`);
          }
          // Las fórmulas que ha escrito la IA (las que no son de las fijas de la app) se avisan
          for (const c of v.receta.calculos) {
            if (!Quimica.esFija(c)) v.receta.avisos.push(`«${c.nombre}» lleva una fórmula escrita por la IA, no una de las fijas de la app: revísala (= ${c.expr}).`);
          }
          v.receta.modelo = modelo;
          if (!v.receta.avisos.some((a) => a.startsWith('Un paso nombra') || a.startsWith('El dato'))) return { receta: v.receta, modelo };
          if (!conFallos) conFallos = { receta: v.receta, modelo };
        } catch (err) {
          ultimo = err;
          // Una receta que no vale se recuerda: si después los demás están saturados, lo que se le
          // dice al usuario es por qué no valía (pasó: un modelo contestó con una receta mala, el otro
          // estaba saturado, y la app solo decía "saturado")
          if (err.estado === 0 && !rechazo) rechazo = err;
          // Sin conexión o con la clave mal, los demás modelos fallarían igual
          // (ni si Gemini se niega por seguridad: se negaría otra vez, y cada intento gasta del cupo)
          if ([-1, 401, 403, SEGURIDAD].includes(err.estado)) return { error: mensajeDe(err), detalle: err.message };
          // Sin contestar a tiempo: el siguiente intento es el mismo modelo, que tampoco contestaría
          if (err.estado === TIEMPO) return conFallos || { error: mensajeDe(err), detalle: err.message };
          if (err.estado === 429) sinCupo.add(modelo);
          // Saturado: el siguiente de la lista es el mismo modelo, también saturado; y cada petición,
          // aunque la rechace por saturación, gasta del cupo diario. Se pasa a la siguiente vuelta
          if (err.estado >= 500) { saturado = true; break; }
        }
      }
      if (conFallos || !saturado) break;
      if (vuelta < VUELTAS - 1) await pausa(ESPERA_SATURADO_MS);
    }
    if (conFallos) return conFallos;
    const motivo = rechazo || ultimo;
    return { error: mensajeDe(motivo), detalle: motivo.message };
  };

  let enMarcha = false;
  const unaALaVez = async (fn) => {
    if (enMarcha) return { error: 'La IA ya está trabajando: espera un momento' };
    enMarcha = true;
    try { return await fn(); } finally { enMarcha = false; }
  };

  // El texto pegado → receta nueva
  const convertir = (texto, clave, opciones) => {
    const t = String(texto || '').trim();
    const k = String(clave || '').trim();
    if (!k) return Promise.resolve({ error: 'Falta la clave de Gemini: ponla en ⚙️ Ajustes' });
    if (t.length < 20) return Promise.resolve({ error: 'Pega el texto del procedimiento (es muy corto)' });
    if (t.length > MAX_TEXTO) return Promise.resolve({ error: `El texto es demasiado largo (más de ${MAX_TEXTO} letras)` });
    return unaALaVez(() => generar(pedirConvertir(t), k, opciones, { textoOriginal: t }, false, marcasDe(t)));
  };

  // Una receta + lo que pide el usuario → la receta cambiada (con su id y su texto original)
  const cambiar = (receta, peticion, clave, opciones) => {
    const t = String(peticion || '').trim();
    const k = String(clave || '').trim();
    if (!k) return Promise.resolve({ error: 'Falta la clave de Gemini: ponla en ⚙️ Ajustes' });
    if (t.length < 5) return Promise.resolve({ error: 'Escribe qué quieres cambiar' });
    return unaALaVez(() => generar(pedirCambio(receta, t.slice(0, 2000)), k, opciones, { id: receta.id, textoOriginal: receta.textoOriginal }, true))
      .then((r) => (r && r.receta ? { ...r, receta: devolverFijas(r.receta, receta) } : r));
  };
  // Las fórmulas «solo de la app» se le mandan a Gemini como su cuenta escrita (libre). Si las devuelve
  // igual (mismo id y misma cuenta), vuelven a ser de la app, sin el aviso de «fórmula escrita por la IA».
  // Y los datos que se apuntan al hacer la receta (enPaso, versión 151) no se le mandan como tales:
  // los que siguen ahí (mismo id) vuelven a llevar su marca
  const sinEspacios = (s) => String(s || '').replace(/\s+/g, '');
  const devolverFijas = (nueva, vieja) => {
    let cambio = false;
    for (const d of nueva.datos || []) {
      const antes = (vieja.datos || []).find((x) => x.id === d.id);
      if (antes && antes.enPaso && !d.enPaso) { d.enPaso = true; cambio = true; }
    }
    for (const c of nueva.calculos || []) {
      const antes = (vieja.calculos || []).find((x) => x.id === c.id);
      if (!antes || !Quimica.esFija(antes) || paraIA(antes) || Quimica.esFija(c) || sinEspacios(c.expr) !== sinEspacios(antes.expr)) continue;
      nueva.avisos = (nueva.avisos || []).filter((a) => !a.startsWith(`«${c.nombre}» lleva una fórmula escrita por la IA`));
      c.tipo = antes.tipo;
      c.args = JSON.parse(JSON.stringify(antes.args));
      cambio = true;
    }
    if (!cambio) return nueva;
    const v = Quimica.validar(nueva);
    return v.error ? nueva : { ...v.receta, modelo: nueva.modelo };
  };

  const Gemini = { convertir, cambiar, marcasDe, MODELOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Gemini;
  else raiz.Gemini = Gemini;
})(typeof window !== 'undefined' ? window : globalThis);
