# Normas del Libro de Precios COAATMCA 2025

> Fuente: páginas 6-10 del PDF oficial "Libro Precios 46 COOATMCA" (Colegio
> Oficial de Aparejadores, Arquitectos Técnicos e Ingenieros de Edificación
> de Mallorca). Convenio de la Construcción de Baleares, vigencia 1-1-2024.

Estas reglas se inyectan como contexto estable en el system prompt del Judge
y del Evaluator global. Todo razonamiento sobre precios debe respetarlas —
son contractuales cuando así lo indica el libro.

---

## 1. Porcentajes sobre el Presupuesto

1.1. **Medios Auxiliares (MA)**: 2-4 % sobre el PEM.
- 4 % en obras con predominio de trabajo en altura o condiciones difíciles.
- 2 % en obras planas simples y bien accesibles.

1.2. **Costes Indirectos (CI)**: 3-6 % sobre Costes Directos.
- Valor orientativo por defecto: **3 %** (según generador de precios COAATMCA).
- El operador puede sobrescribir según tipología de obra.

1.3. **Gastos Generales (GG)**: 13 % sobre el PEM. Contractual.

1.4. **Beneficio Industrial (BI)**: 6 % sobre el PEM. Contractual.

1.5. **Utillaje + BI adicional sobre mano de obra y materiales**: +15 %
(según nota 1 de la página 10 del libro). Aplica cuando la mano de obra o
los materiales los suministra la empresa constructora o la propiedad.

1.6. **IVA**: 21 % sobre el PEC (= PEM + GG + BI). Excepción: 10 % en obras
de vivienda social.

---

## 2. Criterios de medición

2.1. **Movimiento de tierras, hormigones**: en m³ de cada elemento.

2.2. **Encofrados**: en m² del desarrollo de la superficie.

2.3. **Hierros**: en kg aplicando el baremo correspondiente, incrementado
un 3 % en concepto de alambre de atar y tolerancias de fabricación.

2.4. **Muros y tabiques**: en m² con el siguiente sistema de descuento de
huecos:
- Descuento total en huecos > 8 m² (y se contabilizan los dinteles aparte).
- Descuento del 50 % en huecos entre 4 y 8 m².
- NO se descuentan huecos < 4 m².

2.5. **Forjados y cubiertas**: en m² descontando huecos > 1 m².

2.6. **Enfoscados, enlucidos y revestimientos**: en m² similar a muros y
tabiques. Cantos vivos, matarrincones y guardavivos se miden aparte.

2.7. **Alicatados**: en m². Se descuentan superficies > 3 m². Si la altura
del alicatado < altura del hueco de puerta, se mide la superficie realmente
alicatada descontando la anchura total de la puerta.

2.8. **Solados y pavimentos**: en m² de superficies pisables.

2.9. **Vidrios**: la cuadratura se efectúa por múltiplos de 6 tomando el
inmediato superior para medidas que no lo sean. Cortes en óvalo con
margen de 12 cm sobre el dimensionado real.

---

## 3. Recargos sobre mano de obra

3.1. **Trabajo nocturno** (22:00-06:00): +25 %.

3.2. **Trabajo en festivo**: +50 %.

3.3. **Obra en altura > 10 m sin plataforma adecuada**: +15 % sobre la mano
de obra de ese capítulo.

---

## 4. Conversiones de unidades permitidas

Cuando el aparejador declara una partida en una unidad y el libro la tiene
en otra, SOLO se admiten estas conversiones si la descripción aporta el
puente (`bridge`) explícito:

4.1. **m² ↔ m³** válido si la descripción indica **espesor**.
- Ej: "10 cm de grava en 50 m²" → `bridge: {thickness_m: 0.10}` → 5 m³.

4.2. **ml ↔ ud** válido si la descripción indica **tamaño unitario**.
- Ej: "tubería de 3 m/pieza, 30 ml" → `bridge: {piece_length_m: 3.0}` → 10 ud.

4.3. **kg ↔ m³** válido si la descripción indica **densidad** o si es un
material estándar (hormigón = 2400 kg/m³; acero = 7850 kg/m³).
- Ej: "2400 kg de hormigón armado" → `bridge: {density_kg_m3: 2400}` → 1 m³.

4.4. **t ↔ kg**: conversión directa con factor 1000 (sin puente).

**PROHIBIDO sin puente explícito**:
- m² → ud, m³ → ud, ud → magnitud continua (superficie, volumen, masa).
- Cualquier conversión entre dimensiones físicas incompatibles que no
  disponga de bridge en esta tabla. En esos casos marcar
  `needs_human_review: true`.

---

## 5. Partidas 1:N (composición)

Una partida declarada como "unidad única" que en realidad agrega varias
sub-actividades se detecta por las siguientes señales en la descripción:
- Las palabras "Incluye:", "Comprende:", "Consta de:".
- Enumeraciones con guiones (`-`), bullets (`•`) o numeradas (`1.`, `a)`).

Procedimiento al detectar 1:N:
1. Descomponer la descripción en N sub-partidas atómicas.
2. Buscar cada sub-partida independientemente en el libro (vector search).
3. Aplicar conversiones de unidades del punto 4 donde sea necesario.
4. Precio total = Σ (precio_sub_partida × cantidad_convertida).
5. El output marca `match_kind: "1:N"` y lista las sub-partidas con sus
   `unit_conversion_applied` respectivas.

---

## 6. Red de seguridad ("from_scratch")

Si NINGÚN candidato del libro vectorizado cobertura la partida ni por
match 1:1 ni por composición 1:N:
1. Intentar estimación desde componentes básicos (mano de obra + material
   + maquinaria) consultando `labor_rates_2025` vía `get_labor_rate`.
2. Marcar `match_kind: "from_scratch"` y `needs_human_review: true`.
3. Documentar en `reasoning_trace` la vía de estimación usada y los
   componentes considerados.

---

## 7. Importantes avisos del libro oficial

- Los precios son **orientativos**. Son calculados basándose en precios de
  mercado y rendimientos, extrapolando a veces desde materiales similares.
- **NO son válidos** para obras de reparación o reforma sin coeficiente
  corrector a criterio del técnico.
- Los precios del libro **NO incluyen** costes indirectos, gastos generales,
  BI, impuestos o IVA — el usuario debe añadirlos al confeccionar el PEC.
- Los "Gastos no facturables" (electricidad, agua, valla, caseta, acometidas,
  etc.) están DENTRO del coste de ejecución ya incluido — no son partidas
  aparte.
