import { config } from "../config.js";

// railway region ids -> somewhere a human has heard of
const RAILWAY_REGIONS = {
  "us-west1": { country: "United States", countryCode: "US", region: "Oregon" },
  "us-west2": { country: "United States", countryCode: "US", region: "California" },
  "us-east4": { country: "United States", countryCode: "US", region: "Virginia" },
  "us-east4-eqdc4a": { country: "United States", countryCode: "US", region: "Virginia" },
  "europe-west4": { country: "Netherlands", countryCode: "NL", region: "North Holland" },
  "europe-west4-drams3a": { country: "Netherlands", countryCode: "NL", region: "North Holland" },
  "asia-southeast1": { country: "Singapore", countryCode: "SG", region: "Singapore" },
  "asia-southeast1-eqsg3a": { country: "Singapore", countryCode: "SG", region: "Singapore" },
};

let location = {
  country: config.serverCountry || "Unknown",
  countryCode: "",
  region: config.serverRegion || "",
  source: config.serverCountry ? "env" : "pending",
};

async function lookup(url, pick) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return pick(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectLocation() {
  if (config.serverCountry) return location;
  const railway = RAILWAY_REGIONS[config.railwayRegion];
  const found =
    (await lookup("https://ipwho.is/?fields=success,country,country_code,region", (data) =>
      data?.success ? { country: data.country, countryCode: data.country_code, region: data.region } : null,
    )) ||
    (await lookup("http://ip-api.com/json/?fields=status,country,countryCode,regionName", (data) =>
      data?.status === "success" ? { country: data.country, countryCode: data.countryCode, region: data.regionName } : null,
    )) ||
    railway;
  if (found) location = { ...found, source: "detected" };
  else location = { ...location, source: "unknown" };
  return location;
}

export function serverLocation() {
  return location;
}
