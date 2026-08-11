# Calificaciones de riesgo: cómo publicarlas para todo el mundo

Hasta ahora el mantenedor de **Config › Credit ratings** guardaba lo que editabas
solo en tu navegador. Servía para trabajar, pero nadie más veía el resultado: si
abrías la plataforma en otro equipo, tus calificaciones no estaban.

Con este cambio las calificaciones viven en la base de datos. Vos las publicás
con una clave que solo tenés vos, y desde ese momento **cualquiera que abra
latambanks.co ve exactamente eso**. Nadie más puede modificarlas.

---

## Qué es una "variable de entorno" de Vercel

Es simplemente un dato secreto que le das a Vercel para que el servidor lo use,
sin que quede escrito en el código ni en GitHub.

Pensalo como la contraseña de tu casa: no la escribís en la puerta (el
repositorio, que es público para quien tenga acceso), la tenés vos y se la das
solo a quien necesita entrar (el servidor). Vercel la guarda cifrada y se la pasa
al backend cada vez que arranca. Nadie que lea el código puede verla.

La contraseña de la base de datos (`COCKROACH_URL`) ya funciona así. Vamos a
agregar una segunda, `RATINGS_WRITE_KEY`, que es la que habilita publicar
calificaciones.

---

## Los tres pasos que tenés que hacer

### Paso 1 — Crear las tablas en la base de datos

Una sola vez. Entrá a la consola de CockroachDB
(`latambanks-25604...cockroachlabs.cloud`), abrí **SQL Shell** y pegá el
contenido completo del archivo `migrations/010_bank_ratings.sql`.

No borra ni toca nada de lo que ya existe: solo crea dos tablas nuevas
(`bank_ratings` y `bank_rating_notes`). Si la corrés dos veces por error, no pasa
nada.

### Paso 2 — Cargar las calificaciones que ya tenías

También una sola vez. Las 49 calificaciones que ya están en el repositorio
(Chile y Colombia) hay que pasarlas a la base. Desde tu equipo, en la carpeta del
proyecto:

```bash
python tools/seed_bank_ratings_db.py
```

Toma la `COCKROACH_URL` de tu archivo `.env`. Si querés ver qué haría antes de
escribir, corré `python tools/seed_bank_ratings_db.py --dry-run`.

Se puede repetir sin duplicar nada.

### Paso 3 — Definir tu clave en Vercel

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

**Los cambios tardan hasta un minuto en verse en otros equipos**, porque la
respuesta se cachea 60 segundos para no golpear la base en cada visita. En tu
propia pantalla se ven al instante.

**No hay historial**, por decisión de producto: la base guarda la calificación
vigente de cada banco, no su evolución. Sí queda registrado *cuándo* se actualizó
cada celda (`updated_at`).

**El archivo `data/bank_ratings.json` sigue existiendo como respaldo.** El
servidor lo usa solo si la base todavía no tiene las tablas, si nunca se corrió
el seed, o si la base no responde. Una vez hecho el paso 2, la fuente de verdad
es la base de datos. Si querés saber de dónde salió una respuesta, el endpoint
`/api/ratings` lo dice en el campo `source` (`db` o `seed`).

**Si perdés la clave**, no se recupera: entrás a Vercel, la reemplazás por una
nueva y redespliegas. Las calificaciones ya publicadas no se tocan.

**El botón Export JSON sigue ahí.** Si algún día querés volver a tener todo en el
repositorio, exportás y reemplazás `data/bank_ratings.json`.

---

## Si algo no funciona

| Mensaje | Qué significa |
|---|---|
| `RATINGS_WRITE_KEY no está configurada en el servidor` | Falta el paso 3, o falta redesplegar después de guardarla. |
| `clave de escritura inválida` | La clave no coincide con la de Vercel. |
| `falta aplicar la migración migrations/010_bank_ratings.sql` | Falta el paso 1. |
| El mantenedor abre pero no muestra lo que publicaste | Esperá un minuto (caché) y recargá. Si sigue, mirá `/api/ratings?country=CL` y revisá el campo `source`. |
