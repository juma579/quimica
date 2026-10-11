# 🧪 Química

*Esta app está hecha con Claude Code. No soy programador, solo quería una app que me fuera útil.*

App para el laboratorio: **recetas** con pasos, cronómetros y cuentas automáticas (molaridad, diluciones, ácidos comerciales…), y un **cuaderno** para llevar el registro de tus muestras, disoluciones y fotos.

## 👉 Entrar en la app

### **https://juma579.github.io/quimica/**

No hay que descargar nada ni crear una cuenta. Se abre en el navegador y se puede instalar como una app más.

---

## 📱 Instalarla en el iPhone

1. Abre la dirección de arriba **con Safari** (no con Chrome).
2. Pulsa el botón **Compartir** (el cuadrado con una flecha hacia arriba, abajo en la pantalla).
3. Baja y elige **«Añadir a pantalla de inicio»**.
4. Pulsa **Añadir**.

Te sale un icono de un matraz azul. Ábrela desde ahí, como cualquier otra app. Después **funciona también sin internet**.

## 🤖 Instalarla en Android

**Lo mejor: la app de verdad (APK).** Con ella **los cronómetros suenan aunque tengas la app cerrada**, incluso con «No molestar».

1. Abre **https://github.com/juma579/quimica/releases/latest** en el móvil.
2. Baja el archivo **`Quimica-….apk`** (en «Assets»).
3. Ábrelo. Si Android lo pide, permite **«instalar apps de esta fuente»** para tu navegador.
4. Pulsa **Instalar**. Si ya la tenías instalada, se actualiza sin perder tus datos.

**Más sencillo, sin APK** (los cronómetros solo avisan con la app abierta):

1. Abre la dirección de arriba con **Chrome**.
2. Pulsa los tres puntos **⋮** (arriba a la derecha).
3. Elige **«Instalar app»** (o «Añadir a pantalla de inicio»).

## 💻 Usarla en el ordenador

Hay dos maneras:

**A. Sin instalar nada** (lo más fácil): abre la dirección de arriba en cualquier navegador. Tus datos se guardan en ese navegador.

**B. Con «Química PC»** (para tener tus datos en el ordenador y **pasarlos solos entre el ordenador y el móvil**):

1. Instala **[Node.js](https://nodejs.org)** (una sola vez; botón verde «LTS», «siguiente, siguiente»).
2. Baja **`Quimica-PC-….zip`** de **https://github.com/juma579/quimica/releases/latest** (en «Assets»).
3. Descomprímelo donde quieras y haz doble clic en **`Quimica PC.bat`**.
4. Se abre el navegador con la app. Deja abierta la ventana negra mientras la uses.

Tus recetas, cuaderno y fotos se guardan en la carpeta `datos`, junto al programa (también una copia diaria); en la app del PC, **Ajustes → «Cambiar la carpeta de datos…»** para guardarlos en otro sitio. Para actualizar, descomprime el .zip nuevo **encima** (no borres la carpeta: tus datos están dentro). Funciona en **Windows**; en Mac o Linux, con `node pc/servidor.js`.

### 🔗 Conectar el móvil con el ordenador

Con «Química PC» abierto, en su ventana salen una **dirección** y un **código**.

- **Android** (la APK): en la app, ⚙️ **Ajustes → Conectar con el PC → «📷 Escanear el QR del PC»**, y apunta al código QR que sale en la app del PC. Se conecta solo. (Si prefieres, escribe la dirección y el código y pulsa **«Conectar por la wifi»**, o usa el **cable USB**.)
- **iPhone** (y cualquier móvil sin la APK), **con la app de internet** (`https://juma579.github.io/quimica/`): la usas en cualquier sitio, sin PC, y cuando estés en la misma wifi que el PC, la sincronizas.
  1. En la app de internet: ⚙️ **Ajustes → Conectar con el PC → «📷 Escanear el QR del PC»** y apunta al código QR que sale en la app del PC (o escribe la dirección y el código).
  2. Toca **«🔄 Sincronizar con el PC»**: se abre una ventana un momento, se pasa todo en los dos sentidos y se cierra sola.
  3. Desde esta app **no se pasa solo**: hay que tocar «Sincronizar» (arriba sale **«💻 pasar al PC»** cuando tienes cambios sin pasar, y un aviso en la pantalla principal). Si el navegador pregunta por una ventana emergente, permítela.
- **Otra forma, sin la app de internet:** el programa del PC **sirve la app por la wifi**. En el móvil, con la misma wifi, abre la cámara y apunta al QR de la app del PC; toca el aviso que sale y la app se abre **ya conectada** (se sincroniza sola, pero solo funciona con el PC encendido). Sus datos son distintos de los de la app de internet.

Con la APK y con la app que sirve el PC, las recetas, el cuaderno y las fotos pasan solos de un lado a otro; con la de internet, al tocar «Sincronizar». En los dos casos **hace falta que el programa del PC esté abierto** y los dos en la misma wifi.

> 🔒 **Seguridad:** solo entra quien tenga el código (y se bloquea tras 5 intentos fallidos). Por la wifi la información **no va cifrada**: conéctalo solo en una red de confianza (la de casa), y **cierra el programa cuando no lo uses**. Si crees que alguien ha visto el código, cámbialo en la app del PC (Ajustes → «Cambiar el código»).

---

## ❓ Cosas que conviene saber

- **Tus datos son solo tuyos y están solo en tu aparato** (y en tu ordenador, si usas Química PC). Tus recetas, cuadernos y fotos no se suben a ningún sitio de internet. Nadie más los ve, y tú no ves los de nadie.
- **Si borras los datos del navegador o quitas la app de la pantalla de inicio, se pierden.** En ⚙️ **Ajustes** hay **«💾 Guardar la copia en un archivo»** (recetas, cuaderno y fotos) y para recuperarla. Y con **«📄 Hacer un informe»** (dentro de un cuaderno) puedes guardar el cuaderno en PDF.
- **Para convertir un texto en receta con la IA** hace falta una clave gratuita de Gemini (Google): se pide en https://aistudio.google.com/apikey y se pega en ⚙️ **Ajustes**. Es opcional: también se pueden escribir las recetas a mano, y las cuentas las hace la app igual.
- **Los cronómetros** avisan con tres pitidos y vibración, pero **solo con la app abierta** (en el iPhone no pueden sonar con la app cerrada).
- **Se actualiza sola.** La próxima vez que la abras con internet, coge la versión nueva.

---

*Los datos que escribes nunca salen de tu aparato. Este repositorio contiene solo la app, no los datos de nadie.*
