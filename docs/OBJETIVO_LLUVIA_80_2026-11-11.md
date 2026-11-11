# Objetivo 80 % de detección y cantidad de lluvia

Se considera lluvia observada una hora XEMA con al menos 0,1 mm. Detección (POD) significa aciertos entre las horas lluviosas observadas. Cantidad se interpreta como error absoluto del acumulado de hasta 20 % frente a la suma observada en días completos. También se muestra el error absoluto diario dividido por el total observado (WAPE), porque errores diarios opuestos se pueden cancelar al sumar el periodo. Como control de calidad del candidato se usó un máximo del 60 % de falsas alarmas entre los avisos emitidos.

## Protocolo

- El ajuste usa observaciones XEMA y predicciones de Badalona–Museu, Barcelona–el Raval y Malgrat entre el 12 de septiembre y el 10 de octubre. Se excluye el día cero ensamblado. La selección usa las horas del 17–24 de octubre cuya referencia es posterior al entrenamiento.
- La prueba principal solo usa referencias posteriores al 24 de octubre y horas de validez anteriores al 7 de noviembre. La ventana resultante es más corta cuanto mayor es la antelación. El 7–10 de noviembre queda como control adicional y es muy seco.
- Se comparan la cantidad ponderada, el voto de miembros húmedos y una regresión logística regularizada. Una variante incorpora el máximo pronosticado en las dos horas precedentes al mismo offset, sin utilizar observaciones futuras. La cantidad se compara por separado, con el ajuste existente, correcciones de escala ajustadas en entrenamiento y un modelo de ocurrencia por cantidad esperada.
- Se repitió el ajuste y la selección en tres ventanas cronológicas a 24 y 48 h. Los umbrales se eligen en validación. El barrido en prueba se publica como sensibilidad retrospectiva y sus resultados no deciden qué candidato entra en la app.

## Prueba principal

| Antelación | Detección | Falsas alarmas | Error del acumulado | Error diario WAPE |
|---|---:|---:|---:|---:|
| 24 h | 76,7 % | 54,9 % | 17,6 % | 60,8 % |
| 48 h | 56,7 % | 69,1 % | 4,9 % | 73,0 % |
| 72 h | 70,0 % | 69,1 % | 8,4 % | 73,2 % |
| 96 h | 60,0 % | 74,3 % | 0,1 % | 100,4 % |
| 120 h | 70,0 % | 73,8 % | 7,9 % | 97,9 % |
| 144 h | 0,0 % | 100,0 % | 5,9 % | 144,6 % |
| 168 h | 3,3 % | 98,1 % | 71,7 % | 124,7 % |

La selección independiente conservó la cantidad vigente. A 24 h, el nuevo detector encontró las mismas 23 de 30 horas lluviosas que el vigente y redujo de 29 a 28 los avisos falsos. Los valores combinados esconden diferencias por estación. Badalona detectó 8 de 10 horas, con 17,0 % de error del acumulado y 23,2 % de WAPE. Barcelona detectó 11 de 13 y tuvo 66,9 % de error del acumulado. Malgrat detectó 4 de 7 y tuvo 37,3 % de error del acumulado. Los episodios de las estaciones próximas están correlacionados.

La repetición por fechas tampoco sostuvo el 80 %. En la ventana con 68 horas lluviosas a 24 h, una corrección redujo el error del acumulado de 66,8 % a 15,0 %, mientras la detección cayó del 73,5 % al 32,4 %. En otra ventana, a 48 h, se consiguió 94,6 % de detección y 14,7 % de error del acumulado con 74,5 % de falsas alarmas y 41,0 % de WAPE.

## Comprobación en otras 11 estaciones

El barrido retrospectivo encontró un umbral de 0,3 mm sobre el ensemble bruto que, en las tres estaciones objetivo, habría alcanzado 83,3 % de detección. Al estar escogido con esa prueba a la vista, se comprobó aparte en 11 estaciones XEMA que no se usaron para elegirlo. La ventana espacial es del 19 de octubre al 1 de noviembre y comparte parte de las fechas del estudio. Los 232 casos lluviosos no equivalen a 232 episodios independientes.

| Detector a 24 h | Detección | Falsas alarmas | Error del acumulado | WAPE diario |
|---|---:|---:|---:|---:|
| Vigente | 86,2 % | 49,5 % | 10,5 % | 50,5 % |
| Umbral exploratorio | 84,1 % | 36,9 % | 10,5 % | 50,5 % |

El umbral exploratorio redujo los avisos falsos de 196 a 114 y perdió cinco aciertos. En estas estaciones el 80 % se cumple para la detección y el acumulado del periodo incluso con el detector vigente. A escala diaria el error sigue siendo alto. El candidato no sustituye al detector actual sin una verificación temporal independiente con más episodios, especialmente en Malgrat. A partir de 48 h, los umbrales que alcanzaron retrospectivamente el 80 % de detección tuvieron entre el 67,9 % y el 91,7 % de falsas alarmas en la prueba principal.

## Corrección de cantidad aplicada a la app

La precipitación horaria del proveedor es la suma de la hora precedente. Ahora el total diario atribuye las 00:00 al día que termina. Se aplica al resumen diario, al panel de próximos días, a la tabla diaria y al acumulado recalculado cuando hay un ajuste local. Las temperaturas y las cantidades horarias conservan sus horas originales.

## Reproducción

```text
npx tsx --env-file=.env.local scripts/rainTargetData.ts --download
npx tsx scripts/auditRainTargets.ts
```

El segundo comando reutiliza los archivos de XEMA y Previous Runs de las auditorías del 8 y 11 de noviembre. El JSON adjunto incluye los resultados por estación, los recuentos de aciertos, omisiones y falsas alarmas, y los cortes de cada repetición. Los datos brutos quedan fuera del repositorio.

[Definición de la precipitación horaria de Open-Meteo](https://open-meteo.com/en/docs/historical-weather-api) · [Verificación de POD, FAR y CSI de la OMM](https://severeweather.wmo.int/TCFW/RAIV_Workshop2017/21_EvaluationVerification_And_QualityManagement_PablosSantos.pdf)
