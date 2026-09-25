const SQLParser = require('./sqlParser');

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
    return this.TYPE_MAP[baseType] || baseType;
  }

  /**
   * Generates a simple DDL string for visualization.
   */
  static generateDDL(diff, fullSchema = {}) {
    const sql = [];

    diff.tablesAdded.forEach(tableName => {
      const table = fullSchema ? fullSchema[tableName] : null;
      if (!table || !table.columns) {
        sql.push(`-- CREATE TABLE ${tableName} (schema missing)`);
        return;
      }
      const colDefs = table.columns.map(col =>
        `  \`${col.name}\` ${col.type}${col.nullable ? '' : ' NOT NULL'}`
      );
      sql.push(`CREATE TABLE \`${tableName}\` (\n${colDefs.join(',\n')}\n);`);
    });

    diff.tablesDropped.forEach(table => sql.push(`DROP TABLE \`${table}\`;`));

    diff.columnsAdded.forEach(({ table, column }) => {
      sql.push(`ALTER TABLE \`${table}\` ADD COLUMN \`${column.name}\` ${column.type};`);
    });

    diff.columnsDropped.forEach(({ table, column }) => {
      sql.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`);
    });

    diff.columnsModified.forEach(({ table, column, new: nc }) => {
      sql.push(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${nc.type};`);
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
         WHERE table_name = '${tableName}' AND table_schema = '${currentDb}' AND constraint_name = 'PRIMARY'`
      );
      const primaryKeys = new Set((pkRows.map(r => r.COLUMN_NAME || r.column_name || '')).map(n => n.toLowerCase()));

      const [columns] = await dbClient.execute(
        `SELECT column_name as name, data_type as type, is_nullable as nullable, column_default as \`default\`, extra as extra
         FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = '${currentDb}'`
      );

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
        })
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

      newCols.forEach((nc, idx) => {
        if (!oldColNames.includes(nc.name.toLowerCase())) {
          changes.columnsAdded.push({ table: newTableName, column: nc });
        }
      });

      oldCols.forEach((oc, idx) => {
        if (!newColNames.includes(oc.name.toLowerCase())) {
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
      diff.columnsModified.length === 0;

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
        return `  \`${col.name}\` ${col.type}${nullSql}${defaultSql}${aiSql}${pkSql}`;
      });

      let createTableSql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n${colDefs.join(',\n')}\n);`;

      // Add Indexes
      if (tableData.indexes && tableData.indexes.length > 0) {
        tableData.indexes.forEach(idx => {
          const cols = idx.columns.map(c => `\`${c}\``).join(', ');
          createTableSql += `\nCREATE INDEX \`${idx.name}\` ON \`${tableName}\` (${cols});`;
        });
      }

      // Add Constraints
      if (tableData.constraints && tableData.constraints.length > 0) {
        tableData.constraints.forEach(constraint => {
          createTableSql += `\nALTER TABLE \`${tableName}\` ${constraint};`;
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
        sql: `DROP TABLE \`${tableName}\`;`,
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
          sql: `-- CREATE TABLE ${tableName} (schema missing)`,
          risk: 'LOW'
        });
        return;
      }

      const colDefs = table.columns.map(col => {
        const nullSql = col.nullable ? '' : ' NOT NULL';
        const defaultSql = col.default ? ` DEFAULT ${col.default}` : '';
        const aiSql = col.autoIncrement ? ' AUTO_INCREMENT' : '';
        const pkSql = col.primaryKey ? ' PRIMARY KEY' : '';
        return `  \`${col.name}\` ${col.type}${nullSql}${defaultSql}${aiSql}${pkSql}`;
      });

      plan.push({
        type: 'CREATE_TABLE',
        table: tableName,
        columns: table.columns, // Include column metadata for fallback sync
        sql: `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n${colDefs.join(',\n')}\n);`,
        risk: 'LOW'
      });
    });

    // 3. Columns Added
    diff.columnsAdded.forEach(({ table, column }) => {
      if (!table || !column) return;
      const nullSql = column.nullable ? '' : ' NOT NULL';
      const defaultSql = column.default ? ` DEFAULT ${column.default}` : '';
      plan.push({
        type: 'ADD_COLUMN',
        table,
        column: column.name,
        sql: `ALTER TABLE \`${table}\` ADD COLUMN \`${column.name}\` ${column.type} ${nullSql} ${defaultSql};`,
        risk: 'LOW'
      });
    });

    // 4. Columns Dropped
    diff.columnsDropped.forEach(({ table, column }) => {
      if (!table || !column) return;
      plan.push({
        type: 'DROP_COLUMN',
        table,
        column,
        sql: `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`,
        risk: 'LOW'
      });
    });

    // 5. Columns Modified
    diff.columnsModified.forEach(({ table, column, new: nc }) => {
      if (!table || !column || !nc) return;
      const nullSql = nc.nullable ? '' : ' NOT NULL';
      const aiSql = nc.autoIncrement ? ' AUTO_INCREMENT' : '';
      plan.push({
        type: 'MODIFY_COLUMN',
        table,
        column,
        sql: `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${nc.type}${nullSql}${aiSql};`,
        risk: 'HIGH'
      });
    });

    return plan;
  }
}

module.exports = SchemaEngine;
