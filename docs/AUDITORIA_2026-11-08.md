# Auditoría meteorológica y web — 8 de noviembre de 2026

**Actualización posterior:** ver `docs/RECALIBRACION_2026-11-08.md`. Se amplió el histórico, se publicó una recalibración temporal y se corrigió la agregación de intervalos XEMA. Las cifras iniciales de falsas alarmas XEMA de este análisis se retiran: comparaban períodos distintos y no constituyen una validación horaria válida.

Se inspeccionaron la web publicada, las vistas móvil y escritorio, el recorrido de datos desde Open-Meteo y estaciones hasta las tarjetas/tablas, los presets, el nowcast y las herramientas de evaluación. Los cambios están en el repositorio local; no se ha desplegado ni modificado la configuración de Vercel.

## Errores corregidos

| Área | Fallo comprobado | Corrección |
|---|---|---|
| Pesos | Reserva del 20–34 % para AIFS/GraphCast sin verificación, aplicada también a viento | Se conservan proporciones de habilidad medida y se normalizan; los modelos sin medir reciben únicamente el fallback existente de 0,01 cuando aportan datos |
| Horizonte | Tarjeta, tira horaria y panel semanal reiniciaban el plazo al seleccionar una hora futura | El horizonte real se propaga a pesos y corrección de sesgo; la selección futura deja de etiquetarse «Ahora» |
| Sesgo | Un horizonte sin medición heredaba la corrección de 0–48 h | No se extrapola una corrección sin evidencia |
| Lluvia | Tarjeta actual calculaba media simple y fabricaba porcentajes a partir de mm/h | Media ponderada canónica; probabilidad ausente permanece desconocida |
| Estaciones | AEMET devuelve `ta/fint/idema`; el consumidor esperaba `temperature/updatedAt/code` | Adaptador específico, timestamp UTC y conversión de viento de m/s a km/h |
| Nowcast | Una estación vieja podía ocultar otra fresca; la lista de cercanía puede expandirse fuera del radio | Solo se mezclan estaciones con temperatura válida, hasta 90 minutos y 10 km; la lista visible conserva su política independiente |
| Nowcast | El fallback del modelo aparecía como «estación en vivo» | Insignia solo cuando existe una observación fresca y una comparación válida |
| Redes | Un rechazo de una de las redes invalidaba ambas peticiones | Se recupera cada red independientemente con `Promise.allSettled`; al deduplicar se elige la observación más reciente |
| Fórmula | Wind chill aplicado en calma | Se exige viento mínimo de 4,8 km/h además de temperatura ≤10 °C |
| Iconos | 8 mm diarios o rachas fuertes se presentaban como tormenta eléctrica | Tormenta requiere código WMO explícito; lluvia horaria usa umbral 0,1 mm; el icono actual usa temperatura actual, no mínima diaria |
| Datos | NaN, infinitos, pesos ausentes o negativos contaminaban la media | Se descartan contribuciones inválidas y se renormaliza sobre las válidas |
| Verificación | Pares inválidos contaban como observaciones | MAE/RMSE/bias y contingencias solo cuentan pares finitos válidos |
| Calibración | Se promediaban RMSE sin tamaño muestral | Se combinan errores cuadrados ponderados por número de muestras antes de tomar la raíz |
| Ranking | Modelos repetidos participaban varias veces; empates dependían del orden; RMSE=0 se descartaba | Se agrupan modelos por ubicación, se resuelven empates con rango medio y se admite error cero |
| Dispersión | Media ponderada y varianza sin ponderar | Ambos momentos usan los mismos pesos |
| Datos horarios | AQI/polen se elegían por hora de descarga o solo número de hora | Selección por fecha y hora local del reloj actual, con actualización periódica |
| CSS | Regla global fuera de capas sobrescribía `text-6xl` y otros tamaños | Regla base dentro de `@layer base`; recuperada la jerarquía tipográfica |
| Móvil | Siete columnas comprimían las tarjetas diarias y recortaban cifras | Ancho mínimo de 4,5 rem y desplazamiento horizontal dentro del componente |
| Heatmap | Gradiente contenía `rgba(...,18)%`, sintaxis inválida | Porcentaje dentro de `rgba`; valores no finitos transparentes |
| Rendimiento | Nowcast reconstruía dos series completas para usar un solo punto | Reutiliza el snapshot ya corregido: evita recorrer cientos de horas por todos los modelos |
| Carga | Ciudades y Ajustes formaban parte del módulo inicial | Importación dinámica al montar sus pestañas |
| Red | Cliente abortaba a los 20 s aunque el proxy puede dedicar 25 s al proveedor y después consultar caché | Timeout cliente de 32 s; fallback de modelos comparte un único presupuesto de 25 s |

La definición de probabilidad y los códigos WMO se contrastaron con [Open-Meteo](https://open-meteo.com/en/docs). El dominio del wind chill se contrastó con [NWS](https://www.weather.gov/safety/cold-wind-chill-chart).

## Qué mide realmente el ensemble

La previsión pública usa presets estáticos por variable y horizonte. El pipeline calcula y almacena `dynamic_weights`, pero esa tabla no se consume en el recorrido público de la previsión. El ajuste por terreno es un multiplicador pequeño de recomendaciones, no aprendizaje continuo de pesos por ubicación.

El histórico local contiene 10.407.860 filas de forecast y 10.746 filas de precisión. Las ventanas de precisión disponibles abarcan **15–22 de agosto de 2026** para temperatura, viento y precipitación. No son representativas de todas las estaciones del año ni demuestran habilidad en noviembre. Más de siete días se siguen usando extrapolaciones sin verificación equivalente.

Las probabilidades suministradas por Open-Meteo proceden de ensembles probabilísticos. Promediar probabilidades no las calibra automáticamente; el peso derivado del RMSE de cantidad tampoco demuestra fiabilidad probabilística. No se ha convertido acuerdo entre modelos deterministas en una nueva probabilidad.

Los modelos no son observaciones independientes: comparten forzamientos, familias y errores. La desviación entre modelos describe desacuerdo; no constituye un intervalo de confianza con cobertura garantizada. El nowcast conserva una mezcla heurística 60/40 y carece de ajuste por diferencias de altitud: limitar distancia y antigüedad reduce errores evidentes, sin demostrar calibración de esa mezcla.

## Evaluación ejecutada

Se ejecutaron cinco particiones espaciales del histórico, con agrupación de modelos corregida. Los esquemas aprendidos en cada partición excluyen sus ubicaciones de prueba. Los presets fijos pudieron entrenarse con esas mismas ubicaciones/fechas: sus resultados son descriptivos y **no** una validación temporal independiente. El evaluador ahora lo indica, incluye media equiponderada y evita comparar porcentajes de mejora sobre poblaciones de distinto tamaño.

Temperatura en la población comparable de 48.849 instancias:

| Método | RMSE °C | MAE °C |
|---|---:|---:|
| Mejor modelo individual elegido en entrenamiento | 1,5888 | 1,1628 |
| Media equiponderada | 1,2448 | 0,9162 |
| Preset | 1,2314 | 0,9023 |
| Borda entrenado sin ubicaciones de prueba | 1,2312 | 0,9020 |
| Borda con sesgo | 1,2293 | 0,8991 |

La mejora de pesos sobre la media simple es pequeña frente a la mejora de combinar modelos. No justifica afirmar que siempre hay un único modelo ganador.

En precipitación, sobre las 143.896 instancias ERA5 disponibles, el preset obtiene RMSE 0,4016 frente a 0,4015 de la media equiponderada; CSI 28,1 % frente a 28,7 %. En esta muestra, la complejidad de los pesos no demuestra ventaja para lluvia. El RMSE favorece una buena estimación de cantidad media, mientras que detectar episodios localizados y calibrar probabilidades son problemas distintos.

La primera prueba XEMA de agosto fue invalidada al verificar la documentación del proveedor: se estaban comparando medias horas etiquetadas por inicio con horas de lluvia etiquetadas por finalización. Se ha sustituido por la prueba UTC de 14 días documentada en la recalibración. Los pesos exploratorios de aquella prueba no se publicaron.

## Validación y límites operativos

- Suite de 140 archivos: 1.130 pruebas superadas tras los cambios del núcleo.
- TypeScript y ESLint sin errores en esa comprobación.
- Build de producción compilado; 14 pruebas de portada y regresión visual superadas en Chromium de escritorio y Pixel 7, sobre servidor de producción.
- Capturas verificadas: temperatura principal legible, tarjetas con ancho mínimo, sin desbordamiento horizontal de la página y sin insignia falsa de estación.
- Las fuentes Google requieren acceso a red al compilar. El entorno local avisa de `NEXT_PUBLIC_APP_URL` ausente; no se ha inferido ni cambiado la configuración remota.
- La comprobación E2E previa mostró AEMET 401 en el entorno local. Corregir el formato del consumidor no renueva credenciales del proveedor.

Comandos reproducibles:

```text
npm run test
npm run typecheck
npm run lint
npm run build
npm run e2e -- e2e/audit.spec.ts e2e/home.spec.ts --workers=2
npm run eval:ensemble -- temperature 5
npm run eval:ensemble -- precipitation 5
npm run eval:ensemble -- wind_speed 5
npm run eval:ensemble -- precipitation 5 --truth=station --from=2026-08-15 --to=2026-08-16 --stations=12
```

## Recalibración pendiente de evidencia suficiente

Para demostrar una mejora meteorológica general, hace falta archivar prospectivamente forecasts emitidos y observaciones verificadas durante varias situaciones sinópticas y estaciones, separar entrenamiento y prueba en el tiempo y comparar sobre idénticas instancias. Evaluar cantidad con MAE/RMSE y episodios con POD/FAR/CSI; evaluar probabilidad con Brier, curvas de fiabilidad y resolución, por ubicación y plazo. Mantener un conjunto final sin usar para seleccionar hiperparámetros.

Solo después procede publicar nuevos pesos locales o por familias y activar pesos dinámicos con límites de antigüedad, muestra mínima y rollback. Esta auditoría corrige errores de ejecución, fórmulas y presentación; no declara resuelta la precisión de lluvia con una semana histórica.
