const mysql = require('mysql2/promise');

class ConnectionManager {
  static async getConnection(connectionString) {
    if (!connectionString) {
      throw new Error('Connection string is required to connect to a target database.');
    }

    try {
      const url = new URL(connectionString);
      const dbName = url.pathname.substring(1); // Remove leading '/'
      const baseUri = `${url.protocol}//${url.username}:${url.password}@${url.hostname}:${url.port}`;

      // 1. Connect to the server without specifying a DB first
      const connection = await mysql.createConnection({
        uri: baseUri,
        ssl: {
          rejectUnauthorized: true
        }
      });

      // 2. Ensure the database exists
      if (dbName) {
        await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        await connection.execute(`USE \`${dbName}\`;`);
      }

      return connection;
    } catch (error) {
      console.error('[ConnectionManager] Failed to create connection:', error.message);
      throw error;
    }
  }


  static async closeConnection(connection) {
    if (connection) {
      await connection.end();
    }
  }
}

module.exports = ConnectionManager;
