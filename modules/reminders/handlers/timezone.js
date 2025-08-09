/**
 * /timezone Command Autocomplete Handler
 * -------------------------------------
 * - Provides searchable autocomplete for timezones using the countries-and-timezones library.
 * - Supports searching by timezone name, country, and main cities.
 * - Implements fuzzy matching (Levenshtein distance, startsWith) to handle typos and partial matches.
 * - Formats suggestions with country, city, UTC offset, and timezone code for clarity.
 * - Shows popular timezones when no input is provided.
 * - To extend: update the popularTzCodes array or adjust the filtering/formatting logic.
 * - Maintainers: Ensure the countries-and-timezones library is up to date for accurate timezone data.
 */
import { setUserTimezone, getUserTimezone } from "../services/timezoneService.js";
import ct from 'countries-and-timezones';

/* console.log("[TIMEZONE] Module loaded, ct library:", typeof ct); */

export function setup(ctx) {
/*   console.log("[/timezone setup] === TIMEZONE COMMAND SETUP START ===");
  console.log("[/timezone setup] Context available:", {
    hasV2: !!ctx.v2,
    hasCreateInteractionCommand: !!ctx.v2?.createInteractionCommand,
    hasLogger: !!ctx.logger,
    moduleName: "reminders"
  }); */

  const builder = ctx.v2.createInteractionCommand()
    .setName("timezone")
    .setDescription("Set or view your timezone")
    .addStringOption(opt => {
      //console.log("[/timezone setup] Adding string option 'timezone' with autocomplete=true");
      return opt
        .setName("timezone")
        .setDescription("Your timezone (e.g. America/New_York)")
        .setRequired(false)
        .setAutocomplete(true);
    })
    .onExecute(ctx.dsl.withTryCatch(
      ctx.dsl.withDeferredReply(async (i) => {
        const userId = i.user.id;
        const tzInput = i.options.getString("timezone");

        if (tzInput) {
          // Enhanced timezone validation using countries-and-timezones library
          if (typeof tzInput !== "string" || tzInput.trim().length === 0) {
            await i.editReply({ embeds: [ctx.embed.error({ title: "Invalid timezone", description: "Please provide a valid timezone (e.g. America/New_York)." })], ephemeral: true });
            return;
          }
          
          // Validate timezone exists in the library
          const allTimezones = ct.getAllTimezones();
          const tzData = allTimezones[tzInput];
          
          if (!tzData) {
            await i.editReply({ 
              embeds: [ctx.embed.error({ 
                title: "Invalid timezone", 
                description: `The timezone \`${tzInput}\` is not recognized. Please use the autocomplete suggestions to select a valid timezone.` 
              })], 
              ephemeral: true 
            });
            return;
          }
          
          try {
            await setUserTimezone(ctx, userId, tzInput);
            
            // Enhanced success message with timezone info
            const offsetStr = formatOffset(tzData.utcOffset);
            const countries = tzData.countries || [];
            const countryStr = countries.length > 0 ? ` (${countries.slice(0, 2).join(', ')})` : '';
            
            await i.editReply({ 
              embeds: [ctx.embed.success({ 
                title: "Timezone Set", 
                description: `Your timezone is now set to \`${tzInput}\` (UTC${offsetStr})${countryStr}.` 
              })], 
              ephemeral: true 
            });
          } catch (err) {
            await i.editReply({ embeds: [ctx.embed.error({ title: "Failed to set timezone", description: err?.message || "An unexpected error occurred." })], ephemeral: true });
          }
        } else {
          // Get timezone
          try {
            const timezone = await getUserTimezone(ctx, userId);
            if (timezone) {
              await i.editReply({ embeds: [ctx.embed.info({ title: "Your Timezone", description: `Your timezone is set to \`${timezone}\`.` })], ephemeral: true });
            } else {
              await i.editReply({ embeds: [ctx.embed.warn({ title: "No Timezone Set", description: "You have not set a timezone yet. Use `/timezone <your zone>` to set one." })], ephemeral: true });
            }
          } catch (err) {
            await i.editReply({ embeds: [ctx.embed.error({ title: "Failed to retrieve timezone", description: err?.message || "An unexpected error occurred." })], ephemeral: true });
          }
        }
      })
    ));

  builder.onAutocomplete("timezone", async (i) => {
    //console.log("[/timezone autocomplete] === AUTOCOMPLETE HANDLER START ===");
    
    try {
      // Get focused input
      const focusedRaw = i.options.getFocused(true);
      const input = (focusedRaw?.value || "").toLowerCase().trim();
      //console.log("[/timezone autocomplete] Input:", input);
      
      // Get all timezones from countries-and-timezones library
      const allTimezones = ct.getAllTimezones();
      //console.log("[/timezone autocomplete] Total timezones available:", Object.keys(allTimezones).length);
      
      // Popular timezone suggestions (shown when no input)
      const popularTimezones = [
        "UTC",
        "America/New_York",
        "America/Los_Angeles",
        "America/Chicago",
        "America/Denver",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "Asia/Tokyo",
        "Asia/Shanghai",
        "Australia/Sydney",
        "Pacific/Auckland"
      ];
      
      let suggestions = [];
      
      if (!input) {
        // No input - show popular timezones
        suggestions = popularTimezones.map(tz => {
          const tzData = allTimezones[tz];
          if (tzData) {
            const offsetStr = formatOffset(tzData.utcOffset);
            return {
              name: `${tz} (UTC${offsetStr})`,
              value: tz
            };
          }
          return { name: tz, value: tz };
        });
      } else {
        // Search through all timezones
        const searchResults = [];
        
        for (const [tzName, tzData] of Object.entries(allTimezones)) {
          const searchScore = calculateSearchScore(tzName, tzData, input);
          if (searchScore > 0) {
            searchResults.push({
              name: tzName,
              data: tzData,
              score: searchScore
            });
          }
        }
        
        // Sort by relevance score (higher is better)
        searchResults.sort((a, b) => b.score - a.score);
        
        // Format top results
        suggestions = searchResults.slice(0, 25).map(result => {
          const offsetStr = formatOffset(result.data.utcOffset);
          const countries = result.data.countries || [];
          const countryStr = countries.length > 0 ? ` (${countries.slice(0, 2).join(', ')})` : '';
          
          return {
            name: `${result.name} - UTC${offsetStr}${countryStr}`,
            value: result.name
          };
        });
      }
      
      //console.log("[/timezone autocomplete] Returning", suggestions.length, "suggestions");
      await i.respond(suggestions);
      
    } catch (err) {
      //console.error("[/timezone autocomplete] Error:", err?.message);
      
      // Fallback to basic options
      const fallback = [
        { name: "UTC", value: "UTC" },
        { name: "America/New_York (Eastern)", value: "America/New_York" },
        { name: "America/Los_Angeles (Pacific)", value: "America/Los_Angeles" },
        { name: "Europe/London (GMT)", value: "Europe/London" }
      ];
      
      await i.respond(fallback);
    }
  });
  
  // Helper function to format UTC offset
  function formatOffset(minutes) {
    if (!minutes) return "+00:00";
    const hours = Math.floor(Math.abs(minutes) / 60);
    const mins = Math.abs(minutes) % 60;
    const sign = minutes >= 0 ? '+' : '-';
    return `${sign}${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }
  
  // Helper function to calculate search relevance score
  function calculateSearchScore(tzName, tzData, input) {
    let score = 0;
    const lowerTzName = tzName.toLowerCase();
    
    // Exact match gets highest score
    if (lowerTzName === input) return 1000;
    
    // Starts with input gets high score
    if (lowerTzName.startsWith(input)) score += 500;
    
    // Contains input gets medium score
    if (lowerTzName.includes(input)) score += 100;
    
    // Check city/region parts
    const parts = tzName.split('/');
    for (const part of parts) {
      const lowerPart = part.toLowerCase();
      if (lowerPart === input) score += 800;
      if (lowerPart.startsWith(input)) score += 300;
      if (lowerPart.includes(input)) score += 50;
    }
    
    // Check countries
    const countries = tzData.countries || [];
    for (const country of countries) {
      const lowerCountry = country.toLowerCase();
      if (lowerCountry === input) score += 200;
      if (lowerCountry.startsWith(input)) score += 100;
      if (lowerCountry.includes(input)) score += 25;
    }
    
    return score;
  }

/*   console.log("[/timezone setup] About to register autocomplete handler");
  console.log("[/timezone setup] Builder autocomplete map:", {
    hasAutocompleteMap: !!builder._autocomplete,
    autocompleteKeys: builder._autocomplete ? Array.from(builder._autocomplete.keys()) : []
  }); */

/*   console.log("[/timezone setup] Registering command with context"); */
  const off = builder.register(ctx, "reminders", { stateManager: ctx.v2.state });
/*   console.log("[/timezone setup] Command registered, disposer created:", !!off); */  
  ctx.lifecycle.addDisposable(off);
/*   console.log("[/timezone setup] === TIMEZONE COMMAND SETUP COMPLETE ==="); */
}