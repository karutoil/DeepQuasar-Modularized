import * as chrono from 'chrono-node';

/**
 * Parses a natural language time string using chrono-node.
 * @param {string} input - The time string to parse.
 * @param {Date} [refDate] - Reference date for relative parsing (optional).
 * @returns {{ date: Date|null, error: string|null, rawResults: any }} 
 *   - date: Parsed Date object, or null if invalid/ambiguous.
 *   - error: Error message if parsing failed or ambiguous.
 *   - rawResults: The raw chrono-node results for advanced usage.
 */
export function parseNaturalLanguageTime(input, refDate = new Date()) {
  if (typeof input !== 'string' || !input.trim()) {
    return { date: null, error: 'No time input provided.', rawResults: null };
  }

  // Short duration format: e.g. "5s", "10m", "2h", "3d", "1w", "1y"
  const shortDurationRegex = /^(\d+)\s*(s|m|h|d|w|y)$/i;
  const match = input.trim().match(shortDurationRegex);

  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (isNaN(value) || value <= 0) {
      return { date: null, error: 'Invalid duration value.', rawResults: null };
    }

    let ms = 0;
    switch (unit) {
      case 's': ms = value * 1000; break;
      case 'm': ms = value * 60 * 1000; break;
      case 'h': ms = value * 60 * 60 * 1000; break;
      case 'd': ms = value * 24 * 60 * 60 * 1000; break;
      case 'w': ms = value * 7 * 24 * 60 * 60 * 1000; break;
      case 'y': ms = value * 365 * 24 * 60 * 60 * 1000; break;
      default:
        return { date: null, error: 'Unknown duration unit.', rawResults: null };
    }

    const date = new Date(refDate.getTime() + ms);

    if (isNaN(date.getTime())) {
      return { date: null, error: 'Calculated date is invalid.', rawResults: null };
    }

    // Optionally, check for past dates (shouldn't happen for positive durations)
    if (date.getTime() < Date.now()) {
      return { date: null, error: 'Calculated time is in the past.', rawResults: null };
    }

    return { date, error: null, rawResults: { type: 'short-duration', value, unit, ms } };
  }

  // Fallback to chrono-node for natural language parsing
  const results = chrono.parse(input, refDate);

  if (!results || results.length === 0) {
    return { date: null, error: 'Could not parse time input.', rawResults: results };
  }

  // If multiple results, input may be ambiguous
  if (results.length > 1) {
    return { date: null, error: 'Ambiguous time input. Please be more specific.', rawResults: results };
  }

  const result = results[0];
  if (!result || !result.start) {
    return { date: null, error: 'Could not extract a valid date.', rawResults: results };
  }

  const date = result.start.date();
  if (isNaN(date.getTime())) {
    return { date: null, error: 'Parsed date is invalid.', rawResults: results };
  }

  // Optionally, check for past dates
  if (date.getTime() < Date.now()) {
    return { date: null, error: 'Parsed time is in the past.', rawResults: results };
  }

  return { date, error: null, rawResults: results };
}
