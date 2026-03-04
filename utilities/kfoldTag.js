/*
 * LOEO / KFOLD tag helper (standalone utility)
 *
 * PURPOSE
 * - Single source of truth for deriving the tag used in filenames/logs when event K-fold validation
 *   is run, with LOEO as default when EVENT_KFOLD_K is not explicitly set/valid.
 * - Tag format requirement: "LOEO" (default) or "KFOLD<k>" (e.g., KFOLD5).
 *
 * NOTE: Do NOT wire this into other files yet (per request). This file is a placeholder with
 *       detailed integration notes.
 *
 * IMPLEMENTATION IDEA (for when wiring in):
 * - Expose a function like `resolveKFoldTag(rawValue)` that returns an object:
 *     { tag: 'LOEO' | `KFOLD${k}`, mode: 'loeo'|'kfold', k: number|null, isKFold: boolean }
 * - `rawValue` should be the raw string from process.env.EVENT_KFOLD_K.
 * - If rawValue is missing, non-numeric, <=1, or >=eventCount (when eventCount is known),
 *   return LOEO. Otherwise return KFOLD<k>.
 * - Keep the utility pure (no file reads, no env reads) so it can be used by both runtime
 *   optimizer logic and post-processing scripts.
 *
 * ============================================================================
 * WHERE TO INSERT (ALL OTHER FILES IN modelOptimizer)
 * ============================================================================
 *
 * 1) core/optimizer.js
 *    A) LOG CONTEXT (internal log filename)
 *       - Current: logContext = `${runContext}${seedSuffix}${outputTagSuffix}`
 *       - Insert tag for POST-EVENT runs only:
 *         logContext = `${runContext}${seedSuffix}${kfoldTagSuffix}${outputTagSuffix}`
 *         where kfoldTagSuffix = `_${tag.toLowerCase()}` or `_${tag}` per naming decision.
 *       - This affects utilities/logging.js output filenames:
 *         `<event>_post_event_seed-a_LOEO_log.txt` (or KFOLD5)
 *
 *    B) RESULTS OUTPUT FILENAMES (post_event results)
 *       - Current: outputBaseName = `${baseName}${seedSuffix}${outputTagSuffix}`
 *       - Insert tag for POST-EVENT runs only:
 *         outputBaseName = `${baseName}${seedSuffix}${kfoldTagSuffix}${outputTagSuffix}`
 *       - Affects:
 *         - `${outputBaseName}_post_event_results.json`
 *         - `${outputBaseName}_post_event_results.txt`
 *
 *    C) “EVENT K-FOLD SETTINGS” block in results TXT
 *       - Current: EVENT_KFOLD_K prints raw env or LOEO (default)
 *       - Optionally replace the printed value with the resolved tag from utility
 *         to keep output consistent with filenames.
 *
 *    D) Seed summary cleanup guard
 *       - Current: if OUTPUT_TAG set, SKIP_SEED_CLEANUP is enabled.
 *       - Ensure LOEO/KFOLD tag does NOT force SKIP_SEED_CLEANUP unless desired.
 *         (No change needed unless you start injecting tag into OUTPUT_TAG.)
 *
 * 2) scripts/summarizeSeedResults.js
 *    A) Regex patterns used to find seed results/logs must accept BOTH tagged and untagged.
 *       - seedJsonRegex, seedResultRegex, seedLogRegex should match:
 *         `<base>_seed-<x>_LOEO_post_event_results.json`
 *         `<base>_seed-<x>_KFOLD5_post_event_results.json`
 *         and the existing untagged naming.
 *       - Build optional tag capture in the regex:
 *         `(?:_(LOEO|KFOLD\d+))?` inserted before `_post_event`.
 *
 *    B) Best-seed “keptFiles” list should include tagged variants:
 *       - Add candidate names with `_LOEO_` and `_KFOLD<k>_` between seed suffix and
 *         post_event/log suffix.
 *       - Keep backwards-compat names.
 *
 * 3) utilities/logging.js
 *    - No code change needed if logContext already includes tag suffix.
 *    - If you want log filenames to show LOEO/KFOLD in a specific position,
 *      ensure core/optimizer.js logContext is updated accordingly.
 *
 * 4) README.md (and any workflow docs)
 *    - Update example log/result filenames to show LOEO/KFOLD in post_event filenames
 *      if you want documentation to match.
 *    - Example: `american-express_seed-a_LOEO_post_event_results.json`
 *
 * 5) Any ad-hoc scripts that parse result filenames
 *    - Search for regex/filename parsing of `_post_event_results` patterns and update to accept
 *      optional `_(LOEO|KFOLD\d+)` between seed and post_event segment.
 *    - Known files today:
 *      - scripts/summarizeSeedResults.js (primary)
 *      - ARCHIVE/* (if still used operationally)
 *
 * ============================================================================
 * STANDALONE PLACEHOLDER IMPLEMENTATION (NOT WIRED YET)
 * ============================================================================
 *
 * Example implementation (commented out for now; enable when ready):
 *
 * function resolveKFoldTag(rawValue, options = {}) {
 *   const raw = String(rawValue || '').trim();
 *   const parsed = parseInt(raw, 10);
 *   const hasValid = Number.isFinite(parsed) && parsed > 1;
 *   if (!hasValid) {
 *     return { tag: 'LOEO', mode: 'loeo', k: null, isKFold: false };
 *   }
 *   return { tag: `KFOLD${parsed}`, mode: 'kfold', k: parsed, isKFold: true };
 * }
 *
 * module.exports = { resolveKFoldTag };
 */
