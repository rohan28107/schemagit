const SchemaEngine = require('../src/engine/schemaEngine');
const ConflictService = require('../src/services/ConflictService');

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

  describe('ConflictService Edge Cases', () => {
    test('should detect a TABLE_CONFLICT when both branches create same table with different structures', () => {
      const base = {};
      const branchA = {
        logs: { columns: [{ name: 'id', type: 'INT', nullable: false }] }
      };
      const branchB = {
        logs: { columns: [{ name: 'id', type: 'INT', nullable: false, primaryKey: true }] }
      };

      const { conflicts } = ConflictService.detectConflicts(base, branchA, branchB);
      expect(conflicts).toContainEqual(
        expect.objectContaining({ type: 'TABLE_CONFLICT', table: 'logs' })
      );
    });

    test('should detect a COLUMN_CONFLICT when both branches modify same column differently', () => {
      const base = {
        users: { columns: [{ name: 'username', type: 'TEXT', nullable: false }] }
      };
      const branchA = {
        users: { columns: [{ name: 'username', type: 'INT', nullable: false }] }
      };
      const branchB = {
        users: { columns: [{ name: 'username', type: 'VARCHAR', nullable: false }] }
      };

      const { conflicts } = ConflictService.detectConflicts(base, branchA, branchB);
      expect(conflicts).toContainEqual(
        expect.objectContaining({ type: 'COLUMN_CONFLICT', column: 'username' })
      );
    });
  });
});

  describe('Advanced Diffing & Planning', () => {
    test('should detect a column rename when types match and only one col is added/dropped', () => {
      const oldSchema = {
        users: {
          columns: [
            { name: 'id', type: 'INT', nullable: false, primaryKey: true },
            { name: 'username', type: 'TEXT', nullable: false },
          ]
        }
      };
      const newSchema = {
        users: {
          columns: [
            { name: 'id', type: 'INT', nullable: false, primaryKey: true },
            { name: 'login', type: 'TEXT', nullable: false },
          ]
        }
      };
      const diff = SchemaEngine.diff(oldSchema, newSchema);
      expect(diff.columnsRenamed).toContainEqual(
        expect.objectContaining({ table: 'users', oldName: 'username', newName: 'login' })
      );
      expect(diff.columnsAdded).toHaveLength(0);
      expect(diff.columnsDropped).toHaveLength(0);
    });

    test('should generate RENAME COLUMN SQL in migration plan', () => {
      const diff = {
        tablesAdded: [], tablesDropped: [], columnsAdded: [], columnsDropped: [], columnsModified: [],
        columnsRenamed: [{ table: 'users', oldName: 'username', newName: 'login', column: { name: 'login', type: 'TEXT', nullable: false } }],
        indexesAdded: [], indexesDropped: [], constraintsAdded: [], constraintsDropped: []
      };
      const plan = SchemaEngine.generateMigrationPlan(diff);
      expect(plan[0].type).toBe('RENAME_COLUMN');
      expect(plan[0].sql).toContain('ALTER TABLE `users` RENAME COLUMN `username` TO `login`');
    });

    test('should detect and plan for index changes', () => {
      const oldSchema = {
        users: {
          columns: [{ name: 'id', type: 'INT', nullable: false }],
          indexes: [{ name: 'idx_id', columns: ['id'], unique: true }]
        }
      };
      const newSchema = {
        users: {
          columns: [{ name: 'id', type: 'INT', nullable: false }],
          indexes: [
            { name: 'idx_id', columns: ['id'], unique: true },
            { name: 'idx_email', columns: ['email'], unique: false }
          ]
        }
      };
      const diff = SchemaEngine.diff(oldSchema, newSchema);
      expect(diff.indexesAdded).toContainEqual(
        expect.objectContaining({ table: 'users', index: expect.objectContaining({ name: 'idx_email' }) })
      );
      
      const plan = SchemaEngine.generateMigrationPlan(diff);
      expect(plan.some(p => p.type === 'ADD_INDEX')).toBe(true);
      expect(plan.find(p => p.type === 'ADD_INDEX').sql).toContain('CREATE INDEX `idx_email` ON `users` (`email`)');
    });

    test('should detect and plan for constraint changes', () => {
      const oldSchema = {
        users: {
          columns: [{ name: 'id', type: 'INT', nullable: false }],
          constraints: []
        }
      };
      const newSchema = {
        users: {
          columns: [{ name: 'id', type: 'INT', nullable: false }],
          constraints: [{ name: 'uq_email', type: 'UNIQUE' }]
        }
      };
      const diff = SchemaEngine.diff(oldSchema, newSchema);
      expect(diff.constraintsAdded).toContainEqual(
        expect.objectContaining({ table: 'users', constraint: expect.objectContaining({ name: 'uq_email' }) })
      );
      
      const plan = SchemaEngine.generateMigrationPlan(diff);
      expect(plan.some(p => p.type === 'ADD_CONSTRAINT')).toBe(true);
    });
  });
