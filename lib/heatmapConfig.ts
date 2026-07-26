export const HEATMAP_ROWS = 6
export const HEATMAP_COLS = 8
export const HEATMAP_DEBOUNCE_MS = 400
export const HEATMAP_FORECAST_DAYS = 7
// B-NEW-5: cap models in the heatmap request so Open-Meteo's URL stays
// under its 2 kB limit. When the user has selected more, the UI must
// warn that the displayed heatmap only reflects the top-N by weight.
export const HEATMAP_MAX_MODELS = 4
