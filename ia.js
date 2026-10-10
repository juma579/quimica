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
  const TIEMPO_MAXIMO = 90 * 1000;
  const MAX_TEXTO = 12000;

  // Los nombres de todos los huecos de las fórmulas fijas (c, v, pm, pureza, partes…).
  // A Gemini se le piden como una LISTA de parejas { hueco, dato }. Antes era una ficha con una
  // casilla por hueco (16 casillas), y Gemini de verdad solo rellenaba las dos primeras, dejaba
  // las demás vacías y metía varios id juntos en una ("v_tinta Sakamoto pureza_naddbs")
  const HUECOS = [];
  for (const tipo of Object.values(Quimica.TIPOS)) {
    for (const rol of Object.keys(tipo.huecos)) if (!HUECOS.includes(rol)) HUECOS.push(rol);
  }

  const ESQUEMA = {
    type: 'OBJECT',
    properties: {
      nombre: { type: 'STRING' },
      resumen: { type: 'STRING' },
      seguridad: { type: 'STRING', nullable: true },
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
            tipo: { type: 'STRING', enum: [...Object.keys(Quimica.TIPOS), 'libre'] },
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

  const REGLAS = `
La app enseña la receta así: unos DATOS que el usuario puede cambiar, unas CANTIDADES que la app calcula a partir de los datos con una fórmula, y los PASOS, donde cada cantidad sale ya calculada. Si el usuario cambia un dato (el volumen final, la molaridad, un peso molecular…), todas las cantidades de los pasos cambian solas. Las fórmulas de siempre ya están hechas y probadas dentro de la app: tú solo dices cuál es la de cada cantidad y qué dato va en cada hueco; las cuentas y los cambios de unidades los hace la app.

Devuelve un objeto JSON con:
- nombre: corto. resumen: una frase que diga qué se prepara o qué se hace.
- seguridad: precauciones (lo que diga el texto y lo evidente para esos reactivos: guantes, gafas, vitrina, "añadir el ácido sobre el agua"…), en pocas frases; null si no hace falta. Si se calienta un disolvente inflamable (etanol, acetona…) o se mete en un horno algo empapado en él, avisa aquí: calentar solo sobre placa sin llama, con ventilación y por debajo de su punto de ebullición, y dejar evaporar el disolvente en vitrina antes del horno.
- datos: los números de los que depende la receta y que el usuario querrá cambiar: volumen final, concentración deseada, concentración de las disoluciones madre, masa del reactivo de partida, equivalentes, pureza o riqueza, densidad y los pesos moleculares. Cada uno:
  - id: nombre corto para las fórmulas, solo letras minúsculas sin tilde, números y "_", empezando por letra: "v_final", "c_nacl", "pm_nacl", "eq_base", "d_hcl".
  - nombre: como lo leería una persona ("Volumen final", "Concentración de NaCl").
  - origen: de dónde sale el valor. "texto": el número está escrito en el texto. "deducido": se calcula con números del texto (una concentración a partir de una masa y un volumen). "formula": es un peso molecular con su fórmula química. "falta": hace falta pero el texto no lo da ni se puede deducir de él (lo más habitual: el volumen que se quiere preparar de cada disolución cuando el texto solo da concentraciones; también una pureza o la concentración de un stock).
  - valor: el número, si origen es "texto" o "deducido". Si origen es "falta" o "formula", null: el usuario lo escribirá en la app. NUNCA inventes un valor "razonable" (ni 100 mL, ni 1 L): un número inventado parecería sacado del texto.
  - unidad: g, mg, mL, L, µL, mol, mmol, M, mM, g/mol, %, g/mL, eq…
  - formula: SOLO en los pesos moleculares (unidad "g/mol"): la fórmula química bien escrita, con mayúsculas y minúsculas ("NaCl", "CuSO4·5H2O", "Ca(OH)2", "C9H8O4"). La app calcula el peso molecular con ella: en ese caso pon valor null. En los demás datos, formula null.
- calculos: cada cantidad que hay que medir (pesar, pipetear, enrasar) y que depende de los datos. Cada uno:
  - id y nombre, como en los datos ("m_nacl", "NaCl a pesar").
  - unidad: la del resultado (g para una masa, mL para un volumen, M para una molaridad, mol o mmol para moles). La app ya cambia sola de g a mg o de mL a µL: no hagas cálculos duplicados para eso.
  - tipo: cuál de las fórmulas de la app es.
  - huecos: qué va en cada hueco de esa fórmula, como una lista de parejas { "hueco": nombre del hueco, "dato": UN SOLO id de un dato o de otro cálculo }. Pon una pareja por cada hueco de la fórmula: TODOS los obligatorios, y los opcionales si existe ese dato (si la receta tiene la pureza de ese reactivo, pon su hueco pureza). En "dato" va un único id, tal cual, sin espacios ni nada más; NUNCA números: si hace falta un número (6 M, 2 equivalentes, el 98 % de pureza), créalo como dato. No conviertas unidades: la app sabe que un dato va en mL o en mM. Los tipos y sus huecos:
    - "masa_molar": masa de un sólido para una disolución de molaridad dada. Huecos: c (la concentración, en M o mM), v (el volumen de disolución), pm (el peso molecular), pureza (en %, opcional). Ejemplo: [{"hueco":"c","dato":"c_nacl"},{"hueco":"v","dato":"v_final"},{"hueco":"pm","dato":"pm_nacl"},{"hueco":"pureza","dato":"pureza_nacl"}].
    - "masa_gl": masa de un sólido para una concentración en g/L, mg/mL o % peso/volumen. Huecos: c, v, pureza (opcional).
    - "dilucion": volumen que hay que medir de una disolución más concentrada. Huecos: c (la concentración que se quiere), v (el volumen que se quiere), c_stock (la concentración de la disolución de partida; puede ser un dato o un cálculo de tipo "conc_comercial"). Las dos concentraciones, en el mismo tipo de unidad.
    - "parte": lo que le toca a una parte de una mezcla en proporción (5 : 1 : 4). Huecos: total (el volumen total de la mezcla), parte (el dato con las partes de esta), y una pareja "partes" por CADA parte de la mezcla, incluida esta. Ejemplo para la primera de tres: [{"hueco":"total","dato":"v_mezcla"},{"hueco":"parte","dato":"partes_a"},{"hueco":"partes","dato":"partes_a"},{"hueco":"partes","dato":"partes_b"},{"hueco":"partes","dato":"partes_extra"}].
    - "conc_comercial": molaridad de un ácido o una base que se compra concentrado. Huecos: densidad (g/mL), riqueza (% en peso), pm. Sale en M.
    - "moles_masa": moles que hay en una masa. Huecos: masa, pm, pureza (opcional). Sale en mol o mmol.
    - "moles_disolucion": moles que hay en un volumen de disolución. Huecos: c, v.
    - "masa_moles": masa de un reactivo o de un producto a partir de unos moles. Huecos: moles (un cálculo de moles), eq (los equivalentes respecto a esos moles; opcional), pm, pureza (opcional).
    - "volumen_masa": volumen de un líquido puro a partir de su masa. Huecos: masa, densidad.
    - "volumen_moles": volumen de una disolución que lleva unos moles. Huecos: moles, eq (opcional), c.
    - "libre": SOLO si ninguna de las anteriores sirve. Entonces huecos null, y escribe tú la cuenta en expr, con los id de los datos y de otros cálculos, números con punto decimal, + - * / ^ y paréntesis (también sqrt(), log() decimal, ln(), exp(), min(), max()), metiendo en ella los cambios de unidades. La app la marcará para que el usuario la revise.
  - expr: null salvo con tipo "libre".
  - original: SOLO si el texto dice literalmente esa cantidad ("se pesan 5,84 g"): ese número, en esa misma unidad (sirve para comprobar tu fórmula: con los datos del texto, la fórmula tiene que dar ese número). Si el texto no la dice, null: no pongas aquí un número calculado por ti.
- pasos: frases cortas, siempre en imperativo de tú ("Pesa…", "Añade…", "Seca…"; nunca "Pesar", "Secado" ni "Se pesa"), una acción por paso y en el orden del texto. No te saltes nada de lo que diga el texto (temperaturas, orden de adición, material, lo que hay que observar, condiciones como "solo para las muestras X", cuántas veces se repite algo).
  - titulo: si el texto viene dividido en fases, etapas o apartados ("Fase 1: Tinta de grafeno", "Lavado ácido (solo muestras GNP)"), el primer paso de cada una lleva en titulo el nombre de la fase tal como lo dice el texto, con sus aclaraciones. En los demás pasos, null.
  - ciclos: si unos pasos se repiten varias veces (un ciclo: "sumergir, secar y repetir 5 veces"), el PRIMER paso del ciclo lleva en ciclos cuántos ciclos son en total (5; "repetir 5 veces" son 5 en total, no 5 además del primero, salvo que el texto diga otra cosa). La app pone ahí un contador que sube cada vez que se pone el cronómetro de ese paso. En los demás pasos, null. Dilo también en el texto de ese primer paso ("Sumerge la fibra en la tinta durante 10 min (ciclo de inmersión y secado: 5 ciclos en total)") y deja al final del ciclo el paso de repetir ("Repite la inmersión y el secado 4 veces más: 5 ciclos en total").
  - Cada cantidad que sea un dato o un cálculo se escribe con su id entre llaves, SIN el número ni la unidad: "Pesa {m_nacl} de NaCl y disuélvelo en unos {v_agua} de agua". La app pone el número y la unidad: no escribas la unidad detrás de las llaves (mal: "HNO3 {c_hno3} M"; bien: "HNO3 {c_hno3}").
  - Lo que no cambia con la escala (temperaturas, rpm, pH, tiempos) se escribe tal cual en el texto del paso, SIEMPRE: cada paso se tiene que entender solo ("Mantén el reactor sellado a 100 °C durante 8 h", "Sonica 3 h").
  - minutos: solo si en ese paso hay que esperar un tiempo concreto que dice el texto (agitar, calentar, reflujo, reposo, enfriar, centrifugar, incubar): la app pone un cronómetro. El tiempo va en minutos (3 h son 180) y además escrito en el texto del paso. Puede llevar decimales (0.5 son 30 segundos). Si es un intervalo, el valor más bajo. Si no hay espera, o el texto no da un tiempo concreto ("toda la noche", "hasta que se disuelva"), null: no inventes una duración.

Cómo elegir los datos y las fórmulas:
- Piensa qué querría cambiar un químico: casi siempre el volumen final o la escala, la concentración, y los pesos moleculares, la pureza y la densidad de los reactivos.
- Aunque el texto solo dé cantidades fijas ("disuelve 5,84 g de NaCl en 1 L"), saca de ellas los datos con sentido químico (concentración 0.1 M, volumen 1000 mL, peso molecular) y calcula la cantidad con ellos.
- Pureza: cada reactivo que se pesa para una disolución de concentración dada lleva su dato de pureza en % ("pureza_nacl"; si el texto no la da, valor 100 y origen "deducido"), y va en el hueco pureza de su cálculo.
- Ácido o base comercial diluido a una concentración ("HNO3 6 M"): datos de la concentración que se quiere, el volumen a preparar, la densidad (g/mL) y la riqueza (% en peso) del producto comercial (origen "falta" si el texto no los da) y su peso molecular; un cálculo "conc_comercial" y otro "dilucion" con ese como c_stock; y un paso aparte para prepararlo: "En vitrina, añade lentamente {v_acido} de HNO3 comercial sobre agua destilada (nunca al revés) y completa con agua hasta {v_bano}".
- Reacción o síntesis: toma un reactivo de referencia (su masa es un dato), calcula sus moles ("moles_masa") y da los demás por equivalentes ("masa_moles", con un dato de equivalentes que sale de las cantidades del texto; si es un líquido, después "volumen_masa" con su densidad). Si viene a cuento, añade el rendimiento teórico ("masa_moles" con el peso molecular del producto).
- Mezcla en proporción de volúmenes (por ejemplo 5 : 1 : 4, disolución A : disolución B : disolvente). OBLIGATORIO hacerlo así, y NO con un dato de volumen suelto para cada parte:
  - datos: UN solo volumen, el total de la mezcla ("v_mezcla", origen "falta" si el texto no lo da), y un dato por cada parte de la proporción ("partes_a" 5, "partes_b" 1, "partes_extra" 4, unidad "partes", origen "texto").
  - calculos: el volumen de cada parte, de tipo "parte". La masa de lo que se disuelve en cada parte se calcula con el volumen de esa parte (ese cálculo va en el hueco v).
  - pasos: cada uno dice su volumen: "Disuelve {m_a} de A en {v_a} de etanol", "Mezcla las dos disoluciones y añade {v_extra} de etanol".
- Si hay varias disoluciones independientes, cada una tiene su propio dato de volumen a preparar.
- En el paso donde se prepara cada disolución se dice cuánto se prepara: "Disuelve {m_nacl} de NaCl en agua destilada hasta {v_final}". Todo dato de volumen o de masa tiene que usarse en algún cálculo o salir en algún paso: no dejes datos sueltos.
- Cada id que escribas entre llaves en un paso tiene que ser exactamente uno de los id de datos o de calculos: repásalos uno a uno antes de contestar.
- Si una cantidad no encaja en ningún tipo pero debe crecer con la receta, crea el dato "escala" (valor 1, unidad "×") y un cálculo "libre" con expr "cantidad_del_texto * escala".
- No inventes cantidades, reactivos ni pasos que no estén en el texto (salvo el de preparar un ácido diluido). Si el texto dice el hidrato de una sal (monohidratado, trihidratado…), la fórmula química lleva exactamente ese hidrato. No uses en huecos ni en expr ningún id que no hayas definido.
- Todo en español correcto, con sus tildes.`;

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

  const pedirConvertir = (texto) => `Convierte este procedimiento de laboratorio en una receta para la app.\n${REGLAS}\n\nEl procedimiento, tal como lo ha escrito el usuario:\n"""\n${texto}\n"""`;

  const pedirCambio = (receta, peticion) => {
    const actual = {
      nombre: receta.nombre, resumen: receta.resumen, seguridad: receta.seguridad || null,
      // Un peso molecular escrito a mano va sin fórmula, para que la app no lo vuelva a calcular
      // (origen "texto" en los que tienen valor, para que la IA los devuelva tal cual)
      datos: receta.datos.map((d) => {
        const esPM = Quimica.esPesoMolecular(d) && !d.manual;
        return { id: d.id, nombre: d.nombre, valor: esPM ? null : d.valor, unidad: d.unidad, formula: d.manual ? null : d.formula || null,
          origen: esPM ? 'formula' : d.valor == null ? 'falta' : 'texto' };
      }),
      calculos: receta.calculos.map((c) => (Quimica.esFija(c)
        ? { id: c.id, nombre: c.nombre, unidad: c.unidad, tipo: c.tipo, huecos: aParejas(c.args), expr: null, original: null }
        : { id: c.id, nombre: c.nombre, unidad: c.unidad, tipo: 'libre', huecos: null, expr: c.expr, original: null })),
      pasos: receta.pasos.map((p) => ({ titulo: p.titulo || null, texto: p.texto, minutos: p.minutos || null, ciclos: p.ciclos || null })),
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
  const FINES_DE_SEGURIDAD = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'];

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
      if (err.name === 'AbortError') throw new ErrorIA('La IA ha tardado demasiado', 0);
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
    if (err.estado === SEGURIDAD) return 'Gemini no ha querido convertir este texto por sus normas de seguridad. Puedes escribir la receta a mano con ✍️ (las cuentas las hace la app igual).';
    if (err.estado === 429) return 'Gemini ha llegado a su límite gratuito de hoy (20 peticiones al día, y los intentos con Gemini saturado también cuentan). Se renueva de madrugada';
    if (err.estado === 401 || err.estado === 403) return 'Gemini no acepta la clave: revísala en ⚙️ Ajustes';
    if (err.estado >= 500) return 'Gemini está saturado ahora mismo; prueba otra vez en unos minutos';
    if (err.estado === 0 && err.message.startsWith('Receta')) return `La IA ha dado una receta que no vale (${err.message.slice(18)}). Prueba otra vez`;
    return 'La IA no ha podido ahora; prueba otra vez en un rato';
  };

  // Pide con el modelo principal y, si falla, con el de reserva. Devuelve { receta, modelo } o { error }
  const generar = async (texto, clave, opciones, extra, sinOriginales) => {
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
    return unaALaVez(() => generar(pedirConvertir(t), k, opciones, { textoOriginal: t }));
  };

  // Una receta + lo que pide el usuario → la receta cambiada (con su id y su texto original)
  const cambiar = (receta, peticion, clave, opciones) => {
    const t = String(peticion || '').trim();
    const k = String(clave || '').trim();
    if (!k) return Promise.resolve({ error: 'Falta la clave de Gemini: ponla en ⚙️ Ajustes' });
    if (t.length < 5) return Promise.resolve({ error: 'Escribe qué quieres cambiar' });
    return unaALaVez(() => generar(pedirCambio(receta, t.slice(0, 2000)), k, opciones, { id: receta.id, textoOriginal: receta.textoOriginal }, true));
  };

  const Gemini = { convertir, cambiar, MODELOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Gemini;
  else raiz.Gemini = Gemini;
})(typeof window !== 'undefined' ? window : globalThis);
