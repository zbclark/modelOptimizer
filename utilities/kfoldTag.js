/*
 * LOEO / KFOLD tag helper (standalone utility)
 *
 * PURPOSE
 * - Single source of truth for deriving the tag used in filenames/logs when event K-fold validation
 *   is run, with LOEO as default when EVENT_KFOLD_K is not explicitly set/valid.
 * - Tag format requirement: "LOEO" (default) or "KFOLD<k>" (e.g., KFOLD5).
 *
 * ============================================================================
 * STANDALONE PLACEHOLDER IMPLEMENTATION
 * ============================================================================
 */

function resolveKFoldTag(rawValue) {
	const raw = String(rawValue || '').trim();
	const parsed = parseInt(raw, 10);
	const hasValid = Number.isFinite(parsed) && parsed > 1;
	if (!hasValid) {
		return { tag: 'LOEO', mode: 'loeo', k: null, isKFold: false };
	}
	return { tag: `KFOLD${parsed}`, mode: 'kfold', k: parsed, isKFold: true };
}

module.exports = { resolveKFoldTag };
