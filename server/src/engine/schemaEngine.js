const SQLParser = require('./sqlParser');
const { safeIdentifier } = require('../utils/sqlUtils');

class SchemaEngine {
  // Tables used by the system for version control. Must NEVER be dropped or modified.
  static PROTECTED_TABLES = ['Project', 'Branch', 'Commit', 'SchemaSnapshot'];

  // Type normalization map to handle MySQL's internal type naming
  static TYPE_MAP = {
    'LONGTEXT': 'TEXT',
    'MEDIUMTEXT': 'TEXT',
    'TINYTEXT': 'TEXT',
    'VARCHAR': 'TEXT',
    'INT': 'INT',
    'INTEGER': 'INT',
    'BIGINT': 'INT',
    'SMALLINT': 'INT',
    'TINYINT': 'INT',
    'BOOLEAN': 'TINYINT',
    'BOOL': 'TINYINT',
  };

  static normalizeType(type) {
    if (!type) return 'TEXT';
    const upper = type.toUpperCase();
    // Handle types like "varchar(255)" or "int(11)"
    const baseType = upper.split('(')[0];
    const normalized = this.TYPE_MAP[baseType] || baseType;
    return normalized.toUpperCase();
  }

  /**
   * Generates a simple DDL string for visualization.
   */
  static generateDDL(diff, fullSchema = {}) {
    const sql = [];

    diff.tablesAdded.forEach(tableName => {
      const table = fullSchema ? fullSchema[tableName] : null;
      if (!table || !table.columns) {
        sql.push(`-- CREATE TABLE ${safeIdentifier(tableName)} (schema missing)`);
        return;
      }
      const colDefs = table.columns.map(col =>
        `  ${safeIdentifier(col.name)} ${col.type}${col.nullable ? '' : ' NOT NULL'}`
      );
      sql.push(`CREATE TABLE ${safeIdentifier(tableName)} (\n${colDefs.join(',\n')}\n);`);
    });

    diff.tablesDropped.forEach(table => sql.push(`DROP TABLE ${safeIdentifier(table)};`));

    diff.columnsAdded.forEach(({ table, column }) => {
      sql.push(`ALTER TABLE ${safeIdentifier(table)} ADD COLUMN ${safeIdentifier(column.name)} ${column.type};`);
    });

    diff.columnsDropped.forEach(({ table, column }) => {
      sql.push(`ALTER TABLE ${safeIdentifier(table)} DROP COLUMN ${safeIdentifier(column)};`);
    });

    diff.columnsModified.forEach(({ table, column, new: nc }) => {
      sql.push(`ALTER TABLE ${safeIdentifier(table)} MODIFY COLUMN ${safeIdentifier(column)} ${nc.type};`);
    });

    return sql.join('\n\n');
  }

  /**
   * Merges two schema snapshots into one.
   * Performs a union of tables and merges columns for common tables.
   * @returns {{ mergedSchema: Object, conflicts: Array }}
   */
  static merge(snapshotA, snapshotB) {
    const mergedSchema = {};
    const conflicts = [];
    const allTables = new Set([
      ...Object.keys(snapshotA || {}),
      ...Object.keys(snapshotB || {}),
    ]);

    for (const tableName of allTables) {
      const tableA = snapshotA?.[tableName];
      const tableB = snapshotB?.[tableName];

      if (!tableA) {
        mergedSchema[tableName] = tableB;
        continue;
      }
      if (!tableB) {
        mergedSchema[tableName] = tableA;
        continue;
      }

      // Merge columns for tables present in both snapshots
      const mergedColumns = [];
      const colA = tableA.columns || [];
      const colB = tableB.columns || [];

      const colANames = colA.map(c => c.name.toLowerCase());
      const colBNames = colB.map(c => c.name.toLowerCase());

      // Keep all columns from A
      mergedColumns.push(...colA);

      // Add columns from B that are not in A
      colB.forEach(cb => {
        const matchingA = colA.find(ca => ca.name.toLowerCase() === cb.name.toLowerCase());
        if (!matchingA) {
          mergedColumns.push(cb);
        } else {
          // Check for conflicts (type or nullability difference)
          if (this.normalizeType(matchingA.type) !== this.normalizeType(cb.type) || matchingA.nullable !== cb.nullable) {
            conflicts.push({
              type: 'COLUMN_CONFLICT',
              table: tableName,
              column: cb.name,
              oldValue: matchingA,
              newValue: cb,
              message: `Conflict in table \`${tableName}\` column \`${cb.name}\`: type or nullability differs.`
            });
          }
        }
      });

      mergedSchema[tableName] = {
        ...tableA,
        columns: mergedColumns,
      };
    }

    return { mergedSchema, conflicts };
  }

  /**
   * Fetches the current state of the database and converts it to a snapshot.
   * @param {Object} dbClient - A mysql2 connection or similar client that supports .execute() or .query()
   */
  static async getCurrentDbState(dbClient) {
    const [dbNameResult] = await dbClient.execute(`SELECT DATABASE() as db`);
    const currentDb = dbNameResult[0]?.db;

    if (!currentDb) {
      console.warn('[SchemaEngine] Warning: No default database selected. State detection may be inaccurate.');
    }

    console.log(`[SchemaEngine] Detecting state for database: ${currentDb || 'UNKNOWN'}`);

    const [tables] = await dbClient.execute(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'}`
    );

    const state = {};
    for (const tableRow of tables) {
      const tableName = tableRow.TABLE_NAME || tableRow.table_name;
      if (!tableName || this.PROTECTED_TABLES.includes(tableName)) continue;

      // Get primary key columns for this table
      const [pkRows] = await dbClient.execute(
        `SELECT column_name FROM information_schema.key_column_usage
         WHERE table_name = '${tableName}' AND table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'} AND constraint_name = 'PRIMARY'`
      );
      const primaryKeys = new Set((pkRows.map(r => r.COLUMN_NAME || r.column_name || '')).map(n => n.toLowerCase()));

      const [columns] = await dbClient.execute(
        `SELECT column_name as name, data_type as type, is_nullable as nullable, column_default as \`default\`, extra as extra
         FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'}`
      );

      // Fetch indexes for this table
      const [indexRows] = await dbClient.execute(
        `SELECT index_name, column_name, non_unique
         FROM information_schema.statistics
         WHERE table_name = '${tableName}' AND table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'}
         ORDER BY index_name, seq_in_index`
      );

      const indexes = [];
      const indexMap = {};
      indexRows.forEach(row => {
        const idxName = row.INDEX_NAME || row.index_name;
        const colName = row.COLUMN_NAME || row.column_name;
        if (!indexMap[idxName]) {
          indexMap[idxName] = { name: idxName, columns: [], unique: !(row.NON_UNIQUE || row.non_unique) };
        }
        indexMap[idxName].columns.push(colName);
      });
      Object.values(indexMap).forEach(idx => indexes.push(idx));

      // Fetch constraints
      const [constraintRows] = await dbClient.execute(
        `SELECT constraint_name, constraint_type
         FROM information_schema.table_constraints
         WHERE table_name = '${tableName}' AND table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'}`
      );
      const constraints = constraintRows.map(row => ({
        name: row.CONSTRAINT_NAME || row.constraint_name,
        type: row.CONSTRAINT_TYPE || row.constraint_type
      }));

      state[tableName] = {
        columns: columns.map(col => {
          const colName = col.name || '';
          const extra = col.extra || '';
          const isAi = extra.toLowerCase().includes('auto_increment');

          return {
            name: colName,
            type: col.type,
            nullable: col.nullable === 'YES',
            default: col.default,
            autoIncrement: isAi,
            primaryKey: primaryKeys.has(colName.toLowerCase())
          };
        }),
        indexes,
        constraints
      };
    }
    return state;
  }

  /**
   * Diffs two schema snapshots and returns the changes.
   * Now includes semantic rename detection for tables and columns.
   */
  static diff(oldSchema, newSchema) {
    const changes = {
      tablesAdded: [],
      tablesDropped: [],
      columnsAdded: [],
      columnsDropped: [],
      columnsModified: [],
      indexesAdded: [],
      indexesDropped: [],
      constraintsAdded: [],
      constraintsDropped: [],
      columnsRenamed: [],
    };

    const oldTables = Object.keys(oldSchema || {});
    const newTables = Object.keys(newSchema || {});

    const oldTablesLower = oldTables.map(t => t.toLowerCase());
    const newTablesLower = newTables.map(t => t.toLowerCase());

    // Calculate Added/Dropped
    changes.tablesAdded = newTables.filter(t =>
      !oldTablesLower.includes(t.toLowerCase())
    );
    changes.tablesDropped = oldTables.filter(t =>
      !newTablesLower.includes(t.toLowerCase())
    );

    const commonTables = oldTables.filter(t =>
      newTablesLower.includes(t.toLowerCase())
    );

    for (const table of commonTables) {
      const newTableName = newTables.find(t =>
        t.toLowerCase() === table.toLowerCase()
      );
      if (!newTableName) continue;

      const oldCols = oldSchema[table].columns || [];
      const newCols = newSchema[newTableName].columns || [];

      const oldColNames = oldCols.map(c => c.name.toLowerCase());
      const newColNames = newCols.map(c => c.name.toLowerCase());

      // --- Rename Detection ---
      const droppedCols = oldCols.filter(oc => !newColNames.includes(oc.name.toLowerCase()));
      const addedCols = newCols.filter(nc => !oldColNames.includes(nc.name.toLowerCase()));

      if (droppedCols.length === 1 && addedCols.length === 1) {
        const oc = droppedCols[0];
        const nc = addedCols[0];
        if (this.isColumnSemanticallyEqual(oc, nc)) {
          changes.columnsRenamed.push({
            table: newTableName,
            oldName: oc.name,
            newName: nc.name,
            column: nc
          });
        }
      }

      // Columns Added (excluding renames)
      newCols.forEach((nc) => {
        const isRenamed = changes.columnsRenamed.some(r => r.table === newTableName && r.newName === nc.name);
        if (!oldColNames.includes(nc.name.toLowerCase()) && !isRenamed) {
          changes.columnsAdded.push({ table: newTableName, column: nc });
        }
      });

      // Columns Dropped (excluding renames)
      oldCols.forEach((oc) => {
        const isRenamed = changes.columnsRenamed.some(r => r.table === newTableName && r.oldName === oc.name);
        if (!newColNames.includes(oc.name.toLowerCase()) && !isRenamed) {
          changes.columnsDropped.push({ table: newTableName, column: oc.name });
        }
      });

      newCols.forEach(nc => {
        const oc = oldCols.find(c => c.name.toLowerCase() === nc.name.toLowerCase());
        if (oc) {
          const typeMatch = this.normalizeType(oc.type) === this.normalizeType(nc.type);
          const nullMatch = oc.nullable === nc.nullable;

          // Special case for PKs: if it's a PK and the only difference is autoIncrement, ignore it to avoid TiDB 'Unsupported modify' error
          const aiMatch = oc.autoIncrement === nc.autoIncrement;
          const isPk = oc.primaryKey || nc.primaryKey;

          if (!typeMatch || (!isPk && !nullMatch) || (!aiMatch && !isPk)) {
            changes.columnsModified.push({
              table: newTableName,
              column: nc.name,
              old: oc,
              new: nc
            });
          }
        }
      });

      // Index Diffing
      const oldIndexes = oldSchema[table].indexes || [];
      const newIndexes = newSchema[newTableName].indexes || [];
      const oldIdxNames = oldIndexes.map(i => (i.name || '').toLowerCase());
      const newIdxNames = newIndexes.map(i => (i.name || '').toLowerCase());

      newIndexes.forEach(ni => {
        if (!oldIdxNames.includes(ni.name.toLowerCase())) {
          changes.indexesAdded.push({ table: newTableName, index: ni });
        }
      });
      oldIndexes.forEach(oi => {
        if (!newIdxNames.includes((oi.name || '').toLowerCase())) {
          changes.indexesDropped.push({ table: newTableName, index: oi.name });
        }
      });

      // Constraint Diffing
      const oldConstraints = oldSchema[table].constraints || [];
      const newConstraints = newSchema[newTableName].constraints || [];
      const oldConNames = oldConstraints.map(c => (c.name || '').toLowerCase());
      const newConNames = newConstraints.map(c => (c.name || '').toLowerCase());

      newConstraints.forEach(nc => {
        const conName = (nc.name || '').toLowerCase();
        if (!oldConNames.includes(conName)) {
          changes.constraintsAdded.push({ table: newTableName, constraint: nc });
        }
      });
      oldConstraints.forEach(oc => {
        if (!newConNames.includes((oc.name || '').toLowerCase())) {
          changes.constraintsDropped.push({ table: newTableName, constraint: oc.name });
        }
      });
    }

    return changes;
  }

  static isTableSemanticallyEqual(tableA, tableB) {
    if (!tableA || !tableB) return false;
    if (tableA.columns.length !== tableB.columns.length) return false;

    // Check if all columns in A have a semantic match in B
    return tableA.columns.every(colA =>
      tableB.columns.some(colB => this.isColumnSemanticallyEqual(colA, colB))
    );
  }

  static isColumnSemanticallyEqual(colA, colB) {
    if (!colA || !colB) return false;
    return (
      this.normalizeType(colA.type) === this.normalizeType(colB.type) &&
      colA.nullable === colB.nullable &&
      colA.autoIncrement === colB.autoIncrement
    );
  }


  /**
   * Verifies if the actual database state matches the target snapshot.
   * @param {Object} actualState - The state fetched from the real DB.
   * @param {Object} targetSnapshot - The expected state.
   * @returns {{ isVerified: boolean, diff: Object }}
   */
  static verify(actualState, targetSnapshot) {
    const diff = this.diff(actualState, targetSnapshot);

    // Verification succeeds if there are no differences
    const isVerified =
      diff.tablesAdded.length === 0 &&
      diff.tablesDropped.length === 0 &&
      diff.columnsAdded.length === 0 &&
      diff.columnsDropped.length === 0 &&
      diff.columnsModified.length === 0 &&
      diff.columnsRenamed.length === 0 &&
      diff.indexesAdded.length === 0 &&
      diff.indexesDropped.length === 0 &&
      diff.constraintsAdded.length === 0 &&
      diff.constraintsDropped.length === 0;

    return { isVerified, diff };
  }

  /**
   * Converts a schema snapshot back into a full SQL dump file.

   * @param {Object} snapshot - The schema snapshot to export.
   */
  static generateFullSchemaSQL(snapshot) {
    const sqlStatements = [];

    for (const [tableName, tableData] of Object.entries(snapshot)) {
      const colDefs = tableData.columns.map(col => {
        const nullSql = col.nullable ? '' : ' NOT NULL';
        const defaultSql = col.default ? ` DEFAULT ${col.default}` : '';
        const aiSql = col.autoIncrement ? ' AUTO_INCREMENT' : '';
        const pkSql = col.primaryKey ? ' PRIMARY KEY' : '';
        return `  ${safeIdentifier(col.name)} ${col.type}${nullSql}${defaultSql}${aiSql}${pkSql}`;
      });

      let createTableSql = `CREATE TABLE IF NOT EXISTS ${safeIdentifier(tableName)} (\n${colDefs.join(',\n')}\n);`;

      // Add Indexes
      if (tableData.indexes && tableData.indexes.length > 0) {
        tableData.indexes.forEach(idx => {
          const cols = idx.columns.map(c => safeIdentifier(c)).join(', ');
          createTableSql += `\nCREATE INDEX ${safeIdentifier(idx.name)} ON ${safeIdentifier(tableName)} (${cols});`;
        });
      }

      // Add Constraints
      if (tableData.constraints && tableData.constraints.length > 0) {
        tableData.constraints.forEach(constraint => {
          createTableSql += `\nALTER TABLE ${safeIdentifier(tableName)} ${constraint};`;
        });
      }

      sqlStatements.push(createTableSql);
    }

    return sqlStatements.join('\n\n');
  }

  /**
   * Generates a structured migration plan based on the diff.
   */
  static generateMigrationPlan(diff, fullSchema = {}) {
    const plan = [];

    // 1. Tables Dropped
    diff.tablesDropped.forEach(tableName => {
      if (!tableName || tableName === 'undefined' || this.PROTECTED_TABLES.includes(tableName)) return;
      plan.push({
        type: 'DROP_TABLE',
        table: tableName,
        sql: `DROP TABLE ${safeIdentifier(tableName)};`,
        risk: 'MEDIUM'
      });
    });

    // 2. Tables Added
    diff.tablesAdded.forEach(tableName => {
      if (!tableName || tableName === 'undefined') return;

      const table = fullSchema ? fullSchema[tableName] : null;
      if (!table || !table.columns) {
        plan.push({
          type: 'CREATE_TABLE',
          table: tableName,
          sql: `-- CREATE TABLE ${safeIdentifier(tableName)} (schema missing)`,
          risk: 'LOW'
        });
        return;
      }

      const colDefs = table.columns.map(col => {
        const nullSql = col.nullable ? '' : ' NOT NULL';
        const defaultSql = col.default ? ` DEFAULT ${col.default}` : '';
        const aiSql = col.autoIncrement ? ' AUTO_INCREMENT' : '';
        const pkSql = col.primaryKey ? ' PRIMARY KEY' : '';
        return `  ${safeIdentifier(col.name)} ${col.type}${nullSql}${defaultSql}${aiSql}${pkSql}`;
      });

      plan.push({
        type: 'CREATE_TABLE',
        table: tableName,
        columns: table.columns, // Include column metadata for fallback sync
        sql: `CREATE TABLE IF NOT EXISTS ${safeIdentifier(tableName)} (\n${colDefs.join(',\n')}\n);`,
        risk: 'LOW'
      });
    });

    // 3. Columns Renamed
    (diff.columnsRenamed || []).forEach(({ table, oldName, newName, column }) => {
      plan.push({
        type: 'RENAME_COLUMN',
        table,
        oldColumn: oldName,
        column: newName,
        sql: `ALTER TABLE ${safeIdentifier(table)} RENAME COLUMN ${safeIdentifier(oldName)} TO ${safeIdentifier(newName)};`,
        risk: 'LOW'
      });
    });

    // 4. Columns Added
    (diff.columnsAdded || []).forEach(({ table, column }) => {
      if (!table || !column) return;
      const nullSql = column.nullable ? '' : ' NOT NULL';
      const defaultSql = column.default ? ` DEFAULT ${column.default}` : '';
      plan.push({
        type: 'ADD_COLUMN',
        table,
        column: column.name,
        sql: `ALTER TABLE ${safeIdentifier(table)} ADD COLUMN ${safeIdentifier(column.name)} ${column.type} ${nullSql} ${defaultSql};`,
        risk: 'LOW'
      });
    });

    // 5. Columns Dropped
    (diff.columnsDropped || []).forEach(({ table, column }) => {
      if (!table || !column) return;
      plan.push({
        type: 'DROP_COLUMN',
        table,
        column,
        sql: `ALTER TABLE ${safeIdentifier(table)} DROP COLUMN ${safeIdentifier(column)};`,
        risk: 'LOW'
      });
    });

    // 6. Columns Modified
    (diff.columnsModified || []).forEach(({ table, column, new: nc }) => {
      if (!table || !column || !nc) return;
      const nullSql = nc.nullable ? '' : ' NOT NULL';
      const aiSql = nc.autoIncrement ? ' AUTO_INCREMENT' : '';
      plan.push({
        type: 'MODIFY_COLUMN',
        table,
        column,
        sql: `ALTER TABLE ${safeIdentifier(table)} MODIFY COLUMN ${safeIdentifier(column)} ${nc.type}${nullSql}${aiSql};`,
        risk: 'HIGH'
      });
    });

    // 7. Indexes Added
    (diff.indexesAdded || []).forEach(({ table, index }) => {
      const cols = index.columns.map(c => {
        const col = fullSchema?.[table]?.columns?.find(colDef => colDef.name === c);
        const isText = col && this.normalizeType(col.type) === 'TEXT';
        return isText ? `${safeIdentifier(c)}(191)` : safeIdentifier(c);
      }).join(', ');
      plan.push({
        type: 'ADD_INDEX',
        table,
        index: index.name,
        sql: `CREATE INDEX ${safeIdentifier(index.name)} ON ${safeIdentifier(table)} (${cols});`,
        risk: 'LOW'
      });
    });

    // 8. Indexes Dropped
    (diff.indexesDropped || []).forEach(({ table, index }) => {
      plan.push({
        type: 'DROP_INDEX',
        table,
        index,
        sql: `DROP INDEX ${safeIdentifier(index)} ON ${safeIdentifier(table)};`,
        risk: 'LOW'
      });
    });

    // 9. Constraints Added
    (diff.constraintsAdded || []).forEach(({ table, constraint }) => {
      plan.push({
        type: 'ADD_CONSTRAINT',
        table,
        constraint: constraint.name,
        sql: `ALTER TABLE ${safeIdentifier(table)} ${constraint};`,
        risk: 'LOW'
      });
    });

    // 10. Constraints Dropped
    (diff.constraintsDropped || []).forEach(({ table, constraint }) => {
      plan.push({
        type: 'DROP_CONSTRAINT',
        table,
        constraint,
        sql: `ALTER TABLE ${safeIdentifier(table)} DROP INDEX ${safeIdentifier(constraint)};`, // Simplified for MySQL/TiDB
        risk: 'LOW'
      });
    });

    return plan;
  }
}

module.exports = SchemaEngine;
