# Calificaciones de riesgo: cómo publicarlas para todo el mundo

Hasta ahora el mantenedor de **Config › Credit ratings** guardaba lo que editabas
solo en tu navegador. Servía para trabajar, pero nadie más veía el resultado: si
abrías la plataforma en otro equipo, tus calificaciones no estaban.

Con este cambio las calificaciones viven en la base de datos. Vos las publicás
con una clave que solo tenés vos, y desde ese momento **cualquiera que abra
latambanks.co ve exactamente eso**. Nadie más puede modificarlas.

---

## Lo único que tenés que hacer: definir tu clave en Vercel

Todo lo demás pasa solo al desplegar. La base de datos se prepara sola: el
backend crea sus tablas la primera vez que arranca y las llena con las
calificaciones que ya estaban en el repositorio, igual que hace con el contador
de visitas y con la caché de BTG. No hay que correr nada a mano.

Lo único que no se puede automatizar es la clave, y hay una razón de fondo: es lo
que distingue tus publicaciones de las de cualquier otro. Si la clave estuviera
en el código o la generara alguien más, dejaría de ser tuya.

### Qué es una "variable de entorno"

Es un dato secreto que le das a Vercel para que lo use el servidor, sin que quede
escrito en el código ni en GitHub.

Pensalo como la llave de tu casa: no la dejás pegada en la puerta (el
repositorio), la tenés vos y se la das solo a quien necesita entrar (el
servidor). Vercel la guarda cifrada y se la pasa al backend cada vez que
arranca. Nadie que lea el código puede verla.

La contraseña de la base de datos (`COCKROACH_URL`) ya funciona así. Vamos a
agregar una segunda, `RATINGS_WRITE_KEY`, que es la que habilita publicar.

### Los pasos

1. Entrá a [vercel.com](https://vercel.com) y abrí el proyecto de la plataforma.
2. Arriba, andá a la pestaña **Settings**.
3. En el menú de la izquierda, elegí **Environment Variables**.
4. Llená el formulario:
   - **Key** (nombre): `RATINGS_WRITE_KEY`
   - **Value** (valor): la clave que quieras. Inventá algo largo y que no uses en
     otro lado, por ejemplo `latam-ratings-2026-K9mzQ4pR7wLx`. No tiene que ser
     memorizable: guardala en tu gestor de contraseñas.
   - **Environments**: dejá marcados los tres (Production, Preview, Development).
5. Apretá **Save**.
6. Andá a la pestaña **Deployments**, buscá el despliegue más reciente y usá
   **Redeploy**. Esto hace falta porque la clave se le entrega al servidor cuando
   arranca: si no redespliegas, el servidor sigue corriendo sin ella.

Listo. A partir de ahí, en Config › Credit ratings vas a ver un botón verde
**Publish** cada vez que edites algo.

Mientras no la definas, la plataforma funciona igual que siempre: el mantenedor
abre, las calificaciones se ven, los borradores se guardan en tu navegador y el
botón Publish avisa que falta configurar la clave en vez de fallar sin
explicación.

---

## Cómo se usa

1. Editás las celdas que quieras. Se guardan en tu navegador como borrador, igual
   que antes, y arriba a la derecha aparece el contador de cambios sin publicar.
2. Cuando estés conforme, apretás **Publish**.
3. La primera vez en cada pestaña te pide la clave. La pegás y aceptás.
4. Aparece la confirmación (`Published for Chile. 3 ratings saved.`) y desde ese
   momento cualquier visitante ve esas calificaciones.

La clave queda en memoria mientras la pestaña esté abierta, así que no te la
vuelve a pedir en cada publicación. Al cerrar la pestaña se olvida: no queda
guardada en el equipo.

Si te equivocás al escribirla, el mensaje lo dice y **el borrador no se pierde**:
volvés a apretar Publish y la ingresás de nuevo.

---

## Detalles que conviene saber

**Solo se publica lo que editaste.** Si tocás tres celdas de Chile, viajan esas
tres. El servidor no borra ni modifica lo que no venga en el envío, así que no
hay riesgo de vaciar un país sin querer.

**Si algo falla a mitad de camino, no queda nada a medias.** La escritura es una
transacción: o entran todos los cambios del envío, o ninguno.

**Lo que publicás no se pisa nunca.** El sembrado automático desde el archivo del
repositorio ocurre una única vez, cuando la tabla está vacía. Un redespliegue o
un reinicio no revierte nada.

**Los cambios tardan hasta un minuto en verse en otros equipos**, porque la
respuesta se cachea 60 segundos para no golpear la base en cada visita. En tu
propia pantalla se ven al instante.

**No hay historial**, por decisión de producto: la base guarda la calificación
vigente de cada banco, no su evolución. Sí queda registrado *cuándo* se actualizó
cada celda (`updated_at`).

**El archivo `data/bank_ratings.json` sigue existiendo como respaldo.** El
servidor lo usa si la base todavía no tiene las tablas, si nunca se sembró, o si
la base no responde: preferimos servir la copia del repositorio antes que
mostrarte un error. Si querés saber de dónde salió una respuesta, el endpoint
`/api/ratings` lo dice en el campo `source` (`db` o `seed`).

**Si perdés la clave**, no se recupera: entrás a Vercel, la reemplazás por una
nueva y redespliegas. Las calificaciones ya publicadas no se tocan.

**El botón Export JSON sigue ahí.** Si algún día querés volver a tener todo en el
repositorio, exportás y reemplazás `data/bank_ratings.json`.

---

## Herramientas opcionales

No hacen falta para el uso normal, pero están por si algún día conviene.

`migrations/010_bank_ratings.sql` es el esquema de las dos tablas. El backend lo
crea solo, así que este archivo sirve como documentación y para poder crearlas
desde la consola de CockroachDB antes de desplegar.

`tools/seed_bank_ratings_db.py` carga `data/bank_ratings.json` en la base. El
backend ya lo hace la primera vez; el script sirve si querés reimportar el
archivo a mano después de corregirlo. Es idempotente y no borra nada: lo que esté
en la base y no en el archivo se queda como está. Necesita `COCKROACH_URL` en el
entorno, y con `--dry-run` informa sin escribir.

---

## Si algo no funciona

| Mensaje | Qué significa |
|---|---|
| `RATINGS_WRITE_KEY no está configurada en el servidor` | Falta definirla en Vercel, o falta redesplegar después de guardarla. |
| `clave de escritura inválida` | La clave no coincide con la de Vercel. |
| `las tablas de calificaciones no existen y no se pudieron crear` | El usuario de la base no tiene permiso para crear tablas. Aplicá `migrations/010_bank_ratings.sql` desde la consola. |
| El mantenedor abre pero no muestra lo que publicaste | Esperá un minuto (caché) y recargá. Si sigue, mirá `/api/ratings?country=CL` y revisá el campo `source`. |
