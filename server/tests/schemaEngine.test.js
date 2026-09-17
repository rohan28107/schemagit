const SchemaEngine = require('../src/engine/schemaEngine');

describe('SchemaEngine', () => {
  const mockOldSchema = {
    users: {
      columns: [
        { name: 'id', type: 'INT', nullable: false, primaryKey: true },
        { name: 'username', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT', nullable: true },
      ]
    },
    projects: {
      columns: [
        { name: 'id', type: 'INT', nullable: false, primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false },
      ]
    }
  };

  describe('diff()', () => {
    test('should detect a new table', () => {
      const newSchema = {
        ...mockOldSchema,
        teams: {
          columns: [{ name: 'id', type: 'INT', nullable: false }]
        }
      };
      const diff = SchemaEngine.diff(mockOldSchema, newSchema);
      expect(diff.tablesAdded).toContain('teams');
    });

    test('should detect a dropped table', () => {
      const { projects, ...newSchema } = mockOldSchema;
      const diff = SchemaEngine.diff(mockOldSchema, newSchema);
      expect(diff.tablesDropped).toContain('projects');
    });

    test('should detect a new column in existing table', () => {
      const newSchema = {
        ...mockOldSchema,
        users: {
          columns: [
            ...mockOldSchema.users.columns,
            { name: 'phone', type: 'TEXT', nullable: true }
          ]
        }
      };
      const diff = SchemaEngine.diff(mockOldSchema, newSchema);
      expect(diff.columnsAdded).toContainEqual(
        expect.objectContaining({ table: 'users', column: expect.objectContaining({ name: 'phone' }) })
      );
    });

    test('should detect a dropped column', () => {
      const newSchema = {
        ...mockOldSchema,
        users: {
          columns: mockOldSchema.users.columns.filter(c => c.name !== 'email')
        }
      };
      const diff = SchemaEngine.diff(mockOldSchema, newSchema);
      expect(diff.columnsDropped).toContainEqual(
        expect.objectContaining({ table: 'users', column: 'email' })
      );
    });

    test('should detect a modified column type', () => {
      const newSchema = {
        ...mockOldSchema,
        users: {
          columns: mockOldSchema.users.columns.map(c =>
            c.name === 'username' ? { ...c, type: 'INT' } : c
          )
        }
      };
      const diff = SchemaEngine.diff(mockOldSchema, newSchema);
      expect(diff.columnsModified).toContainEqual(
        expect.objectContaining({ table: 'users', column: 'username' })
      );
    });

    test('should be case-insensitive for table and column names', () => {
      const newSchema = {
        USERS: {
          columns: [
            { name: 'ID', type: 'INT', nullable: false },
            { name: 'USERNAME', type: 'TEXT', nullable: false },
            { name: 'EMAIL', type: 'TEXT', nullable: true },
          ]
        },
        projects: mockOldSchema.projects
      };
      const diff = SchemaEngine.diff(mockOldSchema, newSchema);
      expect(diff.tablesAdded).toHaveLength(0);
      expect(diff.tablesDropped).toHaveLength(0);
      expect(diff.columnsAdded).toHaveLength(0);
    });
  });

  describe('generateMigrationPlan()', () => {
    test('should generate correct SQL for a new table', () => {
      const diff = {
        tablesAdded: ['teams'],
        tablesDropped: [],
        columnsAdded: [],
        columnsDropped: [],
        columnsModified: []
      };
      const fullSchema = {
        teams: {
          columns: [{ name: 'id', type: 'INT', nullable: false, primaryKey: true }]
        }
      };
      const plan = SchemaEngine.generateMigrationPlan(diff, fullSchema);
      expect(plan[0].sql).toContain('CREATE TABLE IF NOT EXISTS `teams`');
      expect(plan[0].columns).toBeDefined();
    });

    test('should generate correct SQL for adding a column', () => {
      const diff = {
        tablesAdded: [],
        tablesDropped: [],
        columnsAdded: [{ table: 'users', column: { name: 'age', type: 'INT', nullable: true } }],
        columnsDropped: [],
        columnsModified: []
      };
      const plan = SchemaEngine.generateMigrationPlan(diff);
      expect(plan[0].sql).toContain('ALTER TABLE `users` ADD COLUMN `age` INT');
    });

    test('should generate correct SQL for dropping a column', () => {
      const diff = {
        tablesAdded: [],
        tablesDropped: [],
        columnsAdded: [],
        columnsDropped: [{ table: 'users', column: 'email' }],
        columnsModified: []
      };
      const plan = SchemaEngine.generateMigrationPlan(diff);
      expect(plan[0].sql).toContain('ALTER TABLE `users` DROP COLUMN `email`');
    });
  });
});
