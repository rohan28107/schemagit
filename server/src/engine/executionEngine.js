const mysql = require('mysql2/promise');

class ExecutionEngine {
  /**
   * Executes a structured migration plan.
   * @param {Array} plan - The migration plan from SchemaEngine.
   * @param {Object} dbClient - A mysql2 connection.
   */
  static async executeMigrationPlan(plan, dbClient) {
    const results = [];

    try {
      await dbClient.execute(`SET tidb_allow_remove_auto_inc = 1;`);
    } catch (e) {
      console.warn(`[Execution] Could not set tidb_allow_remove_auto_inc: ${e.message}`);
    }

    for (const step of plan) {
      console.log(`[Execution] Processing ${step.type} on ${step.table}...`);

      if (step.type === 'RENAME_TABLE') {
        const res = await this.runStandardDDL(step.sql, dbClient);
        results.push({ step, status: 'SUCCESS', method: 'STANDARD', result: res });
        continue;
      }

      if (step.risk === 'HIGH') {
        const res = await this.runOSC(step, dbClient);
        results.push({ step, status: 'SUCCESS', method: 'OSC', result: res });
      } else {
        let res;
        try {
          res = await this.runStandardDDL(step.sql, dbClient);
        } catch (e) {
          if (step.type === 'CREATE_TABLE' && (e.message.includes('already exists') || e.errno === 1050)) {
            console.log(`[Execution] Table \`${step.table}\` already exists (caught error). Synchronizing columns...`);
            const syncResults = await this.syncColumnsForExistingTable(step.table, step.columns, dbClient);
            results.push({
              step,
              status: 'SUCCESS',
              method: 'STANDARD_WITH_SYNC',
              result: null,
              syncDetails: syncResults
            });
            continue;
          }
          throw e;
        }

        if (step.type === 'CREATE_TABLE' && res[0] && res[0].affectedRows === 0 && step.columns) {
          console.log(`[Execution] Table \`${step.table}\` already exists. Synchronizing columns...`);
          const syncResults = await this.syncColumnsForExistingTable(step.table, step.columns, dbClient);
          results.push({
            step,
            status: 'SUCCESS',
            method: 'STANDARD_WITH_SYNC',
            result: res,
            syncDetails: syncResults
          });
          continue;
        }

        results.push({ step, status: 'SUCCESS', method: 'STANDARD', result: res });
      }
    }

    return results;
  }

  /**
   * Ensures an existing table has all the columns defined in the target schema.
   */
  static async syncColumnsForExistingTable(tableName, targetColumns, dbClient) {
    const syncResults = [];

    const [dbNameResult] = await dbClient.execute(`SELECT DATABASE() as db`);
    const currentDb = dbNameResult[0]?.db;

    const [currentCols] = await dbClient.execute(
      `SELECT column_name as name
       FROM information_schema.columns
       WHERE table_name = '${tableName}' AND table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'}`
    );

    const existingColNames = currentCols.map(c => (c.COLUMN_NAME || c.name || '').toLowerCase());

    for (const col of targetColumns) {
      if (!existingColNames.includes(col.name.toLowerCase())) {
        console.log(`[Sync] Adding missing column \`${col.name}\` to \`${tableName}\`...`);
        const nullSql = col.nullable ? '' : ' NOT NULL';
        const defaultSql = col.default ? ` DEFAULT ${col.default}` : '';
        const sql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${col.name}\` ${col.type} ${nullSql} ${defaultSql};`;

        try {
          await dbClient.execute(sql);
          syncResults.push({ column: col.name, action: 'ADDED' });
        } catch (e) {
          console.error(`[Sync] Failed to add column ${col.name}:`, e.message);
          syncResults.push({ column: col.name, action: 'FAILED', error: e.message });
        }
      }
    }

    const targetColNames = targetColumns.map(c => c.name.toLowerCase());
    for (const existingCol of currentCols) {
      const colName = existingCol.COLUMN_NAME || existingCol.name;
      if (colName && !targetColNames.includes(colName.toLowerCase())) {
        console.log(`[Sync] Dropping obsolete column \`${colName}\` from \`${tableName}\`...`);
        const sql = `ALTER TABLE \`${tableName}\` DROP COLUMN \`${colName}\`;`;
;

        try {
          await dbClient.execute(sql);
          syncResults.push({ column: colName, action: 'DROPPED' });
        } catch (e) {
          console.error(`[Sync] Failed to drop column ${colName}:`, e.message);
          syncResults.push({ column: colName, action: 'DROP_FAILED', error: e.message });
        }
      }
    }

    return syncResults;
  }

  /**
   * Implements a simulated Online Schema Change (OSC) pattern for large tables.
   * Optimized for large tables by avoiding OFFSET.
   */
  static async runOSC(step, dbClient) {
    const { table, sql } = step;
    console.log(`[OSC] Starting Online Schema Change for ${table} to avoid locks...`);

    const shadowTableName = `${table}_shadow`;
    console.log(`[OSC] Creating shadow table ${shadowTableName}...`);

    await dbClient.execute(`CREATE TABLE \`${shadowTableName}\` LIKE \`${table}\`;`);

    const shadowSql = sql.replace(new RegExp(`\`${table}\``, 'g'), `\`${shadowTableName}\``);
    await dbClient.execute(shadowSql);

    console.log(`[OSC] Copying data in chunks using PK range...`);

    const [pkResult] = await dbClient.execute(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = '${table}' AND column_key = 'PRI' LIMIT 1`
    );
    const pkColumn = pkResult[0]?.COLUMN_NAME || 'id';
    console.log(`[OSC] Using primary key \`${pkColumn}\` for chunking`);

    let lastId = null;
    const CHUNK_SIZE = 5000;
    let totalCopied = 0;

    while (true) {
      const query = lastId
        ? `INSERT INTO \`${shadowTableName}\` SELECT * FROM \`${table}\` WHERE \`${pkColumn}\` > ${lastId} ORDER BY \`${pkColumn}\` ASC LIMIT ${CHUNK_SIZE}`
        : `INSERT INTO \`${shadowTableName}\` SELECT * FROM \`${table}\` ORDER BY \`${pkColumn}\` ASC LIMIT ${CHUNK_SIZE}`;

      const [result] = await dbClient.execute(query);
      const count = result.affectedRows;

      if (count === 0) break;

      totalCopied += count;

      const [lastIdResult] = await dbClient.execute(
        `SELECT \`${pkColumn}\` FROM \`${shadowTableName}\` ORDER BY \`${pkColumn}\` DESC LIMIT 1`
      );
      lastId = lastIdResult[0] ? lastIdResult[0][pkColumn] : null;

      console.log(`[OSC] Copied ${totalCopied} rows...`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log(`[OSC] Swapping tables...`);
    await dbClient.execute(`RENAME TABLE \`${table}\` TO \`${table}_old\`, \`${shadowTableName}\` TO \`${table}\`;`);

    console.log(`[OSC] Cleaning up...`);
    await dbClient.execute(`DROP TABLE \`${table}_old\`;`);

    return { rowsCopied: totalCopied };
  }

  static async getTableInfo(tableName) {
    // Query INFORMATION_SCHEMA to get data length
    const result = await prisma.$queryRawUnsafe(
      `SELECT data_length FROM information_schema.tables WHERE table_name = '${tableName}' AND table_schema = DATABASE()`
    );
    return result[0] || { data_length: 0 };
  }

  static isInstantDDL(sql) {
    // MySQL 8.0 Instant DDL supports:
    // - Adding a column at the end of the table
    // - Dropping the last column
    // - Renaming a column
    return /ADD COLUMN.*$/i.test(sql) || /DROP COLUMN.*$/i.test(sql) || /RENAME COLUMN/i.test(sql);
  }

  static async runInstantDDL(sql) {
    const instantSql = `${sql} ALGORITHM=INSTANT;`;
    return prisma.$executeRawUnsafe(instantSql);
  }

  static async runStandardDDL(sql, dbClient) {
    console.log(`[SQL Execution] Running: ${sql}`);
    return dbClient.execute(sql);
  }
}

module.exports = ExecutionEngine;