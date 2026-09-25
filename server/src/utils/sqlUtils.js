/**
 * Central utility for SQL identifier safety.
 * Ensures all table, column, and index names are properly quoted and escaped
 * for MySQL/TiDB compatibility to prevent SQL injection.
 */

const safeIdentifier = (id) => {
  if (!id) return '`unknown`';
  // Escape backticks by doubling them
  const escaped = id.replace(/`/g, '``');
  return `\`${escaped}\``;
};

module.exports = {
  safeIdentifier,
};
