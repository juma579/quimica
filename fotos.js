// Las fotos del cuaderno. Se guardan en el móvil (IndexedDB: localStorage no tiene sitio para
// fotos), como JPEG de 2000 px como mucho: una copia para verlas, no el archivo original.
// Las .tiff (las del microscopio) el WebView no las sabe enseñar: se leen con UTIF.js (y pako, para
// las comprimidas), que están en vendor/ y solo se cargan la primera vez que hace falta.
//   Fotos.convertir(archivo) → { id, blob, nombre, ancho, alto }   (sin guardar)
//   Fotos.guardar(foto), Fotos.leer(id) → foto | null, Fotos.borrar(id)
(function () {
  'use strict';
  const BASE = 'quimica-fotos';
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
      t.onerror = () => mal(t.error);
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
    const lienzo = document.createElement('canvas');
    lienzo.width = p.width;
    lienzo.height = p.height;
    lienzo.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, p.width * p.height * 4), p.width, p.height), 0, 0);
    return { fuente: lienzo, ancho: p.width, alto: p.height };
  };
  const deImagen = async (archivo) => {
    const bmp = await createImageBitmap(archivo);
    return { fuente: bmp, ancho: bmp.width, alto: bmp.height };
  };

  const convertir = async (archivo) => {
    const img = (await esTiff(archivo)) ? await deTiff(archivo) : await deImagen(archivo);
    const k = Math.min(1, LADO / Math.max(img.ancho, img.alto));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(img.ancho * k));
    lienzo.height = Math.max(1, Math.round(img.alto * k));
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(img.fuente, 0, 0, lienzo.width, lienzo.height);
    if (img.fuente.close) img.fuente.close();
    const blob = await new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se ha podido convertir la foto'))), 'image/jpeg', 0.85));
    return { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, blob, nombre: archivo.name || 'foto', ancho: lienzo.width, alto: lienzo.height, fecha: Date.now() };
  };

  window.Fotos = { convertir, guardar, leer, borrar, ids, esTiff };
})();
