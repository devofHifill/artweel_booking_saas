/**
 * Travel time — the wedge feature, expressed as a scheduling constraint.
 *
 * Incumbent booking tools treat location as a text label on a booking. For a
 * studio that also runs mobile parties and corporate workshops, location is
 * a hard constraint on the schedule: the question is not "is the calendar
 * free at 2pm" but "is the calendar free at 2pm AND can this person
 * physically get there from where they are at 1pm".
 *
 * The engine expresses that by WIDENING each existing commitment by the
 * travel time to and from the requested address. A one-hour class in another
 * town blocks far more than one hour of the day.
 */

export type LatLng = { lat: number; lng: number };

export interface TravelTimeProvider {
  /** Door-to-door minutes. */
  minutesBetween(from: LatLng, to: LatLng): Promise<number>;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Straight-line estimate. Deliberately pessimistic.
 *
 * Real road distance exceeds straight-line distance by roughly 1.3x in most
 * US metros, and a short trip is dominated by parking and loading rather
 * than driving. Underestimating travel makes the system promise a slot the
 * instructor cannot reach, which is far worse than hiding one they could —
 * so the constants err toward caution.
 *
 * Phase 1 replaces this with a real routing matrix. The interface exists so
 * that swap touches one file.
 */
export class HaversineTravelProvider implements TravelTimeProvider {
  constructor(
    private readonly averageSpeedKmh = 35,
    private readonly roadFactor = 1.3,
    private readonly fixedOverheadMinutes = 10,
  ) {}

  async minutesBetween(from: LatLng, to: LatLng): Promise<number> {
    const km = haversineKm(from, to) * this.roadFactor;
    if (km === 0) return 0;
    const driving = (km / this.averageSpeedKmh) * 60;
    return Math.ceil(driving + this.fixedOverheadMinutes);
  }
}

/**
 * Caching wrapper.
 *
 * Studios serve the same neighbourhoods over and over, so hit rates are high.
 * Coordinates are rounded to ~1km before keying: two addresses on the same
 * block have identical travel characteristics and should not each cost an
 * API call once a real routing provider is behind this.
 */
export class CachedTravelProvider implements TravelTimeProvider {
  private readonly cache = new Map<string, number>();

  constructor(
    private readonly inner: TravelTimeProvider,
    private readonly precision = 2,
  ) {}

  private key(from: LatLng, to: LatLng): string {
    const r = (n: number) => n.toFixed(this.precision);
    return `${r(from.lat)},${r(from.lng)}->${r(to.lat)},${r(to.lng)}`;
  }

  async minutesBetween(from: LatLng, to: LatLng): Promise<number> {
    const k = this.key(from, to);
    const hit = this.cache.get(k);
    if (hit !== undefined) return hit;

    const value = await this.inner.minutesBetween(from, to);
    this.cache.set(k, value);
    return value;
  }

  get size() {
    return this.cache.size;
  }
}

export const defaultTravelProvider: TravelTimeProvider = new CachedTravelProvider(
  new HaversineTravelProvider(),
);

/** Travel fee bands stored on a location: [{ maxKm, feeCents, minSpendCents }]. */
export type TravelFeeBand = {
  maxKm: number;
  feeCents: number;
  minSpendCents?: number;
};

export function travelFeeFor(
  distanceKm: number,
  bands: TravelFeeBand[] | null | undefined,
): { feeCents: number; minSpendCents: number } | null {
  if (!bands || bands.length === 0) return null;

  const sorted = [...bands].sort((a, b) => a.maxKm - b.maxKm);
  for (const band of sorted) {
    if (distanceKm <= band.maxKm) {
      return {
        feeCents: band.feeCents,
        minSpendCents: band.minSpendCents ?? 0,
      };
    }
  }

  // Beyond every band means outside the service area entirely.
  return null;
}
