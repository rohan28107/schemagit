/**
 * Simple SQL Parser to extract schema from .sql dumps.
 * Focuses on CREATE TABLE and column definitions.
 */

class SQLParser {
  /**
   * Parses a SQL dump file and returns a structured schema representation.
   * @param {string} sql - The content of the .sql file.
   * @returns {Object} The parsed schema.
   */
  static parse(sql) {
    const schema = {};

    // Improved regex to handle different quoting and spacing
    // Matches: CREATE TABLE [IF NOT EXISTS] `table_name` ( ... ) [OPTIONS];
    // This version allows for table options (like ENGINE=InnoDB) before the semicolon.
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([\w\.]+)[`"']?\s*\(([\s\S]*?)\)[^;]*;/gi;
    let match;

    while ((match = tableRegex.exec(sql)) !== null) {
      const tableName = match[1];
      const columnBlock = match[2];

      schema[tableName] = {
        columns: this.parseColumns(columnBlock),
        indexes: this.parseIndexes(columnBlock),
        constraints: this.parseConstraints(columnBlock)
      };
    }

    return schema;
  }

  static parseColumns(block) {
    const columns = [];
    const lines = this.splitSqlBlock(block);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip table-level constraints
      if (/^(PRIMARY\s+KEY|KEY|CONSTRAINT|UNIQUE|CHECK)/i.test(trimmed)) continue;

      // Column regex: `column_name` TYPE ...
      // Handles both quoted and unquoted column names
      const colRegex = /^[`"']?([\w\.]+)[`"']?\s+([\w\(\),]+)(.*)$/i;
      const colMatch = trimmed.match(colRegex);

      if (colMatch) {
        const [_, name, type, rest] = colMatch;
        columns.push({
          name,
          type: type.toUpperCase(),
          nullable: !/NOT\s+NULL/i.test(rest),
          default: this.extractDefault(rest),
          autoIncrement: /AUTO_INCREMENT/i.test(rest),
          primaryKey: /PRIMARY\s+KEY/i.test(rest)
        });
      }
    }
    return columns;
  }

  static splitSqlBlock(block) {
    const result = [];
    let current = '';
    let depth = 0;

    for (let char of block) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && depth === 0) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  static parseIndexes(block) {
    const indexes = [];
    const lines = this.splitSqlBlock(block);

    for (const line of lines) {
      const trimmed = line.trim();
      const indexRegex = /^KEY\s+[`"']?([\w\.]+)[`"']?\s*\(([^)]+)\)/i;
      const indexMatch = trimmed.match(indexRegex);
      if (indexMatch) {
        indexes.push({
          name: indexMatch[1],
          columns: indexMatch[2].split(',').map(c => c.trim().replace(/[`"']/g, ''))
        });
      }
    }
    return indexes;
  }

  static parseConstraints(block) {
    const constraints = [];
    const lines = this.splitSqlBlock(block);

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^CONSTRAINT/i.test(trimmed)) {
        constraints.push(trimmed);
      }
    }
    return constraints;
  }

  static extractDefault(rest) {
    const defaultRegex = /DEFAULT\s+([^,\s]+)/i;
    const match = rest.match(defaultRegex);
    return match ? match[1] : null;
  }
}

module.exports = SQLParser;