const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface SolarPosition {
  declinationDeg: number;
  subsolarLatitudeDeg: number;
  subsolarLongitudeDeg: number;
  elevationDeg: number;
  azimuthDeg: number;
  apparentSolarMinutes: number;
  equationOfTimeMinutes: number;
}

function wrap(value: number, range: number): number {
  return ((value % range) + range) % range;
}

/**
 * NOAA's published fractional-year solar equations, applied to UTC. This is an
 * approximate geometric position of the Sun's centre (it does not model local
 * terrain, refraction, or the solar disc).
 */
export function solarPosition(instant: Date, latitudeDeg: number, longitudeDeg: number): SolarPosition {
  const year = instant.getUTCFullYear();
  const yearLength = new Date(Date.UTC(year + 1, 0, 1)).getTime() - new Date(Date.UTC(year, 0, 1)).getTime();
  const dayOfYear = (Date.UTC(year, instant.getUTCMonth(), instant.getUTCDate()) - Date.UTC(year, 0, 1)) / 86_400_000 + 1;
  const utcMinute = instant.getUTCHours() * 60 + instant.getUTCMinutes() + instant.getUTCSeconds() / 60 + instant.getUTCMilliseconds() / 60_000;
  const hour = utcMinute / 60;
  const gamma = 2 * Math.PI / (yearLength / 86_400_000) * (dayOfYear - 1 + (hour - 12) / 24);

  const equationOfTimeMinutes = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const declinationRad = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const apparentSolarMinutes = wrap(utcMinute + equationOfTimeMinutes + 4 * longitudeDeg, 1440);
  const hourAngleRad = (apparentSolarMinutes / 4 - 180) * DEG;
  const latitudeRad = latitudeDeg * DEG;
  const elevationRad = Math.asin(
    Math.sin(latitudeRad) * Math.sin(declinationRad)
    + Math.cos(latitudeRad) * Math.cos(declinationRad) * Math.cos(hourAngleRad),
  );
  const azimuthRad = Math.atan2(
    Math.sin(hourAngleRad),
    Math.cos(hourAngleRad) * Math.sin(latitudeRad) - Math.tan(declinationRad) * Math.cos(latitudeRad),
  ) + Math.PI;

  return {
    declinationDeg: declinationRad * RAD,
    subsolarLatitudeDeg: declinationRad * RAD,
    subsolarLongitudeDeg: wrap(180 - utcMinute / 4 - equationOfTimeMinutes / 4 + 180, 360) - 180,
    elevationDeg: elevationRad * RAD,
    azimuthDeg: wrap(azimuthRad * RAD, 360),
    apparentSolarMinutes,
    equationOfTimeMinutes,
  };
}

export function compassPoint(azimuthDeg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(wrap(azimuthDeg, 360) / 22.5) % points.length];
}

export function formatSolarTime(minutes: number): string {
  const rounded = Math.floor(wrap(minutes, 1440));
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}
