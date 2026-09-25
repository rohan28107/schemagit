const SchemaEngine = require('../src/engine/schemaEngine');
const { safeIdentifier } = require('../src/utils/sqlUtils');
const ConflictService = require('../src/services/ConflictService');

describe('SchemaGit Negative Tests', () => {

  describe('SQL Identifier Safety', () => {
    test('should properly escape backticks in identifiers to prevent injection', () => {
      const maliciousId = 'users`; DROP TABLE users; --';
      const quoted = safeIdentifier(maliciousId);

      // Expected: `users``; DROP TABLE users; --`
      expect(quoted).toBe('`users``; DROP TABLE users; --`');
    });

    test('should handle empty or null identifiers gracefully', () => {
      expect(safeIdentifier(null)).toBe('`unknown`');
      expect(safeIdentifier('')).toBe('`unknown`');
      expect(safeIdentifier(undefined)).toBe('`unknown`');
    });
  });

  describe('SchemaEngine Diff Edge Cases', () => {
    test('should not crash when diffing empty schemas', () => {
      const diff = SchemaEngine.diff({}, {});
      expect(diff).toEqual({
        tablesAdded: [],
        tablesDropped: [],
        columnsAdded: [],
        columnsDropped: [],
        columnsModified: [],
        columnsRenamed: [],
        indexesAdded: [],
        indexesDropped: [],
        constraintsAdded: [],
        constraintsDropped: [],
      });
    });

    test('should handle schemas with missing columns/tables in a robust way', () => {
      const oldSchema = { users: { columns: [] } };
      const newSchema = { users: { columns: [{ name: 'id', type: 'INT' }] } };

      expect(() => {
        SchemaEngine.diff(oldSchema, newSchema);
      }).not.toThrow();
    });
  });

  describe('ConflictService Robustness', () => {
    test('should handle null snapshots in detectConflicts', () => {
      expect(() => {
        ConflictService.detectConflicts(null, null, null);
      }).not.toThrow();

      const { conflicts } = ConflictService.detectConflicts(null, null, null);
      expect(conflicts).toEqual([]);
    });

    test('should detect conflict when one branch drops a table and another modifies it', () => {
      const base = { logs: { columns: [{ name: 'id', type: 'INT' }] } };
      const branchA = {}; // dropped
      const branchB = { logs: { columns: [{ name: 'id', type: 'INT' }, { name: 'msg', type: 'TEXT' }] } }; // modified

      const { conflicts } = ConflictService.detectConflicts(base, branchA, branchB);
      expect(conflicts).toContainEqual(
        expect.objectContaining({ type: 'TABLE_CONFLICT', table: 'logs' })
      );
    });

    test('should detect conflict when both branches modify the same column differently', () => {
      const base = { users: { columns: [{ name: 'username', type: 'TEXT' }] } };
      const branchA = { users: { columns: [{ name: 'username', type: 'INT' }] } };
      const branchB = { users: { columns: [{ name: 'username', type: 'VARCHAR' }] } };

      const { conflicts } = ConflictService.detectConflicts(base, branchA, branchB);
      expect(conflicts).toContainEqual(
        expect.objectContaining({ type: 'COLUMN_CONFLICT', column: 'username' })
      );
    });
  });
});
