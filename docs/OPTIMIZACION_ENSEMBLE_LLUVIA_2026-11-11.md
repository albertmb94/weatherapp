# Optimización del ensemble de lluvia por horizonte · 11 de noviembre de 2026

## Datos y criterio

Se descargaron previsiones archivadas de lluvia a 24, 48, 72 y 168 h para nueve estaciones XEMA, y se agregaron archivos anteriores para evaluar las mismas estaciones en fechas posteriores y cinco estaciones distintas. Cada fila conserva el offset exacto, el modelo y la hora UTC de validez. El ajuste usa el catálogo que consulta la aplicación para esas coordenadas. Los valores ausentes se excluyen del promedio. La referencia vigente conserva el ajuste local en las tres zonas donde existe, aplicado de forma contrafactual durante todo el archivo para comparar con el producto actual.

Las cantidades diarias se evalúan en ventanas completas de 24 horas que terminan a medianoche UTC. Previous Runs presenta un offset fijo para cada hora de validez. Un total diario construido así compara los mismos intervalos para ambos métodos y puede mezclar distintas pasadas dentro del día. No sustituye una evaluación del día completo emitido en una sola pasada.

Se midieron detección horaria (POD, observación ≥0,1 mm), falsas alarmas (FAR), CSI, error del acumulado del periodo y error diario ponderado (WAPE). La decisión de aplicación exige una mejora de WAPE con detección y CSI al menos iguales, control de falsas alarmas y confirmación tanto temporal como espacial. Las diferencias diarias se remuestrean en bloques de dos fechas manteniendo juntas todas las estaciones del día. Son intervalos descriptivos. El objetivo del 80 % sigue visible aunque una mejora relativa no lo alcance.

## Tres iteraciones

1. **Pesos ajustados directamente al ensemble.** Se compararon el preset vigente, pesos iguales, ajustes conjuntos a la cantidad horaria y a totales diarios por modelo, y cambios de escala y curvatura. El ajuste termina el 27 de septiembre, la selección usa del 5 al 18 de octubre y la prueba requiere una referencia posterior al 18. Esa prueba fue seca, en particular a 168 h. En la prueba reciente el candidato de 24 h subió la detección de 76,7 % a 93,3 %, mientras el WAPE subió de 59,8 % a 101,0 %. A 72 h subió de 73,3 % a 83,3 %, mientras el WAPE subió de 72,6 % a 130,3 %.
2. **Control de miembros extremos.** Se añadieron una combinación que limita valores altos aislados y otra que da peso al percentil 75. El ajuste termina el 24 de septiembre y la selección del 2 al 10 de octubre termina antes. Así se puede verificar del 19 de octubre al 1 de noviembre, con 142 horas lluviosas en las ubicaciones de ajuste y 121 en las cinco estaciones externas. En la muestra externa a 24 h, limitar extremos mantuvo la detección en 81,8 %, redujo las falsas alarmas de 47,3 % a 44,7 % y redujo el error del acumulado de 9,3 % a 3,7 %. El WAPE quedó prácticamente igual (46,3 % a 46,4 %) y empeoró en la muestra reciente.
3. **Ocurrencia y cantidad separadas.** La ocurrencia usa una regresión regularizada sobre la media y el voto ponderado de miembros húmedos. La cantidad usa un factor acotado estimado con la mediana ponderada de los cocientes diarios, que minimiza el error absoluto diario en el ajuste. El umbral y el grado de ajuste se eligen en el mismo periodo interno de la segunda ronda.

| Plazo | Detección externa, vigente → separada | Falsas alarmas externas | WAPE externo | Detección reciente |
|---|---:|---:|---:|---:|
| 24 h | 81,8 % → 81,8 % | 47,3 % → 38,9 % | 46,3 % → 46,3 % | 76,7 % → 86,7 % |
| 48 h | 83,5 % → 83,5 % | 51,7 % → 51,0 % | 74,9 % → 97,6 % | 70,0 % → 80,0 % |
| 72 h | 81,8 % → 81,8 % | 53,3 % → 52,4 % | 73,7 % → 73,7 % | 73,3 % → 86,7 % |
| 168 h | 24,0 % → 22,3 % | 84,5 % → 84,7 % | 117,7 % → 106,9 % | 3,3 % → 3,3 % |

A 24 h, la detección separada también mantiene el POD en la muestra temporal y reduce las falsas alarmas de 56,7 % a 53,0 %. En la reciente, las falsas alarmas suben de 55,8 % a 61,8 %. A 72 h, subir la detección reciente a 86,7 % lleva las falsas alarmas a 77,0 %. A una semana, reducir el error de cantidad sigue dejando demasiadas horas lluviosas sin detectar.

## Resultado para la app

Ningún candidato mejora conjuntamente en todos sus controles y ninguno acredita ambos objetivos del 80 % de forma estable. Se conservan los pesos vigentes de lluvia. El candidato más claro para una nueva prueba independiente es el detector separado de 24 h. Repetir la selección sobre las mismas fechas de octubre produciría una estimación optimista. Para evaluar los acumulados de una semana y la capacidad de detección por día desde una emisión fija hacen falta más pasadas individuales verificadas contra estaciones y episodios de distinta intensidad.

## Reproducción

```text
npx tsx --env-file=.env.local scripts/ensembleRainData.ts --download
npx tsx scripts/optimizeRainEnsemble.ts
```

El segundo comando reutiliza los archivos XEMA de las auditorías previas. El JSON registra configuraciones candidatas, recuentos, falsos avisos y las métricas temporales, espaciales y recientes para los cuatro plazos.

[Archivo Previous Runs de Open-Meteo](https://open-meteo.com/en/docs/previous-runs-api) · [Verificación POD, FAR y CSI de la OMM](https://severeweather.wmo.int/TCFW/RAIV_Workshop2017/21_EvaluationVerification_And_QualityManagement_PablosSantos.pdf)
