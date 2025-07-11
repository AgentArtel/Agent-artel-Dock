/**
 * @fileoverview Weather utility functions for the unified node system.
 * Provides helper functions for geocoding and API requests.
 */

import { LogCategory, logger } from 'agentdock-core';

import type { GeocodingResult, WeatherApiResponse } from './types';

/**
 * Parse coordinates from string
 * @returns [latitude, longitude] or null if invalid
 */
export function parseCoordinates(location: string): [number, number] | null {
  logger.info(
    LogCategory.NODE,
    'WeatherUtils',
    `Parsing coordinates from: ${location}`
  );
  const parts = location.split(',').map((part) => parseFloat(part.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    logger.warn(LogCategory.NODE, 'WeatherUtils', 'Invalid coordinate format');
    return null;
  }
  const [lat, lon] = parts;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    logger.warn(
      LogCategory.NODE,
      'WeatherUtils',
      'Coordinates out of valid range'
    );
    return null;
  }
  logger.info(
    LogCategory.NODE,
    'WeatherUtils',
    `Valid coordinates: ${lat},${lon}`
  );
  return [lat, lon];
}

/**
 * Wrapper for fetch with Edge-compatible error handling
 */
export async function fetchWithCors<T>(url: string): Promise<T> {
  logger.info(LogCategory.NODE, 'WeatherUtils', `Fetching data from: ${url}`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal,
      cache: 'no-store', // Ensure fresh data in Edge environment
      next: { revalidate: 0 } // Disable caching in Edge runtime
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      const errorDetails = {
        url,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        runtime: typeof window === 'undefined' ? 'edge/server' : 'client'
      };
      logger.error(LogCategory.NODE, 'WeatherUtils', 'API Error', errorDetails);
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    logger.info(LogCategory.NODE, 'WeatherUtils', 'API request successful');
    return data as T;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        logger.error(LogCategory.NODE, 'WeatherUtils', 'Request timeout');
        throw new Error(`Request timeout: ${url}`);
      }
      if (error.name === 'TypeError') {
        // Network errors or other fetch-related issues
        logger.error(LogCategory.NODE, 'WeatherUtils', 'Network Error', {
          url,
          error: error.message,
          runtime: typeof window === 'undefined' ? 'edge/server' : 'client',
          stack: error.stack
        });
        throw new Error(`Network error: ${error.message}`);
      }
      logger.error(LogCategory.NODE, 'WeatherUtils', 'Fetch error', {
        url,
        error: error.message,
        runtime: typeof window === 'undefined' ? 'edge/server' : 'client',
        stack: error.stack
      });
      throw new Error(`Failed to fetch weather data: ${error.message}`);
    }
    throw new Error('An unexpected error occurred');
  }
}

/**
 * Get coordinates for a location using Open-Meteo geocoding API
 */
export async function getCoordinates(
  location: string
): Promise<[number, number, string, string, string]> {
  logger.info(
    LogCategory.NODE,
    'WeatherUtils',
    `Getting coordinates for location: ${location}`
  );
  try {
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
    logger.info(
      LogCategory.NODE,
      'WeatherUtils',
      `Geocoding URL: ${geocodingUrl}`
    );

    const data = await fetchWithCors<GeocodingResult>(geocodingUrl);

    if (!data.results?.length) {
      logger.error(
        LogCategory.NODE,
        'WeatherUtils',
        `Location not found: ${location}`
      );
      throw new Error(`Location "${location}" not found`);
    }

    const { latitude, longitude, name, country, admin1 } = data.results[0];
    logger.info(
      LogCategory.NODE,
      'WeatherUtils',
      `Geocoding successful: ${name}, ${country} (${latitude},${longitude})`
    );
    return [latitude, longitude, name, country, admin1 || ''];
  } catch (error) {
    logger.error(LogCategory.NODE, 'WeatherUtils', 'Geocoding error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw new Error(
      `Failed to get location coordinates: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get weather forecast from Open-Meteo API
 */
export async function getWeatherForecast(
  latitude: number,
  longitude: number,
  days: number = 7
): Promise<WeatherApiResponse> {
  logger.info(
    LogCategory.NODE,
    'WeatherUtils',
    `Getting weather forecast for coordinates: ${latitude},${longitude}`
  );
  try {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const endDate = new Date(today);
    endDate.setUTCDate(today.getUTCDate() + (days - 1));
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    logger.info(
      LogCategory.NODE,
      'WeatherUtils',
      `Fetching weather data for dates: ${startDateStr} to ${endDateStr}`
    );

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_probability_max&timezone=UTC&start_date=${startDateStr}&end_date=${endDateStr}`;

    const data = await fetchWithCors<WeatherApiResponse>(weatherUrl);
    logger.info(
      LogCategory.NODE,
      'WeatherUtils',
      'Weather data received from Open-Meteo API'
    );

    return data;
  } catch (error) {
    logger.error(LogCategory.NODE, 'WeatherUtils', 'Weather forecast error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw new Error(
      `Failed to get weather forecast: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
