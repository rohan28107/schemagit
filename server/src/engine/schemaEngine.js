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
    'BIGINT': 'INT',
    'SMALLINT': 'INT',
    'TINYINT': 'INT',
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
   * Fetches the current state of the database and converts it to a snapshot.
   * @param {PrismaClient} prisma
   */
  static async getCurrentDbState(prisma) {
    const dbNameResult = await prisma.$queryRawUnsafe(`SELECT DATABASE() as db`);
    const currentDb = dbNameResult[0]?.db;

    if (!currentDb) {
      console.warn('[SchemaEngine] Warning: No default database selected. State detection may be inaccurate.');
    }

    console.log(`[SchemaEngine] Detecting state for database: ${currentDb || 'UNKNOWN'}`);

    const tables = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'}`
    );

    const state = {};
    for (const tableRow of tables) {
      const tableName = tableRow.table_name;
      if (this.PROTECTED_TABLES.includes(tableName)) continue;

      const columns = await prisma.$queryRawUnsafe(
        `SELECT column_name as name, data_type as type, is_nullable as nullable, column_default as \`default\`, extra as extra
         FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = '${currentDb}'`
      );

      state[tableName] = {
        columns: columns.map(col => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable === 'YES',
          default: col.default,
          autoIncrement: col.extra?.includes('auto_increment'),
          primaryKey: false
        }))
      };
    }
    return state;
  }

  /**
   * Diffs two schema snapshots and returns the changes.
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

    // Case-insensitive comparison for table names to handle OS differences
    const oldTablesLower = oldTables.map(t => t.toLowerCase());
    const newTablesLower = newTables.map(t => t.toLowerCase());

    changes.tablesAdded = newTables.filter(t => !oldTablesLower.includes(t.toLowerCase()));
    changes.tablesDropped = oldTables.filter(t => !newTablesLower.includes(t.toLowerCase()));

    const commonTables = oldTables.filter(t => newTablesLower.includes(t.toLowerCase()));
    for (const table of commonTables) {
      // Find the matching table in newSchema (handling case differences)
      const newTableName = newTables.find(t => t.toLowerCase() === table.toLowerCase());
      const oldCols = oldSchema[table].columns || [];
      const newCols = newSchema[newTableName].columns || [];

      const oldColNames = oldCols.map(c => c.name.toLowerCase());
      const newColNames = newCols.map(c => c.name.toLowerCase());

      newCols.forEach(nc => {
        if (!oldColNames.includes(nc.name.toLowerCase())) {
          changes.columnsAdded.push({ table: newTableName, column: nc });
        }
      });

      oldCols.forEach(oc => {
        if (!newColNames.includes(oc.name.toLowerCase())) {
          changes.columnsDropped.push({ table: newTableName, column: oc.name });
        }
      });

      newCols.forEach(nc => {
        const oc = oldCols.find(c => c.name.toLowerCase() === nc.name.toLowerCase());
        if (oc && (this.normalizeType(oc.type) !== this.normalizeType(nc.type) || oc.nullable !== nc.nullable)) {
          changes.columnsModified.push({
            table: newTableName,
            column: nc.name,
            old: oc,
            new: nc
          });
        }
      });
    }

    return changes;
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
      plan.push({
        type: 'MODIFY_COLUMN',
        table,
        column,
        sql: `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${nc.type} ${nullSql};`,
        risk: 'HIGH'
      });
    });

    return plan;
  }
}

module.exports = SchemaEngine;
