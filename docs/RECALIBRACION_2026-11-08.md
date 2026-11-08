# Recalibración y archivo UTC — 8 de noviembre de 2026

## Datos y particiones

Se descargaron previsiones históricas de Open-Meteo para 18 ubicaciones de España, Europa, Estados Unidos y Canadá, entre el 20 de septiembre y el 1 de noviembre de 2026: 43 días. Cada ubicación pide los modelos globales y regionales de su catálogo. El informe incluye cobertura real por modelo: los ausentes/all-null no se sustituyen por «best match» ni por cero.

- Ajuste interno: 20 de septiembre–11 de octubre.
- Selección de potencia de habilidad y regularización: 12–18 de octubre.
- Prueba temporal final: 19 de octubre–1 de noviembre.
- Verificación adicional: 12 estaciones XEMA durante esos mismos 14 días finales, con observaciones independientes de ERA5.

Se excluye `_previous_day0`, una serie de pasadas actuales ensambladas, del entrenamiento y la prueba. Se verifican los desfases 24, 48, 72, 96, 120, 144 y 168 horas. Los perfiles 0–48 h, 48–96 h y 96–168 h se ajustan a partir de esos offsets, no de inicializaciones reales de pasadas. Previous Runs no proporciona esas inicializaciones: el campo histórico `init_time` almacena ahora explícitamente **hora de referencia = validez − offset**, sin presentarla como hora real de emisión.

Se aprende habilidad relativa dentro de cada ubicación para evitar premiar a un modelo regional solo por cubrir un clima más fácil. La selección interna compara combinaciones regularizadas de habilidad y preset anterior. El conjunto temporal final actúa como filtro de publicación: misma población comparable, RMSE menor y, en lluvia, CSI no inferior. No se reajustan pesos con las fechas de prueba.

## Resultado temporal frente al preset anterior

| Variable | Horizonte | RMSE anterior | RMSE candidato | Publicado |
|---|---|---:|---:|---|
| Temperatura, °C | 0–48 h | 1,2558 | 1,2413 | Sí |
| Temperatura, °C | 48–96 h | 1,3831 | 1,3780 | Sí |
| Temperatura, °C | 96–168 h | 1,7871 | 1,7871 | Se conserva anterior |
| Lluvia, mm/h | 0–48 h | 0,2348 | 0,2251 | Sí |
| Lluvia, mm/h | 48–96 h | 0,2589 | 0,2540 | Sí |
| Lluvia, mm/h | 96–168 h | 0,3034 | 0,3016 | No: empeora CSI |
| Viento, km/h | 0–48 h | 3,0355 | 2,9985 | Sí |
| Viento, km/h | 48–96 h | 3,7383 | 3,6740 | Sí |
| Viento, km/h | 96–168 h | 4,8098 | 4,7969 | Sí |

Hay 12.096 instancias de prueba por variable en cada uno de los dos primeros horizontes y 18.144 en el tercero. Los pesos publicados están en `lib/ensemble/calibration.generated.json`, con las fechas de origen. Se cargan en `ENSEMBLE_PRESETS`, que alimenta tarjetas, tablas, resúmenes y CSV; los pesos anteriores permanecen separados como baseline reproducible.

Las estaciones se utilizan además como control regional de no inferioridad: hasta un 1 % relativo de variación de RMSE y CSI frente al baseline. Es una tolerancia de publicación, no significación estadística ni un intervalo de confianza. Solo hay estaciones catalanas en este control; no se optimizan pesos globales contra ellas. Los candidatos aceptados pasan este control. Las pequeñas regresiones locales de temperatura 0–48 h (+0,64 %) y viento 0–48 h (+0,45 %) quedan registradas, sin ocultarlas.

En lluvia XEMA, el RMSE 0–48 h pasa de 0,6635 a 0,6521 mm/h; 48–96 h de 0,7120 a 0,7107. La detección y falsas alarmas completas figuran en el JSON de estaciones. El CSI a corto plazo varía de 0,44093 a 0,44046, dentro de la tolerancia regional; a medio plazo mejora de 0,36750 a 0,36784. Esto mejora cantidad media, sin resolver toda la incertidumbre de episodios locales.

## Correcciones de horas y almacenamiento

1. Previous Runs y ERA5 se solicitan con `timezone=GMT` y `timeformat=unixtime`. Se convierten a ISO-8601 UTC explícito con `Z` antes de emparejar o guardar.
2. Se conserva cada identidad de modelo y posición temporal. Un valor no finito se omite; nunca ocupa el lugar de otro modelo u hora.
3. El escritor de forecasts verifica `valid_time − reference_time = lead_time_hours`; rechaza fechas locales sin zona y desfases incoherentes.
4. El archivo se prueba con SQLite real: escritura, lectura, actualización de una misma clave y rechazo de filas inválidas.
5. Las métricas nuevas llevan `verification_version=2`. Los lectores de recomendaciones/sesgo excluyen precisión legacy; los lectores de estaciones/forecasts excluyen timestamps locales antiguos. No se reinterpretan silenciosamente las filas históricas sin zona.
6. XEMA etiqueta el **inicio** del intervalo de 30 o 60 minutos. Se suman las dos medias horas de lluvia y se guardan en la hora UTC de **finalización**, como la lluvia de la hora precedente en Open-Meteo. Para variables continuas se calcula la media del período completo. Se descartan intervalos incompletos o invalidados.
7. El backtest semanal usa siete días completos acabados siete días atrás para dejar margen a ERA5. No calibra con el día actual incompleto.
8. Los agregados diarios usan su fecha real, descontando `past_days`; el índice de un día histórico ya no se interpreta como plazo futuro.
9. Cada respuesta del cliente tiene arrays de igual longitud que el eje horario, con huecos `null` alineados. Se rechazan ejes horarios ausentes o inválidos.

## Configuración de la versión

- Sin reserva de masa por arquitectura AI/determinista.
- Sin boosts de terreno ni correcciones aditivas añadidas después de la validación.
- Los dos candidatos rechazados conservan el preset previo.
- Los perfiles >168 h conservan los pesos anteriores: Previous Runs no permite verificarlos con este procedimiento. No se afirma calibración empírica para esos plazos.
- Las variables auxiliares siguen usando perfiles proxy documentados; no se afirma que tengan calibración propia.
- La probabilidad de lluvia sigue siendo la probabilidad del proveedor, agregada coherentemente. Se comprobó `precipitation_probability_previous_day1` para ECMWF/GFS en el archivo y el proveedor devolvió arrays nulos en la consulta examinada; no se inventó un entrenamiento Brier sin probabilidades archivadas.

## Reproducción

```text
npm run calibrate:temporal
npm run verify:calibration-stations
npm run test
npm run typecheck
npm run lint
npm run e2e -- e2e/audit.spec.ts e2e/home.spec.ts --workers=2
```

La descarga queda en `.recalibration-cache/`, excluida de Git. El primer comando produce candidatos en `.recalibration-cache/validated-weights.json` y el informe temporal; su promoción al archivo publicado requiere revisar el control de estaciones y pasar los tests `releaseCalibration`. Las repeticiones utilizan los mismos datos cacheados y el baseline anterior, no el preset recién publicado como baseline. No se han usado ni modificado bases de datos de producción durante la recalibración.

Informes de datos: `docs/recalibration-2026-11-08.json` y `docs/recalibration-stations-2026-11-08.json`.

Fuentes primarias: [Previous Runs](https://open-meteo.com/en/docs/previous-runs-api), [variables horarias Open-Meteo](https://open-meteo.com/en/docs), [semántica temporal de XEMA](https://apidocs.meteocat.gencat.cat/documentacio/dades-de-la-xema/).

## Comprobación específica de Badalona, Barcelona y Malgrat

Tras el aviso del usuario se examinó el 11 de octubre–7 de noviembre en las estaciones Badalona–Museu (WU), Barcelona–el Raval (X4) y Malgrat (WT). Solo se usaron observaciones validadas y horas completas: hay 624 horas comparables por estación y offset, con datos hasta la hora de finalización del 6 de noviembre; no se inventaron valores para los días recientes pendientes de validación.

Con 48 h de antelación, las cantidades acumuladas del ensemble global recalibrado seguían siendo 97,0 frente a 28,4 mm observados en Badalona; 98,2 frente a 51,9 en Barcelona; y 75,1 frente a 26,1 en Malgrat. Confirma una sobreestimación local importante que no resolvía el pequeño cambio de pesos globales. No se compara el offset cero como si fuese una pasada emitida 12 horas antes: es una serie histórica ensamblada y no proporciona esa garantía.

Se ajustó entonces una pendiente multiplicativa no negativa usando **solo el 11–24 de octubre**, y se verificó en las fechas posteriores. El factor se limita a [0,25; 1,25]. Se exige muestra húmeda suficiente, mejora de RMSE y MAE y CSI no inferior antes de aplicarlo. Los modelos originales permanecen intactos: la corrección se aplica una única vez al resultado del ensemble WedAI. Las comparaciones manuales por modelo y las probabilidades del proveedor no se modifican.

| Estación | Plazo | RMSE sin ajuste | RMSE ajustado | CSI sin ajuste → ajustado |
|---|---|---:|---:|---:|
| Badalona | 24–48 h | 0,3174 | 0,2171 | 0,269 → 0,304 |
| Barcelona | 24–48 h | 0,2553 | 0,1785 | 0,278 → 0,308 |
| Malgrat | 24–48 h | 0,1881 | 0,1626 | 0,250 → 0,417 |

**Contrapartida medida:** reducir cantidad también puede convertir lluvias débiles en valores inferiores al umbral de detección. En Badalona 24–48 h el POD pasa de 0,90 a 0,70; las falsas alarmas entre avisos bajan de 0,723 a 0,650. En Malgrat el POD pasa de 1 a 0,714 y las falsas alarmas bajan de 0,75 a 0,50. La mejora del CSI no significa que no haya más omisiones: se publican todos los recuentos, no solo las métricas favorables. Esta es una corrección de **cantidad esperada**, no un nuevo pronóstico probabilístico de que vaya a llover.

El ajuste queda limitado a **5 km de cada estación**, **24–168 horas de antelación**, con vigencia **8 de noviembre–6 de diciembre de 2026**. No se extrapola a toda Cataluña, al tramo 12–24 h sin pasadas verificables, al día 8–14 ni a otra estación del año. A partir de su caducidad se usa el ensemble global hasta regenerar y validar nueva evidencia.

Los factores viajan como metadatos reservados en el mismo eje horario, para que recortes y lectura offline mantengan la alineación. Las tarjetas, la tira horaria, las tablas y los resúmenes usan la misma corrección; los totales diarios locales se recalculan sumando ese mismo ensemble horario. Una prueba verifica que los datos originales de ECMWF permanecen iguales y que el total diario coincide con la suma corregida.

Evidencia y reproducción: `docs/coastal-rain-2026-11-08.json`, `lib/ensemble/coastal-rain.generated.json` y `npx tsx --env-file=.env.local scripts/diagnoseCoastalRain.ts`. El informe distingue siempre ajuste de cantidad y detección de episodios.
