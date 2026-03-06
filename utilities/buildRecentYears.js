/**
 * Module: buildRecentYears
 * Purpose: Build recent-year lists and cutoffs for historical scopes.
 */
module.exports = function buildRecentYears(season, yearCount = 5) {
  const baseYear = season || new Date().getFullYear();
  return Array.from({ length: yearCount }, (_, idx) => baseYear - idx);
};
