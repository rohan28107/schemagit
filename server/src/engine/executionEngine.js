const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ExecutionEngine {
  /**
   * Executes a structured migration plan.
   * @param {Array} plan - The migration plan from SchemaEngine.
   */
  static async executeMigrationPlan(plan) {
    const results = [];
    for (const step of plan) {
      console.log(`[Execution] Processing ${step.type} on ${step.table}...`);

      if (step.risk === 'HIGH') {
        const res = await this.runOSC(step);
        results.push({ step, status: 'SUCCESS', method: 'OSC', result: res });
      } else {
        const res = await this.runStandardDDL(step.sql);

        // FALLBACK: If CREATE_TABLE returned 0, the table already exists.
        // We must now synchronize its columns to ensure the schema matches.
        if (step.type === 'CREATE_TABLE' && res === 0 && step.columns) {
          console.log(`[Execution] Table \`${step.table}\` already exists. Synchronizing columns...`);
          const syncResults = await this.syncColumnsForExistingTable(step.table, step.columns);
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
   * This prevents the "result: 0" issue where CREATE TABLE IF NOT EXISTS does nothing.
   */
  static async syncColumnsForExistingTable(tableName, targetColumns) {
    const syncResults = [];

    // 1. Get actual current columns for this specific table
    const dbNameResult = await prisma.$queryRawUnsafe(`SELECT DATABASE() as db`);
    const currentDb = dbNameResult[0]?.db;

    const currentCols = await prisma.$queryRawUnsafe(
      `SELECT column_name as name
       FROM information_schema.columns
       WHERE table_name = '${tableName}' AND table_schema = ${currentDb ? `\'${currentDb}\'` : 'NULL'}`
    );

    const existingColNames = currentCols.map(c => c.name.toLowerCase());

    // 2. Add missing columns
    for (const col of targetColumns) {
      if (!existingColNames.includes(col.name.toLowerCase())) {
        console.log(`[Sync] Adding missing column \`${col.name}\` to \`${tableName}\`...`);
        const nullSql = col.nullable ? '' : ' NOT NULL';
        const defaultSql = col.default ? ` DEFAULT ${col.default}` : '';
        const sql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${col.name}\` ${col.type} ${nullSql} ${defaultSql};`;

        try {
          await prisma.$executeRawUnsafe(sql);
          syncResults.push({ column: col.name, action: 'ADDED' });
        } catch (e) {
          console.error(`[Sync] Failed to add column ${col.name}:`, e.message);
          syncResults.push({ column: col.name, action: 'FAILED', error: e.message });
        }
      }
    }

    // 3. Drop obsolete columns (The missing piece!)
    // We only drop columns that are present in the DB but NOT in our target schema
    const targetColNames = targetColumns.map(c => c.name.toLowerCase());
    for (const existingCol of currentCols) {
      const colName = existingCol.name;
      if (!targetColNames.includes(colName.toLowerCase())) {
        console.log(`[Sync] Dropping obsolete column \`${colName}\` from \`${tableName}\`...`);
        const sql = `ALTER TABLE \`${tableName}\` DROP COLUMN \`${colName}\`;`;

        try {
          await prisma.$executeRawUnsafe(sql);
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
   * For a real production app, this would use a tool like gh-ost or pt-osc.
   */
  static async runOSC(step) {
    const { table, sql } = step;
    console.log(`[OSC] Starting Online Schema Change for ${table} to avoid locks...`);

    // 1. Create Shadow Table
    const shadowTableName = `${table}_shadow`;
    console.log(`[OSC] Creating shadow table ${shadowTableName}...`);

    // Corrected: Use a more reliable way to clone table structure
    await prisma.$executeRawUnsafe(`CREATE TABLE \`${shadowTableName}\` LIKE \`${table}\`;`);

    // Apply the change to the shadow table
    // Ensure we target the shadow table in the SQL statement
    const shadowSql = sql.replace(new RegExp(`\`${table}\``, 'g'), `\`${shadowTableName}\``);
    await prisma.$executeRawUnsafe(shadowSql);

    // 2. Chunked Data Copy
    console.log(`[OSC] Copying data in chunks...`);
    let offset = 0;
    const CHUNK_SIZE = 1000;
    let totalCopied = 0;

    while (true) {
      const count = await prisma.$executeRawUnsafe(
        `INSERT INTO \`${shadowTableName}\` SELECT * FROM \`${table}\` LIMIT ${CHUNK_SIZE} OFFSET ${offset}`
      );

      if (count === 0) break;

      totalCopied += count;
      offset += CHUNK_SIZE;
      console.log(`[OSC] Copied ${totalCopied} rows...`);

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 3. Atomic Swap
    console.log(`[OSC] Swapping tables...`);
    await prisma.$executeRawUnsafe(`RENAME TABLE \`${table}\` TO \`${table}_old\`, \`${shadowTableName}\` TO \`${table}\`;`);

    // 4. Cleanup
    await prisma.$executeRawUnsafe(`DROP TABLE \`${table}_old\`;`);

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

  static async runStandardDDL(sql) {
    console.log(`[SQL Execution] Running: ${sql}`);
    return prisma.$executeRawUnsafe(sql);
  }
}

module.exports = ExecutionEngine;