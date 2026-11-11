# Auditoría del ensemble meteorológico · 11 de noviembre de 2026

## Pregunta y población

El sistema combina modelos deterministas y de IA mediante un promedio ponderado por variable y horizonte. Los modelos sin un dato finito quedan fuera de ese promedio para la hora concreta. Se auditó la lista que solicita el cliente para cada ubicación, incluido el peso de reserva de 0,01 para miembros que no figuran en el preset. Se usó la versión del 8 de noviembre como referencia y se comparó con pesos iguales, un modelo individual elegido en la validación y un ajuste conjunto de los pesos. El modelo individual se puntúa en el mismo subconjunto que los ensembles y debe cubrir al menos el 95 % de la validación para entrar en la comparación.

La evaluación horaria usa offsets archivados de 24, 48, 72, 96, 120, 144 y 168 h. No incluye el offset 0, que el proveedor construye a partir de las pasadas más recientes. Las muestras se unen por ubicación, variable y hora de validez UTC. La referencia regional es ERA5-Seamless, un producto de reanálisis, y el control de superficie usa 12 estaciones XEMA. Se separaron ambos resultados porque un promedio de malla y una estación observan escalas distintas. Las observaciones XEMA corresponden a intervalos horarios completos con su final en UTC.

| Partición | Fecha de validez | Uso |
|---|---|---|
| Ajuste inicial | 20 sep–1 oct | Aprende pesos en 18 ubicaciones |
| Validación interna | 14–18 oct | Elige la intensidad de regularización |
| Reajuste | 20 sep–11 oct | Reestima solo el candidato elegido |
| Control temporal | 24 oct–1 nov | Comprueba regresiones en las 18 ubicaciones iniciales |
| Control espacial y temporal | 24 oct–1 nov | 12 ubicaciones excluidas de ajuste y selección |
| Prueba reciente | 2–5 nov | 18 ubicaciones, fechas posteriores al informe anterior |
| Control de estaciones | 24 oct–1 nov | 12 estaciones catalanas, sin usarlas para ajustar |

Se exige que, en cada caso de validación, la referencia histórica anterior a la validez supere el cierre del entrenamiento más cinco días de margen para las observaciones. El control en fechas de octubre vuelve a usar parte del periodo del informe anterior. Las 12 ubicaciones nuevas y las fechas del 2–5 de noviembre aportan evidencia adicional. La muestra sigue concentrada en un periodo de otoño y en Europa y Norteamérica.

## Qué se ajustó y qué pasó el filtro

El ajuste anterior aproximaba la habilidad de cada miembro por separado. El nuevo candidato optimiza el error del promedio resultante con la renormalización que usa la app en cada hora. Así puede distinguir dos modelos que aportan información complementaria de dos que tienden a cometer el mismo error. Se ajustan multiplicadores positivos y acotados sobre el preset y se penalizan desviaciones grandes. El ajuste y la selección nunca consultan los controles. Los intervalos del cambio de RMSE son descriptivos y se obtienen remuestreando bloques consecutivos de tres días, con todas las ciudades y offsets del día juntos.

Para publicar se exige una mejora sobre pesos iguales en el control espacial, que el límite superior del intervalo descriptivo del cambio de RMSE frente al preset sea inferior a cero y que se respeten las tolerancias del control temporal (0,5 %), estaciones (1 %) y periodo reciente (2 %). En precipitación se protegen también el CSI y la detección de lluvia a partir de 0,1 mm/h. Los tamaños muestrales, MAE, RMSE, detección, falsas alarmas, cantidades y el desglose por offset están en el JSON.

| Viento a 10 m | RMSE en 12 ciudades nuevas | RMSE reciente | RMSE XEMA | Cambio espacial y rango descriptivo (km/h) |
|---|---:|---:|---:|---:|
| 24–48 h | 2,960 → 2,936 | 2,899 → 2,845 | 2,671 → 2,676 | −0,023 [−0,040; −0,006] |
| 72–96 h | 3,392 → 3,346 | 3,261 → 3,193 | 3,242 → 3,240 | −0,046 [−0,065; −0,023] |
| 120–168 h | 4,457 → 4,446 | 4,666 → 4,659 | 3,543 → 3,548 | −0,011 [−0,021; −0,005] |

La mejora del viento es pequeña y las dos subidas de RMSE de XEMA quedan visibles. Los pesos nuevos se limitan a la velocidad del viento entre 24 y 168 h, sin propagarse a rachas, oleaje u otras variables que usaban el perfil de viento como aproximación. Las horas entre los offsets de la tabla usan el peso del intervalo correspondiente. El tramo inicial de 0 a 23 h conserva el preset anterior.

- **Temperatura.** El ajuste conjunto redujo el RMSE temporal 0–48 h de 1,260 a 1,240 °C y lo aumentó en ciudades nuevas (1,354 → 1,366 °C) y XEMA (1,847 → 1,879 °C). En esas ciudades, el promedio simple obtuvo 1,311 °C. Es una referencia importante para una réplica con más estaciones y otras temporadas.
- **Precipitación.** A 72–96 h el candidato mejoró de 0,288 a 0,286 mm/h en ciudades nuevas y empeoró de 0,190 a 0,194 en las fechas recientes. A 24–48 h la incertidumbre del cambio incluyó cero. El control de estaciones de esta ventana fue seco, por lo que aporta poca evidencia de habilidad en episodios fuertes. Se conservaron los pesos y el ajuste local anterior en su ámbito y fechas originales. No se dedujo probabilidad de lluvia de la cantidad prevista.
- **Perfiles.** Se clasificaron las 30 ubicaciones con el código de la aplicación y elevaciones públicas. El clasificador usa referencias puntuales de costa y un umbral de altitud, por lo que, por ejemplo, clasificó Valencia y Málaga como llanura y dejó cero ubicaciones de montaña en el ajuste. El mejor caso fue viento costero de 24–48 h, con 3,956 → 3,929 km/h en solo tres ciudades nuevas. El urbano tuvo una sola ciudad externa y el efecto de llanura varió según el plazo. Los perfiles se mantuvieron fuera de la ponderación en producción y se retiraron de la portada las consultas de recomendaciones y sesgo que no afectaban al cálculo.

## Segunda comprobación de lluvia

También se ajustó en entrenamiento una corrección multiplicativa de cantidad, separada del cambio de pesos. A 24–48 h, multiplicar por 0,844 redujo el RMSE del periodo reciente de 0,195 a 0,182 mm/h, pero la detección bajó del 39,8 % al 35,7 %. En las ciudades nuevas subió el RMSE de 0,250 a 0,254 mm/h. A 120–168 h se repitió el patrón de menor error reciente y menor detección. No se amplió la corrección de cantidad.

Para el ajuste costero ya activo se reservaron observaciones XEMA del 7–10 de noviembre, posteriores a las últimas horas verificadas en el estudio anterior. Se obtuvo cobertura de 72 horas en Badalona y Barcelona y de 96 en Malgrat. Solo llovieron 0,6, 0,5 y 0,3 mm respectivamente. A 48 h el ajuste redujo el RMSE en las tres estaciones, pero ninguno de los dos métodos detectó una hora lluviosa al umbral de 0,1 mm/h. A 168 h el ajuste eliminó todos los aciertos horarios de Badalona y Malgrat en esta muestra. El chequeo confirma que cantidad y ocurrencia deben evaluarse por separado. Es una comprobación retrospectiva del factor vigente y no una muestra representativa de lluvias fuertes.

## Días 8–14 y probabilidades

Se intentaron seis inicializaciones de octubre para seis ciudades con el archivo de pasadas individuales. La comparación emparejada IFS/GFS solo pudo usar las pasadas del 21 y 24 de octubre a las 00 UTC. Se puntuaron 864 instancias entre 169 y 240 h y 1.002 por encima de 240 h y hasta 336 h. Son horas correlacionadas de solo dos pasadas. Para lluvia en el tramo largo, el promedio simple logró 0,414 frente a 0,510 mm/h del preset. Para temperatura en ese tramo, el preset obtuvo 3,143 frente a 3,308 °C del promedio simple. El ensayo no justifica cambiar esos pesos.

Ninguno de los miembros archivados con respuesta en este ensayo trajo probabilidades de precipitación finitas más allá de 168 h. No se puede calcular Brier ni fiabilidad probabilística con esas respuestas. Para una calibración probabilística hacen falta probabilidades archivadas o un modelo probabilístico entrenado para un evento definido, evaluado con Brier y curvas de fiabilidad en fechas y estaciones aparte.

## Correcciones en la aplicación

- El plazo de una hora se calcula una vez desde la recepción del pronóstico por el servidor. Se conserva al recortar el horizonte y al recuperar un pronóstico guardado. Es la referencia observable del producto combinado. El proveedor no publica una hora común de inicialización para todos los miembros.
- La tabla calcula los pesos por hora antes de agregar. Cambiar de resolución o seleccionar un día ya no adelanta el plazo de esas horas. El indicador de temperatura actual se muestra por separado y la media conserva su significado.
- Una respuesta de elevación ausente o inválida ya no equivale a 0 m.
- El verificador de estaciones conserva el offset exacto al agrupar los miembros. El semanal guarda las puntuaciones nuevas como versión 3, excluye el día cero ensamblado y conserva las métricas anteriores de versión 2 solo en los intervalos que no mezclaban ese día con un offset real.

## Reproducción

```text
npx tsx scripts/recalibrate.ts --download-only
npm run verify:calibration-stations
npx tsx scripts/forecastAuditData.ts --download
npx tsx scripts/auditForecast.ts
npx tsx scripts/auditLongRange.ts
npx tsx --env-file=.env.local scripts/auditCoastalForecast.ts
```

Los datos brutos quedan en `.recalibration-cache`, fuera de Git. El segundo comando necesita acceso XEMA si falta el archivo local y puede regenerar el informe de comprobación del 8 de noviembre. El auditor escribe un JSON con las puntuaciones y otro con candidatos aprobados. El archivo publicado de viento reproduce esos candidatos. El ensayo es reproducible con el mismo archivo de entrada y no toca la base de producción.

Fuentes: [Previous Model Runs](https://open-meteo.com/en/docs/previous-runs-api), [Single Runs](https://open-meteo.com/en/docs/single-runs-api), [Historical Weather](https://open-meteo.com/en/docs/historical-weather-api), [medidas XEMA](https://apidocs.meteocat.gencat.cat/documentacio/dades-de-la-xema/) y [EMOS con distribución gamma censurada para precipitación](https://arxiv.org/abs/1512.04068).
