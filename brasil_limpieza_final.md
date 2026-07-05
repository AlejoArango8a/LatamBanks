# Brasil — Limpieza de nombres y exclusiones adicionales

Ajustes sobre `brasil_bancos_config.py` y sobre el punto donde se construye el
nombre del banco que se muestra en el dashboard.

Son 4 cambios. Ninguno toca Chile ni Colombia.

---

## Cambio 1 — Excluir automáticamente instituciones "em liquidação"

En vez de listar códigos uno por uno, agregar una REGLA que excluya cualquier
institución cuyo nombre (oficial, del CSV de ISPB) contenga el texto "liquida"
(cubre "em liquidação", "em liquidação extrajudicial", etc.).

Casos que esto elimina hoy:
- 58497702 — Banco LetsBank (em liquidação extrajudicial)
- 61024352 — Banco Pleno (em liquidação extrajudicial)
- 17157777 — Banco Nacional (em liquidação) — ya está en EXCLUIR; la regla lo cubre igual

Ventaja: a futuro, cualquier banco que entre en liquidación se filtra solo.

---

## Cambio 2 — BMG: mostrar solo el banco principal

BMG aparece dos veces (mismo grupo). Aplicando "una entidad por grupo":
- MOSTRAR:  61186680  → Banco BMG
- EXCLUIR:  50585090  → Banco BMG Consignado (subsidiaria de consignado del grupo)

Acción: agregar `50585090` a la lista EXCLUIR en `brasil_bancos_config.py`.

---

## Cambio 3 — Quitar el texto "Banco Múltiplo" del nombre

Hay 9 bancos con "Banco Múltiplo" pegado al nombre. Hay que quitar ese texto de
donde aparezca (a veces está en medio, no solo al final) y arreglar el espaciado.

```python
import re

def quitar_banco_multiplo(nombre: str) -> str:
    # Quita "Banco Múltiplo" (con o sin guion alrededor) de cualquier parte del nombre
    n = re.sub(r'\s*[-–]?\s*banco m[úu]ltiplo\s*', ' ', nombre, flags=re.IGNORECASE)
    n = re.sub(r'\s+', ' ', n).strip(' -–')   # espacios dobles y bordes sueltos
    return n
```

Resultado esperado:
| Antes | Después |
|---|---|
| Kirton Bank S.A. - Banco Múltiplo | Kirton Bank S.A. |
| Goldman Sachs do Brasil Banco Múltiplo S.A. | Goldman Sachs do Brasil S.A. |
| BANK OF CHINA (BRASIL) BANCO MÚLTIPLO S/A | BANK OF CHINA (BRASIL) S/A |
| PICPAY BANK - BANCO MÚLTIPLO S.A | PICPAY BANK S.A |
| SOCIAL BANK BANCO MÚLTIPLO S/A | SOCIAL BANK S/A |
| Intesa Sanpaolo Brasil S.A. - Banco Múltiplo | Intesa Sanpaolo Brasil S.A. |
| Bank of America Merrill Lynch Banco Múltiplo S.A. | Bank of America Merrill Lynch S.A. |
| Novo Banco Continental S.A. - Banco Múltiplo | Novo Banco Continental S.A. |
| OURIBANK S.A. BANCO MÚLTIPLO | OURIBANK S.A. |

---

## Cambio 4 — Arreglar nombres en MAYÚSCULAS

Muchos nombres vienen todo en mayúsculas (ej. "BANCO KEB HANA DO BRASIL S.A.").
Convertirlos a formato título, PERO:
- Preservar siglas conocidas en mayúscula (S.A., BTG, XP, UBS, BB, BMG, ABC, KEB, etc.)
- Dejar las preposiciones portuguesas (do, de, da, dos, das, e) en minúscula,
  salvo que sean la primera palabra.

```python
SIGLAS = {
    "S.A.", "S/A", "BTG", "XP", "UBS", "BB", "BMG", "ABC", "BBVA", "KEB", "HS",
    "ABN", "AMRO", "BNP", "JP", "J.P.", "BNDES", "C6", "BV", "BS2", "PAN",
    "MUFG", "BOCOM", "BBM", "KEB", "ING", "BofA",
}
MINUSCULAS = {"do", "de", "da", "dos", "das", "e"}

def title_case_banco(nombre: str) -> str:
    palabras = nombre.split()
    out = []
    for i, w in enumerate(palabras):
        wu = w.upper().strip(".")
        if wu in {s.upper().strip(".") for s in SIGLAS}:
            out.append(w.upper())                       # sigla
        elif w.lower() in MINUSCULAS and i != 0:
            out.append(w.lower())                       # preposición (no al inicio)
        else:
            out.append(w.capitalize())                  # palabra normal
    return " ".join(out)
```

---

## Orden de construcción del nombre a mostrar (IMPORTANTE)

Para cada CodInst, resolver el nombre así, en este orden:

1. Si está en `RENOMBRAR` → usar ese nombre TAL CUAL. No aplicar nada más.
2. Si no, partir del nombre oficial del CSV de ISPB y aplicar en secuencia:
   a. `quitar_banco_multiplo(nombre)`
   b. `title_case_banco(resultado)`

Ejemplos finales:
- "Goldman Sachs do Brasil Banco Múltiplo S.A." → "Goldman Sachs do Brasil S.A."
- "BANCO KEB HANA DO BRASIL S.A."              → "Banco KEB Hana do Brasil S.A."
- "BANK OF CHINA (BRASIL) BANCO MÚLTIPLO S/A"  → "Bank Of China (brasil) S/A"
- "OURIBANK S.A. BANCO MÚLTIPLO"               → "Ouribank S.A."

(El caso "(brasil)" con paréntesis puede quedar en minúscula; es un detalle menor
que se puede pulir después si molesta.)

---

## Resumen de acciones
1. Regla nueva: excluir cualquier institución cuyo nombre contenga "liquida".
2. Agregar `50585090` (BMG Consignado) a EXCLUIR.
3. Agregar y aplicar `quitar_banco_multiplo()`.
4. Agregar y aplicar `title_case_banco()`.
5. Respetar el orden: RENOMBRAR primero (sin tocar); el resto se limpia con 3 y 4.
