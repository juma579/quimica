// Las fotos del cuaderno. Se guardan en el móvil (IndexedDB: localStorage no tiene sitio para
// fotos), como JPEG a toda su resolución (hasta 16 megapíxeles; versión 126, antes 2000 px), con una
// «vista» de 2000 px y una «mini» de 400 px para enseñarlas deprisa.
// Las .tiff (las del microscopio) el WebView no las sabe enseñar: se leen con UTIF.js (y pako, para
// las comprimidas), que están en vendor/ y solo se cargan la primera vez que hace falta.
//   Fotos.convertir(archivo) → { id, blob, nombre, ancho, alto }   (sin guardar)
//   Fotos.guardar(foto), Fotos.leer(id) → foto | null, Fotos.borrar(id)
(function () {
  'use strict';
  // Cada usuario del móvil (versión 112) tiene su propia base de fotos. El primero (o si no hay usuarios)
  // sigue con «quimica-fotos»: así las fotos de antes se quedan donde estaban, sin migrar nada.
  // El usuario activo está en localStorage `quimica.usuarios` ({ activo, lista }); al cambiar de usuario
  // se recarga la página, así que esto se mira una sola vez
  const nombreDeBase = () => {
    try {
      const u = JSON.parse(localStorage.getItem('quimica.usuarios') || 'null');
      if (u && typeof u.activo === 'string' && /^[a-z0-9]{2,20}$/i.test(u.activo) && u.activo !== 'u1') return `quimica-fotos-${u.activo}`;
    } catch { /* sin usuarios: la de siempre */ }
    return 'quimica-fotos';
  };
  const BASE = nombreDeBase();
  const ALMACEN = 'fotos';
  const LADO = 2000;

  let base = null;
  const abrir = () => {
    if (!base) {
      base = new Promise((ok, mal) => {
        const p = indexedDB.open(BASE, 1);
        p.onupgradeneeded = () => p.result.createObjectStore(ALMACEN, { keyPath: 'id' });
        p.onsuccess = () => ok(p.result);
        p.onerror = () => mal(p.error);
      });
      base.catch(() => { base = null; });
    }
    return base;
  };
  const operar = async (modo, fn) => {
    const db = await abrir();
    return new Promise((ok, mal) => {
      const t = db.transaction(ALMACEN, modo);
      const pedido = fn(t.objectStore(ALMACEN));
      t.oncomplete = () => ok(pedido ? pedido.result : undefined);
      t.onerror = () => mal(t.error || new Error('No se ha podido guardar'));
      t.onabort = () => mal(t.error || new Error('No se ha podido guardar'));
    });
  };
  const guardar = (foto) => operar('readwrite', (s) => s.put(foto));
  const leer = async (id) => (await operar('readonly', (s) => s.get(id))) || null;
  const borrar = (id) => operar('readwrite', (s) => s.delete(id));
  // Los ids de todas las fotos guardadas (para saber cuáles pasar al PC o traer de él)
  const ids = async () => (await operar('readonly', (s) => s.getAllKeys())) || [];

  // Un script de vendor/, una sola vez
  const cargados = {};
  const cargar = (src) => {
    if (!cargados[src]) {
      cargados[src] = new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = ok;
        s.onerror = () => { delete cargados[src]; mal(new Error(`No se ha podido cargar ${src}`)); };
        document.head.append(s);
      });
    }
    return cargados[src];
  };

  // Lo más grande que se guarda (versión 126, lo pidió el usuario: «verlas a máxima resolución»):
  // la foto entera, salvo que pase de 16 megapíxeles, que es lo más que puede dibujar un iPhone (y
  // más sería mucha memoria en el móvil). Antes se guardaba de 2000 px como mucho
  const MAX_AREA = 16000000;
  // Reduce una imagen RGBA a la mitad, un tercio… (promediando cada cuadrado de f×f píxeles), para
  // las .tiff enormes: dibujarlas enteras en un lienzo no se puede en un iPhone
  const reducirRGBA = (rgba, ancho, alto, f) => {
    const w = Math.floor(ancho / f);
    const hgt = Math.floor(alto / f);
    const sale = new Uint8ClampedArray(w * hgt * 4);
    const n = f * f;
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0; let g = 0; let b = 0; let a = 0;
        for (let dy = 0; dy < f; dy++) {
          let i = ((y * f + dy) * ancho + x * f) * 4;
          for (let dx = 0; dx < f; dx++, i += 4) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; }
        }
        const o = (y * w + x) * 4;
        sale[o] = r / n; sale[o + 1] = g / n; sale[o + 2] = b / n; sale[o + 3] = a / n;
      }
    }
    return { rgba: sale, ancho: w, alto: hgt };
  };

  // TIFF: por el tipo, por el nombre o por cómo empieza el archivo ("II*\0" o "MM\0*")
  const esTiff = async (archivo) => {
    if (/tiff?$/i.test(archivo.type) || /\.tiff?$/i.test(archivo.name || '')) return true;
    const b = new Uint8Array(await archivo.slice(0, 4).arrayBuffer());
    return (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a);
  };

  // Lo que se dibuja: { fuente (algo que vale para drawImage), ancho, alto }
  const deTiff = async (archivo) => {
    await cargar('vendor/pako_inflate.min.js');
    await cargar('vendor/UTIF.js');
    const buf = await archivo.arrayBuffer();
    const paginas = window.UTIF.decode(buf);
    if (!paginas.length) throw new Error('Esa .tiff no tiene ninguna imagen');
    // La página más grande (algunas traen una miniatura delante)
    for (const p of paginas) window.UTIF.decodeImage(buf, p, paginas);
    const p = paginas.filter((x) => x.width && x.height).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!p) throw new Error('No se ha podido leer esa .tiff');
    const rgba = window.UTIF.toRGBA8(p);
    let img = { rgba: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, p.width * p.height * 4), ancho: p.width, alto: p.height };
    // (más de 16 megapíxeles: se reduce antes de dibujarla)
    if (img.ancho * img.alto > MAX_AREA) img = reducirRGBA(img.rgba, img.ancho, img.alto, Math.ceil(Math.sqrt(img.ancho * img.alto / MAX_AREA)));
    const lienzo = document.createElement('canvas');
    lienzo.width = img.ancho;
    lienzo.height = img.alto;
    lienzo.getContext('2d').putImageData(new ImageData(img.rgba, img.ancho, img.alto), 0, 0);
    return { fuente: lienzo, ancho: img.ancho, alto: img.alto };
  };
  const deImagen = async (archivo) => {
    const bmp = await createImageBitmap(archivo);
    return { fuente: bmp, ancho: bmp.width, alto: bmp.height };
  };

  // Dibuja una imagen en un lienzo de lado máximo «lado» (con fondo blanco) y lo da como JPEG.
  // lado: null = tan grande como se pueda (MAX_AREA)
  const aJpeg = (fuente, ancho, alto, lado, calidad) => {
    const k = lado ? Math.min(1, lado / Math.max(ancho, alto)) : Math.min(1, Math.sqrt(MAX_AREA / (ancho * alto)));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(ancho * k));
    lienzo.height = Math.max(1, Math.round(alto * k));
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok({ blob: b, ancho: lienzo.width, alto: lienzo.height }) : mal(new Error('No se ha podido convertir la foto'))), 'image/jpeg', calidad));
  };

  // La miniatura (versión 125): una copia pequeña (400 px) para las listas, las tarjetas y la galería.
  // Antes se enseñaba la foto entera de 2000 px hasta en los cuadraditos, y con cientos de fotos el
  // móvil gastaría mucha memoria. Las de antes se hacen la primera vez que se ven (miniaturaDe)
  const LADO_MINI = 400;
  // Las copias pequeñas de una foto: mini (400 px: listas, tarjetas, galería) y vista (2000 px: para
  // verla en grande o compararla sin ampliar; versión 126). La foto entera (blob) se carga al ampliar
  const COPIAS = { mini: [LADO_MINI, 0.8], vista: [LADO, 0.85] };
  const copiaDeBlob = async (blob, campo) => {
    const bmp = await createImageBitmap(blob);
    try { return (await aJpeg(bmp, bmp.width, bmp.height, COPIAS[campo][0], COPIAS[campo][1])).blob; } finally { if (bmp.close) bmp.close(); }
  };

  const convertir = async (archivo) => {
    const img = (await esTiff(archivo)) ? await deTiff(archivo) : await deImagen(archivo);
    let entera;
    let vista = null;
    let mini;
    try {
      entera = await aJpeg(img.fuente, img.ancho, img.alto, null, 0.92);
      // (la vista solo si la foto es más grande que ella; si no, la vista es la foto misma)
      if (Math.max(entera.ancho, entera.alto) > LADO) vista = (await aJpeg(img.fuente, img.ancho, img.alto, LADO, 0.85)).blob;
      mini = (await aJpeg(img.fuente, img.ancho, img.alto, LADO_MINI, 0.8)).blob;
    } finally { if (img.fuente.close) img.fuente.close(); }
    return { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, blob: entera.blob, ...(vista ? { vista } : {}), mini, nombre: archivo.name || 'foto', ancho: entera.ancho, alto: entera.alto, fecha: Date.now() };
  };

  // Una copia (mini o vista) de una foto guardada: la suya o, si es de antes (o llegó del PC), se hace
  // ahora y se le guarda. Solo si la foto sigue estando (si se ha borrado mientras tanto, no se vuelve
  // a crear). Una foto que ya es pequeña es su propia vista
  const copiaDe = async (id, campo) => {
    const f = await leer(id);
    if (!f) return null;
    if (f[campo]) return f[campo];
    if (campo === 'vista' && (!f.ancho || Math.max(f.ancho, f.alto || 0) <= LADO)) return f.blob;
    let copia;
    try { copia = await copiaDeBlob(f.blob, campo); } catch { return f.blob; }
    const db = await abrir();
    await new Promise((ok) => {
      const t = db.transaction(ALMACEN, 'readwrite');
      const s = t.objectStore(ALMACEN);
      const p = s.get(id);
      p.onsuccess = () => { if (p.result && !p.result[campo]) s.put({ ...p.result, [campo]: copia }); };
      t.oncomplete = ok;
      t.onerror = ok;
      t.onabort = ok;
    });
    return copia;
  };
  const miniaturaDe = (id) => copiaDe(id, 'mini');
  const vistaDe = (id) => copiaDe(id, 'vista');

  // Una foto para el informe (PDF y Word; versión 141, lo pidió el usuario: «al descargar el PDF o el Word no hace
  // falta que las fotos estén en máxima resolución»): la vista reducida a «ancho» píxeles de ancho (lo que ocupa
  // en el papel a unos 300 ppp), en JPEG 0,85. No se guarda: se hace al hacer el informe. Da { blob, ancho, alto }
  const paraDocumento = async (id, ancho) => {
    const v = await vistaDe(id);
    if (!v) return null;
    const bmp = await createImageBitmap(v);
    try {
      if (bmp.width <= ancho * 1.1) return { blob: v, ancho: bmp.width, alto: bmp.height };
      return await aJpeg(bmp, bmp.width, bmp.height, Math.round(Math.max(bmp.width, bmp.height) * ancho / bmp.width), 0.85);
    } finally { if (bmp.close) bmp.close(); }
  };

  window.Fotos = { convertir, guardar, leer, borrar, ids, esTiff, miniaturaDe, vistaDe, paraDocumento, base: BASE, LADO };
})();
