const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const SQLParser = require('../engine/sqlParser');
const SchemaEngine = require('../engine/schemaEngine');
const ExecutionEngine = require('../engine/executionEngine');

const prisma = new PrismaClient();

// Create a new project from a SQL dump
router.post('/import', async (req, res) => {
  try {
    const { name, sql } = req.body;
    const snapshotContent = SQLParser.parse(sql);

    const project = await prisma.project.create({
      data: { name }
    });

    const snapshot = await prisma.schemaSnapshot.create({
      data: { content: snapshotContent }
    });

    const mainBranch = await prisma.branch.create({
      data: {
        name: 'main',
        projectId: project.id
      }
    });

    const initialCommit = await prisma.commit.create({
      data: {
        message: 'Initial import',
        snapshotId: snapshot.id,
        branchId: mainBranch.id
      }
    });

    await prisma.branch.update({
      where: { id: mainBranch.id },
      data: { headId: initialCommit.id }
    });

    // AUTO-APPLY: Sync the imported schema to the real DB immediately
    const currentDbState = await SchemaEngine.getCurrentDbState(prisma);
    const diff = SchemaEngine.diff(currentDbState, snapshotContent);
    const plan = SchemaEngine.generateMigrationPlan(diff, snapshotContent);
    await ExecutionEngine.executeMigrationPlan(plan);

    const projectWithBranches = await prisma.project.findUnique({
      where: { id: project.id },
      include: { branches: true }
    });

    res.json({ project: projectWithBranches, branch: mainBranch });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to import schema' });
  }
});

// Diff two branches
router.get('/diff', async (req, res) => {
  const { branchA, branchB } = req.query;
  console.log(`[Diff] Request received: branchA=${branchA}, branchB=${branchB}`);
  try {
    const bA = await prisma.branch.findUnique({ where: { id: branchA }, include: { head: { include: { snapshot: true } } } });
    const bB = await prisma.branch.findUnique({ where: { id: branchB }, include: { head: { include: { snapshot: true } } } });

    if (!bA || !bB) {
      console.log('[Diff] Error: One or both branches not found');
      return res.status(404).json({ error: 'One or both branches not found' });
    }

    if (!bA.head || !bB.head) {
      console.log('[Diff] Error: One or both branches have no commits');
      return res.status(400).json({ error: 'One or both branches have no commits' });
    }

    if (!bA.head.snapshot || !bB.head.snapshot) {
      console.log('[Diff] Error: One or both snapshots are missing');
      return res.status(400).json({ error: 'One or both snapshots are missing' });
    }

    const contentA = bA.head.snapshot.content;
    const contentB = bB.head.snapshot.content;

    if (contentA === null || contentB === null) {
      console.log('[Diff] Error: One or both snapshot contents are null');
      return res.status(400).json({ error: 'One or both snapshot contents are null' });
    }

    console.log('[Diff] Calculating diff...');
    const diff = SchemaEngine.diff(contentA, contentB);

    const response = { diff };
    console.log('[Diff] Success. Response:', JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error('[Diff] Critical error:', error);
    res.status(500).json({ error: 'Diff failed', details: error.message });
  }
});

// Get project details and current head
router.get('/:id', async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        branches: {
          include: { head: { include: { snapshot: true } } }
        }
      }
    });
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create a new branch
router.post('/branch', async (req, res) => {
  const { name, projectId, sourceBranchId } = req.body;
  try {
    if (!sourceBranchId) {
      return res.status(400).json({ error: 'sourceBranchId is required' });
    }

    const sourceBranch = await prisma.branch.findUnique({
      where: { id: sourceBranchId },
      include: { head: true }
    });

    if (!sourceBranch) {
      return res.status(404).json({ error: 'Source branch not found' });
    }

    const newBranch = await prisma.branch.create({
      data: {
        name,
        projectId,
        headId: sourceBranch.headId ? sourceBranch.headId : null
      }
    });

    res.json(newBranch);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create branch' });
  }
});

// Commit a change to a branch
router.post('/commit', async (req, res) => {
  const { branchId, message, snapshot } = req.body;
  try {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    const parentId = branch.headId;

    const parsedSnapshot = SQLParser.parse(snapshot);
    const snapshotRecord = await prisma.schemaSnapshot.create({
      data: { content: parsedSnapshot }
    });

    const commit = await prisma.commit.create({
      data: {
        message,
        snapshotId: snapshotRecord.id,
        branchId,
        parentId
      }
    });

    await prisma.branch.update({
      where: { id: branchId },
      data: { headId: commit.id }
    });

    // AUTO-SYNC: Apply the commit to the real DB immediately
    const currentDbState = await SchemaEngine.getCurrentDbState(prisma);
    const diff = SchemaEngine.diff(currentDbState, parsedSnapshot);
    const plan = SchemaEngine.generateMigrationPlan(diff, parsedSnapshot);
    await ExecutionEngine.executeMigrationPlan(plan);

    res.json(commit);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to commit change' });
  }
});

// Merge one branch into another
router.post('/merge', async (req, res) => {
  const { sourceBranchId, targetBranchId } = req.body;
  try {
    const sourceBranch = await prisma.branch.findUnique({
      where: { id: sourceBranchId },
      include: { head: { include: { snapshot: true } } }
    });
    const targetBranch = await prisma.branch.findUnique({
      where: { id: targetBranchId },
      include: { head: { include: { snapshot: true } } }
    });

    if (!sourceBranch || !targetBranch) {
      return res.status(404).json({ error: 'One or both branches not found' });
    }

    if (!sourceBranch.head?.snapshot || !targetBranch.head?.snapshot) {
      return res.status(400).json({ error: 'One or both branches have no commits' });
    }

    const sourceSnapshot = sourceBranch.head.snapshot.content;
    const targetSnapshot = targetBranch.head.snapshot.content;

    // In this simplified VCS, a merge takes the source branch's evolved state
    // and applies it to the target branch.
    const mergeMessage = `Merged branch ${sourceBranch.name} into ${targetBranch.name}`;

    const snapshotRecord = await prisma.schemaSnapshot.create({
      data: { content: sourceSnapshot }
    });

    const commit = await prisma.commit.create({
      data: {
        message: mergeMessage,
        snapshotId: snapshotRecord.id,
        branchId: targetBranchId,
        parentId: targetBranch.headId
      }
    });

    await prisma.branch.update({
      where: { id: targetBranchId },
      data: { headId: commit.id }
    });

    // AUTO-SYNC: Apply the merged state to the real DB immediately
    const currentDbState = await SchemaEngine.getCurrentDbState(prisma);
    const diff = SchemaEngine.diff(currentDbState, sourceSnapshot);
    const plan = SchemaEngine.generateMigrationPlan(diff, sourceSnapshot);
    await ExecutionEngine.executeMigrationPlan(plan);

    res.json({
      message: `Successfully merged ${sourceBranch.name} into ${targetBranch.name}`,
      commit: commit
    });
  } catch (error) {
    console.error('[Merge] Critical error:', error);
    res.status(500).json({ error: 'Merge failed', details: error.message });
  }
});

// Apply changes to the real database
router.post('/apply', async (req, res) => {
  const { branchId } = req.body;
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: { head: { include: { snapshot: true } } }
    });

    if (!branch || !branch.head || !branch.head.snapshot) {
      return res.status(404).json({ error: 'Branch or snapshot not found' });
    }

    console.log(`[Apply] Applying branch ${branchId} to database...`);

    // 1. Get actual current DB state
    const currentDbState = await SchemaEngine.getCurrentDbState(prisma);

    // 2. Generate a structured migration plan
    const diff = SchemaEngine.diff(currentDbState, branch.head.snapshot.content);
    const plan = SchemaEngine.generateMigrationPlan(diff, branch.head.snapshot.content);

    if (plan.length === 0) {
      return res.json({ message: 'Database is already up to date', plan: [] });
    }

    // 3. Execute the migration plan (handling large tables automatically)
    const results = await ExecutionEngine.executeMigrationPlan(plan);

    res.json({
      message: 'Schema applied successfully',
      appliedSteps: results.length,
      details: results
    });
  } catch (error) {
    console.error('[Apply] Critical error:', error);
    res.status(500).json({ error: 'Failed to apply schema', details: error.message });
  }
});

module.exports = router;