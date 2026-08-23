import type { LocationPrecision, LocationSelection } from "./types";

const LOCATION_ID = /^[a-z0-9][a-z0-9:_-]{0,79}$/i;

export function isLocationId(value: unknown): value is string {
  return typeof value === "string" && LOCATION_ID.test(value);
}

export function locationPrecision(location: LocationSelection): LocationPrecision {
  if (location.feederId) return "feeder";
  if (location.providerId) return "provider_upazila";
  return "upazila";
}

export function locationKey(location: LocationSelection): string {
  if (location.feederId) return `feeder:${location.feederId}`;
  if (location.providerId) {
    return `provider:${location.providerId}:upazila:${location.upazilaId}`;
  }
  return `upazila:${location.upazilaId}`;
}

export function ancestorLocationKeys(location: LocationSelection): string[] {
  const keys = [`upazila:${location.upazilaId}`];
  if (location.providerId) {
    keys.push(`provider:${location.providerId}:upazila:${location.upazilaId}`);
  }
  if (location.feederId) keys.push(`feeder:${location.feederId}`);
  return keys;
}

