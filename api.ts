/**
 * API client for z.ai quota endpoint.
 *
 * This module handles fetching quota data from the z.ai API,
 * validating the response, and parsing it into a structured format
 * suitable for display in the status bar.
 *
 * @module api
 */

import type { QuotaResponse, ParsedQuota, QuotaLimit } from "./types";
import { Unit } from "./types";

/** Base URL for the z.ai quota API endpoint */
const API_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

/** Default timeout for API requests in milliseconds */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Fetches quota information from the z.ai API.
 *
 * Makes a GET request to the quota endpoint with Bearer authentication,
 * validates the response code and structure, and extracts the relevant
 * quota limits (5-hour and weekly).
 *
 * The monthly quota (unit 5) is parsed from the response but not included
 * in the returned {@link ParsedQuota} object, as it's not displayed in v1.
 *
 * @param apiKey - The z.ai API key for authentication
 * @returns Parsed quota data with 5h, weekly limits, and plan level
 * @throws {Error} If the API request fails, returns non-200 code, or response is malformed
 * @throws {Error} If the request times out (after {@link REQUEST_TIMEOUT_MS})
 * @throws {Error} If the response JSON is invalid or has an unexpected structure
 *
 * @example
 * ```ts
 * import { fetchQuota } from "./api";
 * import { getApiKey } from "./auth";
 *
 * const apiKey = getApiKey();
 * const quota = await fetchQuota(apiKey);
 * console.log(`Plan: ${quota.planLevel}`);
 * console.log(`5h used: ${quota.fiveHour?.percentage}%`);
 * ```
 */
export async function fetchQuota(apiKey: string): Promise<ParsedQuota> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as QuotaResponse;

    // Validate response code
    if (data.code !== 200) {
      throw new Error(`API returned code ${data.code}`);
    }

    // Validate response structure
    if (!data.data || !Array.isArray(data.data.limits)) {
      throw new Error("Invalid response structure: missing data.limits array");
    }

    // Parse limits - extract 5-hour and weekly quotas
    let fiveHour: QuotaLimit | null = null;
    let weekly: QuotaLimit | null = null;

    for (const limit of data.data.limits) {
      if (limit.unit === Unit.FIVE_HOUR) {
        fiveHour = limit;
      } else if (limit.unit === Unit.WEEKLY) {
        weekly = limit;
      }
      // Unit 5 (monthly) is parsed but not displayed in v1
      // Future: could store monthly limit for display or detailed command
    }

    return {
      fiveHour,
      weekly,
      planLevel: data.data.level,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      // Handle AbortError (timeout)
      if (error.name === "AbortError") {
        throw new Error("Request timeout: fetch took longer than 5 seconds");
      }
      // Re-throw with clearer context
      if (error.message.startsWith("HTTP error") || error.message.startsWith("API returned")) {
        throw error;
      }
      if (error.message.startsWith("Invalid response structure")) {
        throw error;
      }
      throw new Error(`Failed to fetch quota: ${error.message}`);
    }
    throw new Error("Failed to fetch quota: unknown error");
  }
}
