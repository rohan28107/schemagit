const SchemaEngine = require('../engine/schemaEngine');
const fs = require("fs");

class ConflictService {
  /**
   * Detects conflicts between two branches by comparing them against a common ancestor.
   * @param {Object} baseSnapshot - The snapshot of the common ancestor.
   * @param {Object} snapshotA - The snapshot of the source branch.
   * @param {Object} snapshotB - The snapshot of the target branch.
   * @returns {{ mergedSchema: Object, conflicts: Array }}
   */
  static detectConflicts(baseSnapshot, snapshotA, snapshotB) {
    const mergedSchema = {};
    const conflicts = [];

    const allTables = new Set([
      ...Object.keys(baseSnapshot || {}),
      ...Object.keys(snapshotA || {}),
      ...Object.keys(snapshotB || {}),
    ]);

    for (const tableName of allTables) {
      const tableBase = baseSnapshot?.[tableName];
      const tableA = snapshotA?.[tableName];
      const tableB = snapshotB?.[tableName];

      // 1. Table-level changes
      if (!tableBase) {
        // Table added in A or B
        if (tableA && tableB) {
          // Both added the same table name - check if structures are identical
          if (JSON.stringify(tableA) !== JSON.stringify(tableB)) {
            conflicts.push({
              type: 'TABLE_CONFLICT',
              table: tableName,
              message: `Table \`${tableName}\` was created in both branches with different structures.`,
              valueA: tableA,
              valueB: tableB,
            });
            // We omit it from mergedSchema to force resolution
          } else {
            mergedSchema[tableName] = tableA;
          }
        } else {
          // Only one branch added it - clean merge
          mergedSchema[tableName] = tableA || tableB;
        }
        continue;
      }

      if (!tableA) {
        // Table dropped in A
        if (tableB && JSON.stringify(tableB) !== JSON.stringify(tableBase)) {
          conflicts.push({
            type: 'TABLE_CONFLICT',
            table: tableName,
            message: `Table \`${tableName}\` was dropped in Branch A but modified in Branch B.`,
            valueA: null,
            valueB: tableB,
          });
        } else {
          // Dropped in A, untouched in B -> Drop it
          continue;
        }
        continue;
      }

      if (!tableB) {
        // Table dropped in B
        if (tableA && JSON.stringify(tableA) !== JSON.stringify(tableBase)) {
          conflicts.push({
            type: 'TABLE_CONFLICT',
            table: tableName,
            message: `Table \`${tableName}\` was modified in Branch A but dropped in Branch B.`,
            valueA: tableA,
            valueB: null,
          });
        } else {
          // Dropped in B, untouched in A -> Drop it
          continue;
        }
        continue;
      }

      // 2. Column-level changes (Three-Way Merge)
      const mergedColumns = [];
      const colsBase = tableBase.columns || [];
      const colsA = tableA.columns || [];
      const colsB = tableB.columns || [];

      const allColNames = new Set([
        ...colsBase.map(c => c.name.toLowerCase()),
        ...colsA.map(c => c.name.toLowerCase()),
        ...colsB.map(c => c.name.toLowerCase()),
      ]);

      for (const colNameLower of allColNames) {
        const cBase = colsBase.find(c => c.name.toLowerCase() === colNameLower);
        const cA = colsA.find(c => c.name.toLowerCase() === colNameLower);
        const cB = colsB.find(c => c.name.toLowerCase() === colNameLower);

        const isAChanged = !cBase || !cA || JSON.stringify(cBase) !== JSON.stringify(cA);
        const isBChanged = !cBase || !cB || JSON.stringify(cBase) !== JSON.stringify(cB);

        if (!isAChanged && !isBChanged) {
          if (cA) mergedColumns.push(cA);
        } else if (!isAChanged && isBChanged) {
          if (cB) mergedColumns.push(cB);
        } else if (isAChanged && !isBChanged) {
          if (cA) mergedColumns.push(cA);
        } else {
          // Both changed - check if they changed to the same thing
          if (cA && cB && SchemaEngine.isColumnSemanticallyEqual(cA, cB)) {
             mergedColumns.push(cA);
          } else {
            // Actual conflict
            if (cA && cB) {
              conflicts.push({
                type: 'COLUMN_CONFLICT',
                table: tableName,
                column: colNameLower,
                message: `Conflict in \`${tableName}\`.\`${colNameLower}\`: both branches modified this column.`,
                valueA: cA,
                valueB: cB,
                baseValue: cBase,
              });
              mergedColumns.push(cA);
            } else {
              conflicts.push({
                type: 'COLUMN_CONFLICT',
                table: tableName,
                column: colNameLower,
                message: `Conflict in \`${tableName}\`.\`${colNameLower}\`: one branch modified/added it, the other dropped it.`,
                valueA: cA,
                valueB: cB,
                baseValue: cBase,
              });
              if (cA) mergedColumns.push(cA);
            }
          }
        }
      }

      mergedSchema[tableName] = {
        ...tableA,
        columns: mergedColumns,
      };
    }

    return { mergedSchema, conflicts };
  }
}

module.exports = ConflictService;
